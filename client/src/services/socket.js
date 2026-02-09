/**
 * ============================================
 * Socket.io Client Service
 * ============================================
 * 
 * Manages the Socket.io connection lifecycle.
 * 
 * WHY singleton pattern:
 * - Only ONE socket connection per client
 * - Shared across all components via import
 * - Clean connect/disconnect lifecycle
 * 
 * AUTHENTICATION:
 * JWT token is sent in the auth handshake.
 * Server verifies before allowing connection.
 */

import { io } from 'socket.io-client';
import { SERVER_URL } from '../utils/constants';

let socket = null;

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
    transports: ['websocket', 'polling'], // Prefer WebSocket
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
    // CRITICAL: rejectUnauthorized must be false for self-signed SSL
    rejectUnauthorized: false,
  });

  // Connection lifecycle logging
  socket.on('connect', () => {
    console.log('✅ Socket connected:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
    if (reason === 'io server disconnect') {
      // Server disconnected us (likely token expired)
      // Don't auto-reconnect, force re-auth
      console.log('Server forced disconnect — re-authentication required');
    }
  });

  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log(`🔄 Socket reconnected after ${attemptNumber} attempts`);
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`🔄 Socket reconnection attempt ${attemptNumber}`);
  });

  socket.on('reconnect_failed', () => {
    console.error('❌ Socket reconnection failed after all attempts');
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

export default {
  connectSocket,
  disconnectSocket,
  getSocket,
  isSocketConnected,
};
