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
import { isAndroid } from '../utils/platform';

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
      // Android native app: use Capacitor ScreenCapture plugin
      if (isAndroid()) {
        return await this._startAndroidScreenShare();
      }

      // Web/Electron: use standard getDisplayMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser/app. Use a desktop browser instead.');
      }

      try {
        this.screenStream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
      } catch (constraintErr) {
        // Fallback: some browsers reject advanced constraints
        console.warn('Retrying screen share with basic constraints:', constraintErr.message);
        this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      }

      // Note: onended handler is set by the caller (useCallStore.toggleScreenShare)
      // to properly revert both WebRTC and UI state.

      console.log('🖥️ Screen sharing started');
      return this.screenStream;
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Screen sharing was cancelled.');
      }
      console.error('Screen share error:', error.name, error.message);
      throw error;
    }
  }

  /**
   * Android-specific screen share using native MediaProjection via Capacitor plugin.
   * 
   * Flow:
   * 1. Call native ScreenCapture.start() → requests MediaProjection permission
   * 2. Native service captures screen via MediaProjection → ImageReader
   * 3. Frames are sent to JS as base64 JPEG via Capacitor events
   * 4. JS draws frames on a canvas → canvas.captureStream() → WebRTC
   * 
   * This gives ACTUAL screen content (not a placeholder) over WebRTC.
   */
  async _startAndroidScreenShare() {
    const ScreenCapture = window.Capacitor?.Plugins?.ScreenCapture;
    if (!ScreenCapture) {
      throw new Error('Screen capture plugin not available. Please update the app.');
    }

    try {
      console.log('🖥️ Requesting Android screen capture permission...');
      const result = await ScreenCapture.start();
      if (!result?.success) {
        throw new Error('Screen capture permission denied');
      }

      console.log('🖥️ Android screen capture service started, setting up frame receiver...');

      // Create canvas to draw received frames
      const canvas = document.createElement('canvas');
      // Initial size (will be updated when first frame arrives)
      canvas.width = 720;
      canvas.height = 1280;
      const ctx = canvas.getContext('2d');

      // Fill with dark background initially
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Create stream from canvas — fps=0 means manual frame updates
      // We'll call requestFrame() on the track after each draw
      this.screenStream = canvas.captureStream(0);

      // Reusable Image element for decoding base64 frames
      const frameImg = new Image();
      let frameReady = true;

      // Listen for screen frames from native
      this._screenFrameListener = await ScreenCapture.addListener('screenFrame', (data) => {
        if (!frameReady || !data?.frame) return;
        frameReady = false;

        frameImg.onload = () => {
          // Update canvas size if dimensions changed
          if (canvas.width !== data.width || canvas.height !== data.height) {
            canvas.width = data.width;
            canvas.height = data.height;
          }

          // Draw the actual screen frame
          ctx.drawImage(frameImg, 0, 0, canvas.width, canvas.height);

          // Request the captureStream to emit this frame
          const videoTrack = this.screenStream?.getVideoTracks()[0];
          if (videoTrack && typeof videoTrack.requestFrame === 'function') {
            videoTrack.requestFrame();
          }

          frameReady = true;
        };

        frameImg.onerror = () => {
          frameReady = true;
        };

        frameImg.src = 'data:image/jpeg;base64,' + data.frame;
      });

      // Listen for native capture stop (e.g. user stops from notification)
      this._screenStopListener = await ScreenCapture.addListener('screenStopped', () => {
        console.log('🖥️ Native screen capture stopped');
        // Trigger track ended so the UI can react
        const videoTrack = this.screenStream?.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
        }
      });

      // Wait briefly for first frame to arrive
      await new Promise(resolve => setTimeout(resolve, 800));

      console.log('🖥️ Android screen share active with real frame streaming');
      return this.screenStream;
    } catch (error) {
      // Clean up on failure
      this._cleanupAndroidScreenShare();
      try { await ScreenCapture.stop(); } catch (e) {}
      
      if (error.message?.includes('denied') || error.message?.includes('cancelled')) {
        throw new Error('Screen sharing was cancelled.');
      }
      throw error;
    }
  }

  /**
   * Clean up Android screen share listeners and intervals
   */
  _cleanupAndroidScreenShare() {
    if (this._screenFrameListener) {
      this._screenFrameListener.remove();
      this._screenFrameListener = null;
    }
    if (this._screenStopListener) {
      this._screenStopListener.remove();
      this._screenStopListener = null;
    }
    if (this._screenCaptureInterval) {
      clearInterval(this._screenCaptureInterval);
      this._screenCaptureInterval = null;
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

    // Clean up Android native screen capture
    if (isAndroid()) {
      this._cleanupAndroidScreenShare();
      const ScreenCapture = window.Capacitor?.Plugins?.ScreenCapture;
      if (ScreenCapture) {
        ScreenCapture.stop().catch(e => console.warn('Failed to stop native screen capture:', e));
      }
    }

    // Clear canvas capture interval if any (non-Android fallback)
    if (this._screenCaptureInterval) {
      clearInterval(this._screenCaptureInterval);
      this._screenCaptureInterval = null;
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

    // Initialize ICE candidate queue — preserve any candidates queued before PC existed
    if (!this.iceCandidateQueues.has(peerId)) {
      this.iceCandidateQueues.set(peerId, []);
    }

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

      // NOTE: ICE restart on 'failed' / 'disconnected' is handled
      // by setupWebRTCCallbacks in useCallStore.js (with proper timeouts).
      // Do NOT restart here to avoid double-restart SDP conflicts.
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

      // Get stream from event, or use/create a shared remote stream
      // (video transceiver with null track may not have stream association)
      let remoteStream = event.streams[0];
      if (!remoteStream) {
        remoteStream = this.remoteStreams.get(peerId) || new MediaStream();
        remoteStream.addTrack(event.track);
      }

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
    };

    /**
     * Negotiation needed
     * WHY: Fires when tracks are added/removed, requiring new offer/answer
     */
    pc.onnegotiationneeded = () => {
      // Skip during initial setup — only renegotiate after first offer/answer
      if (!pc.currentLocalDescription) {
        console.log(`⏭️ Skipping negotiation — initial setup for ${peerId}`);
        return;
      }
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

    // CRITICAL: Always ensure a video transceiver exists with sendrecv.
    // This guarantees SDP always has both m=audio and m=video from the start.
    // Using sendrecv (not recvonly) means screen share only needs replaceTrack
    // — NO direction change → NO onnegotiationneeded → NO m-line reorder.
    const hasVideoTransceiver = pc.getTransceivers().some(
      t => t.receiver?.track?.kind === 'video'
    );
    if (!hasVideoTransceiver) {
      pc.addTransceiver('video', { direction: 'sendrecv' });
      console.log(`📺 Added sendrecv video transceiver for ${peerId}`);
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
      // Don't use offerToReceiveAudio/Video (deprecated) —
      // they conflict with explicit addTransceiver and can cause
      // duplicate m-lines → SDP order mismatch errors.
      const offer = await pc.createOffer();

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
      // Handle glare: if we also sent an offer (both sides negotiating),
      // rollback our offer and accept theirs
      if (pc.signalingState === 'have-local-offer') {
        console.log(`⚠️ Glare detected for ${peerId}, rolling back local offer`);
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log(`📥 Remote description (offer) set for ${peerId}`);

      // Process queued ICE candidates
      await this.processIceCandidateQueue(peerId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`📤 Answer created for ${peerId}`);

      return answer;
    } catch (error) {
      // SSL role conflict — recreate connection and retry once
      if (error.message && error.message.includes('SSL role')) {
        console.warn(`⚠️ SSL role conflict for ${peerId}, recreating connection...`);
        this.closePeerConnection(peerId);
        pc = this.createPeerConnection(peerId);

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await this.processIceCandidateQueue(peerId);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`📤 Answer created for ${peerId} (after SSL retry)`);
        return answer;
      }

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
      // Accept answer in both initial and renegotiation scenarios
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`📥 Remote description (answer) set for ${peerId}`);

        // Process queued ICE candidates
        await this.processIceCandidateQueue(peerId);
      } else if (pc.signalingState === 'stable') {
        // Answer arrived after we already moved to stable (race condition)
        console.warn(`Answer arrived but already stable for ${peerId}, ignoring`);
      } else {
        console.warn(`Unexpected signaling state: ${pc.signalingState} for ${peerId}, queueing`);
        // Try anyway — some browsers are lenient
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await this.processIceCandidateQueue(peerId);
        } catch (innerErr) {
          console.error('Failed to set remote description in unexpected state:', innerErr);
        }
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
   * If no video track exists, acquires a new camera track.
   * @returns {boolean|Promise<boolean>} New enabled state
   */
  toggleVideo() {
    if (!this.localStream) return false;

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      console.log(`📹 Video ${videoTrack.enabled ? 'on' : 'off'}`);
      return videoTrack.enabled;
    }

    // No video track exists — need to acquire camera
    // Return a promise so the caller can await
    return this._acquireVideoTrack();
  }

  /**
   * Acquire a new camera video track and add it to the local stream
   * and all active peer connections.
   * Called when toggleVideo is pressed but no video track exists
   * (e.g., call started as audio-only or camera failed initially).
   */
  async _acquireVideoTrack() {
    try {
      console.log('📹 Acquiring new camera track...');
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: MEDIA_CONSTRAINTS.video,
      });
      const newVideoTrack = cameraStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        console.error('📹 No video track from getUserMedia');
        return false;
      }

      // Add the video track to the existing local stream
      this.localStream.addTrack(newVideoTrack);
      console.log('📹 Camera track added to local stream');

      // Add/replace video track in all peer connections
      for (const [peerId, pc] of this.peerConnections) {
        try {
          // First try to find an existing video transceiver to replace
          const videoTransceiver = pc.getTransceivers().find(
            t => t.sender?.track?.kind === 'video' ||
                 t.receiver?.track?.kind === 'video'
          );

          if (videoTransceiver && videoTransceiver.sender) {
            await videoTransceiver.sender.replaceTrack(newVideoTrack);
            console.log(`📹 Replaced video track for ${peerId}`);
          } else {
            // No existing video transceiver — add new track
            pc.addTrack(newVideoTrack, this.localStream);
            console.log(`📹 Added new video track for ${peerId}`);
          }
        } catch (err) {
          console.error(`📹 Failed to add video track to ${peerId}:`, err);
        }
      }

      return true;
    } catch (error) {
      console.error('📹 Failed to acquire camera:', error);
      if (error.name === 'NotAllowedError') {
        throw new Error('Camera permission denied. Please allow access.');
      }
      if (error.name === 'NotFoundError') {
        throw new Error('No camera found. Please connect a camera.');
      }
      if (error.name === 'NotReadableError') {
        throw new Error('Camera is in use by another application.');
      }
      return false;
    }
  }

  /**
   * Replace video track with screen share (or back to camera)
   * 
   * WHY replaceTrack:
   * - No renegotiation needed (no new offer/answer)
   * - Seamless switch
   * - Remote peer sees the new track automatically
   */
  async replaceVideoTrack(newTrack, isScreenShare = false) {
    for (const [peerId, pc] of this.peerConnections) {
      try {
        // Find video transceiver — check both sender and receiver track kind
        const videoTransceiver = pc.getTransceivers().find(
          t => t.sender?.track?.kind === 'video' ||
               t.receiver?.track?.kind === 'video'
        );

        if (videoTransceiver && videoTransceiver.sender) {
          await videoTransceiver.sender.replaceTrack(newTrack);
          console.log(`🔄 Replaced video track for ${peerId} (screen: ${isScreenShare})`);

          // Optimize encoding based on content type
          try {
            const params = videoTransceiver.sender.getParameters();
            if (params.encodings && params.encodings.length > 0) {
              if (isScreenShare) {
                // Screen share: prioritize sharpness over framerate
                if (newTrack && newTrack.contentHint !== undefined) {
                  newTrack.contentHint = 'detail';
                }
                params.encodings[0].maxBitrate = 2500000; // 2.5 Mbps for screen
              } else {
                // Camera: prioritize motion, remove bitrate cap
                if (newTrack && newTrack.contentHint !== undefined) {
                  newTrack.contentHint = 'motion';
                }
                delete params.encodings[0].maxBitrate;
              }
              await videoTransceiver.sender.setParameters(params);
            }
          } catch (encErr) {
            // setParameters not supported in all browsers, safe to ignore
            console.warn('Could not set encoding params:', encErr.message);
          }
        } else {
          // Last resort: find any sender that could carry video
          const videoSender = pc.getSenders().find(
            s => !s.track || s.track.kind === 'video'
          );
          if (videoSender) {
            await videoSender.replaceTrack(newTrack);
            console.log(`🔄 Replaced video track via sender fallback for ${peerId}`);
          } else {
            console.warn(`No video transceiver or sender found for ${peerId}`);
          }
        }
      } catch (err) {
        console.error(`Failed to replace video track for ${peerId}:`, err);
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

    // Clear event callbacks to prevent stale handlers firing
    // on accidentally-created PeerConnections after call ends
    this.onIceCandidate = null;
    this.onIceStateChange = null;
    this.onRemoteStream = null;
    this.onRemoteStreamRemoved = null;
    this.onNegotiationNeeded = null;

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
