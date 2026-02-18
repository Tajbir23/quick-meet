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

const mongoose = require('mongoose');
const User = require('../models/User');
const setupPresenceHandlers = require('./presence');
const setupChatHandlers = require('./chat');
const setupSignalingHandlers = require('./signaling');
const { deliverPendingCall, clearPendingCall } = require('./signaling');
const setupGroupCallHandlers = require('./groupCall');
const setupFileTransferHandlers = require('./fileTransfer');
const setupChannelHandlers = require('./channel');
const { startScheduledPostPublisher, stopScheduledPostPublisher } = require('./channel');
const socketGuard = require('../security/SocketGuard');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const intrusionDetector = require('../security/IntrusionDetector');
const userCache = require('../utils/userCache');

// Helper: check if MongoDB is connected before DB operations
const isMongoConnected = () => mongoose.connection.readyState === 1;

// Global state: maps userId → socketId for routing
const onlineUsers = new Map();

const registerSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    const userId = socket.userId;
    const username = socket.username;
    const ip = socket.ip || socket.handshake.address;

    console.log(`🔌 User connected: ${username} (${userId}) — socket: ${socket.id}`);

    // ============================================
    // Track user presence — SYNCHRONOUS (never await before handler registration)
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

    // ─── BROADCAST IMMEDIATELY (before any async work) ───
    // WHY: The old code did `await User.findByIdAndUpdate(...)` BEFORE
    // registering event handlers and broadcasting. This meant:
    // 1. All broadcasts were delayed by MongoDB latency (50-500ms)
    // 2. All event handlers were registered LATE — any client events
    //    arriving during the await were silently dropped
    // 3. If MongoDB was slow/disconnected, presence was broken entirely
    //
    // FIX: Broadcast + register handlers FIRST (synchronous),
    //      then do DB update in the background (fire-and-forget).

    // ─── Update presence cache ───
    userCache.setOnline(userId, username, socket.id);

    socket.broadcast.emit('user:online', {
      userId,
      username,
      socketId: socket.id,
      lastSeen: new Date().toISOString(),
    });

    // Send current online users list to the newly connected user (with lastSeen)
    const onlineUsersList = [];
    for (const [uid, sid] of onlineUsers.entries()) {
      if (uid !== userId) {
        const presence = userCache.getPresence(uid);
        onlineUsersList.push({
          userId: uid,
          socketId: sid,
          lastSeen: presence?.lastSeen?.toISOString() || new Date().toISOString(),
        });
      }
    }
    socket.emit('users:online-list', onlineUsersList);

    // ─── DB update (fire-and-forget — never block the connection handler) ───
    if (isMongoConnected()) {
      User.findByIdAndUpdate(userId, {
        isOnline: true,
        socketId: socket.id,
        lastSeen: new Date(),
      }).catch(err => {
        console.warn('DB: online status update failed (non-fatal):', err.message);
      });
    }

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
          const presence = userCache.getPresence(uid);
          list.push({
            userId: uid,
            socketId: sid,
            lastSeen: presence?.lastSeen?.toISOString() || new Date().toISOString(),
          });
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
    setupChannelHandlers(io, socket, onlineUsers);

    // ============================================
    // Deliver pending calls (user was offline, now reconnected)
    // If someone called while this user was offline, deliver now
    // ============================================
    deliverPendingCall(io, socket, userId);

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
    socket.on('disconnect', (reason) => {
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

        // Update presence cache
        userCache.setOffline(userId);

        // Clear any pending calls for this user
        clearPendingCall(userId);

        const lastSeen = new Date().toISOString();

        // Broadcast offline IMMEDIATELY with lastSeen timestamp
        socket.broadcast.emit('user:offline', {
          userId,
          username,
          lastSeen,
        });

        // DB update (fire-and-forget)
        if (isMongoConnected()) {
          User.findByIdAndUpdate(userId, {
            isOnline: false,
            socketId: null,
            lastSeen: new Date(),
          }).catch(err => {
            console.warn('DB: offline status update failed (non-fatal):', err.message);
          });
        }
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

  // Start the scheduled post publisher for channels
  startScheduledPostPublisher(io);
};

module.exports = registerSocketHandlers;
