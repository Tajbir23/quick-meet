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

// Global state: maps userId → socketId for routing
// WHY in-memory Map: Fast O(1) lookups, no DB queries for presence routing
// LIMITATION: Single server only. For multi-server, use Redis adapter.
const onlineUsers = new Map();

const registerSocketHandlers = (io) => {
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    const username = socket.username;

    console.log(`🔌 User connected: ${username} (${userId}) — socket: ${socket.id}`);

    // ============================================
    // Track user presence
    // ============================================
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
    // Register sub-handlers
    // ============================================
    setupPresenceHandlers(io, socket, onlineUsers);
    setupChatHandlers(io, socket, onlineUsers);
    setupSignalingHandlers(io, socket, onlineUsers);
    setupGroupCallHandlers(io, socket, onlineUsers);

    // ============================================
    // Handle disconnect
    // ============================================
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 User disconnected: ${username} (${userId}) — reason: ${reason}`);

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

      // Broadcast offline status
      socket.broadcast.emit('user:offline', {
        userId,
        username,
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error(`Socket error for ${username}:`, error);
    });
  });
};

module.exports = registerSocketHandlers;
