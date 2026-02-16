/**
 * ============================================
 * Push Notification Controller — Self-Hosted (No Firebase)
 * ============================================
 * 
 * Instead of FCM, uses an in-memory queue of pending notifications.
 * The Android BackgroundService polls GET /api/push/pending every 5 seconds
 * from native Java (HTTP), so it works even when WebView is suspended.
 * 
 * Flow:
 * 1. Socket handler detects user is offline (no socket)
 * 2. Stores notification in pendingNotifications Map
 * 3. Android BackgroundService polls /api/push/pending?token=JWT
 * 4. Server returns pending notifications and clears them
 * 5. Native Java shows Android system notification
 * 
 * Notifications auto-expire after 5 minutes.
 */

const jwt = require('jsonwebtoken');

// In-memory pending notification queue: userId → [{ type, title, body, data, createdAt }]
const pendingNotifications = new Map();

// Auto-cleanup interval — remove expired notifications every 60 seconds
const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [userId, notifs] of pendingNotifications) {
    const filtered = notifs.filter(n => (now - n.createdAt) < EXPIRY_MS);
    if (filtered.length === 0) {
      pendingNotifications.delete(userId);
    } else {
      pendingNotifications.set(userId, filtered);
    }
  }
}, 60000);

/**
 * Store a pending notification for an offline user
 * Called by socket handlers when user has no active socket
 * 
 * @param {string} userId
 * @param {object} notification - { type, title, body, data }
 */
const storePendingNotification = (userId, { type, title, body, data = {} }) => {
  if (!userId) return;

  const notif = {
    type: type || 'message',
    title: title || 'Quick Meet',
    body: body || '',
    data,
    createdAt: Date.now(),
  };

  if (!pendingNotifications.has(userId)) {
    pendingNotifications.set(userId, []);
  }

  const queue = pendingNotifications.get(userId);
  queue.push(notif);

  // Keep max 20 pending notifications per user
  if (queue.length > 20) {
    queue.splice(0, queue.length - 20);
  }

  console.log(`📨 Pending notification stored for ${userId}: ${title} — ${body}`);
};

/**
 * GET /api/push/pending
 * 
 * Polled by Android BackgroundService (native HTTP client).
 * Auth via JWT token in query param.
 * 
 * Query params: token (JWT)
 * Returns: { notifications: [...] } and clears the queue
 */
const getPendingNotifications = (req, res) => {
  try {
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Token required' });
    }

    // Verify JWT
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Invalid token payload' });
    }

    // Get and clear pending notifications
    const notifications = pendingNotifications.get(userId) || [];
    pendingNotifications.delete(userId);

    res.json({
      success: true,
      notifications,
      count: notifications.length,
    });
  } catch (err) {
    console.error('getPendingNotifications error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/push/health
 * Simple health check for the native polling service
 */
const pushHealth = (req, res) => {
  res.json({ success: true, time: Date.now() });
};

/**
 * Clear all call-type pending notifications for a user.
 * Called when a call is answered, rejected, or timed out.
 */
const clearPendingCallNotifications = (userId) => {
  if (!userId) return;
  const queue = pendingNotifications.get(userId);
  if (!queue) return;
  const filtered = queue.filter(n => n.type !== 'call');
  if (filtered.length === 0) {
    pendingNotifications.delete(userId);
  } else {
    pendingNotifications.set(userId, filtered);
  }
};

module.exports = {
  storePendingNotification,
  clearPendingCallNotifications,
  getPendingNotifications,
  pushHealth,
};
