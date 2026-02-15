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
 * - Android/iOS: Capacitor Filesystem + auto-open prompt
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
    return saveFileOnMobile(blob, fileName);
  }
  
  // Web: browser download
  return browserDownload(blob, fileName);
};

/**
 * Get MIME type from filename extension
 */
const getMimeTypeFromFileName = (fileName) => {
  const ext = fileName?.split('.').pop()?.toLowerCase() || '';
  const mimeMap = {
    // Apps
    'apk': 'application/vnd.android.package-archive',
    'xapk': 'application/vnd.android.package-archive',
    'exe': 'application/x-msdownload',
    'msi': 'application/x-msi',
    'dmg': 'application/x-apple-diskimage',
    'deb': 'application/x-debian-package',
    'rpm': 'application/x-rpm',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'txt': 'text/plain',
    'csv': 'text/csv',
    'json': 'application/json',
    'xml': 'text/xml',
    // Images
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
    'gif': 'image/gif', 'webp': 'image/webp', 'svg': 'image/svg+xml',
    'bmp': 'image/bmp', 'ico': 'image/x-icon',
    // Video
    'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo',
    'mov': 'video/quicktime', 'webm': 'video/webm', 'flv': 'video/x-flv',
    '3gp': 'video/3gpp',
    // Audio
    'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac',
    'aac': 'audio/aac', 'ogg': 'audio/ogg', 'wma': 'audio/x-ms-wma',
    'm4a': 'audio/mp4',
    // Archives
    'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed', 'tar': 'application/x-tar',
    'gz': 'application/gzip',
  };
  return mimeMap[ext] || 'application/octet-stream';
};

/**
 * Save file on Android/iOS using Capacitor Filesystem
 * Then prompt to open the file (especially important for APK installs)
 */
const saveFileOnMobile = async (blob, fileName) => {
  try {
    // Use Capacitor native bridge directly (NOT ES module import)
    // because @capacitor/* is externalized in vite.config.js and bare
    // module specifiers can't be resolved in the WebView.
    const FilesystemPlugin = window.Capacitor?.Plugins?.Filesystem;
    if (!FilesystemPlugin) {
      console.warn('[Platform] Capacitor Filesystem plugin not available');
      return browserDownload(blob, fileName);
    }
    
    // Convert blob to base64
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    // Determine the best directory for saving
    // On Android 11+ (API 30), ExternalStorage requires MANAGE_EXTERNAL_STORAGE
    // Use Documents directory as fallback, or External if available
    // NOTE: Use string directory names (not enum) since the npm package is externalized
    let savedUri = null;
    let savedPath = null;
    let saveDirectory = null;

    // Try ExternalStorage/Downloads first (visible in file manager)
    try {
      const result = await FilesystemPlugin.writeFile({
        path: `Download/${fileName}`,
        data: base64,
        directory: 'EXTERNAL_STORAGE',
        recursive: true,
      });
      savedUri = result.uri;
      savedPath = `Download/${fileName}`;
      saveDirectory = 'ExternalStorage';
      console.log(`[Platform] File saved to ExternalStorage: ${savedPath}`);
    } catch (extErr) {
      console.warn('[Platform] ExternalStorage save failed, trying Documents:', extErr.message);
      
      // Fallback: save to app's Documents directory
      try {
        const result = await FilesystemPlugin.writeFile({
          path: `Downloads/${fileName}`,
          data: base64,
          directory: 'DOCUMENTS',
          recursive: true,
        });
        savedUri = result.uri;
        savedPath = `Downloads/${fileName}`;
        saveDirectory = 'Documents';
        console.log(`[Platform] File saved to Documents: ${savedPath}`);
      } catch (docErr) {
        console.warn('[Platform] Documents save failed, trying Data:', docErr.message);
        
        // Last resort: app's internal data directory
        const result = await FilesystemPlugin.writeFile({
          path: `downloads/${fileName}`,
          data: base64,
          directory: 'DATA',
          recursive: true,
        });
        savedUri = result.uri;
        savedPath = `downloads/${fileName}`;
        saveDirectory = 'Data';
        console.log(`[Platform] File saved to Data: ${savedPath}`);
      }
    }

    // Now try to open the file using the system's default handler
    // This is critical for APK installation and opening other file types
    if (savedUri) {
      try {
        await openFileOnMobile(savedUri, savedPath, fileName, saveDirectory);
      } catch (openErr) {
        console.warn('[Platform] Auto-open failed (user can open from file manager):', openErr.message);
      }
    }

    return true;
  } catch (err) {
    console.error('Capacitor save failed:', err);
    return browserDownload(blob, fileName);
  }
};

/**
 * Open a saved file on Android/iOS using the system handler
 * For APKs → triggers the package installer
 * For other files → opens with appropriate app
 */
const openFileOnMobile = async (fileUri, filePath, fileName, directory) => {
  const mimeType = getMimeTypeFromFileName(fileName);
  const plugins = window.Capacitor?.Plugins;
  
  // Method 1: Try Capacitor FileOpener plugin via native bridge
  if (plugins?.FileOpener?.open) {
    try {
      await plugins.FileOpener.open({
        filePath: fileUri,
        contentType: mimeType,
        openWithDefault: true,
      });
      console.log(`[Platform] File opened via FileOpener: ${fileName}`);
      return;
    } catch (e) {
      console.log('[Platform] FileOpener failed:', e.message);
    }
  }

  // Method 2: Get file URI and try opening
  if (plugins?.Filesystem) {
    try {
      const dirMap = {
        'ExternalStorage': 'EXTERNAL_STORAGE',
        'Documents': 'DOCUMENTS',
        'Data': 'DATA',
      };
      
      const fileInfo = await plugins.Filesystem.getUri({
        path: filePath,
        directory: dirMap[directory] || 'DATA',
      });
      
      if (fileInfo.uri && plugins?.FileOpener?.open) {
        await plugins.FileOpener.open({
          filePath: fileInfo.uri,
          contentType: mimeType,
        });
        console.log(`[Platform] File opened via native FileOpener: ${fileName}`);
        return;
      }
    } catch (e) {
      console.log('[Platform] Native file open failed:', e.message);
    }
  }

  // If we reach here, auto-open is not possible
  // The file IS saved — user can find it in file manager
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'apk') {
    console.log(`[Platform] APK saved but auto-install not possible. User needs @capacitor-community/file-opener plugin or can install from file manager.`);
  }
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
      // Use Capacitor native bridge directly
      const LN = window.Capacitor?.Plugins?.LocalNotifications;
      if (LN) {
        await LN.schedule({
          notifications: [{
            title,
            body,
            id: Date.now(),
            schedule: { at: new Date(Date.now()) },
          }],
        });
      } else {
        throw new Error('LocalNotifications plugin not available');
      }
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
    // Use Capacitor native bridge directly
    const KA = window.Capacitor?.Plugins?.KeepAwake;
    if (!KA) return;
    if (enable) {
      await KA.keepAwake();
    } else {
      await KA.allowSleep();
    }
  } catch (e) {
    // Plugin not installed, ignore
  }
};
