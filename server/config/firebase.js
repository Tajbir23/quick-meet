/**
 * ============================================
 * Firebase Admin SDK Configuration
 * ============================================
 * 
 * Used for sending Firebase Cloud Messaging (FCM) push notifications
 * when users are offline (socket disconnected).
 * 
 * SETUP:
 * 1. Go to Firebase Console → Project Settings → Service Accounts
 * 2. Click "Generate new private key" → save as firebase-service-account.json
 * 3. Place it in server/ directory (git-ignored)
 * 
 * OR set environment variable:
 *   FIREBASE_SERVICE_ACCOUNT_BASE64 = base64-encoded JSON
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let firebaseApp = null;
let messaging = null;

function initializeFirebase() {
  if (firebaseApp) return;

  try {
    let serviceAccount = null;

    // Method 1: Base64 env variable (for CI/CD)
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
      console.log('🔥 Firebase: Using service account from environment variable');
    }

    // Method 2: JSON file in server/ directory
    if (!serviceAccount) {
      const filePath = path.join(__dirname, '..', 'firebase-service-account.json');
      if (fs.existsSync(filePath)) {
        serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log('🔥 Firebase: Using service account from file');
      }
    }

    if (!serviceAccount) {
      console.warn('⚠️  Firebase: No service account found. Push notifications DISABLED.');
      console.warn('   Place firebase-service-account.json in server/ directory');
      console.warn('   Or set FIREBASE_SERVICE_ACCOUNT_BASE64 env variable');
      return;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    messaging = admin.messaging();
    console.log('🔥 Firebase Admin SDK initialized successfully');

  } catch (err) {
    console.error('🔥 Firebase initialization failed:', err.message);
    console.warn('   Push notifications will be DISABLED');
  }
}

/**
 * Send a push notification to a specific device
 * @param {string} fcmToken - The device's FCM registration token
 * @param {object} payload - { title, body, data }
 * @returns {Promise<boolean>} - true if sent successfully
 */
async function sendPushNotification(fcmToken, { title, body, data = {} }) {
  if (!messaging) return false;
  if (!fcmToken) return false;

  try {
    const message = {
      token: fcmToken,
      notification: {
        title,
        body,
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        click_action: 'FLUTTER_NOTIFICATION_CLICK', // For Capacitor compatibility
      },
      android: {
        priority: 'high',
        notification: {
          channelId: data.type === 'call' ? 'quickmeet_calls' : 'quickmeet_messages',
          priority: data.type === 'call' ? 'max' : 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
          ...(data.type === 'call' ? {
            // Full-screen intent for incoming calls
            visibility: 'public',
            sticky: true,
          } : {}),
        },
        // Keep the data-only message alive for 5 minutes
        ttl: 300000,
      },
    };

    const result = await messaging.send(message);
    console.log(`📨 FCM sent to ${fcmToken.substring(0, 20)}...: ${title}`);
    return true;
  } catch (err) {
    // Handle invalid/expired tokens
    if (err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered') {
      console.warn(`📨 FCM token invalid/expired: ${fcmToken.substring(0, 20)}...`);
      return { error: 'invalid_token', fcmToken };
    }
    console.error('📨 FCM send error:', err.message);
    return false;
  }
}

/**
 * Send push notification to multiple tokens (same user, multiple devices)
 * @param {string[]} fcmTokens - Array of FCM tokens
 * @param {object} payload - { title, body, data }
 * @returns {Promise<{success: number, failed: number, invalidTokens: string[]}>}
 */
async function sendToMultipleTokens(fcmTokens, payload) {
  if (!messaging || !fcmTokens?.length) {
    return { success: 0, failed: 0, invalidTokens: [] };
  }

  const results = await Promise.allSettled(
    fcmTokens.map(token => sendPushNotification(token, payload))
  );

  const invalidTokens = [];
  let success = 0;
  let failed = 0;

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      if (result.value === true) {
        success++;
      } else if (result.value?.error === 'invalid_token') {
        invalidTokens.push(result.value.fcmToken);
        failed++;
      } else {
        failed++;
      }
    } else {
      failed++;
    }
  });

  return { success, failed, invalidTokens };
}

/**
 * Check if Firebase is initialized and ready
 */
function isFirebaseReady() {
  return !!messaging;
}

module.exports = {
  initializeFirebase,
  sendPushNotification,
  sendToMultipleTokens,
  isFirebaseReady,
};
