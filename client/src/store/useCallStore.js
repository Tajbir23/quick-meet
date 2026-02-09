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

  // Group call state
  isGroupCall: false,
  groupId: null,
  groupCallParticipants: [],

  // Incoming call data
  incomingCall: null,      // { callerId, callerName, offer, callType }

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

      // Get local media
      const constraints = {
        audio: true,
        video: callType === 'video',
      };
      const localStream = await webrtcService.getLocalStream(constraints);
      set({ localStream });

      // Create peer connection
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

      // Get local media
      const constraints = {
        audio: true,
        video: callType === 'video',
      };
      const localStream = await webrtcService.getLocalStream(constraints);
      set({ localStream });

      // Set up callbacks BEFORE handling offer
      get().setupWebRTCCallbacks(callerId);

      // Handle the offer and create answer
      const answer = await webrtcService.handleOffer(callerId, offer);

      socket.emit('call:answer', {
        callerId,
        answer,
      });

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

    const socket = getSocket();
    if (socket) {
      socket.emit('call:reject', {
        callerId: incomingCall.callerId,
        reason: 'Call rejected',
      });
    }

    set({
      incomingCall: null,
      callStatus: CALL_STATUS.IDLE,
    });
  },

  /**
   * End the current call
   */
  endCall: () => {
    const { remoteUser, callTimer, isGroupCall, groupId } = get();
    const socket = getSocket();

    if (isGroupCall && groupId) {
      // Leave group call
      if (socket) {
        socket.emit('group-call:leave', { groupId });
      }
    } else if (remoteUser && socket) {
      socket.emit('call:end', { targetUserId: remoteUser.userId });
    }

    // Stop timer
    if (callTimer) {
      clearInterval(callTimer);
    }

    // Close all WebRTC connections
    webrtcService.closeAllConnections();

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
      iceState: 'new',
      isGroupCall: false,
      groupId: null,
      groupCallParticipants: [],
    });
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
        // Stop screen share, revert to camera
        webrtcService.stopScreenShare();

        // Revert video track in peer connections to camera
        const cameraTrack = webrtcService.localStream?.getVideoTracks()[0];
        if (cameraTrack) {
          await webrtcService.replaceVideoTrack(cameraTrack);
        }

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
      const localStream = await webrtcService.getLocalStream(constraints);
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
   * Handle new peer joining group call — create offer
   */
  handleGroupPeerJoined: async (peerId, peerName) => {
    const socket = getSocket();
    const { groupId } = get();

    // Create peer connection for new peer
    webrtcService.createPeerConnection(peerId);
    get().setupWebRTCCallbacks(peerId);

    // Create and send offer
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
   * Handle existing peers when joining a group call — create offers
   */
  handleExistingPeers: async (peers) => {
    const socket = getSocket();
    const { groupId } = get();

    for (const peer of peers) {
      webrtcService.createPeerConnection(peer.userId);
      get().setupWebRTCCallbacks(peer.userId);

      const offer = await webrtcService.createOffer(peer.userId);

      if (socket) {
        socket.emit('group-call:offer', {
          groupId,
          targetUserId: peer.userId,
          offer,
        });
      }
    }
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
      }

      if (state === 'disconnected') {
        // Disconnected can recover — wait 5 seconds
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
