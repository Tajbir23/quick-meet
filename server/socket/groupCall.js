/**
 * ============================================
 * Group Call Socket Handlers (Mesh Topology)
 * ============================================
 * 
 * MESH ARCHITECTURE:
 * Every peer connects directly to every other peer.
 * 
 *     A ──── B
 *     │ \  / │
 *     │  \/  │
 *     │  /\  │
 *     │ /  \ │
 *     C ──── D
 * 
 * For N users: N*(N-1)/2 connections
 * - 3 users = 3 connections
 * - 4 users = 6 connections
 * - 5 users = 10 connections
 * - 6 users = 15 connections
 * - 8 users = 28 connections ← performance starts degrading
 * 
 * WHY MESH (not SFU/MCU):
 * - No third-party media server required
 * - True P2P — lowest latency
 * - End-to-end encrypted by default (DTLS-SRTP)
 * - Simple to implement
 * 
 * LIMITATION:
 * - Bandwidth scales with N (each peer uploads N-1 streams)
 * - Recommended max: 6 participants
 * - Beyond that: reduce video quality or switch to audio-only
 * 
 * FLOW FOR NEW PEER JOINING:
 * 1. New peer emits 'group-call:join'
 * 2. Server tells new peer about existing peers ('group-call:existing-peers')
 * 3. Server tells existing peers about new peer ('group-call:peer-joined')
 * 4. New peer creates offer for each existing peer
 * 5. Each existing peer creates answer
 * 6. ICE candidates exchanged
 * 7. All connections established
 */

const Group = require('../models/Group');

// Track active group calls: groupId → Map<userId, username>
const activeGroupCalls = new Map();

const setupGroupCallHandlers = (io, socket, onlineUsers) => {
  /**
   * Query active group calls — client asks on connect to populate banners
   */
  socket.on('group-call:get-active-calls', () => {
    const result = [];
    for (const [groupId, participants] of activeGroupCalls.entries()) {
      if (participants.size > 0) {
        result.push({
          groupId,
          participants: Array.from(participants.entries()).map(([uid, uname]) => ({ userId: uid, username: uname })),
        });
      }
    }
    socket.emit('group-call:active-calls', result);
  });

  /**
   * Join a group call
   */
  socket.on('group-call:join', async ({ groupId }) => {
    try {
      // Verify membership
      const group = await Group.findById(groupId);
      if (!group || !group.isMember(socket.userId)) {
        socket.emit('group-call:error', {
          message: 'Not authorized to join this group call',
        });
        return;
      }

      // Check call member limit (mesh topology constraint)
      if (!activeGroupCalls.has(groupId)) {
        activeGroupCalls.set(groupId, new Map());
      }

      const callParticipants = activeGroupCalls.get(groupId);

      if (callParticipants.size >= (group.maxCallMembers || 6)) {
        socket.emit('group-call:error', {
          message: `Group call is full (max ${group.maxCallMembers || 6} participants for mesh calls)`,
        });
        return;
      }

      // Get existing participants before adding new one
      const existingPeers = [];
      for (const [peerId, peerName] of callParticipants) {
        const peerSocketId = onlineUsers.get(peerId);
        if (peerSocketId) {
          existingPeers.push({
            userId: peerId,
            username: peerName,
            socketId: peerSocketId,
          });
        }
      }

      // Was this the first person joining? (i.e. they're starting the call)
      const isNewCall = callParticipants.size === 0;

      // Add new participant (store userId → username)
      callParticipants.set(socket.userId, socket.username);

      // Join socket room for the group call
      socket.join(`group-call:${groupId}`);

      console.log(`📞 Group call: ${socket.username} joined call in group ${groupId} (${callParticipants.size} participants)`);

      // *** Notify ALL group members about the active call (Telegram-style) ***
      // This goes to the group chat room so the join banner appears in the group header.
      io.to(`group:${groupId}`).emit('group-call:active', {
        groupId,
        participants: Array.from(callParticipants.entries()).map(([uid, uname]) => ({ userId: uid, username: uname })),
      });

      // Also ring group members (incoming call popup) when call is new
      if (isNewCall) {
        io.to(`group:${groupId}`).emit('group-call:incoming', {
          groupId,
          groupName: group.name,
          callerId: socket.userId,
          callerName: socket.username,
          participantCount: callParticipants.size,
          isNewCall,
        });
      }

      // Tell the new peer about existing peers
      // New peer will create offers for each existing peer
      socket.emit('group-call:existing-peers', {
        groupId,
        peers: existingPeers,
      });

      // Tell existing peers about the new peer
      // They will wait for the offer from the new peer
      socket.to(`group-call:${groupId}`).emit('group-call:peer-joined', {
        groupId,
        userId: socket.userId,
        username: socket.username,
        socketId: socket.id,
      });

      // Broadcast participant count update
      io.to(`group-call:${groupId}`).emit('group-call:participants-update', {
        groupId,
        count: callParticipants.size,
        participants: Array.from(callParticipants.keys()),
      });

    } catch (error) {
      console.error('Group call join error:', error);
      socket.emit('group-call:error', {
        message: 'Failed to join group call',
      });
    }
  });

  /**
   * Leave a group call
   */
  socket.on('group-call:leave', ({ groupId }) => {
    handleGroupCallLeave(io, socket, onlineUsers, groupId);
  });

  /**
   * Send offer to a specific peer in group call
   */
  socket.on('group-call:offer', ({ groupId, targetUserId, offer }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('group-call:offer', {
        groupId,
        callerId: socket.userId,
        callerName: socket.username,
        offer,
      });
    }
  });

  /**
   * Send answer to a specific peer in group call
   */
  socket.on('group-call:answer', ({ groupId, targetUserId, answer }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('group-call:answer', {
        groupId,
        answererId: socket.userId,
        answererName: socket.username,
        answer,
      });
    }
  });

  /**
   * ICE candidate for group call peer
   */
  socket.on('group-call:ice-candidate', ({ groupId, targetUserId, candidate }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('group-call:ice-candidate', {
        groupId,
        senderId: socket.userId,
        candidate,
      });
    }
  });

  /**
   * Toggle media in group call
   */
  socket.on('group-call:toggle-media', ({ groupId, kind, enabled }) => {
    socket.to(`group-call:${groupId}`).emit('group-call:media-toggled', {
      userId: socket.userId,
      kind,
      enabled,
    });
  });

  /**
   * Screen share in group call
   */
  socket.on('group-call:screen-share', ({ groupId, sharing }) => {
    socket.to(`group-call:${groupId}`).emit('group-call:screen-share', {
      userId: socket.userId,
      username: socket.username,
      sharing,
    });
  });

  /**
   * Handle disconnect — clean up group call participation
   */
  socket.on('disconnect', () => {
    // Clean up from all active group calls
    for (const [groupId, participants] of activeGroupCalls.entries()) {
      if (participants.has(socket.userId)) {
        handleGroupCallLeave(io, socket, onlineUsers, groupId);
      }
    }
  });
};

/**
 * Helper: Handle a user leaving a group call
 */
function handleGroupCallLeave(io, socket, onlineUsers, groupId) {
  const callParticipants = activeGroupCalls.get(groupId);

  if (!callParticipants) return;

  callParticipants.delete(socket.userId);
  socket.leave(`group-call:${groupId}`);

  console.log(`📞 Group call: ${socket.username} left call in group ${groupId} (${callParticipants.size} remaining)`);

  // Notify remaining peers
  io.to(`group-call:${groupId}`).emit('group-call:peer-left', {
    groupId,
    userId: socket.userId,
    username: socket.username,
  });

  // Broadcast updated active call status to ALL group members
  if (callParticipants.size > 0) {
    io.to(`group:${groupId}`).emit('group-call:active', {
      groupId,
      participants: Array.from(callParticipants.entries()).map(([uid, uname]) => ({ userId: uid, username: uname })),
    });
  } else {
    // Call empty → ended
    activeGroupCalls.delete(groupId);
    console.log(`📞 Group call ended for group ${groupId}`);

    io.to(`group:${groupId}`).emit('group-call:ended', {
      groupId,
    });
  }
}

module.exports = setupGroupCallHandlers;
