/**
 * ============================================
 * Background Service Manager
 * ============================================
 * 
 * Manages the Android foreground service that keeps
 * Quick Meet running in background. Handles:
 * - Starting/stopping the foreground service
 * - Updating notification content based on app state
 * - Showing call/transfer notifications
 * - App state (foreground/background) detection
 * 
 * On non-Android platforms, this is a no-op.
 */

import { isAndroid } from '../utils/platform';

let BackgroundServicePlugin = null;
let AppPlugin = null;
let _isInBackground = false;
let _serviceRunning = false;
let _currentState = {
  inCall: false,
  callType: null,
  callerName: null,
  transferring: false,
  transferProgress: -1,
  transferFileName: null,
  transferDirection: null, // 'sending' | 'receiving'
};

/**
 * Initialize the background service
 * Call this once after user authentication
 */
export const initBackgroundService = async () => {
  if (!isAndroid()) return;
  
  try {
    // Use Capacitor native bridge directly (NOT ES module import)
    // because @capacitor/* is externalized in vite.config.js
    const plugins = window.Capacitor?.Plugins;
    if (!plugins) {
      console.warn('[BackgroundService] Capacitor not available');
      return;
    }
    
    BackgroundServicePlugin = plugins.BackgroundService;
    AppPlugin = plugins.App;
    
    // Start the foreground service
    await startService();
    
    // Listen for app state changes
    AppPlugin.addListener('appStateChange', handleAppStateChange);
    
    // Listen for app being brought to foreground via notification tap
    AppPlugin.addListener('appUrlOpen', () => {
      _isInBackground = false;
    });
    
    console.log('[BackgroundService] Initialized successfully');
  } catch (err) {
    console.warn('[BackgroundService] Init failed (non-fatal):', err.message);
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
    await BackgroundServicePlugin.stop();
    _serviceRunning = false;
    _isInBackground = false;
    console.log('[BackgroundService] Service stopped');
  } catch (err) {
    console.warn('[BackgroundService] Stop failed:', err.message);
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
 * Notify about incoming call (shows high-priority notification)
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
 * Dismiss the incoming call notification
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
 * Show ongoing call notification (visible in notification panel)
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
  
  // Replace incoming call notification with ongoing call notification
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
  
  await dismissCallNotification();
  await updateNotificationForCurrentState();
};

// ========================================
// File Transfer Notifications
// ========================================

/**
 * Notify about incoming file transfer request (high-priority notification)
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
 * Update file transfer progress notification
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
      
      // Clear transfer state
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
    
    // Also update the persistent notification
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
  isInBackground,
  isServiceRunning,
  notifyIncomingCall,
  dismissCallNotification,
  onCallStarted,
  onCallEnded,
  notifyIncomingTransfer,
  updateTransferProgress,
  dismissTransferNotification,
  onSocketConnected,
  onSocketDisconnected,
};
