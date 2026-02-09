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

const setupSignalingHandlers = (io, socket, onlineUsers) => {
  /**
   * Initiate a call — send offer to target user
   * 
   * WHAT'S IN THE OFFER:
   * - SDP (Session Description Protocol) describing:
   *   - Media capabilities (codecs, bitrates)
   *   - Media types (audio, video)
   *   - DTLS fingerprint (for encryption)
   */
  socket.on('call:offer', ({ targetUserId, offer, callType }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (!targetSocketId) {
      // Target user is offline
      socket.emit('call:user-offline', {
        targetUserId,
        message: 'User is offline',
      });
      return;
    }

    console.log(`📞 Call offer: ${socket.username} → ${targetUserId} (${callType})`);

    io.to(targetSocketId).emit('call:offer', {
      callerId: socket.userId,
      callerName: socket.username,
      offer,
      callType, // 'audio' | 'video' | 'screen'
    });
  });

  /**
   * Accept a call — send answer back to caller
   */
  socket.on('call:answer', ({ callerId, answer }) => {
    const callerSocketId = onlineUsers.get(callerId);

    if (callerSocketId) {
      console.log(`📞 Call answer: ${socket.username} → ${callerId}`);

      io.to(callerSocketId).emit('call:answer', {
        answererId: socket.userId,
        answererName: socket.username,
        answer,
      });
    }
  });

  /**
   * Exchange ICE candidates
   * 
   * WHY ICE (Interactive Connectivity Establishment):
   * - Discovers all possible network paths between peers
   * - Handles NAT traversal (most devices are behind NAT)
   * - Tries multiple candidates (host, server-reflexive, relay)
   * - Picks the best path automatically
   * 
   * CANDIDATE TYPES:
   * - host: Direct local IP (works on same network)
   * - srflx: Server-reflexive (public IP via STUN)
   * - relay: Relayed through TURN (we don't have TURN)
   * 
   * WITHOUT TURN:
   * - Symmetric NAT ↔ Symmetric NAT: WILL FAIL
   * - Most other NAT combinations: Will work with STUN
   * - Same network: Always works
   */
  socket.on('call:ice-candidate', ({ targetUserId, candidate }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      io.to(targetSocketId).emit('call:ice-candidate', {
        senderId: socket.userId,
        candidate,
      });
    }
  });

  /**
   * Reject a call
   */
  socket.on('call:reject', ({ callerId, reason }) => {
    const callerSocketId = onlineUsers.get(callerId);

    if (callerSocketId) {
      console.log(`📞 Call rejected: ${socket.username} rejected call from ${callerId}`);

      io.to(callerSocketId).emit('call:rejected', {
        rejecterId: socket.userId,
        rejecterName: socket.username,
        reason: reason || 'Call rejected',
      });
    }
  });

  /**
   * End a call
   */
  socket.on('call:end', ({ targetUserId }) => {
    const targetSocketId = onlineUsers.get(targetUserId);

    if (targetSocketId) {
      console.log(`📞 Call ended: ${socket.username} → ${targetUserId}`);

      io.to(targetSocketId).emit('call:ended', {
        userId: socket.userId,
        username: socket.username,
      });
    }
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
};

module.exports = setupSignalingHandlers;
