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
const { storePendingNotification } = require('../controllers/pushController');

const MAX_MESSAGE_PAYLOAD = 10000; // 10KB max for socket message payloads

const setupChatHandlers = (io, socket, onlineUsers) => {
  const guard = socketGuard;

  /**
   * 1-to-1 message delivery — GUARDED
   * Falls back to pending notification queue if receiver is offline
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
      // User offline — store pending notification for native polling
      const msgContent = typeof message === 'object'
        ? (message.content || message.text || 'New message')
        : String(message);
      const msgType = typeof message === 'object' ? (message.type || 'text') : 'text';
      const preview = msgType === 'text'
        ? (msgContent.length > 100 ? msgContent.substring(0, 100) + '...' : msgContent)
        : (msgType === 'image' ? '📷 Photo' : msgType === 'file' ? '📎 File' : '💬 Message');

      storePendingNotification(receiverId, {
        type: 'message',
        title: socket.username,
        body: preview,
        data: {
          senderId: socket.userId,
          senderName: socket.username,
          messageId: message?._id || '',
        },
      });
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
   * Message delivered acknowledgment — GUARDED
   * Receiver confirms they received the message
   */
  socket.on('message:delivered', guard.wrapHandler(socket, 'message:delivered', ({ messageId, senderId, chatId }) => {
    if (!senderId || !messageId) return;
    if (typeof senderId !== 'string' || senderId.length > 30) return;
    if (typeof messageId !== 'string' || messageId.length > 30) return;

    const senderSocketId = onlineUsers.get(senderId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:delivered:ack', {
        messageId,
        chatId: socket.userId, // The receiver's userId = chatId for the sender
        deliveredTo: socket.userId,
        deliveredAt: new Date().toISOString(),
      });
    }
  }));

  /**
   * Message read/seen receipt — GUARDED
   * Emits to sender that their message was seen
   */
  socket.on('message:read', guard.wrapHandler(socket, 'message:read', ({ senderId, messageId, chatId }) => {
    if (!senderId || !messageId) return;
    if (typeof senderId !== 'string' || senderId.length > 30) return;
    if (typeof messageId !== 'string' || messageId.length > 30) return;

    const senderSocketId = onlineUsers.get(senderId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:read:ack', {
        messageId,
        chatId: socket.userId, // The reader's userId = chatId for the sender
        readBy: socket.userId,
        readAt: new Date().toISOString(),
      });
    }
  }));

  /**
   * Pin message broadcast — GUARDED
   * Notifies the other user (1-to-1) or the group room about a pinned message
   */
  socket.on('message:pin', guard.wrapHandler(socket, 'message:pin', ({ message, chatId, chatType }) => {
    if (!message || !chatId || !chatType) return;
    if (typeof chatId !== 'string' || chatId.length > 30) return;

    if (chatType === 'group') {
      socket.to(`group:${chatId}`).emit('message:pinned', {
        message,
        chatId,
        chatType,
        pinnedByUserId: socket.userId,
        pinnedByUsername: socket.username,
      });
    } else {
      const receiverSocketId = onlineUsers.get(chatId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message:pinned', {
          message,
          chatId: socket.userId,
          chatType: 'user',
          pinnedByUserId: socket.userId,
          pinnedByUsername: socket.username,
        });
      }
    }
  }));

  /**
   * Unpin message broadcast — GUARDED
   */
  socket.on('message:unpin', guard.wrapHandler(socket, 'message:unpin', ({ messageId, chatId, chatType }) => {
    if (!messageId || !chatId || !chatType) return;
    if (typeof chatId !== 'string' || chatId.length > 30) return;
    if (typeof messageId !== 'string' || messageId.length > 30) return;

    if (chatType === 'group') {
      socket.to(`group:${chatId}`).emit('message:unpinned', {
        messageId,
        chatId,
        chatType,
        unpinnedByUserId: socket.userId,
        unpinnedByUsername: socket.username,
      });
    } else {
      const receiverSocketId = onlineUsers.get(chatId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message:unpinned', {
          messageId,
          chatId: socket.userId,
          chatType: 'user',
          unpinnedByUserId: socket.userId,
          unpinnedByUsername: socket.username,
        });
      }
    }
  }));

  /**
   * Bulk delete broadcast — GUARDED
   * Notifies the other user (1-to-1) or group room about deleted messages
   */
  socket.on('message:bulk-delete', guard.wrapHandler(socket, 'message:bulk-delete', ({ messageIds, chatId, chatType }) => {
    if (!messageIds || !Array.isArray(messageIds) || !chatId || !chatType) return;
    if (typeof chatId !== 'string' || chatId.length > 30) return;
    if (messageIds.length > 100) return;

    if (chatType === 'group') {
      socket.to(`group:${chatId}`).emit('message:bulk-deleted', {
        messageIds,
        chatId,
        chatType,
        deletedByUserId: socket.userId,
        deletedByUsername: socket.username,
      });
    } else {
      const receiverSocketId = onlineUsers.get(chatId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('message:bulk-deleted', {
          messageIds,
          chatId: socket.userId,
          chatType: 'user',
          deletedByUserId: socket.userId,
          deletedByUsername: socket.username,
        });
      }
    }
  }));
};

module.exports = setupChatHandlers;
