/**
 * ============================================
 * Client Helper Utilities
 * ============================================
 */

/**
 * Format file size to human-readable string
 */
export const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/**
 * Format timestamp to readable time
 */
export const formatTime = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Format duration (seconds) to mm:ss or hh:mm:ss
 */
export const formatDuration = (seconds) => {
  if (!seconds || seconds < 0) return '00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

/**
 * Get initials from username
 */
export const getInitials = (name) => {
  if (!name) return '?';
  return name
    .split(/[\s_]+/)
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

/**
 * Generate a random color from a string (for avatar backgrounds)
 */
export const stringToColor = (str) => {
  if (!str) return '#64748b';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16',
    '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  ];
  return colors[Math.abs(hash) % colors.length];
};

/**
 * Check if a MIME type is an image
 */
export const isImageFile = (mimeType) => {
  return mimeType && mimeType.startsWith('image/');
};

/**
 * Check if browser supports required WebRTC APIs
 */
export const checkWebRTCSupport = () => {
  const support = {
    rtcPeerConnection: !!window.RTCPeerConnection,
    getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    getDisplayMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia),
    isSecureContext: window.isSecureContext,
  };

  support.fullSupport = support.rtcPeerConnection &&
    support.getUserMedia &&
    support.isSecureContext;

  return support;
};

/**
 * Truncate text with ellipsis
 */
export const truncate = (text, maxLength = 50) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * Play notification sound
 */
export const playNotificationSound = (type = 'message') => {
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === 'call') {
      oscillator.frequency.value = 440;
      gainNode.gain.value = 0.3;
      oscillator.start();
      setTimeout(() => { oscillator.frequency.value = 523; }, 200);
      setTimeout(() => { oscillator.stop(); }, 400);
    } else {
      oscillator.frequency.value = 800;
      gainNode.gain.value = 0.1;
      oscillator.start();
      setTimeout(() => { oscillator.stop(); }, 150);
    }
  } catch (e) {
    // Audio not available, silently ignore
  }
};
