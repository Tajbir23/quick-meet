/**
 * ============================================
 * Socket.io Event Handlers — Main Entry
 * ============================================
 * 
 * ARCHITECTURE:
 * Socket.io is used EXCLUSIVELY for:
 * 1. User presence (online/offline status)
 * 2. Chat message delivery (real-time notifications)
 * 3. WebRTC signaling (offer/answer/ICE exchange)
 * 4. Group call coordination
 * 
 * ALL media (audio, video, screen share) flows through WebRTC P2P.
 * Socket.io NEVER carries media data.
 * 
 * USER TRACKING:
 * - onlineUsers Map: userId → socketId
 * - When user connects: add to map, set DB isOnline=true
 * - When user disconnects: remove from map, set DB isOnline=false
 * - This enables routing signaling to the correct socket
 */

const User = require('../models/User');
const setupPresenceHandlers = require('./presence');
const setupChatHandlers = require('./chat');
const setupSignalingHandlers = require('./signaling');
const setupGroupCallHandlers = require('./groupCall');
const setupFileTransferHandlers = require('./fileTransfer');
const socketGuard = require('../security/SocketGuard');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const intrusionDetector = require('../security/IntrusionDetector');

// Global state: maps userId → socketId for routing
const onlineUsers = new Map();

const registerSocketHandlers = (io) => {
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const username = socket.username;
    const ip = socket.ip || socket.handshake.address;

    console.log(`🔌 User connected: ${username} (${userId}) — socket: ${socket.id}`);

    // ============================================
    // Track user presence
    // ============================================

    // Check concurrent session limits
    const existingSocketId = onlineUsers.get(userId);
    if (existingSocketId && existingSocketId !== socket.id) {
      // Another socket exists for this user — check IDS
      const sessionResult = intrusionDetector.registerSession(userId, socket.id);
      if (!sessionResult.allowed) {
        securityLogger.sessionEvent('concurrent_limit_enforced', SEVERITY.WARN, {
          userId, ip,
          message: `Concurrent session limit reached for ${username}`,
        });
        // Disconnect the OLD socket (keep newest session)
        const oldSocket = io.sockets.sockets.get(existingSocketId);
        if (oldSocket) {
          oldSocket.emit('security:force-logout', {
            reason: 'New session started from another device',
          });
          oldSocket.disconnect(true);
        }
      }
    }
    intrusionDetector.registerSession(userId, socket.id);
    onlineUsers.set(userId, socket.id);

    // Update DB
    try {
      await User.findByIdAndUpdate(userId, {
        isOnline: true,
        socketId: socket.id,
        lastSeen: new Date(),
      });
    } catch (err) {
      console.error('Error updating user online status:', err);
    }

    // Broadcast to all clients that this user is now online
    socket.broadcast.emit('user:online', {
      userId,
      username,
      socketId: socket.id,
    });

    // Send current online users list to the newly connected user
    const onlineUsersList = [];
    for (const [uid, sid] of onlineUsers.entries()) {
      if (uid !== userId) {
        onlineUsersList.push({ userId: uid, socketId: sid });
      }
    }
    socket.emit('users:online-list', onlineUsersList);

    // ============================================
    // On-demand online users request
    // WHY: Client's useSocket listeners may not be ready when the
    //      initial 'users:online-list' is emitted on connection.
    //      This lets the client re-request at any time.
    // ============================================
    socket.on('users:get-online-list', () => {
      const list = [];
      for (const [uid, sid] of onlineUsers.entries()) {
        if (uid !== userId) {
          list.push({ userId: uid, socketId: sid });
        }
      }
      socket.emit('users:online-list', list);
    });

    // ============================================
    // Register sub-handlers (wrapped with SocketGuard)
    // ============================================
    setupPresenceHandlers(io, socket, onlineUsers);
    setupChatHandlers(io, socket, onlineUsers);
    setupSignalingHandlers(io, socket, onlineUsers);
    setupGroupCallHandlers(io, socket, onlineUsers);
    setupFileTransferHandlers(io, socket, onlineUsers);

    // ============================================
    // Security: Request nonce for anti-replay
    // Client can request nonces for signing critical events
    // ============================================
    socket.on('security:request-nonce', () => {
      const cryptoService = require('../security/CryptoService');
      socket.emit('security:nonce', {
        nonce: cryptoService.generateNonce(),
        timestamp: Date.now(),
      });
    });

    // ============================================
    // Handle disconnect
    // ============================================
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 User disconnected: ${username} (${userId}) — socket: ${socket.id} — reason: ${reason}`);

      // IMPORTANT: Only process offline logic if THIS socket is still the current one.
      // Prevents race condition where a reconnect creates a new socket before
      // the old socket's disconnect handler fires — which would falsely mark
      // the user offline even though their NEW socket is active.
      const isCurrentSocket = onlineUsers.get(userId) === socket.id;

      socketGuard.cleanup(socket.id);
      intrusionDetector.removeSession(userId, socket.id);

      if (isCurrentSocket) {
        onlineUsers.delete(userId);

        try {
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            socketId: null,
            lastSeen: new Date(),
          });
        } catch (err) {
          console.error('Error updating user offline status:', err);
        }

        // Broadcast offline status ONLY if this was the active socket
        socket.broadcast.emit('user:offline', {
          userId,
          username,
        });
      } else {
        console.log(`🔌 Stale socket disconnect for ${username} — socket ${socket.id} is NOT current (current: ${onlineUsers.get(userId)}). Skipping offline broadcast & DB update.`);
      }

      securityLogger.socketEvent('disconnect', SEVERITY.INFO, {
        userId, username, reason, ip, staleSocket: !isCurrentSocket,
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${username}:`, error);
      securityLogger.socketEvent('error', SEVERITY.WARN, {
        userId, username,
        error: error.message,
      });
    });
  });
};

module.exports = registerSocketHandlers;
