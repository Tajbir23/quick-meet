/**
 * ============================================
 * Presence Socket Handlers — HARDENED
 * ============================================
 * 
 * Manages real-time user presence with security layer.
 * 
 * SECURITY UPGRADES:
 * - SocketGuard wraps all handlers
 * - Input validation on all parameters
 * - Group room join restricted to verified members
 * - Heartbeat rate limiting
 */

const { socketGuard, securityLogger } = require('../security');
const Group = require('../models/Group');
const userCache = require('../utils/userCache');

const setupPresenceHandlers = (io, socket, onlineUsers) => {
  const guard = socketGuard;

  /**
   * Typing indicator for 1-to-1 chat — GUARDED
   */
  socket.on('typing:start', guard.wrapHandler(socket, 'typing:start', ({ receiverId }) => {
    if (!receiverId || typeof receiverId !== 'string' || receiverId.length > 30) return;
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing:start', {
        userId: socket.userId,
        username: socket.username,
      });
    }
  }));

  socket.on('typing:stop', guard.wrapHandler(socket, 'typing:stop', ({ receiverId }) => {
    if (!receiverId || typeof receiverId !== 'string' || receiverId.length > 30) return;
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing:stop', {
        userId: socket.userId,
      });
    }
  }));

  /**
   * Typing indicator for group chat — GUARDED + input validation
   */
  socket.on('typing:group:start', guard.wrapHandler(socket, 'typing:group:start', ({ groupId }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;
    socket.to(`group:${groupId}`).emit('typing:group:start', {
      userId: socket.userId,
      username: socket.username,
      groupId,
    });
  }));

  socket.on('typing:group:stop', guard.wrapHandler(socket, 'typing:group:stop', ({ groupId }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;
    socket.to(`group:${groupId}`).emit('typing:group:stop', {
      userId: socket.userId,
      groupId,
    });
  }));

  /**
   * Join group room — GUARDED + membership verification
   * SECURITY: Verify the user is actually a member before joining room
   */
  socket.on('group:join-room', guard.wrapHandler(socket, 'group:join-room', async ({ groupId }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;

    try {
      const group = await Group.findById(groupId);
      if (!group || !group.isMember(socket.userId)) {
        securityLogger.log('WARN', 'SOCKET', 'Unauthorized group room join attempt', {
          userId: socket.userId,
          groupId,
        });
        socket.emit('group:error', { message: 'Not authorized to join this group' });
        return;
      }

      socket.join(`group:${groupId}`);
    } catch (err) {
      // Invalid ObjectId or DB error — silently reject
      securityLogger.log('WARN', 'SOCKET', 'Invalid group room join request', {
        userId: socket.userId,
        groupId,
        error: err.message,
      });
    }
  }));

  socket.on('group:leave-room', guard.wrapHandler(socket, 'group:leave-room', ({ groupId }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;
    socket.leave(`group:${groupId}`);
  }));

  /**
   * Heartbeat — rate-limited via SocketGuard
   * Also updates lastSeen in the presence cache
   */
  socket.on('heartbeat', guard.wrapHandler(socket, 'heartbeat', () => {
    userCache.heartbeat(socket.userId);
    socket.emit('heartbeat:ack', { timestamp: new Date().toISOString() });
  }));

  /**
   * Ping check — echoes client timestamp for RTT measurement
   * Client sends { t: Date.now() }, server echoes it back immediately.
   * Client measures: Date.now() - t = round-trip time.
   */
  socket.on('ping:check', guard.wrapHandler(socket, 'ping:check', (data) => {
    socket.emit('ping:result', { t: data?.t });
  }));
};

module.exports = setupPresenceHandlers;
