/**
 * ============================================
 * Chat Socket Handlers — HARDENED
 * ============================================
 * 
 * Real-time message delivery with security layer.
 * 
 * SECURITY UPGRADES:
 * - SocketGuard wraps all handlers (rate limiting, JWT re-validation, anti-replay)
 * - Input sanitization on all incoming data
 * - Size limits on message payloads
 * - SecurityEventLogger audit trail
 */

const { socketGuard, securityLogger } = require('../security');
const { sendPushToUser } = require('../controllers/pushController');

const MAX_MESSAGE_PAYLOAD = 10000; // 10KB max for socket message payloads

const setupChatHandlers = (io, socket, onlineUsers) => {
  const guard = socketGuard;

  /**
   * 1-to-1 message delivery — GUARDED
   * Falls back to FCM push notification if receiver is offline
   */
  socket.on('message:send', guard.wrapHandler(socket, 'message:send', async ({ message, receiverId }) => {
    // Validate payload
    if (!message || !receiverId) return;
    if (typeof receiverId !== 'string' || receiverId.length > 30) return;
    if (typeof message === 'object' && JSON.stringify(message).length > MAX_MESSAGE_PAYLOAD) {
      securityLogger.log('WARN', 'SOCKET', 'Oversized message payload rejected', { userId: socket.userId });
      return;
    }

    const receiverSocketId = onlineUsers.get(receiverId);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit('message:receive', {
        message,
        senderId: socket.userId,
        senderName: socket.username,
      });
    } else {
      // User offline — send FCM push notification
      const msgContent = typeof message === 'object'
        ? (message.content || message.text || 'New message')
        : String(message);
      const msgType = typeof message === 'object' ? (message.type || 'text') : 'text';
      const preview = msgType === 'text'
        ? (msgContent.length > 100 ? msgContent.substring(0, 100) + '...' : msgContent)
        : (msgType === 'image' ? '📷 Photo' : msgType === 'file' ? '📎 File' : '💬 Message');

      sendPushToUser(receiverId, {
        title: socket.username,
        body: preview,
        data: {
          type: 'message',
          senderId: socket.userId,
          senderName: socket.username,
          messageId: message?._id || '',
        },
      }).catch(err => console.warn('FCM message push failed:', err.message));
    }
  }));

  /**
   * Group message delivery — GUARDED
   */
  socket.on('message:group:send', guard.wrapHandler(socket, 'message:group:send', ({ message, groupId }) => {
    if (!message || !groupId) return;
    if (typeof groupId !== 'string' || groupId.length > 30) return;
    if (typeof message === 'object' && JSON.stringify(message).length > MAX_MESSAGE_PAYLOAD) {
      securityLogger.log('WARN', 'SOCKET', 'Oversized group message payload rejected', { userId: socket.userId });
      return;
    }

    socket.to(`group:${groupId}`).emit('message:group:receive', {
      message,
      groupId,
      senderId: socket.userId,
      senderName: socket.username,
    });
  }));

  /**
   * Message read receipt — GUARDED
   */
  socket.on('message:read', guard.wrapHandler(socket, 'message:read', ({ senderId, messageId }) => {
    if (!senderId || !messageId) return;
    if (typeof senderId !== 'string' || senderId.length > 30) return;
    if (typeof messageId !== 'string' || messageId.length > 30) return;

    const senderSocketId = onlineUsers.get(senderId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:read:ack', {
        messageId,
        readBy: socket.userId,
        readAt: new Date().toISOString(),
      });
    }
  }));
};

module.exports = setupChatHandlers;
