/**
 * ============================================
 * Background Service Manager
 * ============================================
 * 
 * Manages the Android foreground service that keeps
 * Quick Meet running in background (like Messenger).
 * 
 * Features:
 * - Persistent foreground service with notification
 * - Auto-start on boot via BootReceiver
 * - Battery optimization bypass request
 * - Notification action buttons (Answer/Decline calls, Accept/Reject transfers)
 * - Pending action polling (JS reads actions from notification buttons)
 * - Message notifications when app is in background
 * - File transfer progress (persistent until complete)
 * - Call notifications (incoming + ongoing with chronometer)
 * 
 * On non-Android platforms, this is a no-op.
 */

import { isAndroid } from '../utils/platform';

let BackgroundServicePlugin = null;
let AppPlugin = null;
let _isInBackground = false;
let _serviceRunning = false;
let _actionPollTimer = null;
let _currentState = {
  inCall: false,
  callType: null,
  callerName: null,
  transferring: false,
  transferProgress: -1,
  transferFileName: null,
  transferDirection: null, // 'sending' | 'receiving'
};

// Callbacks for notification action buttons
let _onAnswerCall = null;
let _onDeclineCall = null;
let _onAcceptTransfer = null;
let _onRejectTransfer = null;

/**
 * Initialize the background service
 * Call this once after user authentication
 */
export const initBackgroundService = async () => {
  if (!isAndroid()) return;
  
  try {
    const plugins = window.Capacitor?.Plugins;
    if (!plugins) {
      console.warn('[BackgroundService] Capacitor not available');
      return;
    }
    
    BackgroundServicePlugin = plugins.BackgroundService;
    AppPlugin = plugins.App;
    
    // Start the foreground service
    await startService();
    
    // Pass JWT token to native service for HTTP polling
    await passAuthTokenToNative();
    
    // Request battery optimization bypass (shows system dialog once)
    await requestBatteryOptimization();
    
    // Listen for app state changes
    AppPlugin.addListener('appStateChange', handleAppStateChange);
    
    // Listen for app being brought to foreground via notification tap
    AppPlugin.addListener('appUrlOpen', () => {
      _isInBackground = false;
    });
    
    // Start polling for pending actions from notification buttons
    startActionPolling();
    
    console.log('[BackgroundService] Initialized successfully');
  } catch (err) {
    console.warn('[BackgroundService] Init failed (non-fatal):', err.message);
  }
};

/**
 * Pass JWT auth token + refresh token to native BackgroundService for HTTP polling.
 * The native service polls /api/push/pending every 5 seconds
 * to receive notifications even when WebView JS is suspended.
 * The refresh token allows the native service to auto-renew the
 * access token when it expires (every 15 min).
 */
export const passAuthTokenToNative = async () => {
  if (!BackgroundServicePlugin) return;
  
  try {
    const token = localStorage.getItem('accessToken') || localStorage.getItem('token');
    const refreshToken = localStorage.getItem('refreshToken');
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'https://quickmeet.genuinesoftmart.store';
    
    if (token) {
      await BackgroundServicePlugin.setAuthToken({ token, refreshToken, serverUrl });
      console.log('[BackgroundService] Auth token + refresh token passed to native polling');
    }
  } catch (err) {
    console.warn('[BackgroundService] setAuthToken failed:', err.message);
  }
};

/**
 * Start the foreground service
 */
export const startService = async () => {
  if (!BackgroundServicePlugin) return;
  
  try {
    await BackgroundServicePlugin.start({
      title: 'Quick Meet',
      body: 'Connected — waiting for calls & messages',
    });
    _serviceRunning = true;
    console.log('[BackgroundService] Service started');
  } catch (err) {
    console.warn('[BackgroundService] Start failed:', err.message);
  }
};

/**
 * Stop the foreground service
 * Call on logout
 */
export const stopService = async () => {
  if (!BackgroundServicePlugin) return;
  
  try {
    stopActionPolling();
    await BackgroundServicePlugin.stop();
    _serviceRunning = false;
    _isInBackground = false;
    console.log('[BackgroundService] Service stopped');
  } catch (err) {
    console.warn('[BackgroundService] Stop failed:', err.message);
  }
};

/**
 * Request battery optimization bypass
 * Shows system dialog to allow unrestricted background
 */
export const requestBatteryOptimization = async () => {
  if (!BackgroundServicePlugin) return;
  
  try {
    // First check if already exempt
    const check = await BackgroundServicePlugin.isBatteryOptimizationDisabled();
    if (check?.disabled) {
      console.log('[BackgroundService] Battery optimization already disabled');
      return;
    }
    
    // Request bypass
    const result = await BackgroundServicePlugin.requestBatteryOptimization();
    console.log('[BackgroundService] Battery optimization request:', result);
  } catch (err) {
    console.warn('[BackgroundService] Battery optimization request failed:', err.message);
  }
};

/**
 * Handle app state change (foreground/background)
 */
const handleAppStateChange = ({ isActive }) => {
  _isInBackground = !isActive;
  console.log(`[BackgroundService] App state: ${isActive ? 'FOREGROUND' : 'BACKGROUND'}`);
  
  if (!isActive) {
    // App went to background — update notification with current state
    updateNotificationForCurrentState();
  }
};

/**
 * Check if app is currently in background
 */
export const isInBackground = () => _isInBackground;

/**
 * Check if the background service is running
 */
export const isServiceRunning = () => _serviceRunning;

// ========================================
// Notification Action Polling
// ========================================

/**
 * Start polling for pending actions from notification buttons.
 * When user taps Answer/Decline/Accept/Reject on notification,
 * the native side stores the action and JS polls for it.
 */
const startActionPolling = () => {
  if (_actionPollTimer) return;
  
  _actionPollTimer = setInterval(async () => {
    if (!BackgroundServicePlugin) return;
    
    try {
      const result = await BackgroundServicePlugin.getPendingAction();
      const action = result?.action;
      if (!action) return;
      
      console.log(`[BackgroundService] Pending action received: ${action}`);
      
      switch (action) {
        case 'answer_call':
          if (_onAnswerCall) _onAnswerCall();
          break;
        case 'decline_call':
          if (_onDeclineCall) _onDeclineCall();
          break;
        case 'accept_transfer':
          if (_onAcceptTransfer) _onAcceptTransfer();
          break;
        case 'reject_transfer':
          if (_onRejectTransfer) _onRejectTransfer();
          break;
      }
    } catch (err) {
      // Silent — service may not be running
    }
  }, 500); // Poll every 500ms
};

const stopActionPolling = () => {
  if (_actionPollTimer) {
    clearInterval(_actionPollTimer);
    _actionPollTimer = null;
  }
};

/**
 * Register callback for notification action buttons
 */
export const setNotificationActionCallbacks = ({
  onAnswerCall,
  onDeclineCall,
  onAcceptTransfer,
  onRejectTransfer,
}) => {
  _onAnswerCall = onAnswerCall || null;
  _onDeclineCall = onDeclineCall || null;
  _onAcceptTransfer = onAcceptTransfer || null;
  _onRejectTransfer = onRejectTransfer || null;
};

// ========================================
// Notification Updates
// ========================================

/**
 * Update the persistent notification based on current state
 */
const updateNotificationForCurrentState = async () => {
  if (!BackgroundServicePlugin || !_serviceRunning) return;
  
  try {
    let title = 'Quick Meet';
    let body = 'Connected — waiting for calls & messages';
    
    if (_currentState.inCall) {
      const type = _currentState.callType === 'video' ? 'Video' : 'Voice';
      title = `${type} Call Active`;
      body = `In call with ${_currentState.callerName || 'someone'}`;
    } else if (_currentState.transferring) {
      const dir = _currentState.transferDirection === 'sending' ? 'Sending' : 'Receiving';
      title = `${dir}: ${_currentState.transferFileName || 'file'}`;
      if (_currentState.transferProgress >= 0) {
        body = `Progress: ${_currentState.transferProgress}%`;
      } else {
        body = 'Preparing transfer...';
      }
    }
    
    await BackgroundServicePlugin.updateNotification({ title, body });
  } catch (err) {
    // Silent fail
  }
};

// ========================================
// Call Notifications  
// ========================================

/**
 * Notify about incoming call (shows high-priority notification with Answer/Decline)
 */
export const notifyIncomingCall = async (callerName, callType = 'audio') => {
  if (!BackgroundServicePlugin) return;
  
  try {
    await BackgroundServicePlugin.showCallNotification({ callerName, callType });
    console.log(`[BackgroundService] Incoming call notification: ${callerName} (${callType})`);
  } catch (err) {
    console.warn('[BackgroundService] Call notification failed:', err.message);
  }
};

/**
 * Dismiss the incoming call notification (UI only — does NOT end the call)
 */
export const dismissCallNotification = async () => {
  if (!BackgroundServicePlugin) return;
  
  try {
    await BackgroundServicePlugin.dismissCallNotification();
  } catch (err) {
    // Silent
  }
};

/**
 * End the call — dismiss notification + downgrade foreground service + release audio focus
 */
export const endCall = async () => {
  if (!BackgroundServicePlugin) return;
  
  try {
    await BackgroundServicePlugin.endCall();
  } catch (err) {
    // Silent
  }
};

/**
 * Show ongoing call notification with End Call button
 */
const showOngoingCallNotification = async (callerName, callType = 'audio') => {
  if (!BackgroundServicePlugin) return;
  
  try {
    await BackgroundServicePlugin.showOngoingCallNotification({ callerName, callType });
    console.log(`[BackgroundService] Ongoing call notification: ${callerName} (${callType})`);
  } catch (err) {
    console.warn('[BackgroundService] Ongoing call notification failed:', err.message);
  }
};

/**
 * Update state: call started
 */
export const onCallStarted = async (callerName, callType) => {
  _currentState.inCall = true;
  _currentState.callType = callType;
  _currentState.callerName = callerName;
  
  await showOngoingCallNotification(callerName, callType);
  await updateNotificationForCurrentState();
};

/**
 * Update state: call ended
 */
export const onCallEnded = async () => {
  _currentState.inCall = false;
  _currentState.callType = null;
  _currentState.callerName = null;
  
  await endCall();
  await updateNotificationForCurrentState();
};

// ========================================
// Message Notifications
// ========================================

/**
 * Show message notification when app is in background
 */
export const notifyNewMessage = async (senderName, message) => {
  if (!BackgroundServicePlugin || !_isInBackground) return;
  
  try {
    await BackgroundServicePlugin.showMessageNotification({ senderName, message });
  } catch (err) {
    // Silent
  }
};

// ========================================
// File Transfer Notifications
// ========================================

/**
 * Notify about incoming file transfer request (high-priority with Accept/Reject)
 */
export const notifyIncomingTransfer = async (senderName, fileName, fileSize) => {
  if (!BackgroundServicePlugin) return;
  
  try {
    await BackgroundServicePlugin.showIncomingTransferNotification({
      senderName,
      fileName,
      fileSize,
    });
    console.log(`[BackgroundService] Incoming transfer notification: ${fileName} from ${senderName}`);
  } catch (err) {
    console.warn('[BackgroundService] Transfer notification failed:', err.message);
  }
};

/**
 * Update file transfer progress notification (persistent until 100%)
 */
export const updateTransferProgress = async (fileName, progress, direction = 'receiving') => {
  if (!BackgroundServicePlugin) return;
  
  _currentState.transferring = progress < 100;
  _currentState.transferProgress = progress;
  _currentState.transferFileName = fileName;
  _currentState.transferDirection = direction;
  
  try {
    const dir = direction === 'sending' ? 'Sending' : 'Receiving';
    
    if (progress >= 100) {
      await BackgroundServicePlugin.showTransferNotification({
        title: 'Transfer Complete',
        body: `${fileName} — ${dir === 'Sending' ? 'sent' : 'received'} successfully`,
        progress: 100,
      });
      
      _currentState.transferring = false;
      _currentState.transferProgress = -1;
      _currentState.transferFileName = null;
      _currentState.transferDirection = null;
    } else {
      await BackgroundServicePlugin.showTransferNotification({
        title: `${dir}: ${fileName}`,
        body: `${progress}% complete`,
        progress,
      });
    }
    
    await updateNotificationForCurrentState();
  } catch (err) {
    // Silent
  }
};

/**
 * Dismiss the transfer notification
 */
export const dismissTransferNotification = async () => {
  if (!BackgroundServicePlugin) return;
  
  _currentState.transferring = false;
  _currentState.transferProgress = -1;
  _currentState.transferFileName = null;
  _currentState.transferDirection = null;
  
  try {
    await BackgroundServicePlugin.dismissTransferNotification();
    await updateNotificationForCurrentState();
  } catch (err) {
    // Silent
  }
};

// ========================================
// Connection State
// ========================================

/**
 * Update notification when socket connects/disconnects
 */
export const onSocketConnected = async () => {
  if (!_serviceRunning) return;
  await updateNotificationForCurrentState();
};

export const onSocketDisconnected = async () => {
  if (!BackgroundServicePlugin || !_serviceRunning) return;
  
  try {
    await BackgroundServicePlugin.updateNotification({
      title: 'Quick Meet',
      body: 'Reconnecting...',
    });
  } catch (err) {
    // Silent
  }
};

export default {
  initBackgroundService,
  startService,
  stopService,
  requestBatteryOptimization,
  isInBackground,
  isServiceRunning,
  setNotificationActionCallbacks,
  notifyIncomingCall,
  dismissCallNotification,
  endCall,
  onCallStarted,
  onCallEnded,
  notifyNewMessage,
  notifyIncomingTransfer,
  updateTransferProgress,
  dismissTransferNotification,
  onSocketConnected,
  onSocketDisconnected,
};
