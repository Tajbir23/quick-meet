const express = require('express');
const router = express.Router();
const {
  signup,
  login,
  logout,
  getMe,
  refreshAccessToken,
  revokeAllSessions,
  getSecurityStatus,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { authLimiter, refreshLimiter } = require('../middleware/rateLimiter');

// Public routes (rate limited)
router.post('/signup', authLimiter, signup);
router.post('/login', authLimiter, login);
router.post('/refresh', refreshLimiter, refreshAccessToken);

// Protected routes
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.post('/revoke-all-sessions', protect, revokeAllSessions);
router.get('/security-status', protect, getSecurityStatus);

module.exports = router;
