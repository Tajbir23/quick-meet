/**
 * ============================================
 * Rate Limiter Middleware
 * ============================================
 * 
 * WHY rate limiting:
 * 1. Prevents brute-force attacks on login/signup
 * 2. Prevents API abuse (DoS)
 * 3. Protects server resources
 * 4. Essential for any production system
 * 
 * Strategy:
 * - General API: 100 requests per 15 minutes per IP
 * - Auth routes: 20 requests per 15 minutes per IP (stricter)
 * - File upload: 10 requests per 15 minutes per IP (strictest)
 */

const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later',
  },
  standardHeaders: true,  // Return rate limit info in headers
  legacyHeaders: false,
});

/**
 * Auth routes rate limiter (stricter)
 * WHY: Login/signup are prime targets for brute-force
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again in 15 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * File upload rate limiter (strictest)
 * WHY: File uploads are resource-intensive (disk I/O, storage)
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many file uploads, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter, uploadLimiter };
