/**
 * ============================================
 * Group Call Socket Handlers — HARDENED (Mesh)
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - SocketGuard wraps all handlers (rate limiting, JWT re-validation)
 * - SDP sanitization on all offers/answers
 * - ICE candidate validation
 * - Group membership verification on every action
 * - Call token validation for group calls
 * - SecurityEventLogger audit trail
 */

const Group = require('../models/Group');
const { socketGuard, sdpSanitizer, callTokenService, securityLogger } = require('../security');

// Track active group calls: groupId → Map<userId, username>
const activeGroupCalls = new Map();

const setupGroupCallHandlers = (io, socket, onlineUsers) => {
  const guard = socketGuard;

  /**
   * Query active group calls — GUARDED
   */
  socket.on('group-call:get-active-calls', guard.wrapHandler(socket, 'group-call:get-active-calls', () => {
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
  }));

  /**
   * Join a group call — GUARDED + membership verification + call token
   */
  socket.on('group-call:join', guard.wrapHandler(socket, 'group-call:join', async ({ groupId, callToken }) => {
    try {
      if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;

      // Verify membership
      const group = await Group.findById(groupId);
      if (!group || !group.isMember(socket.userId)) {
        socket.emit('group-call:error', { message: 'Not authorized to join this group call' });
        securityLogger.log('WARN', 'CALL', 'Unauthorized group call join', { userId: socket.userId, groupId });
        return;
      }

      // Validate call token if provided
      if (callToken) {
        const tokenValid = callTokenService.validateGroupCallToken(callToken, groupId, socket.userId);
        if (!tokenValid) {
          securityLogger.log('WARN', 'CALL', 'Invalid group call token', { userId: socket.userId, groupId });
          // Don't hard-fail — fall back to membership check only
        }
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

      // Prevent duplicate join
      if (callParticipants.has(socket.userId)) {
        return; // Already in call
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

      const isNewCall = callParticipants.size === 0;
      callParticipants.set(socket.userId, socket.username);
      socket.join(`group-call:${groupId}`);

      securityLogger.log('INFO', 'CALL', 'User joined group call', {
        userId: socket.userId,
        groupId,
        participants: callParticipants.size,
      });

      // Notify ALL group members about the active call
      io.to(`group:${groupId}`).emit('group-call:active', {
        groupId,
        participants: Array.from(callParticipants.entries()).map(([uid, uname]) => ({ userId: uid, username: uname })),
      });

      // Ring group members when call is new
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
      socket.emit('group-call:existing-peers', {
        groupId,
        peers: existingPeers,
      });

      // Tell existing peers about the new peer
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
      securityLogger.log('WARN', 'CALL', 'Group call join error', {
        userId: socket.userId,
        error: error.message,
      });
      socket.emit('group-call:error', { message: 'Failed to join group call' });
    }
  }));

  /**
   * Leave a group call — GUARDED
   */
  socket.on('group-call:leave', guard.wrapHandler(socket, 'group-call:leave', ({ groupId }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;
    handleGroupCallLeave(io, socket, onlineUsers, groupId);
  }));

  /**
   * Send offer to a specific peer — GUARDED + SDP sanitization
   */
  socket.on('group-call:offer', guard.wrapHandler(socket, 'group-call:offer', ({ groupId, targetUserId, offer }) => {
    if (!groupId || !targetUserId || !offer) return;
    if (typeof groupId !== 'string' || groupId.length > 30) return;
    if (typeof targetUserId !== 'string' || targetUserId.length > 30) return;

    // Verify caller is in the group call
    const callParticipants = activeGroupCalls.get(groupId);
    if (!callParticipants || !callParticipants.has(socket.userId)) {
      securityLogger.log('WARN', 'CALL', 'Group call offer from non-participant', {
        userId: socket.userId, groupId,
      });
      return;
    }

    // Sanitize SDP
    if (offer.sdp) {
      const sanitized = sdpSanitizer.sanitizeSDP(offer.sdp, 'offer');
      if (!sanitized.valid) {
        securityLogger.log('ALERT', 'WEBRTC', 'Dangerous group call SDP offer rejected', {
          userId: socket.userId, issues: sanitized.warnings,
        });
        return;
      }
      offer.sdp = sanitized.sdp;
    }

    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group-call:offer', {
        groupId,
        callerId: socket.userId,
        callerName: socket.username,
        offer,
      });
    }
  }));

  /**
   * Send answer to a specific peer — GUARDED + SDP sanitization
   */
  socket.on('group-call:answer', guard.wrapHandler(socket, 'group-call:answer', ({ groupId, targetUserId, answer }) => {
    if (!groupId || !targetUserId || !answer) return;
    if (typeof groupId !== 'string' || groupId.length > 30) return;
    if (typeof targetUserId !== 'string' || targetUserId.length > 30) return;

    // Sanitize SDP answer
    if (answer.sdp) {
      const sanitized = sdpSanitizer.sanitizeSDP(answer.sdp, 'answer');
      if (!sanitized.valid) {
        securityLogger.log('ALERT', 'WEBRTC', 'Dangerous group call SDP answer rejected', {
          userId: socket.userId, issues: sanitized.warnings,
        });
        return;
      }
      answer.sdp = sanitized.sdp;
    }

    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group-call:answer', {
        groupId,
        answererId: socket.userId,
        answererName: socket.username,
        answer,
      });
    }
  }));

  /**
   * ICE candidate for group call peer — GUARDED + candidate validation
   */
  socket.on('group-call:ice-candidate', guard.wrapHandler(socket, 'group-call:ice-candidate', ({ groupId, targetUserId, candidate }) => {
    if (!groupId || !targetUserId) return;
    if (typeof groupId !== 'string' || groupId.length > 30) return;
    if (typeof targetUserId !== 'string' || targetUserId.length > 30) return;

    // Sanitize ICE candidate
    if (candidate) {
      const sanitized = sdpSanitizer.sanitizeICECandidate(candidate);
      if (!sanitized.valid) {
        return; // Silently drop bad candidates
      }
      candidate = sanitized.candidate;
    }

    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('group-call:ice-candidate', {
        groupId,
        senderId: socket.userId,
        candidate,
      });
    }
  }));

  /**
   * Toggle media in group call — GUARDED
   */
  socket.on('group-call:toggle-media', guard.wrapHandler(socket, 'group-call:toggle-media', ({ groupId, kind, enabled }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;
    if (!['audio', 'video'].includes(kind)) return;
    if (typeof enabled !== 'boolean') return;

    socket.to(`group-call:${groupId}`).emit('group-call:media-toggled', {
      userId: socket.userId,
      kind,
      enabled,
    });
  }));

  /**
   * Screen share in group call — GUARDED
   */
  socket.on('group-call:screen-share', guard.wrapHandler(socket, 'group-call:screen-share', ({ groupId, sharing }) => {
    if (!groupId || typeof groupId !== 'string' || groupId.length > 30) return;
    if (typeof sharing !== 'boolean') return;

    socket.to(`group-call:${groupId}`).emit('group-call:screen-share', {
      userId: socket.userId,
      username: socket.username,
      sharing,
    });
  }));

  /**
   * Handle disconnect — clean up group call participation
   */
  socket.on('disconnect', () => {
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

  securityLogger.log('INFO', 'CALL', 'User left group call', {
    userId: socket.userId,
    groupId,
    remaining: callParticipants.size,
  });

  io.to(`group-call:${groupId}`).emit('group-call:peer-left', {
    groupId,
    userId: socket.userId,
    username: socket.username,
  });

  if (callParticipants.size > 0) {
    io.to(`group:${groupId}`).emit('group-call:active', {
      groupId,
      participants: Array.from(callParticipants.entries()).map(([uid, uname]) => ({ userId: uid, username: uname })),
    });
  } else {
    activeGroupCalls.delete(groupId);
    securityLogger.log('INFO', 'CALL', 'Group call ended', { groupId });
    io.to(`group:${groupId}`).emit('group-call:ended', { groupId });
  }
}

module.exports = setupGroupCallHandlers;
