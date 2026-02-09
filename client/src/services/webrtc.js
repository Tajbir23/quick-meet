/**
 * ============================================
 * WebRTC Service — Pure P2P Media Transport
 * ============================================
 * 
 * THIS IS THE CORE OF THE ENTIRE SYSTEM.
 * 
 * Manages RTCPeerConnection lifecycle for:
 * - 1-to-1 audio/video calls
 * - Screen sharing
 * - Group calls (mesh: one connection per peer)
 * 
 * ARCHITECTURE:
 * ┌──────────────────────────────────────────┐
 * │              WebRTCService               │
 * │                                          │
 * │  peerConnections: Map<peerId, RTCPeer>   │
 * │  localStream: MediaStream                │
 * │  remoteStreams: Map<peerId, MediaStream>  │
 * │  screenStream: MediaStream               │
 * │                                          │
 * │  Methods:                                │
 * │  ├── getLocalStream()                    │
 * │  ├── createPeerConnection()              │
 * │  ├── createOffer()                       │
 * │  ├── handleOffer()                       │
 * │  ├── handleAnswer()                      │
 * │  ├── handleIceCandidate()                │
 * │  ├── startScreenShare()                  │
 * │  ├── stopScreenShare()                   │
 * │  ├── toggleAudio()                       │
 * │  ├── toggleVideo()                       │
 * │  ├── closeConnection()                   │
 * │  └── closeAllConnections()               │
 * └──────────────────────────────────────────┘
 * 
 * WHY CLASS-BASED:
 * - Encapsulates all WebRTC state
 * - Clean lifecycle management
 * - Multiple peer connections for mesh group calls
 * - Event callbacks for UI updates
 * 
 * SECURITY:
 * WebRTC uses DTLS-SRTP by default = end-to-end encrypted media.
 * No media passes through our server. Only signaling data (SDP, ICE)
 * goes through Socket.io.
 */

import { ICE_SERVERS, MEDIA_CONSTRAINTS, SCREEN_CONSTRAINTS } from '../utils/constants';

class WebRTCService {
  constructor() {
    // Map of peer connections: peerId → RTCPeerConnection
    this.peerConnections = new Map();

    // Local media streams
    this.localStream = null;
    this.screenStream = null;

    // Remote media streams: peerId → MediaStream
    this.remoteStreams = new Map();

    // ICE candidate queues (for candidates that arrive before remote description is set)
    this.iceCandidateQueues = new Map();

    // Callback functions (set by the component using this service)
    this.onRemoteStream = null;       // (peerId, stream) => {}
    this.onRemoteStreamRemoved = null; // (peerId) => {}
    this.onIceCandidate = null;        // (peerId, candidate) => {}
    this.onIceStateChange = null;      // (peerId, state) => {}
    this.onConnectionStateChange = null; // (peerId, state) => {}
    this.onNegotiationNeeded = null;   // (peerId) => {}
    this.onTrackMuted = null;          // (peerId, kind, muted) => {}
  }

  // ============================================
  // LOCAL MEDIA
  // ============================================

  /**
   * Get local media stream (camera + microphone)
   * 
   * WHY separate method:
   * - Can be called independently (preview before call)
   * - Handles permission denial gracefully
   * - Returns existing stream if already acquired
   * 
   * @param {Object} constraints - MediaStreamConstraints
   * @returns {MediaStream}
   */
  async getLocalStream(constraints = {}) {
    try {
      // Check secure context FIRST
      if (!window.isSecureContext) {
        throw new Error(
          'WebRTC requires HTTPS. Please access this site via HTTPS. ' +
          'Camera and microphone access is blocked on insecure origins.'
        );
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          'Your browser does not support WebRTC media APIs. ' +
          'Please use a modern browser (Chrome, Firefox, Edge).'
        );
      }

      // Build audio constraints — support specific deviceId
      let audioConstraints;
      if (constraints.audio === false) {
        audioConstraints = false;
      } else if (constraints.audioDeviceId) {
        audioConstraints = { ...MEDIA_CONSTRAINTS.audio, deviceId: { exact: constraints.audioDeviceId } };
      } else if (typeof constraints.audio === 'object') {
        audioConstraints = constraints.audio;
      } else {
        audioConstraints = MEDIA_CONSTRAINTS.audio;
      }

      // Build video constraints — support specific deviceId
      let videoConstraints;
      if (constraints.video === false) {
        videoConstraints = false;
      } else if (constraints.videoDeviceId) {
        videoConstraints = { ...MEDIA_CONSTRAINTS.video, deviceId: { exact: constraints.videoDeviceId } };
      } else if (typeof constraints.video === 'object') {
        videoConstraints = constraints.video;
      } else {
        videoConstraints = MEDIA_CONSTRAINTS.video;
      }

      const finalConstraints = {
        audio: audioConstraints,
        video: videoConstraints,
      };

      this.localStream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      console.log('📹 Local stream acquired:', {
        audio: this.localStream.getAudioTracks().length,
        video: this.localStream.getVideoTracks().length,
      });

      return this.localStream;
    } catch (error) {
      console.error('Failed to get local stream:', error);

      // Provide helpful error messages
      if (error.name === 'NotAllowedError') {
        throw new Error('Camera/microphone permission denied. Please allow access and try again.');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No camera or microphone found. Please connect a device and try again.');
      }
      if (error.name === 'NotReadableError') {
        throw new Error('Camera or microphone is already in use by another application.');
      }
      if (error.name === 'OverconstrainedError') {
        // Try with simpler constraints
        console.log('Retrying with basic constraints...');
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: constraints.video !== false,
        });
        return this.localStream;
      }
      throw error;
    }
  }

  /**
   * Get audio-only local stream
   */
  async getAudioOnlyStream() {
    return this.getLocalStream({
      audio: MEDIA_CONSTRAINTS.audio,
      video: false,
    });
  }

  /**
   * Start screen sharing
   * 
   * WHY separate from getLocalStream:
   * - Uses getDisplayMedia (different API)
   * - User selects which screen/window to share
   * - Can be added as additional track to existing connection
   */
  async startScreenShare() {
    try {
      if (!navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in your browser.');
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);

      // When user stops sharing via browser UI (clicking "Stop sharing")
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

      console.log('🖥️ Screen sharing started');
      return this.screenStream;
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen sharing was cancelled.');
      }
      throw error;
    }
  }

  /**
   * Stop screen sharing and revert to camera
   */
  stopScreenShare() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
      console.log('🖥️ Screen sharing stopped');
    }
  }

  // ============================================
  // PEER CONNECTION MANAGEMENT
  // ============================================

  /**
   * Create a new RTCPeerConnection for a specific peer
   * 
   * WHY per-peer connection:
   * - WebRTC is fundamentally point-to-point
   * - Each peer gets its own connection, SDP, ICE candidates
   * - For group calls (mesh), we create N-1 connections
   * 
   * @param {string} peerId - The remote user's ID
   * @returns {RTCPeerConnection}
   */
  createPeerConnection(peerId) {
    // Close existing connection if any
    if (this.peerConnections.has(peerId)) {
      this.closePeerConnection(peerId);
    }

    console.log(`🔗 Creating peer connection for: ${peerId}`);

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Initialize ICE candidate queue
    this.iceCandidateQueues.set(peerId, []);

    // ---- EVENT HANDLERS ----

    /**
     * ICE Candidate discovered
     * WHY: Each candidate is a potential network path to reach this peer.
     * Must send to remote peer via signaling (Socket.io).
     */
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`🧊 ICE candidate for ${peerId}:`, event.candidate.type);
        if (this.onIceCandidate) {
          this.onIceCandidate(peerId, event.candidate);
        }
      }
    };

    /**
     * ICE Connection State Change
     * States: new → checking → connected → completed → failed/disconnected/closed
     * 
     * WHY monitor: Enables reconnection logic
     */
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`🧊 ICE state for ${peerId}: ${state}`);

      if (this.onIceStateChange) {
        this.onIceStateChange(peerId, state);
      }

      // Handle failure — attempt ICE restart
      if (state === 'failed') {
        console.log(`⚠️ ICE failed for ${peerId}, attempting restart...`);
        this.restartIce(peerId);
      }

      // Clean up on close
      if (state === 'closed' || state === 'disconnected') {
        // Give it a moment — disconnected can recover
        if (state === 'disconnected') {
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected') {
              console.log(`⚠️ Connection to ${peerId} still disconnected, may need restart`);
            }
          }, 5000);
        }
      }
    };

    /**
     * Connection State Change (overall)
     */
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`📡 Connection state for ${peerId}: ${state}`);

      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(peerId, state);
      }
    };

    /**
     * Remote track received
     * WHY: This fires when the remote peer adds their media tracks.
     * The event contains the MediaStream we need to play in a <video> element.
     */
    pc.ontrack = (event) => {
      console.log(`📥 Remote track from ${peerId}:`, event.track.kind);

      const [remoteStream] = event.streams;
      if (remoteStream) {
        this.remoteStreams.set(peerId, remoteStream);

        if (this.onRemoteStream) {
          this.onRemoteStream(peerId, remoteStream);
        }

        // Track mute/unmute events
        event.track.onmute = () => {
          console.log(`🔇 Remote ${event.track.kind} muted from ${peerId}`);
          if (this.onTrackMuted) {
            this.onTrackMuted(peerId, event.track.kind, true);
          }
        };

        event.track.onunmute = () => {
          console.log(`🔊 Remote ${event.track.kind} unmuted from ${peerId}`);
          if (this.onTrackMuted) {
            this.onTrackMuted(peerId, event.track.kind, false);
          }
        };
      }
    };

    /**
     * Negotiation needed
     * WHY: Fires when tracks are added/removed, requiring new offer/answer
     */
    pc.onnegotiationneeded = () => {
      console.log(`🔄 Negotiation needed for ${peerId}`);
      if (this.onNegotiationNeeded) {
        this.onNegotiationNeeded(peerId);
      }
    };

    // Store the connection
    this.peerConnections.set(peerId, pc);

    // Add local tracks if we have them
    if (this.localStream) {
      this.addLocalTracks(peerId);
    }

    return pc;
  }

  /**
   * Add local media tracks to a peer connection
   */
  addLocalTracks(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (!pc || !this.localStream) return;

    const existingSenders = pc.getSenders();
    
    this.localStream.getTracks().forEach(track => {
      // Check if track is already added
      const alreadyAdded = existingSenders.some(
        sender => sender.track && sender.track.id === track.id
      );
      if (!alreadyAdded) {
        pc.addTrack(track, this.localStream);
        console.log(`➕ Added ${track.kind} track to connection with ${peerId}`);
      }
    });
  }

  // ============================================
  // SIGNALING (Offer/Answer/ICE)
  // ============================================

  /**
   * Create SDP offer and set as local description
   * 
   * CALLER does this first.
   * The offer describes what media we want to send and our capabilities.
   * 
   * @param {string} peerId
   * @returns {RTCSessionDescriptionInit} The offer SDP
   */
  async createOffer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) throw new Error(`No peer connection for ${peerId}`);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await pc.setLocalDescription(offer);
      console.log(`📤 Offer created for ${peerId}`);

      return offer;
    } catch (error) {
      console.error(`Failed to create offer for ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle received offer from remote peer
   * 
   * CALLEE does this.
   * Sets the offer as remote description, then creates and returns an answer.
   * 
   * @param {string} peerId
   * @param {RTCSessionDescriptionInit} offer
   * @returns {RTCSessionDescriptionInit} The answer SDP
   */
  async handleOffer(peerId, offer) {
    let pc = this.peerConnections.get(peerId);

    // Create connection if it doesn't exist yet
    if (!pc) {
      pc = this.createPeerConnection(peerId);
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log(`📥 Remote description (offer) set for ${peerId}`);

      // Process queued ICE candidates
      await this.processIceCandidateQueue(peerId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`📤 Answer created for ${peerId}`);

      return answer;
    } catch (error) {
      console.error(`Failed to handle offer from ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle received answer from remote peer
   * 
   * CALLER does this after receiving the callee's answer.
   * 
   * @param {string} peerId
   * @param {RTCSessionDescriptionInit} answer
   */
  async handleAnswer(peerId, answer) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) {
      console.error(`No peer connection for ${peerId} when handling answer`);
      return;
    }

    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`📥 Remote description (answer) set for ${peerId}`);

        // Process queued ICE candidates
        await this.processIceCandidateQueue(peerId);
      } else {
        console.warn(`Unexpected signaling state: ${pc.signalingState} for ${peerId}`);
      }
    } catch (error) {
      console.error(`Failed to handle answer from ${peerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle received ICE candidate from remote peer
   * 
   * WHY QUEUING:
   * ICE candidates can arrive before the remote description is set.
   * We queue them and process after setRemoteDescription completes.
   * Without queuing: "Failed to add ICE candidate" errors.
   */
  async handleIceCandidate(peerId, candidate) {
    const pc = this.peerConnections.get(peerId);

    if (!pc) {
      console.warn(`No peer connection for ${peerId}, queuing ICE candidate`);
      if (!this.iceCandidateQueues.has(peerId)) {
        this.iceCandidateQueues.set(peerId, []);
      }
      this.iceCandidateQueues.get(peerId).push(candidate);
      return;
    }

    try {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        // Queue for later
        if (!this.iceCandidateQueues.has(peerId)) {
          this.iceCandidateQueues.set(peerId, []);
        }
        this.iceCandidateQueues.get(peerId).push(candidate);
      }
    } catch (error) {
      console.error(`Failed to add ICE candidate for ${peerId}:`, error);
    }
  }

  /**
   * Process queued ICE candidates after remote description is set
   */
  async processIceCandidateQueue(peerId) {
    const pc = this.peerConnections.get(peerId);
    const queue = this.iceCandidateQueues.get(peerId);

    if (!pc || !queue || queue.length === 0) return;

    console.log(`Processing ${queue.length} queued ICE candidates for ${peerId}`);

    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Failed to add queued ICE candidate:', error);
      }
    }

    // Clear queue
    this.iceCandidateQueues.set(peerId, []);
  }

  // ============================================
  // MEDIA CONTROL
  // ============================================

  /**
   * Toggle local audio (mute/unmute)
   * @returns {boolean} New enabled state
   */
  toggleAudio() {
    if (!this.localStream) return false;

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      console.log(`🎤 Audio ${audioTrack.enabled ? 'unmuted' : 'muted'}`);
      return audioTrack.enabled;
    }
    return false;
  }

  /**
   * Toggle local video (on/off)
   * @returns {boolean} New enabled state
   */
  toggleVideo() {
    if (!this.localStream) return false;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      console.log(`📹 Video ${videoTrack.enabled ? 'on' : 'off'}`);
      return videoTrack.enabled;
    }
    return false;
  }

  /**
   * Replace video track with screen share (or back to camera)
   * 
   * WHY replaceTrack:
   * - No renegotiation needed (no new offer/answer)
   * - Seamless switch
   * - Remote peer sees the new track automatically
   */
  async replaceVideoTrack(newTrack) {
    for (const [peerId, pc] of this.peerConnections) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
        console.log(`🔄 Replaced video track for ${peerId}`);
      }
    }
  }

  // ============================================
  // DEVICE SWITCHING (mid-call)
  // ============================================

  /**
   * Switch microphone to a different audio input device mid-call.
   * Gets a new audio track from the selected device and replaces
   * the existing track in all peer connections.
   */
  async switchAudioDevice(deviceId) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { ...MEDIA_CONSTRAINTS.audio, deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getAudioTracks()[0];
      if (!newTrack) throw new Error('No audio track from device');

      // Replace in all peer connections
      for (const [peerId, pc] of this.peerConnections) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (sender) {
          await sender.replaceTrack(newTrack);
        }
      }

      // Replace in local stream
      if (this.localStream) {
        const oldTrack = this.localStream.getAudioTracks()[0];
        if (oldTrack) {
          this.localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        this.localStream.addTrack(newTrack);
      }

      console.log('🎤 Switched audio device to:', deviceId);
      return true;
    } catch (error) {
      console.error('Failed to switch audio device:', error);
      throw error;
    }
  }

  /**
   * Switch camera to a different video input device mid-call.
   */
  async switchVideoDevice(deviceId) {
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { ...MEDIA_CONSTRAINTS.video, deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error('No video track from device');

      // Replace in all peer connections
      await this.replaceVideoTrack(newTrack);

      // Replace in local stream
      if (this.localStream) {
        const oldTrack = this.localStream.getVideoTracks()[0];
        if (oldTrack) {
          this.localStream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        this.localStream.addTrack(newTrack);
      }

      console.log('📹 Switched video device to:', deviceId);
      return true;
    } catch (error) {
      console.error('Failed to switch video device:', error);
      throw error;
    }
  }

  /**
   * Set audio output device (speaker/headphone) on a given audio/video element.
   * Uses HTMLMediaElement.setSinkId() — Chrome/Edge support.
   */
  async setAudioOutput(element, deviceId) {
    try {
      if (element && typeof element.setSinkId === 'function') {
        await element.setSinkId(deviceId);
        console.log('🔊 Audio output set to:', deviceId);
        return true;
      } else {
        console.warn('setSinkId not supported in this browser');
        return false;
      }
    } catch (error) {
      console.error('Failed to set audio output:', error);
      throw error;
    }
  }

  // ============================================
  // ICE RESTART & RECONNECTION
  // ============================================

  /**
   * Restart ICE for a peer (attempt reconnection)
   * 
   * WHY: If ICE fails (NAT/firewall issue), restarting generates
   * new candidates that might find a working path.
   */
  async restartIce(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return;

    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);

      console.log(`🔄 ICE restart initiated for ${peerId}`);

      // The offer needs to be sent to the remote peer via signaling
      // This will be handled by the onNegotiationNeeded callback
      return offer;
    } catch (error) {
      console.error(`ICE restart failed for ${peerId}:`, error);
      throw error;
    }
  }

  // ============================================
  // CLEANUP
  // ============================================

  /**
   * Close a specific peer connection
   */
  closePeerConnection(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.oniceconnectionstatechange = null;
      pc.onconnectionstatechange = null;
      pc.ontrack = null;
      pc.onnegotiationneeded = null;
      pc.close();
      this.peerConnections.delete(peerId);
      console.log(`🔒 Peer connection closed for ${peerId}`);
    }

    // Clean up remote stream
    if (this.remoteStreams.has(peerId)) {
      this.remoteStreams.delete(peerId);
      if (this.onRemoteStreamRemoved) {
        this.onRemoteStreamRemoved(peerId);
      }
    }

    // Clean up ICE queue
    this.iceCandidateQueues.delete(peerId);
  }

  /**
   * Close ALL peer connections and stop all streams
   * Called when ending a call or leaving a group call
   */
  closeAllConnections() {
    console.log('🔒 Closing all peer connections...');

    // Close all peer connections
    for (const peerId of this.peerConnections.keys()) {
      this.closePeerConnection(peerId);
    }

    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }

    // Stop screen stream
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
      this.screenStream = null;
    }

    // Clear all maps
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.iceCandidateQueues.clear();

    console.log('🔒 All connections closed and streams stopped');
  }

  // ============================================
  // DIAGNOSTICS
  // ============================================

  /**
   * Get connection statistics for debugging
   */
  async getStats(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (!pc) return null;

    try {
      const stats = await pc.getStats();
      const result = {};

      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          result.candidatePair = {
            localCandidateId: report.localCandidateId,
            remoteCandidateId: report.remoteCandidateId,
            bytesSent: report.bytesSent,
            bytesReceived: report.bytesReceived,
            currentRoundTripTime: report.currentRoundTripTime,
          };
        }
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          result.inboundVideo = {
            framesReceived: report.framesReceived,
            framesDecoded: report.framesDecoded,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight,
            bytesReceived: report.bytesReceived,
          };
        }
      });

      return result;
    } catch (error) {
      console.error('Failed to get stats:', error);
      return null;
    }
  }
}

// Export singleton instance
// WHY singleton: One WebRTC service shared across the entire app
const webrtcService = new WebRTCService();
export default webrtcService;
