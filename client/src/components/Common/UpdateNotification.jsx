/**
 * ============================================
 * UpdateNotification — Force Update System
 * ============================================
 * 
 * Checks for updates on EVERY app open (all platforms).
 * 
 * PLATFORMS:
 * - Desktop (Electron): electron-updater auto-download + install
 * - Android (Capacitor): Download APK via Filesystem + open with file-opener
 * - Web: Server API check + page reload (auto-deployed)
 * 
 * FORCE UPDATE:
 * When mustUpdate=true, a full-screen blocking overlay appears.
 * User CANNOT dismiss it — they MUST update to continue.
 * 
 * CHECK TIMING:
 * - Immediately on mount (every app open)
 * - Every 2 hours while app is running
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, RefreshCw, X, ArrowDownToLine, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { API_URL, APP_VERSION } from '../../utils/constants';

/**
 * Detect platform key for server API
 */
function getPlatform() {
  if (window.electronAPI?.isElectron) return 'desktop';
  if (window.Capacitor?.isNativePlatform?.()) return 'android';
  return 'web';
}

const UpdateNotification = () => {
  const [updateState, setUpdateState] = useState(null);
  // { status, version, percent, releaseNotes, downloadUrl, mustUpdate, error }
  const [dismissed, setDismissed] = useState(false);
  const [androidDownloading, setAndroidDownloading] = useState(false);
  const [androidProgress, setAndroidProgress] = useState(0);

  // Keep mustUpdate flag persistent — electron-updater events won't override it
  const mustUpdateRef = useRef(false);

  // Native APK version (Android only) — stays at the APK's versionName
  // until user installs a new APK. Unlike APP_VERSION which changes on every
  // web deploy (since Android loads the remote web page).
  const [nativeVersion, setNativeVersion] = useState(null);

  const platform = getPlatform();

  // ─── Get native APK version on Android ──────────
  // Use Capacitor bridge directly (NOT ES module import) because
  // @capacitor/* is externalized in vite.config.js and bare module
  // specifiers can't be resolved in the WebView.
  useEffect(() => {
    if (platform !== 'android') return;
    
    (async () => {
      try {
        const AppPlugin = window.Capacitor?.Plugins?.App;
        if (AppPlugin) {
          const info = await AppPlugin.getInfo();
          console.log('[Update] Native APK version:', info.version);
          setNativeVersion(info.version);
        } else {
          console.warn('[Update] Capacitor App plugin not available');
        }
      } catch (err) {
        console.warn('[Update] Failed to get native version:', err.message);
      }
    })();
  }, [platform]);

  // Version to send for update check:
  // - Android: native APK version (so server can detect APK is outdated)
  // - Other platforms: web bundle version (APP_VERSION)
  const checkVersion = (platform === 'android' && nativeVersion) ? nativeVersion : APP_VERSION;

  // ─── Server API Check (ALL platforms: web, android, desktop) ──
  const checkServerUpdate = useCallback(async () => {
    // On Android, wait until native version is resolved
    if (platform === 'android' && !nativeVersion) return;

    try {
      const res = await fetch(
        `${API_URL}/updates/check?platform=${platform}&version=${checkVersion}`
      );
      const data = await res.json();
      console.log('[Update] Server check result:', data);

      if (data.success && data.hasUpdate) {
        // Store mustUpdate persistently
        if (data.mustUpdate) {
          mustUpdateRef.current = true;
        }

        setUpdateState(prev => {
          // Don't override electron download progress with server check
          if (prev?.status === 'downloading' || prev?.status === 'downloaded') return prev;
          return {
            status: data.mustUpdate ? 'must-update' : 'available',
            version: data.latestVersion,
            releaseNotes: data.releaseNotes,
            downloadUrl: data.downloadUrl,
            mustUpdate: data.mustUpdate,
          };
        });
        setDismissed(false);
      }
    } catch (e) {
      console.warn('Update check failed:', e.message);
    }
  }, [platform, checkVersion, nativeVersion]);

  // ─── Check on mount (EVERY app open) + periodic check ──
  useEffect(() => {
    // Check immediately on mount — no delay
    checkServerUpdate();

    // Check every 2 hours while running
    const interval = setInterval(checkServerUpdate, 2 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, [checkServerUpdate]);

  // ─── Desktop (Electron) — electron-updater events ──
  useEffect(() => {
    if (platform !== 'desktop') return;
    if (!window.electronAPI?.onUpdateStatus) return;

    const cleanup = window.electronAPI.onUpdateStatus((data) => {
      console.log('[Update] Electron-updater event:', data);
      
      // IMPORTANT: Preserve mustUpdate from server check
      // electron-updater events don't have mustUpdate info
      const isMustUpdate = mustUpdateRef.current;
      
      setUpdateState(prev => {
        // If electron-updater says 'available', merge with server's mustUpdate
        if (data.status === 'available') {
          return {
            ...data,
            mustUpdate: isMustUpdate,
            status: isMustUpdate ? 'must-update' : 'available',
            downloadUrl: prev?.downloadUrl || data.downloadUrl,
          };
        }
        // For downloading/downloaded/error — keep mustUpdate flag
        return {
          ...data,
          mustUpdate: isMustUpdate || prev?.mustUpdate,
        };
      });
      
      if (data.status === 'available' || data.status === 'downloaded') {
        setDismissed(false);
      }
    });

    return cleanup;
  }, [platform]);

  // ─── Desktop: Install via electron-updater ────────────
  const handleDesktopInstall = useCallback(() => {
    if (window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  }, []);

  // ─── Desktop: Trigger electron-updater to check & download ─
  const handleDesktopDownload = useCallback(async () => {
    if (window.electronAPI?.checkForUpdate) {
      console.log('[Update] Triggering electron-updater download...');
      try {
        await window.electronAPI.checkForUpdate();
      } catch (e) {
        console.warn('[Update] Electron-updater check failed:', e);
        // Fallback: open download URL in browser
        if (updateState?.downloadUrl) {
          const { shell } = window.electronAPI;
          if (shell?.openExternal) {
            shell.openExternal(updateState.downloadUrl);
          } else {
            window.open(updateState.downloadUrl, '_blank');
          }
        }
      }
    }
  }, [updateState]);

  // ─── Android: Download APK + open system installer ────
  // Uses our custom native ApkInstaller plugin which:
  //  1. Downloads via Android DownloadManager (native, with status bar progress)
  //  2. Opens APK with FileProvider content:// URI via system installer
  //
  // IMPORTANT: Never use window.open(url, '_system') — Capacitor doesn't
  // support it and renders binary APK data inside the WebView.
  const handleAndroidDownload = useCallback(async () => {
    if (!updateState?.downloadUrl) return;

    const ApkInstaller = window.Capacitor?.Plugins?.ApkInstaller;
    if (!ApkInstaller) {
      console.warn('[Update] ApkInstaller plugin not available');
      alert('Update is available but the installer plugin is not loaded. Please reinstall the app from the latest APK.');
      return;
    }

    setAndroidDownloading(true);
    setAndroidProgress(0);

    // Listen for native download progress events
    let progressListener = null;
    try {
      progressListener = await ApkInstaller.addListener('downloadProgress', (data) => {
        console.log('[Update] Native progress:', data);
        if (typeof data.progress === 'number') {
          setAndroidProgress(data.progress);
        }
        if (data.status === 'installing') {
          setAndroidProgress(100);
        }
      });
    } catch (e) {
      console.warn('[Update] Could not add progress listener:', e);
    }

    try {
      const fileName = `quick-meet-v${updateState.version || 'update'}.apk`;
      console.log('[Update] Starting native download:', updateState.downloadUrl);

      const result = await ApkInstaller.downloadAndInstall({
        url: updateState.downloadUrl,
        fileName,
      });

      console.log('[Update] Native install result:', result);
      // The system installer dialog is now open — user taps "Install"
    } catch (error) {
      console.error('[Update] Native download/install error:', error);
      alert('Download failed: ' + (error?.message || 'Unknown error') + '\n\nPlease try again.');
    } finally {
      // Cleanup listener
      if (progressListener?.remove) {
        try { progressListener.remove(); } catch (e) {}
      }
      setAndroidDownloading(false);
    }
  }, [updateState]);

  // ─── Web: Clear cache & reload ────────────────────────
  const handleWebReload = useCallback(() => {
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    window.location.reload(true);
  }, []);

  // ─── Generic handler based on platform ────────────────
  const handleUpdate = useCallback(() => {
    if (platform === 'web') {
      handleWebReload();
    } else if (platform === 'desktop') {
      if (updateState?.status === 'downloaded') {
        handleDesktopInstall();
      } else {
        handleDesktopDownload();
      }
    } else if (platform === 'android') {
      handleAndroidDownload();
    }
  }, [platform, updateState, handleWebReload, handleDesktopInstall, handleDesktopDownload, handleAndroidDownload]);

  const handleDismiss = useCallback(() => {
    if (!updateState?.mustUpdate && !mustUpdateRef.current) {
      setDismissed(true);
    }
  }, [updateState]);

  // ─── Render Logic ────────────────────────────
  if (!updateState) return null;
  if (dismissed && !updateState.mustUpdate && !mustUpdateRef.current) return null;
  if (['checking', 'up-to-date'].includes(updateState.status)) return null;
  if (updateState.status === 'error' && !mustUpdateRef.current) return null;

  // ─── Android Download Progress ────────────────
  if (androidDownloading) {
    return (
      <>
        {mustUpdateRef.current && (
          <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md" />
        )}
        <div className={`fixed z-[9999] ${
          mustUpdateRef.current ? 'inset-0 flex items-center justify-center p-4' : 'bottom-4 right-4 max-w-xs'
        }`}>
          <div className="bg-dark-800 border border-primary-500/30 rounded-xl shadow-2xl p-4 max-w-xs w-full">
            <div className="flex items-center gap-3 mb-2">
              <ArrowDownToLine size={18} className="text-primary-400 animate-bounce" />
              <span className="text-sm font-medium text-white">
                Downloading v{updateState.version || 'update'}...
              </span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2">
              <div
                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${androidProgress}%` }}
              />
            </div>
            <p className="text-xs text-dark-400 mt-1">{androidProgress}%</p>
          </div>
        </div>
      </>
    );
  }

  // ─── Desktop Download Progress (electron-updater) ─────
  if (updateState.status === 'downloading') {
    return (
      <>
        {mustUpdateRef.current && (
          <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md" />
        )}
        <div className={`fixed z-[9999] ${
          mustUpdateRef.current ? 'inset-0 flex items-center justify-center p-4' : 'bottom-4 right-4 max-w-xs'
        }`}>
          <div className="bg-dark-800 border border-primary-500/30 rounded-xl shadow-2xl p-4 max-w-xs w-full animate-slide-up">
            <div className="flex items-center gap-3 mb-2">
              <ArrowDownToLine size={18} className="text-primary-400 animate-bounce" />
              <span className="text-sm font-medium text-white">
                Downloading v{updateState.version || 'update'}...
              </span>
            </div>
            <div className="w-full bg-dark-700 rounded-full h-2">
              <div
                className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${updateState.percent || 0}%` }}
              />
            </div>
            <p className="text-xs text-dark-400 mt-1">{updateState.percent || 0}%</p>
          </div>
        </div>
      </>
    );
  }

  // ─── Update Downloaded (Desktop) — Prompt restart ──
  if (updateState.status === 'downloaded') {
    const isMandatory = mustUpdateRef.current || updateState.mustUpdate;
    return (
      <>
        {isMandatory && (
          <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md" />
        )}
        <div className={`fixed z-[9999] ${
          isMandatory ? 'inset-0 flex items-center justify-center p-4' : 'bottom-4 right-4 max-w-sm'
        }`}>
          <div className={`bg-dark-800 border rounded-xl shadow-2xl p-4 max-w-sm w-full ${
            isMandatory ? 'border-red-500/40' : 'border-emerald-500/30 animate-slide-up'
          }`}>
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-emerald-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">
                  Update Ready — v{updateState.version}
                </p>
                <p className="text-xs text-dark-400 mt-1">
                  {isMandatory
                    ? 'Restart now to install the required update.'
                    : 'Restart the app to install the update.'}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleDesktopInstall}
                    className={`px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                      isMandatory ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    <RefreshCw size={12} />
                    Restart Now
                  </button>
                  {!isMandatory && (
                    <button
                      onClick={handleDismiss}
                      className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs rounded-lg transition-colors"
                    >
                      Later
                    </button>
                  )}
                </div>
              </div>
              {!isMandatory && (
                <button onClick={handleDismiss} className="text-dark-500 hover:text-dark-300">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ─── Must Update OR Available Update ──────────────────
  if (['available', 'must-update'].includes(updateState.status)) {
    const isMandatory = updateState.status === 'must-update' || mustUpdateRef.current || updateState.mustUpdate;

    // Button text and action per platform
    const getButtonConfig = () => {
      if (platform === 'web') {
        return { label: isMandatory ? 'Reload Now' : 'Reload Page', icon: RefreshCw };
      }
      if (platform === 'desktop') {
        return { label: isMandatory ? 'Install Update Now' : 'Download & Install', icon: Download };
      }
      // android
      return { label: isMandatory ? 'Install Update Now' : 'Download & Install', icon: Download };
    };

    const btnConfig = getButtonConfig();
    const BtnIcon = btnConfig.icon;

    return (
      <>
        {/* Full-screen backdrop for mandatory updates — BLOCKS entire app */}
        {isMandatory && (
          <div className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-md" />
        )}

        <div className={`fixed z-[9999] ${
          isMandatory
            ? 'inset-0 flex items-center justify-center p-4'
            : 'bottom-4 right-4 max-w-sm'
        }`}>
          <div className={`bg-dark-800 border rounded-xl shadow-2xl p-5 ${
            isMandatory
              ? 'border-red-500/40 max-w-sm w-full'
              : 'border-primary-500/30 animate-slide-up'
          }`}>
            {/* Force update icon */}
            {isMandatory && (
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-full bg-red-500/15 flex items-center justify-center">
                  <AlertTriangle size={32} className="text-red-400" />
                </div>
              </div>
            )}

            <div className={`flex ${isMandatory ? 'flex-col items-center text-center' : 'items-start'} gap-3`}>
              {!isMandatory && (
                <Download size={22} className="mt-0.5 shrink-0 text-primary-400" />
              )}
              <div className="flex-1">
                <p className={`font-semibold text-white ${isMandatory ? 'text-lg mb-1' : 'text-sm'}`}>
                  {isMandatory ? 'Update Required' : 'Update Available'}
                </p>
                <p className={`text-dark-400 mt-1 ${isMandatory ? 'text-sm' : 'text-xs'}`}>
                  {isMandatory
                    ? `A new version (v${updateState.version}) is required to continue using Quick Meet.`
                    : `Version ${updateState.version} is available.`
                  }
                  {updateState.releaseNotes && (
                    <span className="block mt-1 text-dark-300">{updateState.releaseNotes}</span>
                  )}
                </p>

                {/* Current version info */}
                {isMandatory && (
                  <p className="text-xs text-dark-500 mt-2">
                    Current: v{checkVersion} → New: v{updateState.version}
                  </p>
                )}

                <div className={`flex gap-2 mt-4 ${isMandatory ? 'justify-center' : ''}`}>
                  <button
                    onClick={handleUpdate}
                    className={`px-4 py-2 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                      isMandatory
                        ? 'bg-red-600 hover:bg-red-500 px-6 py-2.5 text-sm'
                        : 'bg-primary-600 hover:bg-primary-500'
                    }`}
                  >
                    <BtnIcon size={14} />
                    {btnConfig.label}
                  </button>

                  {!isMandatory && (
                    <button
                      onClick={handleDismiss}
                      className="px-3 py-2 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs rounded-lg transition-colors"
                    >
                      Later
                    </button>
                  )}
                </div>
              </div>

              {!isMandatory && (
                <button onClick={handleDismiss} className="text-dark-500 hover:text-dark-300">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  return null;
};

export default UpdateNotification;
