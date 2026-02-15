/**
 * File Transfer Routes
 * REST endpoints for P2P file transfer metadata (not file data)
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getActiveTransfers,
  getTransferHistory,
  getTransferDetails,
} = require('../controllers/fileTransferController');

// All routes require authentication
router.use(protect);

/**
 * GET /api/transfers/turn-credentials
 * Generate time-limited TURN credentials using TURN REST API (RFC 7635 / use-auth-secret)
 * 
 * WHY: Static TURN credentials cause stale-nonce (438) and wrong-transaction-ID (437)
 * errors on coturn, especially when multiple devices share the same NAT (public IP).
 * Ephemeral credentials avoid all nonce-related issues because each credential set
 * is fresh and time-limited.
 */
router.get('/turn-credentials', (req, res) => {
  try {
    const TURN_SECRET = process.env.TURN_SECRET || 'QuickMeetTurnSecret2026VeryLongAndSecure';
    const TURN_SERVER_IP = process.env.TURN_SERVER_IP || '167.71.235.56';
    const TURN_DOMAIN = process.env.TURN_DOMAIN || 'quickmeet.genuinesoftmart.store';
    const TTL = 86400; // 24 hours

    // Username format: <expiry-timestamp>:<user-id>
    const expiry = Math.floor(Date.now() / 1000) + TTL;
    const username = `${expiry}:${req.user._id}`;

    // HMAC-SHA1(secret, username) → base64 = credential
    const hmac = crypto.createHmac('sha1', TURN_SECRET);
    hmac.update(username);
    const credential = hmac.digest('base64');

    res.json({
      username,
      credential,
      ttl: TTL,
      uris: [
        // UDP (primary)
        `turn:${TURN_SERVER_IP}:3478`,
        `turn:${TURN_DOMAIN}:3478`,
        // TCP fallback (for restrictive networks / Android WebView)
        `turn:${TURN_SERVER_IP}:3478?transport=tcp`,
        `turn:${TURN_DOMAIN}:3478?transport=tcp`,
        // TLS/TCP (most restrictive networks)
        `turns:${TURN_DOMAIN}:5349?transport=tcp`,
        `turns:${TURN_SERVER_IP}:5349?transport=tcp`,
      ],
    });
  } catch (err) {
    console.error('Failed to generate TURN credentials:', err);
    res.status(500).json({ error: 'Failed to generate TURN credentials' });
  }
});

router.get('/active', getActiveTransfers);
router.get('/history/:userId', getTransferHistory);
router.get('/:transferId', getTransferDetails);

module.exports = router;
