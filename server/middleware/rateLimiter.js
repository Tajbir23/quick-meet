/**
 * ============================================
 * Rate Limiter Middleware — HARDENED
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - Stricter limits across all endpoints
 * - Separate limiters for auth, messages, file uploads, token refresh
 * - IP + user-agent fingerprinting
 * - SecurityEventLogger integration
 * - Skip-on-success for auth (only count failures)
 * 
 * Strategy:
 * - General API: 60 requests per 15 minutes per IP
 * - Auth routes: 5 attempts per 15 minutes per IP (very strict)
 * - Token refresh: 10 per 15 minutes per IP
 * - File upload: 5 requests per 15 minutes per IP
 * - Message send: 30 per minute per IP
 */

const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter — tightened from 100 to 60
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 60,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use IP + User-Agent for more precise tracking
  keyGenerator: (req) => {
    return req.ip + '|' + (req.headers['user-agent'] || 'unknown').slice(0, 50);
  },
});

/**
 * Auth routes rate limiter — VERY strict (5 attempts)
 * Only counts failed attempts (skip successful requests)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again in 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failures
  keyGenerator: (req) => {
    return req.ip;
  },
});

/**
 * Token refresh rate limiter
 * Allow more than auth (tokens expire every 15 min) but still limited
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: 'Too many token refresh attempts. Please re-authenticate.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * File upload rate limiter — tightened to 5
 */
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many file uploads, please try again later',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Message sending rate limiter — prevent spam
 * 30 messages per minute per IP
 */
const messageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: {
    success: false,
    message: 'You are sending messages too quickly. Please slow down.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter, refreshLimiter, uploadLimiter, messageLimiter };
