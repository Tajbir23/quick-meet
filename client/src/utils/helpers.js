/**
 * ============================================
 * Client Helper Utilities
 * ============================================
 * 
 * TIME HANDLING STRATEGY:
 * ─────────────────────────────────────────
 * Server (India UTC+5:30) stores ALL dates in UTC (MongoDB default).
 * Clients in Bangladesh (UTC+6), USA (UTC-5), etc. each receive
 * the same UTC ISO string. We convert to the user's LOCAL timezone
 * using Intl.DateTimeFormat / toLocaleString at display time only.
 * 
 * NEVER compare raw hour/day numbers — always use locale-aware
 * calendar-day boundaries so "Today / Yesterday" labels are
 * correct for EVERY user regardless of their timezone.
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

// ─── Timezone-safe date helpers ──────────────────────────────

/**
 * Get the start-of-day (midnight) in the USER's local timezone.
 * This is critical — we must not use UTC midnight, because
 * "today" for a user in Dhaka (UTC+6) starts at 18:00 UTC previous day.
 */
const startOfLocalDay = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

/**
 * Check if two dates fall on the same LOCAL calendar day.
 */
const isSameLocalDay = (d1, d2) => {
  const a = new Date(d1);
  const b = new Date(d2);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

/**
 * Get the number of LOCAL calendar days between two dates.
 * Returns 0 if same day, 1 if yesterday, etc.
 */
const localDayDiff = (earlier, later) => {
  const a = startOfLocalDay(earlier);
  const b = startOfLocalDay(later);
  return Math.round((b - a) / 86400000);
};

// ─── Formatters ─────────────────────────────────────────────

/**
 * Format timestamp for chat list / last-seen (smart relative time).
 * 
 * Rules (all relative to user's LOCAL timezone):
 *  - < 1 min ago         → "Just now"
 *  - < 60 min ago        → "Xm ago"
 *  - Same calendar day   → "HH:MM" (local)
 *  - Yesterday           → "Yesterday"
 *  - < 7 calendar days   → Weekday name ("Mon")
 *  - Same year           → "Feb 10"
 *  - Older               → "Feb 10, 2025"
 */
export const formatTime = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diffMs = now - d;
  const minutes = Math.floor(diffMs / 60000);

  // Very recent — use relative
  if (diffMs < 0) return 'Just now'; // future timestamp = clock skew, treat as "now"
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  // Calendar-day logic (LOCAL timezone)
  const days = localDayDiff(d, now);

  if (days === 0) {
    // Same local day → show local time
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) {
    return d.toLocaleDateString([], { weekday: 'short' }); // "Mon"
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }); // "Feb 10"
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); // "Feb 10, 2025"
};

/**
 * Format timestamp for message bubbles — always show local time.
 * Messages from "today" just show time.
 * Messages from another day show date + time.
 */
export const formatMessageTime = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const days = localDayDiff(d, now);

  if (days === 0) {
    // Today — just time
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (days === 1) {
    // Yesterday — "Yesterday, 3:42 PM"
    return 'Yesterday, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Older — "Feb 10, 3:42 PM"
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * Generate a date separator label for a given date.
 * Used between messages that fall on different LOCAL calendar days.
 */
export const formatDateSeparator = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const days = localDayDiff(d, now);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) {
    return d.toLocaleDateString([], { weekday: 'long' }); // "Monday"
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

/**
 * Check if a date separator should be shown between two messages.
 * Returns true if message dates fall on different LOCAL calendar days.
 */
export const shouldShowDateSeparator = (currentMsgDate, previousMsgDate) => {
  if (!previousMsgDate) return true; // First message always gets a separator
  return !isSameLocalDay(currentMsgDate, previousMsgDate);
};

/**
 * Format "last seen" specifically — more descriptive than formatTime.
 * Example: "Last seen today at 3:42 PM" / "Last seen yesterday at 9:10 AM"
 */
export const formatLastSeen = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  const now = new Date();
  const diffMs = now - d;
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return 'Active just now';
  if (minutes < 60) return `Active ${minutes}m ago`;

  const days = localDayDiff(d, now);
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (days === 0) return `Last seen today at ${timeStr}`;
  if (days === 1) return `Last seen yesterday at ${timeStr}`;
  if (days < 7) {
    const dayName = d.toLocaleDateString([], { weekday: 'long' });
    return `Last seen ${dayName} at ${timeStr}`;
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `Last seen ${dateStr}`;
};

/**
 * Format duration (seconds) to mm:ss or hh:mm:ss
 * (Duration is a counter, not a timestamp — no timezone concern)
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
