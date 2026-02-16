/**
 * ============================================
 * Push Notification Service (Client)
 * ============================================
 * 
 * Handles FCM push notification registration on Android.
 * Uses the native FirebaseMessagingPlugin (Capacitor custom plugin)
 * to get the FCM token and register it with the server.
 * 
 * Flow:
 * 1. App starts → initPushNotifications()
 * 2. Gets FCM token from native plugin
 * 3. Sends token to server via POST /api/push/register
 * 4. Server stores token in User.fcmTokens
 * 5. When user is offline, server sends FCM push to wake the app
 */

import { API_URL } from '../utils/constants';

let _fcmToken = null;
let _registered = false;

/**
 * Check if we're running in a Capacitor native Android environment
 */
function isAndroid() {
  return !!window.Capacitor?.isNativePlatform?.() &&
    window.Capacitor?.getPlatform?.() === 'android';
}

/**
 * Initialize push notifications
 * Call this after user is authenticated
 */
export async function initPushNotifications() {
  if (!isAndroid()) return;

  try {
    const FirebaseMessaging = window.Capacitor?.Plugins?.FirebaseMessaging;
    if (!FirebaseMessaging) {
      console.warn('[Push] FirebaseMessaging plugin not available');
      return;
    }

    // Get FCM token
    const result = await FirebaseMessaging.getToken();
    if (result?.token) {
      _fcmToken = result.token;
      console.log('[Push] FCM token obtained:', _fcmToken.substring(0, 20) + '...');
      
      // Register token with server
      await registerTokenWithServer(_fcmToken);
    }

    // Listen for token refresh
    FirebaseMessaging.addListener('tokenReceived', async (data) => {
      if (data?.token && data.token !== _fcmToken) {
        console.log('[Push] FCM token refreshed');
        _fcmToken = data.token;
        await registerTokenWithServer(_fcmToken);
      }
    });

    // Listen for push notifications received while app is in foreground
    FirebaseMessaging.addListener('pushNotificationReceived', (notification) => {
      console.log('[Push] Foreground push received:', notification);
      // Don't show notification if app is in foreground — socket handles it
    });

    // Listen for notification tap (app was in background/killed)
    FirebaseMessaging.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[Push] Notification tapped:', action);
      handleNotificationTap(action?.notification?.data);
    });

  } catch (err) {
    console.error('[Push] Init failed:', err.message);
  }
}

/**
 * Register FCM token with the server
 */
async function registerTokenWithServer(token) {
  try {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    const res = await fetch(`${API_URL}/push/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token,
        platform: 'android',
        deviceId: await getDeviceId(),
      }),
    });

    if (res.ok) {
      _registered = true;
      console.log('[Push] Token registered with server');
    } else {
      console.warn('[Push] Token registration failed:', res.status);
    }
  } catch (err) {
    console.error('[Push] Token registration error:', err.message);
  }
}

/**
 * Unregister FCM token (call on logout)
 */
export async function unregisterPushNotifications() {
  if (!_fcmToken) return;

  try {
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;

    await fetch(`${API_URL}/push/unregister`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: _fcmToken }),
    });

    _fcmToken = null;
    _registered = false;
    console.log('[Push] Token unregistered');
  } catch (err) {
    console.warn('[Push] Unregister error:', err.message);
  }
}

/**
 * Handle notification tap — navigate to the right screen
 */
function handleNotificationTap(data) {
  if (!data) return;

  if (data.type === 'call') {
    // Bring app to foreground — the socket will handle the call
    console.log('[Push] Call notification tapped, app opened');
  } else if (data.type === 'message' && data.senderId) {
    // Navigate to chat with the sender
    // This will be picked up by the app's routing
    window.dispatchEvent(new CustomEvent('push:navigate', {
      detail: { type: 'chat', userId: data.senderId, userName: data.senderName },
    }));
  }
}

/**
 * Get a unique device identifier
 */
async function getDeviceId() {
  try {
    const DevicePlugin = window.Capacitor?.Plugins?.Device;
    if (DevicePlugin) {
      const info = await DevicePlugin.getId();
      return info?.identifier || info?.uuid || 'unknown';
    }
  } catch (e) {}
  return 'android-' + Math.random().toString(36).substring(2, 10);
}

/**
 * Get current FCM token
 */
export function getFcmToken() {
  return _fcmToken;
}

/**
 * Check if push notifications are registered
 */
export function isPushRegistered() {
  return _registered;
}
