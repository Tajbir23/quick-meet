/**
 * ============================================
 * UpdateNotification — Auto-Update Banner
 * ============================================
 * 
 * Shows update notifications for both Desktop (Electron)
 * and Mobile (Android/Capacitor) apps.
 * 
 * Desktop: Uses electron-updater (auto-download + install)
 * Android: Checks server API + redirects to download
 * Web: Hidden (no updates needed for web)
 */

import { useState, useEffect, useCallback } from 'react';
import { Download, RefreshCw, X, ArrowDownToLine, CheckCircle } from 'lucide-react';
import { API_URL } from '../../utils/constants';

const APP_VERSION = '1.0.0';

/**
 * Detect platform
 */
function getPlatform() {
  if (window.electronAPI?.isElectron) return 'desktop';
  if (window.Capacitor?.isNativePlatform?.()) return 'android';
  return 'web';
}

const UpdateNotification = () => {
  const [updateState, setUpdateState] = useState(null);
  // { status, version, percent, releaseNotes, downloadUrl, error }
  const [dismissed, setDismissed] = useState(false);

  const platform = getPlatform();

  // ─── Desktop (Electron) ─────────────────────
  useEffect(() => {
    if (platform !== 'desktop') return;
    if (!window.electronAPI?.onUpdateStatus) return;

    const cleanup = window.electronAPI.onUpdateStatus((data) => {
      setUpdateState(data);
      if (data.status === 'available' || data.status === 'downloaded') {
        setDismissed(false);
      }
    });

    return cleanup;
  }, [platform]);

  // ─── Android (Capacitor) — Check server API ──
  useEffect(() => {
    if (platform !== 'android') return;

    const checkAndroidUpdate = async () => {
      try {
        const res = await fetch(
          `${API_URL}/updates/check?platform=android&version=${APP_VERSION}`
        );
        const data = await res.json();

        if (data.success && data.hasUpdate) {
          setUpdateState({
            status: data.mustUpdate ? 'must-update' : 'available',
            version: data.latestVersion,
            releaseNotes: data.releaseNotes,
            downloadUrl: data.downloadUrl,
          });
        }
      } catch (e) {
        console.warn('Android update check failed:', e.message);
      }
    };

    // Check after 3 seconds (let app load first)
    const timer = setTimeout(checkAndroidUpdate, 3000);

    // Check every 6 hours
    const interval = setInterval(checkAndroidUpdate, 6 * 60 * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [platform]);

  // ─── Handlers ────────────────────────────────
  const handleInstall = useCallback(() => {
    if (platform === 'desktop' && window.electronAPI?.installUpdate) {
      window.electronAPI.installUpdate();
    }
  }, [platform]);

  const handleDownload = useCallback(() => {
    if (updateState?.downloadUrl) {
      window.open(updateState.downloadUrl, '_system');
    }
  }, [updateState]);

  const handleDismiss = useCallback(() => {
    if (updateState?.status !== 'must-update') {
      setDismissed(true);
    }
  }, [updateState]);

  // ─── Render Logic ────────────────────────────
  // Don't show on web
  if (platform === 'web') return null;

  // Don't show if no update info
  if (!updateState) return null;

  // Don't show if dismissed (unless force update)
  if (dismissed && updateState.status !== 'must-update') return null;

  // Don't show for non-update statuses
  if (['checking', 'up-to-date'].includes(updateState.status)) return null;

  // Error state
  if (updateState.status === 'error') return null;

  // ─── Download Progress (Desktop) ──────────────
  if (updateState.status === 'downloading') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-dark-800 border border-primary-500/30 rounded-xl shadow-2xl p-4 max-w-xs animate-slide-up">
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
    );
  }

  // ─── Update Downloaded (Desktop) — Prompt restart ──
  if (updateState.status === 'downloaded') {
    return (
      <div className="fixed bottom-4 right-4 z-50 bg-dark-800 border border-emerald-500/30 rounded-xl shadow-2xl p-4 max-w-sm animate-slide-up">
        <div className="flex items-start gap-3">
          <CheckCircle size={20} className="text-emerald-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              Update Ready — v{updateState.version}
            </p>
            <p className="text-xs text-dark-400 mt-1">
              Restart the app to install the update.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleInstall}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw size={12} />
                Restart Now
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs rounded-lg transition-colors"
              >
                Later
              </button>
            </div>
          </div>
          <button onClick={handleDismiss} className="text-dark-500 hover:text-dark-300">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  // ─── Update Available (Android) or Must Update ──
  if (['available', 'must-update'].includes(updateState.status)) {
    const isMandatory = updateState.status === 'must-update';

    return (
      <>
        {/* Backdrop for mandatory updates */}
        {isMandatory && (
          <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        )}

        <div className={`fixed z-50 ${
          isMandatory
            ? 'inset-0 flex items-center justify-center p-4'
            : 'bottom-4 right-4 max-w-sm'
        }`}>
          <div className={`bg-dark-800 border rounded-xl shadow-2xl p-5 ${
            isMandatory
              ? 'border-red-500/40 max-w-sm w-full'
              : 'border-primary-500/30 animate-slide-up'
          }`}>
            <div className="flex items-start gap-3">
              <Download size={22} className={`mt-0.5 shrink-0 ${
                isMandatory ? 'text-red-400' : 'text-primary-400'
              }`} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-white">
                  {isMandatory ? '⚠️ Update Required' : 'Update Available'}
                </p>
                <p className="text-xs text-dark-400 mt-1">
                  Version {updateState.version} is available.
                  {updateState.releaseNotes && (
                    <span className="block mt-1 text-dark-300">{updateState.releaseNotes}</span>
                  )}
                </p>

                <div className="flex gap-2 mt-3">
                  {platform === 'android' ? (
                    <button
                      onClick={handleDownload}
                      className={`px-4 py-2 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                        isMandatory
                          ? 'bg-red-600 hover:bg-red-500'
                          : 'bg-primary-600 hover:bg-primary-500'
                      }`}
                    >
                      <Download size={14} />
                      Download Update
                    </button>
                  ) : (
                    <button
                      onClick={handleInstall}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                    >
                      <RefreshCw size={14} />
                      Install & Restart
                    </button>
                  )}

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
