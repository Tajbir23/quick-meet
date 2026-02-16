/**
 * ============================================
 * WebRTC Signaling Socket Handlers
 * ============================================
 * 
 * THIS IS THE MOST CRITICAL FILE FOR WEBRTC TO WORK.
 * 
 * WebRTC requires a signaling channel to exchange:
 * 1. SDP Offer — "Here's what media I can send, and how"
 * 2. SDP Answer — "Here's what I can accept, and how"
 * 3. ICE Candidates — "Here's how to reach me (IP, port, protocol)"
 * 
 * Socket.io acts as this signaling channel.
 * Once the WebRTC connection is established, all media flows P2P.
 * 
 * ┌────────┐  1. Offer (via Socket)   ┌────────┐
 * │ Caller │ ────────────────────────► │ Callee │
 * │        │ ◄──────────────────────── │        │
 * │        │  2. Answer (via Socket)   │        │
 * │        │                           │        │
 * │        │  3. ICE Candidates        │        │
 * │        │ ◄──────────────────────►  │        │
 * │        │    (via Socket, both)     │        │
 * │        │                           │        │
 * │        │  4. P2P Media Stream      │        │
 * │        │ ◄═══════════════════════► │        │
 * │        │    (WebRTC, direct)       │        │
 * └────────┘                           └────────┘
 * 
 * CALL FLOW:
 * 1. Caller clicks "Call" → gets local media → creates RTCPeerConnection
 * 2. Caller creates SDP offer → sends via socket ('call:offer')
 * 3. Server routes offer to callee's socket
 * 4. Callee sees incoming call UI
 * 5. Callee accepts → gets local media → creates RTCPeerConnection
 * 6. Callee sets remote description (offer) → creates SDP answer
 * 7. Answer sent back via socket ('call:answer')
 * 8. Both exchange ICE candidates as they're discovered
 * 9. ICE completes → DTLS-SRTP handshake → media flows P2P
 */

const sdpSanitizer = require('../security/SDPSanitizer');
const callTokenService = require('../security/CallTokenService');
const socketGuard = require('../security/SocketGuard');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const Message = require('../models/Message');
const { storePendingNotification } = require('../controllers/pushController');

/**
 * ============================================
 * Pending Calls Queue
 * ============================================
 * 
 * When a call is made to an offline user:
 * 1. Store the call offer in pendingCalls (targetUserId → call data)
 * 2. Send push notification via polling (native Android picks it up)
 * 3. DON'T immediately tell the caller "user offline"
 * 4. Wait up to 30 seconds for the target to come online
 * 5. When target reconnects → deliver the pending call offer
 * 6. If 30s expires → then tell caller "user offline"
 * 
 * This prevents the caller's call from being cut immediately
 * when the target is in background but reachable via notification.
 */
const pendingCalls = new Map(); // targetUserId → { callerId, callerSocketId, offer, callType, callerName, timeout, createdAt }
const PENDING_CALL_TIMEOUT = 30000; // 30 seconds

/**
 * Called from socket/index.js when a user connects.
 * If there's a pending call for this user, deliver it.
 */
function deliverPendingCall(io, socket, userId) {
  const pending = pendingCalls.get(userId);
  if (!pending) return false;

  // Check if still valid (caller still online)
  const callerSocketId = pending.callerSocketId;
  const callerSocket = io.sockets.sockets.get(callerSocketId);
  if (!callerSocket) {
    // Caller disconnected — clean up
    clearTimeout(pending.timeout);
    pendingCalls.delete(userId);
    return false;
  }

  console.log(`📞 Delivering pending call: ${pending.callerName} → ${userId}`);

  // Deliver the call offer to the newly connected user
  socket.emit('call:offer', {
    callerId: pending.callerId,
    callerName: pending.callerName,
    offer: pending.offer,
    callType: pending.callType,
    isReconnect: false,
  });

  // Clean up
  clearTimeout(pending.timeout);
  pendingCalls.delete(userId);
  return true;
}

/**
 * Clean up pending call when caller hangs up or call is rejected
 */
function clearPendingCall(callerId) {
  for (const [targetId, pending] of pendingCalls) {
    if (pending.callerId === callerId) {
      clearTimeout(pending.timeout);
      pendingCalls.delete(targetId);
      console.log(`📞 Pending call cleared for ${targetId} (caller ${callerId} cancelled)`);
      return;
    }
  }
}

/**
 * Helper: Create a call log message in DB and emit to both users in real-time.
 * The CALLER is always the message sender so the UI shows correct direction.
 */
async function createCallMessage(io, onlineUsers, { callerId, receiverId, callType, callDuration, callStatus }) {
  try {
    const message = await Message.create({
      sender: callerId,
      receiver: receiverId,
      content: '',
      type: 'call',
      callType: callType || 'audio',
      callDuration: callDuration || 0,
      callStatus: callStatus || 'completed',
      encrypted: false,
    });

    await message.populate('sender', 'username avatar');
    await message.populate('receiver', 'username avatar');

    // Emit to BOTH users for real-time display
    const callerSocketId = onlineUsers.get(callerId);
    const receiverSocketId = onlineUsers.get(receiverId);

    if (callerSocketId) {
      io.to(callerSocketId).emit('call:message', { message, chatUserId: receiverId });
    }
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('call:message', { message, chatUserId: callerId });
    }

    console.log(`📞 Call message saved: ${callStatus} ${callType} call (${callDuration}s) between ${callerId} ↔ ${receiverId}`);
  } catch (err) {
    console.error('Failed to create call message:', err.message);
  }
}

// Track active 1-to-1 calls: userId → partnerUserId
// Used to notify the other party when a user disconnects during a call
const activeCalls = new Map();

const setupSignalingHandlers = (io, socket, onlineUsers) => {

  /**
   * REQUEST CALL TOKEN — must be obtained before initiating a call
   * One-time token binds caller ↔ callee and expires in 60 seconds
   */
  socket.on('call:request-token', ({ targetUserId, callType }, callback) => {
    const tokenData = callTokenService.generateCallToken(
      socket.userId,
      targetUserId,
      callType
    );

    if (typeof callback === 'function') {
      callback(tokenData);
    } else {
      socket.emit('call:token', tokenData);
    }
  });

  /**
   * Initiate a call — send offer to target user
   * SECURITY: SDP sanitized + optional call token validation
   */
  socket.on('call:offer', ({ targetUserId, offer, callType, isReconnect, callToken }) => {
    // Rate limit check via SocketGuard
    const rateResult = require('../security/IntrusionDetector').checkSocketRate(
      socket.id, socket.userId, 'call:offer'
    );
    if (!rateResult.allowed) {
      socket.emit('security:rate-limited', { event: 'call:offer' });
      return;
    }

    // Validate call token if provided
    if (callToken && !isReconnect) {
      const tokenData = callTokenService.consumeCallToken(callToken, socket.userId);
      if (!tokenData) {
        securityLogger.callEvent('offer_invalid_token', SEVERITY.WARN, {
          callerId: socket.userId,
          targetUserId,
        });
        socket.emit('call:error', { message: 'Invalid or expired call token' });
        return;
      }
    }

    // Sanitize SDP
    if (offer && offer.sdp) {
      const sdpResult = sdpSanitizer.sanitizeSDP(offer.sdp, 'offer', socket.userId);
      if (!sdpResult.valid) {
        securityLogger.callEvent('sdp_rejected', SEVERITY.ALERT, {
          userId: socket.userId,
          type: 'offer',
          warnings: sdpResult.warnings,
        });
        socket.emit('call:error', { message: 'Invalid SDP offer' });
        return;
      }
    }

    const targetSocketId = onlineUsers.get(targetUserId);

    if (!targetSocketId) {
      // User is offline — store pending call offer + notification
      // DON'T immediately tell caller "user offline"
      // Wait up to 30s for target to come online via notification
      
      // Store push notification for native polling
      storePendingNotification(targetUserId, {
        type: 'call',
        title: `${socket.username} is calling...`,
        body: `Incoming ${callType || 'audio'} call`,
        data: {
          callType: callType || 'audio',
          callerId: socket.userId,
          callerName: socket.username,
        },
      });

      // Clear any existing pending call for this target
      const existing = pendingCalls.get(targetUserId);
      if (existing) clearTimeout(existing.timeout);

      // Store pending call with 30-second timeout
      const timeoutId = setTimeout(() => {
        const pending = pendingCalls.get(targetUserId);
        if (pending && pending.callerId === socket.userId) {
          pendingCalls.delete(targetUserId);
          console.log(`📞 Pending call expired: ${socket.username} → ${targetUserId} (30s timeout)`);
          
          // NOW tell caller user is offline (after 30s wait)
          socket.emit('call:user-offline', {
            targetUserId,
            message: 'User is offline',
          });
        }
      }, PENDING_CALL_TIMEOUT);

      pendingCalls.set(targetUserId, {
        callerId: socket.userId,
        callerSocketId: socket.id,
        offer,
        callType: callType || 'audio',
        callerName: socket.username,
        timeout: timeoutId,
        createdAt: Date.now(),
      });

      console.log(`📞 Call queued (target offline): ${socket.username} → ${targetUserId} — waiting 30s for reconnect`);
      return;
    }

    console.log(`📞 Call offer${isReconnect ? ' (reconnect)' : ''}: ${socket.username} → ${targetUserId} (${callType})`);

    securityLogger.callEvent('offer', SEVERITY.INFO, {
      callerId: socket.userId,
      targetUserId,
      callType,
      isReconnect: isReconnect || false,
    });

    io.to(targetSocketId).emit('call:offer', {
      callerId: socket.userId,
      callerName: socket.username,
      offer,
      callType,
      isReconnect: isReconnect || false,
    });
  });

  /**
   * Accept a call — send answer back to caller
   * SECURITY: SDP sanitized
   */
  socket.on('call:answer', ({ callerId, answer }) => {
    // Sanitize SDP answer
    if (answer && answer.sdp) {
      const sdpResult = sdpSanitizer.sanitizeSDP(answer.sdp, 'answer', socket.userId);
      if (!sdpResult.valid) {
        securityLogger.callEvent('sdp_answer_rejected', SEVERITY.ALERT, {
          userId: socket.userId,
          type: 'answer',
          warnings: sdpResult.warnings,
        });
        return;
      }
    }

    const callerSocketId = onlineUsers.get(callerId);

    if (callerSocketId) {
      console.log(`📞 Call answer: ${socket.username} → ${callerId}`);

      // Track active call — both parties
      activeCalls.set(socket.userId, callerId);
      activeCalls.set(callerId, socket.userId);

      io.to(callerSocketId).emit('call:answer', {
        answererId: socket.userId,
        answererName: socket.username,
        answer,
      });
    }
  });

  /**
   * Exchange ICE candidates — SANITIZED
   */
  socket.on('call:ice-candidate', ({ targetUserId, candidate }) => {
    // Sanitize ICE candidate
    if (candidate) {
      const iceResult = sdpSanitizer.sanitizeICECandidate(candidate, socket.userId);
      if (!iceResult.valid) {
        securityLogger.callEvent('ice_candidate_rejected', SEVERITY.WARN, {
          userId: socket.userId,
          warnings: iceResult.warnings,
        });
        return;
      }
    }

    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:ice-candidate', {
        senderId: socket.userId,
        candidate,
      });
    }
  });

  /**
   * Reject a call — creates a 'rejected' call log message
   */
  socket.on('call:reject', ({ callerId, reason, callType }) => {
    const callerSocketId = onlineUsers.get(callerId);

    // Clear active call tracking and pending calls
    activeCalls.delete(socket.userId);
    activeCalls.delete(callerId);
    clearPendingCall(callerId);

    if (callerSocketId) {
      console.log(`📞 Call rejected: ${socket.username} rejected call from ${callerId}`);

      io.to(callerSocketId).emit('call:rejected', {
        rejecterId: socket.userId,
        rejecterName: socket.username,
        reason: reason || 'Call rejected',
      });
    }

    // Save rejected call message (caller = sender, callee = socket.userId)
    createCallMessage(io, onlineUsers, {
      callerId,
      receiverId: socket.userId,
      callType: callType || 'audio',
      callDuration: 0,
      callStatus: 'rejected',
    });
  });

  /**
   * End a call — creates a call log message with duration
   * Client sends: targetUserId, callDuration, callType, isIncoming
   * isIncoming tells us whether the ending user was the callee (true) or caller (false)
   */
  socket.on('call:end', ({ targetUserId, callDuration, callType, isIncoming }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    // Clear active call tracking and pending calls for both parties
    activeCalls.delete(socket.userId);
    activeCalls.delete(targetUserId);
    clearPendingCall(socket.userId);
    clearPendingCall(targetUserId);

    if (targetSocketId) {
      console.log(`📞 Call ended: ${socket.username} → ${targetUserId}`);

      io.to(targetSocketId).emit('call:ended', {
        userId: socket.userId,
        username: socket.username,
      });
    }

    // Determine who the caller was
    // If isIncoming=true → socket.userId is the callee, targetUserId is the caller
    // If isIncoming=false → socket.userId is the caller, targetUserId is the callee
    const callerId = isIncoming ? targetUserId : socket.userId;
    const receiverId = isIncoming ? socket.userId : targetUserId;

    // Determine call status from duration
    const status = (callDuration && callDuration > 0) ? 'completed' : 'missed';

    // Save call log message
    createCallMessage(io, onlineUsers, {
      callerId,
      receiverId,
      callType: callType || 'audio',
      callDuration: callDuration || 0,
      callStatus: status,
    });
  });

  /**
   * Toggle media track (notify peer about mute/unmute)
   */
  socket.on('call:toggle-media', ({ targetUserId, kind, enabled }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:media-toggled', {
        userId: socket.userId,
        kind, // 'audio' or 'video'
        enabled,
      });
    }
  });

  /**
   * Screen share started/stopped
   */
  socket.on('call:screen-share', ({ targetUserId, sharing }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:screen-share', {
        userId: socket.userId,
        username: socket.username,
        sharing,
      });
    }
  });

  /**
   * ICE connection state change notification
   * WHY: Enables reconnection logic on the other side
   */
  socket.on('call:ice-state', ({ targetUserId, state }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:ice-state', {
        userId: socket.userId,
        state, // 'checking' | 'connected' | 'failed' | 'disconnected'
      });
    }
  });

  /**
   * Renegotiation needed (e.g., adding screen share track)
   * WHY: When tracks are added/removed, a new offer/answer is needed
   */
  socket.on('call:renegotiate', ({ targetUserId, offer }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:renegotiate', {
        userId: socket.userId,
        offer,
      });
    }
  });

  socket.on('call:renegotiate-answer', ({ targetUserId, answer }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:renegotiate-answer', {
        userId: socket.userId,
        answer,
      });
    }
  });

  /**
   * Handle disconnect — if user was in an active call, notify the other party.
   * This ensures the call ends for both sides even if the socket disconnects
   * before the client can emit call:end (e.g., app killed, network drop).
   */
  socket.on('disconnect', () => {
    const targetUserId = activeCalls.get(socket.userId);
    if (targetUserId) {
      console.log(`📞 User ${socket.username} disconnected during active call with ${targetUserId}`);
      activeCalls.delete(socket.userId);
      activeCalls.delete(targetUserId);

      const targetSocketId = onlineUsers.get(targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended', {
          userId: socket.userId,
          username: socket.username,
        });
      }
    }
  });
};

module.exports = setupSignalingHandlers;
module.exports.deliverPendingCall = deliverPendingCall;
module.exports.clearPendingCall = clearPendingCall;
