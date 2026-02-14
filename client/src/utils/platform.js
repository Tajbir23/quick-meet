/**
 * ============================================
 * Capacitor Platform Helpers
 * ============================================
 * 
 * Utilities for detecting platform (web/android/ios/electron)
 * and providing platform-specific functionality.
 */

/**
 * Detect current platform
 */
export const getPlatform = () => {
  // Electron
  if (window.electronAPI?.isElectron) return 'electron';
  
  // Capacitor (Android/iOS)
  if (window.Capacitor?.isNativePlatform()) {
    return window.Capacitor.getPlatform(); // 'android' or 'ios'
  }
  
  // Web browser
  return 'web';
};

export const isElectron = () => getPlatform() === 'electron';
export const isAndroid = () => getPlatform() === 'android';
export const isIOS = () => getPlatform() === 'ios';
export const isNative = () => ['android', 'ios'].includes(getPlatform());
export const isDesktop = () => getPlatform() === 'electron';
export const isMobile = () => isNative() || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Save file to device (platform-aware)
 * - Electron: Native save dialog
 * - Android/iOS: Capacitor Filesystem
 * - Web: Browser download
 */
export const saveFileToDevice = async (blob, fileName) => {
  const platform = getPlatform();
  
  if (platform === 'electron') {
    // Use Electron's save dialog
    try {
      const result = await window.electronAPI.showSaveDialog({ fileName });
      if (result.canceled || !result.filePath) return false;
      
      // Convert blob to buffer and write via IPC
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      await window.electronAPI.writeFile(result.filePath, buffer);
      return true;
    } catch (err) {
      console.error('Electron save failed:', err);
      // Fallback to browser download
      return browserDownload(blob, fileName);
    }
  }
  
  if (platform === 'android' || platform === 'ios') {
    // Use Capacitor Filesystem
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      
      // Convert blob to base64
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      
      await Filesystem.writeFile({
        path: `Downloads/${fileName}`,
        data: base64,
        directory: Directory.ExternalStorage,
        recursive: true,
      });
      
      return true;
    } catch (err) {
      console.error('Capacitor save failed:', err);
      return browserDownload(blob, fileName);
    }
  }
  
  // Web: browser download
  return browserDownload(blob, fileName);
};

/**
 * Browser download fallback
 */
const browserDownload = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 10000);
  return true;
};

/**
 * Show native notification (platform-aware)
 */
export const showNativeNotification = async (title, body) => {
  const platform = getPlatform();
  
  if (platform === 'electron') {
    window.electronAPI?.showNotification({ title, body });
    return;
  }
  
  if (platform === 'android' || platform === 'ios') {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [{
          title,
          body,
          id: Date.now(),
          schedule: { at: new Date(Date.now()) },
        }],
      });
    } catch (e) {
      // Fallback to web notification
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
      }
    }
    return;
  }
  
  // Web
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  }
};

/**
 * Keep screen awake during file transfer (mobile)
 */
export const keepAwake = async (enable = true) => {
  if (!isNative()) return;
  
  try {
    // Requires @capacitor-community/keep-awake plugin
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    if (enable) {
      await KeepAwake.keepAwake();
    } else {
      await KeepAwake.allowSleep();
    }
  } catch (e) {
    // Plugin not installed, ignore
  }
};
