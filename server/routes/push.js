/**
 * Push Notification Routes
 * 
 * POST /api/push/register   — Register FCM token
 * POST /api/push/unregister — Remove FCM token
 */

const express = require('express');
const router = express.Router();
const { registerToken, unregisterToken } = require('../controllers/pushController');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

router.use(protect);
router.use(apiLimiter);

router.post('/register', registerToken);
router.post('/unregister', unregisterToken);

module.exports = router;
