/**
 * ============================================
 * Presence Socket Handlers
 * ============================================
 * 
 * Manages real-time user presence:
 * - Typing indicators
 * - Activity status updates
 * - Heartbeat/ping for stale connection detection
 */

const setupPresenceHandlers = (io, socket, onlineUsers) => {
  /**
   * Typing indicator for 1-to-1 chat
   * WHY: UX feature — shows "User is typing..." in real-time
   */
  socket.on('typing:start', ({ receiverId }) => {
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing:start', {
        userId: socket.userId,
        username: socket.username,
      });
    }
  });

  socket.on('typing:stop', ({ receiverId }) => {
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing:stop', {
        userId: socket.userId,
      });
    }
  });

  /**
   * Typing indicator for group chat
   */
  socket.on('typing:group:start', ({ groupId }) => {
    socket.to(`group:${groupId}`).emit('typing:group:start', {
      userId: socket.userId,
      username: socket.username,
      groupId,
    });
  });

  socket.on('typing:group:stop', ({ groupId }) => {
    socket.to(`group:${groupId}`).emit('typing:group:stop', {
      userId: socket.userId,
      groupId,
    });
  });

  /**
   * Join group room (for receiving group events)
   * WHY Socket.io rooms: Efficient broadcasting to group members
   */
  socket.on('group:join-room', ({ groupId }) => {
    socket.join(`group:${groupId}`);
    console.log(`👥 ${socket.username} joined room: group:${groupId}`);
  });

  socket.on('group:leave-room', ({ groupId }) => {
    socket.leave(`group:${groupId}`);
    console.log(`👥 ${socket.username} left room: group:${groupId}`);
  });

  /**
   * Heartbeat — client pings periodically to confirm connection is alive
   */
  socket.on('heartbeat', () => {
    socket.emit('heartbeat:ack', { timestamp: new Date().toISOString() });
  });
};

module.exports = setupPresenceHandlers;
