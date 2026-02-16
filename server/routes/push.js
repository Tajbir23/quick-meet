/**
 * Push Notification Routes — Self-Hosted (No Firebase)
 * 
 * GET /api/push/pending  — Polled by Android BackgroundService (native HTTP)
 * GET /api/push/health   — Health check for polling service
 * 
 * NOTE: /pending uses JWT from query param (not middleware),
 * because it's called from native Java HttpURLConnection.
 */

const express = require('express');
const router = express.Router();
const { getPendingNotifications, pushHealth } = require('../controllers/pushController');
const { pollingLimiter } = require('../middleware/rateLimiter');

router.use(pollingLimiter);

// No auth middleware — JWT verified inside the handler (query param)
router.get('/pending', getPendingNotifications);
router.get('/health', pushHealth);

module.exports = router;
