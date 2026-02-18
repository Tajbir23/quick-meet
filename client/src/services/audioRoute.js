/**
 * ============================================
 * Audio Route Service — Speaker/Earpiece Toggle
 * ============================================
 * 
 * Bridges JavaScript ↔ Android AudioManager via Capacitor plugin.
 * On non-Android platforms, falls back to no-op (desktop/web browsers
 * handle speaker via OS-level controls or setSinkId via DeviceSelector).
 * 
 * Usage:
 *   import { setSpeakerOn, isSpeakerOn } from './audioRoute';
 *   await setSpeakerOn(true);   // switch to loudspeaker
 *   await setSpeakerOn(false);  // switch to earpiece
 *   const { enabled } = await isSpeakerOn();
 */

import { isAndroid } from '../utils/platform';

/**
 * Get the native AudioRoute plugin (Android only)
 */
const getPlugin = () => {
  if (!isAndroid()) return null;
  return window.Capacitor?.Plugins?.AudioRoute || null;
};

/**
 * Enable or disable speakerphone
 * @param {boolean} enabled - true = loudspeaker, false = earpiece
 * @returns {Promise<{enabled: boolean}>}
 */
export const setSpeakerOn = async (enabled) => {
  const plugin = getPlugin();
  if (!plugin) {
    console.log('[AudioRoute] Not on Android, speaker toggle is a no-op');
    return { enabled };
  }

  try {
    const result = await plugin.setSpeakerOn({ enabled });
    return result;
  } catch (err) {
    console.error('[AudioRoute] setSpeakerOn failed:', err);
    throw err;
  }
};

/**
 * Check if speakerphone is currently enabled
 * @returns {Promise<{enabled: boolean}>}
 */
export const isSpeakerOn = async () => {
  const plugin = getPlugin();
  if (!plugin) {
    return { enabled: false };
  }

  try {
    const result = await plugin.isSpeakerOn();
    return result;
  } catch (err) {
    console.error('[AudioRoute] isSpeakerOn failed:', err);
    return { enabled: false };
  }
};
