/**
 * ============================================
 * Owner Authorization Middleware
 * ============================================
 * 
 * Ensures only the owner (role === 'owner') can access
 * owner-specific routes (dashboard, user blocking, logs, etc.)
 * 
 * USAGE: router.use(protect, requireOwner);
 * 
 * SECURITY:
 * - Must be used AFTER the protect middleware
 * - Checks user.role from the DB (not from token)
 * - Logs unauthorized access attempts
 */

const User = require('../models/User');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');

/**
 * Middleware: Require owner role
 * Must be used after protect middleware
 */
const requireOwner = async (req, res, next) => {
  try {
    // req.user is set by the protect middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated',
      });
    }

    // Double-check from DB (don't trust cached data)
    const user = await User.findById(req.user._id).select('role');

    if (!user || user.role !== 'owner') {
      securityLogger.authEvent('owner_access_denied', SEVERITY.ALERT, {
        userId: req.user._id.toString(),
        username: req.user.username,
        ip: req.ip,
        path: req.originalUrl,
        message: 'Non-owner attempted to access owner-only route',
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied — owner only',
      });
    }

    next();
  } catch (error) {
    console.error('Owner auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error during authorization',
    });
  }
};

/**
 * Middleware: Check if user is blocked
 * Used in the protect middleware chain to reject blocked users
 */
const checkBlocked = async (req, res, next) => {
  try {
    if (!req.user) return next();

    if (req.user.isBlocked) {
      securityLogger.authEvent('blocked_user_access', SEVERITY.WARN, {
        userId: req.user._id.toString(),
        username: req.user.username,
        ip: req.ip,
        path: req.originalUrl,
      });

      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Contact the administrator.',
        code: 'ACCOUNT_BLOCKED',
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { requireOwner, checkBlocked };
