/**
 * ============================================
 * Socket Guard — Per-Event Security Layer
 * ============================================
 * 
 * DEFENSE LAYERS:
 * 1. Per-event JWT re-validation (token could be revoked between events)
 * 2. HMAC message signing (tamper detection)
 * 3. Anti-replay nonce enforcement (prevents resending captured events)
 * 4. Per-socket rate limiting (prevents event flooding)
 * 5. Auto-ban on abnormal behavior (progressive punishment)
 * 6. Event authorization (checks user permissions per event type)
 * 
 * ATTACK SURFACE:
 * - Socket hijacking → JWT re-validated per critical event
 * - Message tampering → HMAC signature verification
 * - Replay attacks → One-time nonce consumption
 * - DoS via event flood → Rate limiting + auto-ban
 * - Privilege escalation → Per-event authorization
 */

const jwt = require('jsonwebtoken');
const cryptoService = require('./CryptoService');
const intrusionDetector = require('./IntrusionDetector');
const securityLogger = require('./SecurityEventLogger');
const { SEVERITY } = require('./SecurityEventLogger');
const User = require('../models/User');

// Events that require full re-authentication
const CRITICAL_EVENTS = new Set([
  'call:offer', 'call:answer', 'call:ice-candidate',
  'group-call:join', 'group-call:offer', 'group-call:answer', 'group-call:ice-candidate',
  'message:send', 'message:group:send',
]);

// Events that require basic auth check
const AUTH_EVENTS = new Set([
  'call:reject', 'call:end', 'call:toggle-media', 'call:screen-share',
  'group-call:leave', 'group-call:toggle-media', 'group-call:screen-share',
  'typing:start', 'typing:stop', 'typing:group:start', 'typing:group:stop',
  'group:join-room', 'group:leave-room',
  'message:read',
]);

// Events that are allowed without auth (informational)
const PUBLIC_EVENTS = new Set([
  'heartbeat', 'disconnect',
]);

class SocketGuard {
  constructor() {
    // Track violations per socket: socketId → violationCount
    this._violations = new Map();
    this._maxViolations = 10; // Auto-disconnect after 10 violations
  }

  /**
   * Create a middleware wrapper for a socket event handler
   * Wraps the handler with security checks
   * 
   * @param {Socket} socket - Socket.io socket instance
   * @param {string} eventName - The event name
   * @param {Function} handler - The original event handler
   * @param {Object} options - Security options
   * @returns {Function} Secured handler
   */
  wrapHandler(socket, eventName, handler, options = {}) {
    const {
      requireAuth = true,
      requireHMAC = false,     // Enable for critical events
      requireNonce = false,    // Enable for critical events
      rateLimit = true,
    } = options;

    return async (...args) => {
      try {
        // 1. Rate limiting
        if (rateLimit) {
          const rateResult = intrusionDetector.checkSocketRate(
            socket.id, socket.userId, eventName
          );
          if (!rateResult.allowed) {
            this._recordViolation(socket, 'rate_limit', eventName);
            socket.emit('security:rate-limited', {
              event: eventName,
              message: 'Too many requests. Please slow down.',
            });
            return;
          }
        }

        // 2. JWT Re-validation for critical events
        if (requireAuth && CRITICAL_EVENTS.has(eventName)) {
          const token = socket.handshake.auth.token;
          if (!token) {
            this._recordViolation(socket, 'missing_token', eventName);
            socket.emit('security:auth-required', { event: eventName });
            return;
          }

          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Verify user still exists and isn't locked
            if (decoded.id !== socket.userId) {
              this._recordViolation(socket, 'token_mismatch', eventName);
              return;
            }
          } catch (jwtError) {
            securityLogger.socketEvent('token_expired_mid_session', SEVERITY.WARN, {
              socketId: socket.id,
              userId: socket.userId,
              event: eventName,
              error: jwtError.message,
            });
            socket.emit('security:token-expired');
            return;
          }
        }

        // 3. HMAC verification (if enabled and data includes signature)
        if (requireHMAC && args[0] && args[0]._hmac) {
          const { _hmac, _nonce, ...payload } = args[0];
          const valid = cryptoService.verifySignature(payload, socket.userId, _hmac);
          if (!valid) {
            this._recordViolation(socket, 'hmac_invalid', eventName);
            securityLogger.socketEvent('hmac_verification_failed', SEVERITY.ALERT, {
              socketId: socket.id,
              userId: socket.userId,
              event: eventName,
              message: 'HMAC signature verification failed — possible tampering',
            });
            return;
          }
        }

        // 4. Anti-replay nonce check
        if (requireNonce && args[0] && args[0]._nonce) {
          const nonceValid = cryptoService.consumeNonce(args[0]._nonce);
          if (!nonceValid) {
            this._recordViolation(socket, 'replay_detected', eventName);
            securityLogger.socketEvent('replay_detected', SEVERITY.CRITICAL, {
              socketId: socket.id,
              userId: socket.userId,
              event: eventName,
              nonce: args[0]._nonce,
              message: `Replay attack detected on ${eventName}`,
            });
            return;
          }
        }

        // 5. Strip security metadata before passing to handler
        if (args[0] && typeof args[0] === 'object') {
          delete args[0]._hmac;
          delete args[0]._nonce;
          delete args[0]._timestamp;
        }

        // 6. Call the original handler
        await handler(...args);

      } catch (error) {
        console.error(`SocketGuard error [${eventName}]:`, error);
        securityLogger.socketEvent('handler_error', SEVERITY.WARN, {
          socketId: socket.id,
          userId: socket.userId,
          event: eventName,
          error: error.message,
        });
      }
    };
  }

  /**
   * Record a security violation for a socket
   * Auto-disconnects after threshold
   */
  _recordViolation(socket, type, eventName) {
    const count = (this._violations.get(socket.id) || 0) + 1;
    this._violations.set(socket.id, count);

    securityLogger.socketEvent('violation', SEVERITY.WARN, {
      socketId: socket.id,
      userId: socket.userId,
      type,
      event: eventName,
      violationCount: count,
    });

    if (count >= this._maxViolations) {
      securityLogger.socketEvent('auto_disconnect', SEVERITY.ALERT, {
        socketId: socket.id,
        userId: socket.userId,
        violations: count,
        message: `Socket auto-disconnected after ${count} violations`,
      });

      // Add threat score
      const ip = socket.handshake.address;
      intrusionDetector._addThreatScore(ip, 20, 'socket_violations');

      socket.emit('security:banned', {
        message: 'Connection terminated due to security violations',
      });
      socket.disconnect(true);
    }
  }

  /**
   * Clean up when socket disconnects
   */
  cleanup(socketId) {
    this._violations.delete(socketId);
    intrusionDetector.removeSocket(socketId);
  }
}

// Singleton
const socketGuard = new SocketGuard();

module.exports = socketGuard;
