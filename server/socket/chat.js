/**
 * ============================================
 * Chat Socket Handlers
 * ============================================
 * 
 * Real-time message delivery.
 * 
 * FLOW:
 * 1. Sender calls REST API to save message to DB
 * 2. Sender emits 'message:send' via socket
 * 3. Server routes the message to receiver's socket
 * 4. Receiver gets 'message:receive' event in real-time
 * 
 * WHY this two-step approach:
 * - REST API ensures message is persisted (survives disconnects)
 * - Socket ensures real-time delivery (no polling needed)
 * - If receiver is offline, they'll see it from DB when they connect
 */

const setupChatHandlers = (io, socket, onlineUsers) => {
  /**
   * 1-to-1 message delivery
   */
  socket.on('message:send', ({ message, receiverId }) => {
    const receiverSocketId = onlineUsers.get(receiverId);

    if (receiverSocketId) {
      // Receiver is online — deliver in real-time
      io.to(receiverSocketId).emit('message:receive', {
        message,
        senderId: socket.userId,
        senderName: socket.username,
      });
    }
    // If receiver is offline, they'll get it from DB on next login
    // No need to do anything here — message is already saved via REST
  });

  /**
   * Group message delivery
   * WHY broadcast to room: All group members in the room get the message
   */
  socket.on('message:group:send', ({ message, groupId }) => {
    // Emit to all members in the group room except sender
    socket.to(`group:${groupId}`).emit('message:group:receive', {
      message,
      groupId,
      senderId: socket.userId,
      senderName: socket.username,
    });
  });

  /**
   * Message read receipt
   * Notify sender that their message was read
   */
  socket.on('message:read', ({ senderId, messageId }) => {
    const senderSocketId = onlineUsers.get(senderId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:read:ack', {
        messageId,
        readBy: socket.userId,
        readAt: new Date().toISOString(), // Always send UTC ISO string
      });
    }
  });
};

module.exports = setupChatHandlers;
