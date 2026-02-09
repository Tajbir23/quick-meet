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
import useAuthStore from '../store/useAuthStore';
import webrtcService from '../services/webrtc';
import { playNotificationSound } from '../utils/helpers';

const useSocket = () => {
  const initialized = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || initialized.current) return;

    initialized.current = true;
    const user = useAuthStore.getState().user;

    // ============================================
    // PRESENCE EVENTS
    // ============================================

    socket.on('users:online-list', (users) => {
      useChatStore.getState().setOnlineUsers(users);
    });

    socket.on('user:online', ({ userId, username }) => {
      useChatStore.getState().addOnlineUser({ userId });
    });

    socket.on('user:offline', ({ userId }) => {
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
    // 1-TO-1 CALL EVENTS
    // ============================================

    socket.on('call:offer', ({ callerId, callerName, offer, callType }) => {
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
      useCallStore.getState().endCall();
    });

    socket.on('call:ended', ({ username }) => {
      console.log(`📞 Call ended by ${username}`);
      useCallStore.getState().endCall();
    });

    socket.on('call:user-offline', ({ targetUserId }) => {
      console.log(`📞 User ${targetUserId} is offline`);
      useCallStore.getState().endCall();
    });

    socket.on('call:media-toggled', ({ userId, kind, enabled }) => {
      console.log(`Remote ${kind} ${enabled ? 'enabled' : 'disabled'} by ${userId}`);
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

    socket.on('group-call:error', ({ message }) => {
      console.error('Group call error:', message);
    });

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
      socket.off('call:offer');
      socket.off('call:answer');
      socket.off('call:ice-candidate');
      socket.off('call:rejected');
      socket.off('call:ended');
      socket.off('call:user-offline');
      socket.off('call:media-toggled');
      socket.off('call:renegotiate');
      socket.off('call:renegotiate-answer');
      socket.off('group-call:existing-peers');
      socket.off('group-call:peer-joined');
      socket.off('group-call:peer-left');
      socket.off('group-call:offer');
      socket.off('group-call:answer');
      socket.off('group-call:ice-candidate');
      socket.off('group-call:error');
      initialized.current = false;
    };
  }, []);
};

export default useSocket;
