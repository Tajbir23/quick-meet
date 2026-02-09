/**
 * ============================================
 * NetworkStatus — Connection status banner
 * ============================================
 * 
 * Shows a banner when the browser goes offline.
 * Also monitors socket connection status.
 */

import { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { getSocket } from '../../services/socket';

const NetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Monitor socket connection
  useEffect(() => {
    const interval = setInterval(() => {
      const socket = getSocket();
      setSocketConnected(socket?.connected ?? true);
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // No issues — render nothing
  if (isOnline && socketConnected && !showReconnected) return null;

  // Reconnected banner
  if (showReconnected && isOnline && socketConnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-emerald-500 text-white py-2 px-4 text-center text-sm flex items-center justify-center gap-2 animate-slide-in">
        <Wifi size={16} />
        Connection restored
      </div>
    );
  }

  // Offline / disconnected banner
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-500 text-white py-2 px-4 text-center text-sm flex items-center justify-center gap-2 animate-slide-in">
      <WifiOff size={16} />
      {!isOnline
        ? 'You are offline. Check your internet connection.'
        : 'Disconnected from server. Reconnecting...'}
    </div>
  );
};

export default NetworkStatus;
