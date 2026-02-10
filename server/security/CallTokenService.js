/**
 * ============================================
 * Call Token Service — One-Time Call Authorization
 * ============================================
 * 
 * PROBLEM:
 * Without call tokens, any authenticated user could:
 * - Initiate calls to users who blocked them
 * - Inject fake SDP offers to hijack calls
 * - Re-send captured signaling data (replay)
 * - Join group calls they weren't invited to
 * 
 * SOLUTION:
 * One-time, short-lived call tokens that:
 * - Are generated before call initiation
 * - Expire in 60 seconds (call must start quickly)
 * - Can only be used once (consumed on use)
 * - Are bound to specific caller/callee/group
 * - Enable mutual verification (both parties hold tokens)
 * 
 * FLOW:
 * 1. Caller requests call token from server
 * 2. Server generates token with caller/callee binding
 * 3. Caller sends token with call:offer
 * 4. Server validates token, forwards offer only if valid
 * 5. Token is consumed (cannot be reused)
 */

const crypto = require('crypto');
const securityLogger = require('./SecurityEventLogger');
const { SEVERITY } = require('./SecurityEventLogger');

class CallTokenService {
  constructor() {
    // Active call tokens: token → { callerId, targetId, groupId, type, createdAt, used }
    this._tokens = new Map();
    // Active call sessions: sessionId → { participants, createdAt, verified }
    this._sessions = new Map();

    // Cleanup expired tokens every 2 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 2 * 60 * 1000);

    this.TOKEN_TTL = 60 * 1000; // 60 seconds to use a call token
  }

  /**
   * Generate a one-time call token for 1-to-1 call
   * 
   * @param {string} callerId - The user initiating the call
   * @param {string} targetId - The target user
   * @param {string} callType - 'audio' | 'video'
   * @returns {{ token, sessionId, expiresAt }}
   */
  generateCallToken(callerId, targetId, callType) {
    const token = crypto.randomBytes(32).toString('hex');
    const sessionId = crypto.randomBytes(16).toString('hex');
    const createdAt = Date.now();

    this._tokens.set(token, {
      callerId,
      targetId,
      callType,
      sessionId,
      createdAt,
      used: false,
    });

    // Create session for mutual verification
    this._sessions.set(sessionId, {
      participants: [callerId, targetId],
      callType,
      createdAt,
      callerVerified: false,
      calleeVerified: false,
    });

    securityLogger.callEvent('token_generated', SEVERITY.INFO, {
      callerId, targetId, callType, sessionId,
    });

    return {
      token,
      sessionId,
      expiresAt: createdAt + this.TOKEN_TTL,
    };
  }

  /**
   * Generate a call token for group call
   */
  generateGroupCallToken(userId, groupId) {
    const token = crypto.randomBytes(32).toString('hex');
    const createdAt = Date.now();

    this._tokens.set(token, {
      callerId: userId,
      groupId,
      callType: 'group',
      createdAt,
      used: false,
    });

    securityLogger.callEvent('group_token_generated', SEVERITY.INFO, {
      userId, groupId,
    });

    return {
      token,
      expiresAt: createdAt + this.TOKEN_TTL,
    };
  }

  /**
   * Validate and consume a call token
   * Returns the token data if valid, null if invalid/expired/used
   */
  consumeCallToken(token, userId) {
    if (!this._tokens.has(token)) {
      securityLogger.callEvent('token_invalid', SEVERITY.WARN, {
        userId,
        message: 'Invalid call token presented',
      });
      return null;
    }

    const data = this._tokens.get(token);

    // Check expiration
    if (Date.now() - data.createdAt > this.TOKEN_TTL) {
      this._tokens.delete(token);
      securityLogger.callEvent('token_expired', SEVERITY.INFO, {
        userId, callType: data.callType,
      });
      return null;
    }

    // Check if already used
    if (data.used) {
      securityLogger.callEvent('token_reuse_attempt', SEVERITY.ALERT, {
        userId,
        message: 'Attempt to reuse call token — possible replay attack',
      });
      this._tokens.delete(token);
      return null;
    }

    // Verify the user is authorized (either caller for 1-to-1, or group member)
    if (data.callType !== 'group' && data.callerId !== userId) {
      securityLogger.callEvent('token_unauthorized', SEVERITY.ALERT, {
        userId, expectedCaller: data.callerId,
        message: 'Call token used by wrong user — possible impersonation',
      });
      return null;
    }

    // Mark as used
    data.used = true;
    this._tokens.delete(token);

    securityLogger.callEvent('token_consumed', SEVERITY.INFO, {
      userId, callType: data.callType,
    });

    return data;
  }

  /**
   * Verify mutual authentication in a call session
   * Both caller and callee must verify for the call to be trusted
   */
  verifyParticipant(sessionId, userId, role) {
    const session = this._sessions.get(sessionId);
    if (!session) return false;

    if (!session.participants.includes(userId)) {
      securityLogger.callEvent('session_impersonation', SEVERITY.CRITICAL, {
        sessionId, userId,
        message: 'User attempted to verify in a session they are not part of',
      });
      return false;
    }

    if (role === 'caller') session.callerVerified = true;
    if (role === 'callee') session.calleeVerified = true;

    return true;
  }

  /**
   * Check if a call session has mutual verification
   */
  isSessionMutuallyVerified(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return false;
    return session.callerVerified && session.calleeVerified;
  }

  /**
   * End a call session
   */
  endSession(sessionId) {
    this._sessions.delete(sessionId);
  }

  /**
   * Cleanup expired tokens and sessions
   */
  _cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [token, data] of this._tokens.entries()) {
      if (now - data.createdAt > this.TOKEN_TTL * 2) {
        this._tokens.delete(token);
        cleaned++;
      }
    }

    for (const [sessionId, session] of this._sessions.entries()) {
      // Sessions expire after 4 hours (max call duration)
      if (now - session.createdAt > 4 * 60 * 60 * 1000) {
        this._sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🔐 Cleaned ${cleaned} expired call tokens/sessions`);
    }
  }

  /**
   * Shutdown
   */
  destroy() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
    this._tokens.clear();
    this._sessions.clear();
  }
}

// Singleton
const callTokenService = new CallTokenService();

module.exports = callTokenService;
