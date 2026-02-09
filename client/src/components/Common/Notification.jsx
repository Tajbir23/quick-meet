/**
 * ============================================
 * Notification — Global notification component
 * ============================================
 * 
 * Listens for incoming messages when the chat isn't active
 * and shows a browser-style notification.
 * Uses the Notification API where available, falls back to toast.
 */

import { useEffect, useRef } from 'react';
import useChatStore from '../../store/useChatStore';
import useAuthStore from '../../store/useAuthStore';
import { playNotificationSound } from '../../utils/helpers';

const Notification = () => {
  const { isAuthenticated } = useAuthStore();
  const prevUnreadRef = useRef({});
  const { unread, activeChat } = useChatStore();

  // Request notification permission on mount
  useEffect(() => {
    if (isAuthenticated && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [isAuthenticated]);

  // Watch unread counts for new messages
  useEffect(() => {
    if (!isAuthenticated) return;

    const prevUnread = prevUnreadRef.current;

    Object.keys(unread).forEach(chatId => {
      const curr = unread[chatId] || 0;
      const prev = prevUnread[chatId] || 0;

      // New unread message & not in that chat
      if (curr > prev && activeChat?.id !== chatId) {
        playNotificationSound('message');

        // Show browser notification if permitted
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new window.Notification('Quick Meet', {
              body: `You have ${curr} new message${curr > 1 ? 's' : ''}`,
              icon: '/favicon.ico',
              tag: `msg-${chatId}`,
            });
          } catch (e) {
            // Notifications not supported in this context
          }
        }
      }
    });

    prevUnreadRef.current = { ...unread };
  }, [unread, activeChat, isAuthenticated]);

  // This component renders nothing visually
  return null;
};

export default Notification;
