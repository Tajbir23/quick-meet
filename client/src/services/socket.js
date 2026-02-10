/**
 * ============================================
 * Socket.io Client Service — HARDENED
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - Handles server force-logout events
 * - Handles token-expired events (triggers re-auth)
 * - Handles session-revoked events
 * - Reconnects with fresh access token
 * - Anti-replay nonce support for critical events
 */

import { io } from 'socket.io-client';
import { SERVER_URL } from '../utils/constants';

let socket = null;
let _onForceLogout = null; // Callback for force logout

/**
 * Register a callback for force-logout events
 * Called by auth store to wire up the handleForceLogout action
 */
export const onForceLogout = (callback) => {
  _onForceLogout = callback;
};

/**
 * Connect to Socket.io server with JWT authentication
 */
export const connectSocket = (token) => {
  if (socket?.connected) {
    console.log('Socket already connected');
    return socket;
  }

  socket = io(SERVER_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    rejectUnauthorized: false,
  });

  // ─── CONNECTION LIFECYCLE ──────────────────
  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
    if (reason === 'io server disconnect') {
      console.log('Server forced disconnect — re-authentication required');
    }
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
    // If auth error, try using the latest access token from localStorage
    // (the API interceptor may have silently refreshed it)
    if (error.message?.includes('Authentication') || error.message?.includes('jwt')) {
      const freshToken = localStorage.getItem('accessToken');
      if (freshToken && freshToken !== socket.auth?.token) {
        console.log('🔄 Socket auth failed — retrying with refreshed token');
        socket.auth = { token: freshToken };
        // Don't disconnect — let the built-in reconnection retry with the new token
      } else {
        console.log('Auth error on socket — no fresh token available, stopping');
        socket.disconnect();
        if (_onForceLogout) {
          _onForceLogout('Session expired. Please login again.');
        }
      }
    }
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`🔄 Socket reconnection attempt ${attemptNumber}`);
    // On reconnect, use the latest access token
    const freshToken = localStorage.getItem('accessToken');
    if (freshToken) {
      socket.auth = { token: freshToken };
    }
  });

  socket.on('reconnect_failed', () => {
    console.error('❌ Socket reconnection failed after all attempts');
  });

  // ─── SECURITY EVENT HANDLERS ──────────────
  
  /**
   * Server demands force logout (account locked, session revoked, suspicious activity)
   */
  socket.on('security:force-logout', (data) => {
    console.warn('🔒 Force logout from server:', data?.reason);
    socket.disconnect();
    socket = null;
    if (_onForceLogout) {
      _onForceLogout(data?.reason || 'Session terminated by server');
    }
  });

  /**
   * Token expired — server detected expired JWT on socket
   * Try to reconnect with fresh token from localStorage (API interceptor may have refreshed it)
   */
  socket.on('security:token-expired', () => {
    console.warn('🔒 Socket token expired');
    const freshToken = localStorage.getItem('accessToken');
    if (freshToken) {
      socket.auth = { token: freshToken };
      socket.disconnect().connect(); // Reconnect with new token
    } else {
      socket.disconnect();
      if (_onForceLogout) {
        _onForceLogout('Session expired. Please login again.');
      }
    }
  });

  /**
   * Server-sent security nonce (for anti-replay on critical events)
   */
  socket.on('security:nonce', ({ nonce }) => {
    if (socket) {
      socket._securityNonce = nonce;
    }
  });

  return socket;
};

/**
 * Disconnect socket
 */
export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('Socket disconnected and cleaned up');
  }
};

/**
 * Get current socket instance
 */
export const getSocket = () => socket;

/**
 * Check if socket is connected
 */
export const isSocketConnected = () => socket?.connected ?? false;

/**
 * Get current security nonce (for anti-replay)
 */
export const getSecurityNonce = () => socket?._securityNonce || null;

export default {
  connectSocket,
  disconnectSocket,
  getSocket,
  isSocketConnected,
  onForceLogout,
  getSecurityNonce,
};
