/**
 * ============================================
 * NetworkStatus — Connection status banner
 * ============================================
 * 
 * Shows a banner when the browser goes offline
 * or the socket connection is lost.
 * 
 * Uses actual socket events (not polling) for instant,
 * accurate status updates.
 */

import { useState, useEffect, useRef } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { getSocket } from '../../services/socket';

const NetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);
  const reconnectedTimer = useRef(null);
  // Track if socket has ever connected — suppress the banner during
  // initial page load / first connection attempt
  const hasEverConnected = useRef(false);

  // Browser online/offline
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showReconnectedBanner();
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

  // Socket event listeners — react instantly, no polling
  useEffect(() => {
    let cleanup = null;

    const attach = () => {
      const socket = getSocket();
      if (!socket) return;

      const onConnect = () => {
        // If this is a RE-connect (not the very first connect), flash the green banner
        if (hasEverConnected.current) {
          showReconnectedBanner();
        }
        hasEverConnected.current = true;
        setSocketConnected(true);
      };

      const onDisconnect = () => {
        setSocketConnected(false);
        setShowReconnected(false);
      };

      const onConnectError = () => {
        // Only show disconnected banner if we had previously connected
        if (hasEverConnected.current) {
          setSocketConnected(false);
        }
      };

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onConnectError);

      // If socket is already connected right now
      if (socket.connected) {
        hasEverConnected.current = true;
        setSocketConnected(true);
      }

      cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onConnectError);
      };
    };

    // The socket may not exist yet on first render (created later in checkAuth).
    // Check periodically until we find it, then attach listeners and stop.
    attach();
    const poll = setInterval(() => {
      if (getSocket()) {
        attach();
        clearInterval(poll);
      }
    }, 500);

    return () => {
      clearInterval(poll);
      cleanup?.();
      if (reconnectedTimer.current) clearTimeout(reconnectedTimer.current);
    };
  }, []);

  function showReconnectedBanner() {
    setShowReconnected(true);
    if (reconnectedTimer.current) clearTimeout(reconnectedTimer.current);
    reconnectedTimer.current = setTimeout(() => setShowReconnected(false), 3000);
  }

  // No issues — render nothing
  if (isOnline && socketConnected && !showReconnected) return null;

  // Reconnected banner
  if (showReconnected && isOnline && socketConnected) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-emerald-500 text-white py-2.5 px-4 text-center text-sm font-medium flex items-center justify-center gap-2 animate-slide-down safe-top shadow-lg">
        <Wifi size={16} />
        Connection restored
      </div>
    );
  }

  // Offline / disconnected banner
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-500 text-white py-2.5 px-4 text-center text-sm font-medium flex items-center justify-center gap-2 animate-slide-down safe-top shadow-lg">
      <WifiOff size={16} />
      {!isOnline
        ? 'You are offline. Check your internet connection.'
        : 'Disconnected from server. Reconnecting...'}
    </div>
  );
};

export default NetworkStatus;
