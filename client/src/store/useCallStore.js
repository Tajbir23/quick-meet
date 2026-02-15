/**
 * ============================================
 * Call Store (Zustand)
 * ============================================
 * 
 * Manages: Call state, local/remote streams, call UI state
 * 
 * WHY separate from chat store:
 * - Call state is complex and independent
 * - Streams are not serializable
 * - Call UI overlays chat UI
 * - Clean separation of concerns
 */

import { create } from 'zustand';
import webrtcService from '../services/webrtc';
import { getSocket } from '../services/socket';
import { CALL_STATUS } from '../utils/constants';
import {
  dismissCallNotification,
  onCallStarted as bgCallStarted,
  onCallEnded as bgCallEnded,
} from '../services/backgroundService';

const useCallStore = create((set, get) => ({
  // State
  callStatus: CALL_STATUS.IDLE,
  callType: null,          // 'audio' | 'video'
  isIncoming: false,
  remoteUser: null,        // { userId, username }
  localStream: null,
  remoteStream: null,
  remoteStreams: {},        // For group calls: { peerId: stream }
  isAudioEnabled: true,
  isVideoEnabled: true,
  isScreenSharing: false,
  callDuration: 0,
  callTimer: null,
  iceState: 'new',

  // Remote user media state (1-to-1 calls)
  remoteAudioMuted: false,
  remoteVideoMuted: false,

  // Group call state
  isGroupCall: false,
  groupId: null,
  groupCallParticipants: [],

  // UI state
  isMinimized: false,

  // Incoming call data
  incomingCall: null,      // { callerId, callerName, offer, callType }

  // Incoming GROUP call data (separate from 1-to-1)
  incomingGroupCall: null,  // { groupId, groupName, callerName, participantCount }

  // ============================================
  // 1-TO-1 CALL ACTIONS
  // ============================================

  /**
   * Initiate an outgoing call
   */
  startCall: async (targetUser, callType) => {
    try {
      const socket = getSocket();
      if (!socket) throw new Error('Socket not connected');

      set({
        callStatus: CALL_STATUS.CALLING,
        callType,
        remoteUser: targetUser,
        isAudioEnabled: true,
        isVideoEnabled: callType === 'video',
        isIncoming: false,
      });

      // Get local media — fallback to audio-only if camera unavailable
      const constraints = {
        audio: true,
        video: callType === 'video',
      };
      let localStream;
      try {
        localStream = await webrtcService.getLocalStream(constraints);
      } catch (mediaErr) {
        if (callType === 'video') {
          console.warn('Camera unavailable, falling back to audio-only:', mediaErr.message);
          localStream = await webrtcService.getLocalStream({ audio: true, video: false });
          set({ isVideoEnabled: false });
        } else {
          throw mediaErr;
        }
      }
      set({ localStream });
      webrtcService.createPeerConnection(targetUser.userId);

      // Set up callbacks
      get().setupWebRTCCallbacks(targetUser.userId);

      // Create and send offer
      const offer = await webrtcService.createOffer(targetUser.userId);

      socket.emit('call:offer', {
        targetUserId: targetUser.userId,
        offer,
        callType,
      });
    } catch (error) {
      console.error('Failed to start call:', error);
      get().endCall();
      throw error;
    }
  },

  /**
   * Accept an incoming call
   */
  acceptCall: async () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    // Dismiss background call notification immediately
    dismissCallNotification();

    try {
      const socket = getSocket();
      if (!socket) throw new Error('Socket not connected');

      // Save call data before clearing (in case of race conditions)
      const { callerId, callerName, offer, callType } = incomingCall;

      // Set state to CALLING (not CONNECTED yet — wait for ICE to actually connect)
      // This shows the call overlay with "Connecting..." status
      set({
        callStatus: CALL_STATUS.CALLING,
        callType,
        remoteUser: {
          userId: callerId,
          username: callerName,
        },
        isIncoming: true,
        isAudioEnabled: true,
        isVideoEnabled: callType === 'video',
        incomingCall: null, // Clear incoming call data immediately
      });

      // Get local media — fallback to audio-only if camera unavailable
      const constraints = {
        audio: true,
        video: callType === 'video',
      };
      let localStream;
      try {
        localStream = await webrtcService.getLocalStream(constraints);
      } catch (mediaErr) {
        if (callType === 'video') {
          console.warn('Camera unavailable, falling back to audio-only:', mediaErr.message);
          localStream = await webrtcService.getLocalStream({ audio: true, video: false });
          set({ isVideoEnabled: false });
        } else {
          throw mediaErr;
        }
      }
      set({ localStream });
      get().setupWebRTCCallbacks(callerId);

      // Handle the offer and create answer
      const answer = await webrtcService.handleOffer(callerId, offer);

      socket.emit('call:answer', {
        callerId,
        answer,
      });

      // Update background notification: call active
      bgCallStarted(callerName, callType);

      // Timer will start when ICE state changes to 'connected'
    } catch (error) {
      console.error('Failed to accept call:', error);
      get().endCall();
      throw error;
    }
  },

  /**
   * Reject an incoming call
   */
  rejectCall: () => {
    const { incomingCall } = get();
    if (!incomingCall) return;

    // Dismiss background call notification
    dismissCallNotification();

    const socket = getSocket();
    if (socket) {
      socket.emit('call:reject', {
        callerId: incomingCall.callerId,
        reason: 'Call rejected',
        callType: incomingCall.callType || 'audio',
      });
    }

    set({
      incomingCall: null,
      callStatus: CALL_STATUS.IDLE,
    });
  },

  /**
   * End the current call
   * @param {boolean} fromRemote — true when triggered by remote event (call:ended / call:rejected)
   *                                to prevent emitting call:end back to server (avoids duplicate messages)
   */
  endCall: (fromRemote = false) => {
    const { remoteUser, callTimer, isGroupCall, groupId, callDuration, callType, isIncoming } = get();
    const socket = getSocket();

    // Notify background service: call ended
    bgCallEnded();

    if (isGroupCall && groupId) {
      // Leave group call
      if (socket) {
        socket.emit('group-call:leave', { groupId });
      }
    } else if (!fromRemote && remoteUser && socket) {
      // Only emit call:end if WE are ending the call (not a remote event)
      // Send call metadata so the server can create a call log message
      socket.emit('call:end', {
        targetUserId: remoteUser.userId,
        callDuration: callDuration || 0,
        callType: callType || 'audio',
        isIncoming: isIncoming || false,
      });
    }

    // Stop timer
    if (callTimer) {
      clearInterval(callTimer);
    }

    // Close all WebRTC connections
    webrtcService.closeAllConnections();

    // Clear any pending reconnect data (call ended normally)
    localStorage.removeItem('pendingCallReconnect');

    // Reset state
    set({
      callStatus: CALL_STATUS.IDLE,
      callType: null,
      isIncoming: false,
      remoteUser: null,
      localStream: null,
      remoteStream: null,
      remoteStreams: {},
      isAudioEnabled: true,
      isVideoEnabled: true,
      isScreenSharing: false,
      callDuration: 0,
      callTimer: null,
      incomingCall: null,
      incomingGroupCall: null,
      isMinimized: false,
      iceState: 'new',
      remoteAudioMuted: false,
      remoteVideoMuted: false,
      isGroupCall: false,
      groupId: null,
      groupCallParticipants: [],
    });
  },

  // ============================================
  // CALL RECONNECTION (after page refresh)
  // ============================================

  /**
   * Reconnect a call that was interrupted by a page refresh.
   * Restores call state from sessionStorage data, acquires media,
   * creates a new PeerConnection and sends a fresh offer with
   * the isReconnect flag so the remote peer auto-accepts.
   */
  reconnectCall: async (savedCall) => {
    const { callType, remoteUserId, remoteUsername, isGroupCall, groupId, callDuration } = savedCall;

    // Group calls — just re-join the room (server still has it)
    if (isGroupCall && groupId) {
      try {
        await get().startGroupCall(groupId, callType || 'audio');
      } catch (err) {
        console.error('Group call reconnect failed:', err);
      }
      return;
    }

    // 1-to-1 call reconnection
    if (!remoteUserId) return;

    try {
      const socket = getSocket();
      if (!socket) throw new Error('Socket not connected');

      set({
        callStatus: CALL_STATUS.RECONNECTING,
        callType,
        remoteUser: { userId: remoteUserId, username: remoteUsername },
        isAudioEnabled: true,
        isVideoEnabled: callType === 'video',
        callDuration: callDuration || 0,
        isIncoming: false,
      });

      // Get local media
      const constraints = { audio: true, video: callType === 'video' };
      let localStream;
      try {
        localStream = await webrtcService.getLocalStream(constraints);
      } catch (mediaErr) {
        if (callType === 'video') {
          console.warn('Camera unavailable, falling back to audio-only:', mediaErr.message);
          localStream = await webrtcService.getLocalStream({ audio: true, video: false });
          set({ isVideoEnabled: false });
        } else {
          throw mediaErr;
        }
      }
      set({ localStream });

      webrtcService.createPeerConnection(remoteUserId);
      get().setupWebRTCCallbacks(remoteUserId);

      const offer = await webrtcService.createOffer(remoteUserId);

      socket.emit('call:offer', {
        targetUserId: remoteUserId,
        offer,
        callType,
        isReconnect: true,
      });

      console.log('🔄 Reconnect offer sent to', remoteUsername);
    } catch (error) {
      console.error('Call reconnect failed:', error);
      get().endCall();
    }
  },

  // ============================================
  // MINIMIZE / MAXIMIZE
  // ============================================

  toggleMinimize: () => {
    set((state) => ({ isMinimized: !state.isMinimized }));
  },

  maximizeCall: () => {
    set({ isMinimized: false });
  },

  // ============================================
  // MEDIA CONTROLS
  // ============================================

  toggleAudio: () => {
    const enabled = webrtcService.toggleAudio();
    const { remoteUser, isGroupCall, groupId } = get();
    const socket = getSocket();

    set({ isAudioEnabled: enabled });

    if (socket) {
      if (isGroupCall) {
        socket.emit('group-call:toggle-media', { groupId, kind: 'audio', enabled });
      } else if (remoteUser) {
        socket.emit('call:toggle-media', {
          targetUserId: remoteUser.userId,
          kind: 'audio',
          enabled,
        });
      }
    }
  },

  toggleVideo: () => {
    const enabled = webrtcService.toggleVideo();
    const { remoteUser, isGroupCall, groupId } = get();
    const socket = getSocket();

    set({ isVideoEnabled: enabled });

    if (socket) {
      if (isGroupCall) {
        socket.emit('group-call:toggle-media', { groupId, kind: 'video', enabled });
      } else if (remoteUser) {
        socket.emit('call:toggle-media', {
          targetUserId: remoteUser.userId,
          kind: 'video',
          enabled,
        });
      }
    }
  },

  toggleScreenShare: async () => {
    const { isScreenSharing, remoteUser, isGroupCall, groupId } = get();
    const socket = getSocket();

    try {
      if (isScreenSharing) {
        // Stop screen share, revert to camera (or null for audio-only calls)
        webrtcService.stopScreenShare();

        // Revert video track in peer connections to camera (or null if audio-only)
        const cameraTrack = webrtcService.localStream?.getVideoTracks()[0] || null;
        await webrtcService.replaceVideoTrack(cameraTrack);

        // Revert local video to camera stream
        set({ isScreenSharing: false, localStream: webrtcService.localStream });

        if (socket) {
          if (isGroupCall) {
            socket.emit('group-call:screen-share', { groupId, sharing: false });
          } else if (remoteUser) {
            socket.emit('call:screen-share', {
              targetUserId: remoteUser.userId,
              sharing: false,
            });
          }
        }
      } else {
        // Start screen share
        const screenStream = await webrtcService.startScreenShare();
        const screenTrack = screenStream.getVideoTracks()[0];

        await webrtcService.replaceVideoTrack(screenTrack);

        // Handle when user stops sharing via browser UI
        screenTrack.onended = () => {
          get().toggleScreenShare(); // Will stop screen share
        };

        // Update local video to show screen share preview
        set({ isScreenSharing: true, localStream: screenStream });

        if (socket) {
          if (isGroupCall) {
            socket.emit('group-call:screen-share', { groupId, sharing: true });
          } else if (remoteUser) {
            socket.emit('call:screen-share', {
              targetUserId: remoteUser.userId,
              sharing: true,
            });
          }
        }
      }
    } catch (error) {
      console.error('Screen share error:', error);
      throw error;
    }
  },

  // ============================================
  // DEVICE SWITCHING (mid-call)
  // ============================================

  /**
   * Switch microphone input device during an active call
   */
  switchAudioDevice: async (deviceId) => {
    try {
      await webrtcService.switchAudioDevice(deviceId);
      console.log('🎤 Audio input switched to:', deviceId);
    } catch (error) {
      console.error('Failed to switch audio device:', error);
      throw error;
    }
  },

  /**
   * Switch camera input device during an active call
   */
  switchVideoDevice: async (deviceId) => {
    try {
      await webrtcService.switchVideoDevice(deviceId);
      // Update localStream reference in store
      set({ localStream: webrtcService.localStream });
      console.log('📹 Video input switched to:', deviceId);
    } catch (error) {
      console.error('Failed to switch video device:', error);
      throw error;
    }
  },

  /**
   * Switch audio output device (speaker / headphone)
   * @param {HTMLMediaElement} audioElement - the <audio> or <video> element playing remote audio
   * @param {string} deviceId - output device id
   */
  switchAudioOutput: async (audioElement, deviceId) => {
    try {
      await webrtcService.setAudioOutput(audioElement, deviceId);
      console.log('🔊 Audio output switched to:', deviceId);
    } catch (error) {
      console.error('Failed to switch audio output:', error);
      throw error;
    }
  },

  // ============================================
  // GROUP CALL ACTIONS
  // ============================================

  startGroupCall: async (groupId, callType = 'video') => {
    try {
      const socket = getSocket();
      if (!socket) throw new Error('Socket not connected');

      // Dismiss any incoming group call notification (we're the one starting/joining)
      set({ incomingGroupCall: null });

      set({
        callStatus: CALL_STATUS.CONNECTED,
        callType,
        isGroupCall: true,
        groupId,
        isAudioEnabled: true,
        isVideoEnabled: callType === 'video',
      });

      // Get local media
      const constraints = { audio: true, video: callType === 'video' };
      let localStream;
      try {
        localStream = await webrtcService.getLocalStream(constraints);
      } catch (mediaErr) {
        if (callType === 'video') {
          console.warn('Camera unavailable, falling back to audio-only:', mediaErr.message);
          localStream = await webrtcService.getLocalStream({ audio: true, video: false });
          set({ isVideoEnabled: false });
        } else {
          throw mediaErr;
        }
      }
      set({ localStream });

      // Join group call room
      socket.emit('group-call:join', { groupId });
    } catch (error) {
      console.error('Failed to start group call:', error);
      get().endCall();
      throw error;
    }
  },

  /**
   * Set incoming group call notification (from socket)
   */
  setIncomingGroupCall: (data) => {
    // Don't show notification if we're already in this group call
    const { isGroupCall, groupId, callStatus } = get();
    if (isGroupCall && groupId === data.groupId && callStatus !== CALL_STATUS.IDLE) return;

    set({ incomingGroupCall: data });
  },

  /**
   * Dismiss the incoming group call notification without joining
   */
  dismissGroupCall: () => {
    set({ incomingGroupCall: null });
  },

  /**
   * Join an ongoing group call (from incoming notification)
   */
  joinGroupCall: async (groupId, callType = 'audio') => {
    set({ incomingGroupCall: null });
    await get().startGroupCall(groupId, callType);
  },

  /**
   * Handle new peer joining group call — WE (existing peer) create offer
   * Only the EXISTING peer creates the offer to avoid glare/DTLS role conflict.
   */
  handleGroupPeerJoined: async (peerId, peerName) => {
    const socket = getSocket();
    const { groupId } = get();

    // Create peer connection for new peer
    webrtcService.createPeerConnection(peerId);
    get().setupWebRTCCallbacks(peerId);

    // Existing peer creates and sends offer to the new peer
    const offer = await webrtcService.createOffer(peerId);

    if (socket) {
      socket.emit('group-call:offer', {
        groupId,
        targetUserId: peerId,
        offer,
      });
    }

    // Update participants
    set((state) => ({
      groupCallParticipants: [
        ...state.groupCallParticipants,
        { userId: peerId, username: peerName },
      ],
    }));
  },

  /**
   * Handle existing peers when joining a group call
   * NEW peer does NOT create offers — it just prepares connections.
   * Existing peers will send offers via handleGroupPeerJoined.
   */
  handleExistingPeers: async (peers) => {
    // Just add participants to list; existing peers will initiate offers
    for (const peer of peers) {
      // Pre-create peer connections so they're ready when offers arrive
      webrtcService.createPeerConnection(peer.userId);
      get().setupWebRTCCallbacks(peer.userId);
    }

    // Track as participants (username comes from the offer handler)
    set((state) => ({
      groupCallParticipants: [
        ...state.groupCallParticipants,
        ...peers.map(p => ({ userId: p.userId, username: p.username || 'Peer' })),
      ],
    }));
  },

  /**
   * Handle peer leaving group call
   */
  handleGroupPeerLeft: (peerId) => {
    webrtcService.closePeerConnection(peerId);

    set((state) => ({
      groupCallParticipants: state.groupCallParticipants.filter(
        p => p.userId !== peerId
      ),
      remoteStreams: (() => {
        const streams = { ...state.remoteStreams };
        delete streams[peerId];
        return streams;
      })(),
    }));
  },

  // ============================================
  // INTERNAL HELPERS
  // ============================================

  /**
   * Set incoming call data (called from socket handler)
   */
  setIncomingCall: (data) => {
    set({
      incomingCall: data,
      callStatus: CALL_STATUS.RINGING,
    });
  },

  /**
   * Setup WebRTC callbacks for a peer
   */
  setupWebRTCCallbacks: (peerId) => {
    webrtcService.onRemoteStream = (remotePeerId, stream) => {
      console.log('📥 Remote stream received from:', remotePeerId);
      if (get().isGroupCall) {
        set((state) => ({
          remoteStreams: {
            ...state.remoteStreams,
            [remotePeerId]: stream,
          },
        }));
      } else {
        set({ remoteStream: stream });
      }
    };

    webrtcService.onRemoteStreamRemoved = (remotePeerId) => {
      if (get().isGroupCall) {
        set((state) => {
          const streams = { ...state.remoteStreams };
          delete streams[remotePeerId];
          return { remoteStreams: streams };
        });
      } else {
        set({ remoteStream: null });
      }
    };

    webrtcService.onIceCandidate = (remotePeerId, candidate) => {
      const socket = getSocket();
      if (!socket) return;

      if (get().isGroupCall) {
        socket.emit('group-call:ice-candidate', {
          groupId: get().groupId,
          targetUserId: remotePeerId,
          candidate,
        });
      } else {
        socket.emit('call:ice-candidate', {
          targetUserId: remotePeerId,
          candidate,
        });
      }
    };

    webrtcService.onIceStateChange = (remotePeerId, state) => {
      console.log(`🧊 ICE state callback: ${state} for ${remotePeerId}`);
      set({ iceState: state });

      if (state === 'connected' || state === 'completed') {
        if (get().callStatus !== CALL_STATUS.CONNECTED) {
          set({ callStatus: CALL_STATUS.CONNECTED });
          get().startCallTimer();
        }
      }

      if (state === 'failed') {
        console.log('⚠️ ICE failed — attempting ICE restart...');
        set({ callStatus: CALL_STATUS.RECONNECTING });

        // Attempt ICE restart
        webrtcService.restartIce(remotePeerId)
          .then((offer) => {
            if (offer) {
              const socket = getSocket();
              if (socket) {
                if (get().isGroupCall) {
                  socket.emit('group-call:offer', {
                    groupId: get().groupId,
                    targetUserId: remotePeerId,
                    offer,
                  });
                } else {
                  socket.emit('call:renegotiate', {
                    targetUserId: remotePeerId,
                    offer,
                  });
                }
              }
            }
          })
          .catch((err) => {
            console.error('ICE restart failed:', err);
            set({ callStatus: CALL_STATUS.FAILED });
          });

        // Fallback: if ICE stays failed for 10s after restart attempt, end the call
        setTimeout(() => {
          const { iceState: laterState, callStatus: laterStatus } = get();
          if (laterState === 'failed' && laterStatus !== CALL_STATUS.IDLE) {
            console.log('❌ ICE still failed after 10s — auto-ending call');
            get().endCall();
          }
        }, 10000);
      }

      if (state === 'disconnected') {
        // Disconnected can recover — wait 5 seconds, then try ICE restart
        set({ callStatus: CALL_STATUS.RECONNECTING });
        setTimeout(() => {
          const currentIce = get().iceState;
          if (currentIce === 'disconnected') {
            console.log('⚠️ Still disconnected after 5s, attempting ICE restart');
            webrtcService.restartIce(remotePeerId)
              .then((offer) => {
                if (offer) {
                  const socket = getSocket();
                  if (socket) {
                    if (get().isGroupCall) {
                      socket.emit('group-call:offer', {
                        groupId: get().groupId,
                        targetUserId: remotePeerId,
                        offer,
                      });
                    } else {
                      socket.emit('call:renegotiate', {
                        targetUserId: remotePeerId,
                        offer,
                      });
                    }
                  }
                }
              })
              .catch((err) => {
                console.error('ICE restart failed:', err);
              });
          }
        }, 5000);

        // Fallback: if still disconnected or not recovered after 15s, end the call
        // This handles the case where the remote peer hung up but the
        // call:ended socket event didn't arrive
        setTimeout(() => {
          const { iceState: laterState, callStatus: laterStatus } = get();
          const notRecovered = laterState === 'disconnected' || laterState === 'failed';
          if (notRecovered && laterStatus !== CALL_STATUS.IDLE) {
            console.log('❌ ICE not recovered after 15s — auto-ending call');
            get().endCall();
          }
        }, 15000);
      }

      if (state === 'closed') {
        // PeerConnection was closed — the remote peer likely hung up
        const { callStatus: currentStatus } = get();
        if (currentStatus !== CALL_STATUS.IDLE) {
          console.log('🔒 ICE state closed — ending call');
          get().endCall();
        }
      }
    };

    // Handle renegotiation (for screen share adding video to audio call, etc.)
    webrtcService.onNegotiationNeeded = async (remotePeerId) => {
      const pc = webrtcService.peerConnections.get(remotePeerId);
      // Only renegotiate when connection is stable (not during initial setup)
      if (!pc || pc.signalingState !== 'stable') {
        console.log('Skipping renegotiation — not in stable state');
        return;
      }

      try {
        console.log('🔄 Renegotiation needed, creating new offer');
        const offer = await webrtcService.createOffer(remotePeerId);
        const socket = getSocket();
        if (socket) {
          if (get().isGroupCall) {
            socket.emit('group-call:offer', {
              groupId: get().groupId,
              targetUserId: remotePeerId,
              offer,
            });
          } else {
            socket.emit('call:renegotiate', {
              targetUserId: remotePeerId,
              offer,
            });
          }
        }
      } catch (err) {
        console.error('Renegotiation failed:', err);
      }
    };
  },

  /**
   * Start call duration timer
   */
  startCallTimer: () => {
    const { callTimer } = get();
    if (callTimer) clearInterval(callTimer);

    const timer = setInterval(() => {
      set((state) => ({ callDuration: state.callDuration + 1 }));
    }, 1000);

    set({ callTimer: timer });
  },
}));

export default useCallStore;
