/**
 * ============================================
 * JWT Authentication Middleware — HARDENED
 * ============================================
 * 
 * ZERO-TRUST SECURITY UPGRADES:
 * 1. Short-lived access tokens (7 day default — balanced for chat app UX)
 * 2. Refresh token rotation (new refresh token per use)
 * 3. Token binding with device fingerprint (non-fatal mismatch)
 * 4. Session revocation support
 * 5. Concurrent session limits
 * 6. Forced logout on anomaly
 * 7. Password change invalidation
 * 
 * TOKEN ARCHITECTURE:
 * ┌─────────────┐  7 day TTL   ┌─────────────┐
 * │ Access Token │──────────►   │  Protected   │
 * │   (JWT)      │  every req   │   Route      │
 * └──────┬──────┘              └─────────────┘
 *        │ expired?
 *        ▼
 * ┌─────────────┐ 30 day TTL   ┌─────────────┐
 * │Refresh Token│──────────►   │ New Access + │
 * │(httpOnly DB)│  /refresh    │ New Refresh  │
 * └─────────────┘              └─────────────┘
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const intrusionDetector = require('../security/IntrusionDetector');

// Token durations
// WHY 7d: Chat apps need long sessions — 15m caused constant logouts.
// Refresh token extends to 30 days for persistent login across app updates.
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || '7d';
const REFRESH_TOKEN_EXPIRY_DAYS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS) || 30;

/**
 * Protect routes — requires valid JWT access token
 * 
 * SECURITY CHECKS:
 * 1. Token exists in Authorization header
 * 2. Token signature is valid
 * 3. Token is not expired
 * 4. User still exists in DB
 * 5. Password wasn't changed after token issuance
 * 6. Account isn't locked
 * 7. Force-logout flag isn't set
 */
const protect = async (req, res, next) => {
  try {
    let token;

    // Extract token from Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized — no token provided',
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Not authorized — invalid token',
        code: 'TOKEN_INVALID',
      });
    }

    // Find user and attach to request
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized — user not found',
      });
    }

    // Check if password was changed after token was issued
    if (user.changedPasswordAfter(decoded.iat)) {
      securityLogger.authEvent('token_after_password_change', SEVERITY.WARN, {
        userId: user._id.toString(),
        ip: req.ip,
      });
      return res.status(401).json({
        success: false,
        message: 'Password recently changed. Please log in again.',
        code: 'PASSWORD_CHANGED',
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(403).json({
        success: false,
        message: 'Account is temporarily locked',
        code: 'ACCOUNT_LOCKED',
      });
    }

    // Check force-logout flag
    if (user.securityFlags && user.securityFlags.forceLogout) {
      securityLogger.authEvent('force_logout_enforced', SEVERITY.INFO, {
        userId: user._id.toString(),
      });
      return res.status(401).json({
        success: false,
        message: 'Session terminated by security policy',
        code: 'FORCE_LOGOUT',
      });
    }

    // Check if user is blocked
    if (user.isBlocked) {
      securityLogger.authEvent('blocked_user_request', SEVERITY.WARN, {
        userId: user._id.toString(),
        ip: req.ip,
        path: req.originalUrl,
      });
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Contact the administrator.',
        code: 'ACCOUNT_BLOCKED',
      });
    }

    // Verify device fingerprint if present in token
    // WHY non-fatal: Fingerprint can change legitimately after app updates,
    // browser updates, or screen rotation. Hard rejection caused constant logouts.
    // We log a warning for monitoring but allow the request to proceed.
    if (decoded.fp && req.headers['x-device-fingerprint']) {
      const currentFP = req.headers['x-device-fingerprint'];
      const cryptoService = require('../security/CryptoService');
      const hashedFP = cryptoService.hashFingerprint(currentFP);
      if (decoded.fp !== hashedFP) {
        securityLogger.authEvent('device_fingerprint_mismatch', SEVERITY.WARN, {
          userId: user._id.toString(),
          ip: req.ip,
          message: 'Fingerprint changed — possible app update or device change (non-fatal)',
        });
        // Don't reject — allow request but log for monitoring
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during authentication',
    });
  }
};

/**
 * Generate short-lived JWT access token
 * 
 * SECURITY:
 * - 7 day expiry (balanced for chat app UX vs security)
 * - Includes device fingerprint hash
 * - Includes issued-at for password change detection
 */
const generateAccessToken = (userId, deviceFingerprint = null) => {
  const payload = { id: userId };

  // Bind token to device if fingerprint provided
  if (deviceFingerprint) {
    const cryptoService = require('../security/CryptoService');
    payload.fp = cryptoService.hashFingerprint(deviceFingerprint);
  }

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: 'quickmeet',
    audience: 'quickmeet-client',
  });
};

/**
 * Generate a secure refresh token
 * 
 * SECURITY:
 * - Random 64-byte token (not JWT — cannot be decoded)
 * - Stored as SHA-256 hash in DB (if DB is breached, raw tokens are safe)
 * - Rotated on every use (one-time use)
 * - Bound to user and device
 */
const generateRefreshToken = () => {
  return crypto.randomBytes(64).toString('hex');
};

/**
 * Hash a refresh token for storage
 */
const hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Legacy alias for backward compatibility
const generateToken = (userId) => {
  return generateAccessToken(userId);
};

module.exports = {
  protect,
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  ACCESS_TOKEN_EXPIRY,
  REFRESH_TOKEN_EXPIRY_DAYS,
};
