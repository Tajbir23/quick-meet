/**
 * ============================================
 * JWT Authentication Middleware
 * ============================================
 * 
 * WHY JWT (not sessions):
 * 1. Stateless — no server-side session storage needed
 * 2. Works across multiple servers (horizontal scaling)
 * 3. Can be used for both HTTP and WebSocket auth
 * 4. Self-contained (carries user ID in payload)
 * 
 * SECURITY:
 * - Token is sent via Authorization: Bearer <token>
 * - Token is verified on every protected request
 * - Expired tokens are rejected
 * - Invalid tokens return 401
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Protect routes — requires valid JWT
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user and attach to request
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized — user not found',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Not authorized — invalid token',
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Not authorized — token expired',
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Server error during authentication',
    });
  }
};

/**
 * Generate JWT token for a user
 */
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

module.exports = { protect, generateToken };
