/**
 * ============================================
 * useSocket Hook
 * ============================================
 * 
 * Centralizes all socket event listeners.
 * Sets up and tears down listeners on mount/unmount.
 * Routes socket events to the appropriate store actions.
 */

import { useEffect, useRef } from 'react';
import { getSocket } from '../services/socket';
import useChatStore from '../store/useChatStore';
import useCallStore from '../store/useCallStore';
import useGroupStore from '../store/useGroupStore';
import useAuthStore from '../store/useAuthStore';
import webrtcService from '../services/webrtc';
import { playNotificationSound } from '../utils/helpers';
import useFileTransferStore from '../store/useFileTransferStore';

const useSocket = () => {
  const initialized = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || initialized.current) return;

    initialized.current = true;
    const user = useAuthStore.getState().user;

    // ============================================
    // P2P FILE TRANSFER INITIALIZATION
    // ============================================
    useFileTransferStore.getState().initialize();

    // Also retry on socket 'connect' in case first init was too early
    socket.on('connect', () => {
      const ftStore = useFileTransferStore.getState();
      if (!ftStore.initialized) {
        console.log('[useSocket] Socket connected/reconnected — retrying file transfer init');
        ftStore.initialize();
      }
    });

    // ============================================
    // PRESENCE EVENTS
    // ============================================

    socket.on('users:online-list', (users) => {
      console.log(`👤 Online users list received: ${users.length} users`);
      useChatStore.getState().setOnlineUsers(users);
    });

    socket.on('user:online', ({ userId, username, socketId }) => {
      console.log(`👤 User online: ${username} (${userId})`);
      useChatStore.getState().addOnlineUser({ userId, socketId });

      // If this user isn't in our users list (e.g. new signup), refresh the list
      const { users } = useChatStore.getState();
      if (!users.some(u => u._id === userId)) {
        useChatStore.getState().fetchUsers();
      }
    });

    socket.on('user:offline', ({ userId }) => {
      console.log(`👤 User offline: ${userId}`);
      useChatStore.getState().removeOnlineUser(userId);
    });

    // ============================================
    // CHAT EVENTS
    // ============================================

    socket.on('message:receive', ({ message, senderId }) => {
      useChatStore.getState().addReceivedMessage(senderId, message);
      playNotificationSound('message');
    });

    socket.on('message:group:receive', ({ message, groupId }) => {
      useChatStore.getState().addReceivedMessage(groupId, message);
      playNotificationSound('message');
    });

    // Typing indicators
    socket.on('typing:start', ({ userId }) => {
      useChatStore.getState().setTyping(userId, userId, true);
    });

    socket.on('typing:stop', ({ userId }) => {
      useChatStore.getState().setTyping(userId, userId, false);
    });

    socket.on('typing:group:start', ({ userId, groupId }) => {
      useChatStore.getState().setTyping(groupId, userId, true);
    });

    socket.on('typing:group:stop', ({ userId, groupId }) => {
      useChatStore.getState().setTyping(groupId, userId, false);
    });

    // ============================================
    // GROUP MEMBER EVENTS
    // ============================================

    socket.on('group:member-added', ({ groupId, addedUserId, addedUsername, addedBy }) => {
      console.log(`👥 ${addedBy} added ${addedUsername} to group ${groupId}`);

      // If I was the one added, fetch my groups and join the room
      if (addedUserId === user?._id) {
        useGroupStore.getState().fetchMyGroups().then(() => {
          socket.emit('group:join-room', { groupId });
        });
        playNotificationSound('message');
      }
    });

    // ============================================
    // 1-TO-1 CALL EVENTS
    // ============================================

    socket.on('call:offer', async ({ callerId, callerName, offer, callType, isReconnect }) => {
      const { callStatus, remoteUser } = useCallStore.getState();

      // If this is a reconnect offer and we're still in a call with this user,
      // auto-accept without showing incoming call UI
      if (isReconnect && callStatus !== 'idle' && remoteUser?.userId === callerId) {
        console.log(`🔄 Reconnect offer from ${callerName} — auto-accepting`);
        try {
          // Tear down old broken PeerConnection, build fresh one
          webrtcService.closePeerConnection(callerId);
          webrtcService.createPeerConnection(callerId);
          useCallStore.getState().setupWebRTCCallbacks(callerId);

          const answer = await webrtcService.handleOffer(callerId, offer);
          socket.emit('call:answer', { callerId, answer });
        } catch (err) {
          console.error('Failed to handle reconnect offer:', err);
        }
        return;
      }

      console.log(`📞 Incoming call from ${callerName} (${callType})`);

      useCallStore.getState().setIncomingCall({
        callerId,
        callerName,
        offer,
        callType,
      });

      playNotificationSound('call');
    });

    socket.on('call:answer', async ({ answererId, answer }) => {
      try {
        console.log(`📞 Call answered by ${answererId}`);
        await webrtcService.handleAnswer(answererId, answer);
        // Don't set CONNECTED here — let ICE state change handle it
        // ICE will transition to 'connected' which sets CALL_STATUS.CONNECTED
        console.log('📞 Answer processed, waiting for ICE connection...');
      } catch (err) {
        console.error('Failed to handle call answer:', err);
      }
    });

    socket.on('call:ice-candidate', async ({ senderId, candidate }) => {
      try {
        await webrtcService.handleIceCandidate(senderId, candidate);
      } catch (err) {
        console.error('Failed to handle ICE candidate:', err);
      }
    });

    socket.on('call:rejected', ({ rejecterName, reason }) => {
      console.log(`📞 Call rejected by ${rejecterName}: ${reason}`);
      useCallStore.getState().endCall(true); // fromRemote=true to prevent double emit
    });

    socket.on('call:ended', ({ username }) => {
      console.log(`📞 Call ended by ${username}`);
      useCallStore.getState().endCall(true); // fromRemote=true to prevent double emit
    });

    socket.on('call:user-offline', ({ targetUserId }) => {
      console.log(`📞 User ${targetUserId} is offline`);
      useCallStore.getState().endCall(true); // fromRemote=true — no call to log for offline
    });

    // ─── CALL LOG MESSAGE ─────────────────────────
    // Server creates a call log message when a call ends/rejects
    // and emits it to both users for real-time display in chat
    socket.on('call:message', ({ message, chatUserId }) => {
      console.log(`📞 Call log message received for chat: ${chatUserId}`);
      useChatStore.getState().addReceivedMessage(chatUserId, message);
    });

    socket.on('call:media-toggled', ({ userId, kind, enabled }) => {
      console.log(`Remote ${kind} ${enabled ? 'enabled' : 'disabled'} by ${userId}`);
      if (kind === 'audio') {
        useCallStore.setState({ remoteAudioMuted: !enabled });
      } else if (kind === 'video') {
        useCallStore.setState({ remoteVideoMuted: !enabled });
      }
    });

    // Renegotiation (for screen share, ICE restart, etc.)
    socket.on('call:renegotiate', async ({ userId, offer }) => {
      try {
        console.log('🔄 Renegotiation offer received from:', userId);
        const answer = await webrtcService.handleOffer(userId, offer);
        socket.emit('call:renegotiate-answer', {
          targetUserId: userId,
          answer,
        });
      } catch (err) {
        console.error('Failed to handle renegotiation:', err);
      }
    });

    socket.on('call:renegotiate-answer', async ({ userId, answer }) => {
      try {
        await webrtcService.handleAnswer(userId, answer);
      } catch (err) {
        console.error('Failed to handle renegotiation answer:', err);
      }
    });

    // ============================================
    // GROUP CALL EVENTS
    // ============================================

    socket.on('group-call:existing-peers', async ({ groupId, peers }) => {
      try {
        console.log(`📞 Group call: ${peers.length} existing peers`);
        await useCallStore.getState().handleExistingPeers(peers);
      } catch (err) {
        console.error('Failed to handle existing peers:', err);
      }
    });

    // *** Active group call status (Telegram-style banner) ***
    // Emitted whenever someone joins/leaves a group call
    socket.on('group-call:active', ({ groupId, participants }) => {
      useGroupStore.getState().setActiveGroupCall(groupId, participants);
    });

    // Bulk response: all active calls on connect
    socket.on('group-call:active-calls', (calls) => {
      useGroupStore.getState().setActiveGroupCalls(calls);
    });

    // Query active calls now that we're connected
    socket.emit('group-call:get-active-calls');

    // *** Reconnect handler ***
    // When socket reconnects, room memberships are lost (new server socket).
    // Re-join all group rooms and re-query active calls so banners/badges update.
    socket.on('connect', () => {
      console.log('🔌 Socket (re)connected — re-joining group rooms & refreshing online users');
      const { myGroups } = useGroupStore.getState();
      myGroups.forEach(g => socket.emit('group:join-room', { groupId: g._id }));
      socket.emit('group-call:get-active-calls');
      // Re-request online users (server also auto-sends on connect, but this is a safety net)
      socket.emit('users:get-online-list');
      // Refresh users list in case new users signed up
      useChatStore.getState().fetchUsers();
    });

    // Group call ended — remove banner & dismiss ringing
    socket.on('group-call:ended', ({ groupId }) => {
      useGroupStore.getState().removeActiveGroupCall(groupId);
      const { incomingGroupCall } = useCallStore.getState();
      if (incomingGroupCall && incomingGroupCall.groupId === groupId) {
        useCallStore.getState().dismissGroupCall();
      }
    });

    // Ringing notification when a NEW group call starts
    socket.on('group-call:incoming', ({ groupId, groupName, callerId, callerName, participantCount }) => {
      if (callerId === user?._id) return;

      const { callStatus, isGroupCall, groupId: currentGroupId } = useCallStore.getState();
      if (callStatus !== 'idle' && !(isGroupCall && currentGroupId === groupId)) return;
      if (isGroupCall && currentGroupId === groupId) return;

      useCallStore.getState().setIncomingGroupCall({
        groupId,
        groupName,
        callerName,
        participantCount,
      });

      playNotificationSound('call');
    });

    socket.on('group-call:peer-joined', async ({ userId, username }) => {
      try {
        console.log(`📞 Group call: ${username} joined`);
        await useCallStore.getState().handleGroupPeerJoined(userId, username);
      } catch (err) {
        console.error('Failed to handle peer joined:', err);
      }
    });

    socket.on('group-call:peer-left', ({ userId, username }) => {
      console.log(`📞 Group call: ${username} left`);
      useCallStore.getState().handleGroupPeerLeft(userId);
    });

    socket.on('group-call:offer', async ({ groupId, callerId, offer }) => {
      try {
        // Set up callbacks BEFORE handling offer
        useCallStore.getState().setupWebRTCCallbacks(callerId);
        const answer = await webrtcService.handleOffer(callerId, offer);

        socket.emit('group-call:answer', {
          groupId,
          targetUserId: callerId,
          answer,
        });
      } catch (err) {
        console.error('Failed to handle group call offer:', err);
      }
    });

    socket.on('group-call:answer', async ({ answererId, answer }) => {
      try {
        await webrtcService.handleAnswer(answererId, answer);
      } catch (err) {
        console.error('Failed to handle group call answer:', err);
      }
    });

    socket.on('group-call:ice-candidate', async ({ senderId, candidate }) => {
      try {
        await webrtcService.handleIceCandidate(senderId, candidate);
      } catch (err) {
        console.error('Failed to handle group ICE candidate:', err);
      }
    });

    // Screen share notification from a group call peer
    socket.on('group-call:screen-share', ({ userId, username, sharing }) => {
      console.log(`🖥️ ${username} ${sharing ? 'started' : 'stopped'} screen sharing`);
      // Update participant's isScreenSharing flag
      const { groupCallParticipants, isGroupCall } = useCallStore.getState();
      if (isGroupCall) {
        const updated = groupCallParticipants.map(p =>
          p.userId === userId ? { ...p, isScreenSharing: sharing } : p
        );
        useCallStore.setState({ groupCallParticipants: updated });
      }
    });

    // Media toggle notification from a group call peer
    socket.on('group-call:media-toggled', ({ userId, kind, enabled }) => {
      console.log(`📡 Group peer ${userId} ${kind} ${enabled ? 'on' : 'off'}`);
      const { groupCallParticipants, isGroupCall } = useCallStore.getState();
      if (isGroupCall) {
        const updated = groupCallParticipants.map(p =>
          p.userId === userId
            ? { ...p, ...(kind === 'audio' ? { isMuted: !enabled } : { isVideoOff: !enabled }) }
            : p
        );
        useCallStore.setState({ groupCallParticipants: updated });
      }
    });

    socket.on('group-call:error', ({ message }) => {
      console.error('Group call error:', message);
    });

    // ============================================
    // OWNER MODE EVENT
    // ============================================
    socket.on('owner:mode-changed', ({ userId, ownerModeVisible }) => {
      // Update the user in the users list when owner toggles visibility.
      // Uses updateUserRole which skips setState if no change needed,
      // preventing the re-render cascade that wiped message content.
      useChatStore.getState().updateUserRole(
        userId,
        ownerModeVisible ? 'owner' : 'user'
      );
    });

    // ============================================
    // REQUEST INITIAL STATE
    // WHY: connectSocket() runs in checkAuth() and the socket
    //      may connect BEFORE this useEffect registers listeners.
    //      That means the server's auto-sent 'users:online-list'
    //      was emitted to a socket with no listener → lost.
    //      Explicitly requesting it here guarantees we get it.
    // ============================================
    if (socket.connected) {
      socket.emit('users:get-online-list');
    }

    // Heartbeat
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat');
      }
    }, 30000);

    // Cleanup on unmount
    return () => {
      clearInterval(heartbeatInterval);
      socket.off('users:online-list');
      socket.off('user:online');
      socket.off('user:offline');
      socket.off('message:receive');
      socket.off('message:group:receive');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('typing:group:start');
      socket.off('typing:group:stop');
      socket.off('group:member-added');
      socket.off('call:offer');
      socket.off('call:answer');
      socket.off('call:ice-candidate');
      socket.off('call:rejected');
      socket.off('call:ended');
      socket.off('call:user-offline');
      socket.off('call:message');
      socket.off('call:media-toggled');
      socket.off('call:renegotiate');
      socket.off('call:renegotiate-answer');
      socket.off('group-call:existing-peers');
      socket.off('group-call:active');
      socket.off('group-call:active-calls');
      socket.off('group-call:ended');
      socket.off('group-call:incoming');
      socket.off('group-call:peer-joined');
      socket.off('group-call:peer-left');
      socket.off('group-call:offer');
      socket.off('group-call:answer');
      socket.off('group-call:ice-candidate');
      socket.off('group-call:screen-share');
      socket.off('group-call:media-toggled');
      socket.off('group-call:error');
      socket.off('owner:mode-changed');
      socket.off('connect');
      // Cleanup file transfer
      useFileTransferStore.getState().cleanup();
      initialized.current = false;
    };
  }, []);
};

export default useSocket;
