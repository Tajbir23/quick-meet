/**
 * ============================================
 * Push Notification Controller
 * ============================================
 * 
 * Manages FCM token registration/unregistration
 * and provides helper for sending push notifications.
 */

const User = require('../models/User');
const { sendToMultipleTokens, isFirebaseReady } = require('../config/firebase');

/**
 * POST /api/push/register
 * Register an FCM token for the authenticated user
 * Body: { token, deviceId?, platform? }
 */
const registerToken = async (req, res) => {
  try {
    const { token, deviceId, platform } = req.body;

    if (!token || typeof token !== 'string' || token.length < 10) {
      return res.status(400).json({ success: false, message: 'Valid FCM token is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Remove existing entry for same token or same device
    user.fcmTokens = user.fcmTokens.filter(t =>
      t.token !== token && (deviceId ? t.deviceId !== deviceId : true)
    );

    // Add new token (max 5 devices per user)
    user.fcmTokens.push({
      token,
      deviceId: deviceId || '',
      platform: platform || 'android',
      updatedAt: new Date(),
    });

    // Keep only the 5 most recent tokens
    if (user.fcmTokens.length > 5) {
      user.fcmTokens = user.fcmTokens
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 5);
    }

    await user.save();

    console.log(`📱 FCM token registered for ${user.username} (${platform || 'android'})`);

    res.json({ success: true, message: 'FCM token registered' });
  } catch (err) {
    console.error('FCM register error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to register token' });
  }
};

/**
 * POST /api/push/unregister
 * Remove an FCM token (on logout or device change)
 * Body: { token }
 */
const unregisterToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { fcmTokens: { token } },
    });

    console.log(`📱 FCM token unregistered for user ${req.user._id}`);

    res.json({ success: true, message: 'FCM token removed' });
  } catch (err) {
    console.error('FCM unregister error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to unregister token' });
  }
};

/**
 * Send push notification to a specific user by userId
 * Used by socket handlers when user is offline
 * 
 * @param {string} userId - Target user's MongoDB ID
 * @param {object} payload - { title, body, data }
 * @returns {Promise<boolean>} - true if at least one notification was sent
 */
const sendPushToUser = async (userId, { title, body, data = {} }) => {
  if (!isFirebaseReady()) return false;

  try {
    const user = await User.findById(userId).select('fcmTokens username');
    if (!user || !user.fcmTokens?.length) return false;

    const tokens = user.fcmTokens.map(t => t.token);
    const result = await sendToMultipleTokens(tokens, { title, body, data });

    // Clean up invalid tokens
    if (result.invalidTokens.length > 0) {
      await User.findByIdAndUpdate(userId, {
        $pull: { fcmTokens: { token: { $in: result.invalidTokens } } },
      });
      console.log(`📱 Cleaned ${result.invalidTokens.length} invalid FCM tokens for ${user.username}`);
    }

    return result.success > 0;
  } catch (err) {
    console.error('sendPushToUser error:', err.message);
    return false;
  }
};

module.exports = {
  registerToken,
  unregisterToken,
  sendPushToUser,
};
