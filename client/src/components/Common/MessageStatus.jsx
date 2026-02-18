/**
 * ============================================
 * MessageStatus — Pending / Sent / Delivered / Seen
 * ============================================
 * 
 * Status indicators like WhatsApp/Telegram:
 * - pending:   ⏳ Clock icon (grey)
 * - sent:      ✓  Single check (grey)
 * - delivered: ✓✓ Double check (grey)
 * - seen:      ✓✓ Double check (blue)
 * - failed:    ⚠  Warning icon (red)
 */

import { memo } from 'react';

const MessageStatus = ({ status, className = '', size = 14 }) => {
  if (!status || status === 'received') return null;

  const s = size;
  const half = s / 2;

  // Single check SVG path
  const singleCheck = (color) => (
    <svg width={s} height={s} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  // Double check SVG path  
  const doubleCheck = (color) => (
    <svg width={s + 4} height={s} viewBox="0 0 20 16" fill="none" className={className}>
      <path
        d="M2 8.5L5 11.5L11 4.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 8.5L9.5 11.5L15.5 4.5"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  switch (status) {
    case 'pending':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" className={`animate-pulse ${className}`}>
          <circle cx="8" cy="8" r="6" stroke="#9ca3af" strokeWidth="1.5" />
          <path d="M8 5V8.5L10 10" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );

    case 'sent':
      return singleCheck('#9ca3af');

    case 'delivered':
      return doubleCheck('#9ca3af');

    case 'seen':
      return doubleCheck('#60a5fa');

    case 'failed':
      return (
        <svg width={s} height={s} viewBox="0 0 16 16" fill="none" className={className}>
          <circle cx="8" cy="8" r="6" stroke="#ef4444" strokeWidth="1.5" />
          <path d="M8 5V9" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="8" cy="11.5" r="0.8" fill="#ef4444" />
        </svg>
      );

    default:
      return null;
  }
};

export default memo(MessageStatus);
