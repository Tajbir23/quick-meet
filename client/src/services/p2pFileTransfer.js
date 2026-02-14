/**
 * ============================================
 * P2P File Transfer Service — WebRTC DataChannel
 * ============================================
 * 
 * Core engine for chunked P2P file transfer using WebRTC DataChannel.
 * 
 * ARCHITECTURE:
 * ┌──────────────────────────────────────────────────────────┐
 * │                  P2PFileTransfer                         │
 * │                                                         │
 * │  SENDER SIDE:                                           │
 * │  ├── File → slice(chunkSize) → DataChannel.send()       │
 * │  ├── Backpressure: wait if bufferedAmount > threshold    │
 * │  └── Resume: skip to chunk N on reconnect               │
 * │                                                         │
 * │  RECEIVER SIDE:                                         │
 * │  ├── DataChannel.onmessage → collect chunks             │
 * │  ├── Write to disk via StreamSaver / Blob download      │
 * │  └── Report progress to server every 100 chunks         │
 * │                                                         │
 * │  BOTH:                                                  │
 * │  ├── Separate RTCPeerConnection per transfer             │
 * │  ├── Does NOT interfere with call connections            │
 * │  └── Auto-cleanup on complete/cancel/error               │
 * └──────────────────────────────────────────────────────────┘
 * 
 * 50-100GB FILE HANDLING:
 * - File.slice() reads only one chunk at a time (no memory overload)
 * - Receiver writes chunks progressively (not accumulated in memory)
 * - Backpressure: sender pauses when DataChannel buffer is full
 * - On mobile: smaller chunk size (16KB) to avoid crashes
 * 
 * RESUME:
 * - Server tracks lastReceivedChunk
 * - On reconnect, sender starts from lastReceivedChunk + 1
 * - Receiver skips already-received chunks
 */

import { ICE_SERVERS } from '../utils/constants';
import { getSocket } from '../services/socket';

// Detect mobile for adaptive chunk sizing
const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);

// ── Platform capability detection ──────────────────────────────────────
const isElectron = !!window.electronAPI?.isElectron;

/**
 * Check if the browser supports File System Access API (showSaveFilePicker)
 * Available in Chrome 86+, Edge 86+, Opera 72+
 * NOT available in Firefox, Safari, or mobile browsers
 */
const hasFSAccessAPI = (() => {
  try {
    return typeof window.showSaveFilePicker === 'function';
  } catch {
    return false;
  }
})();

/**
 * Max file size for browsers that must use memory accumulation (no streaming)
 * Firefox, Safari, older browsers — hard limit 2GB
 */
const MAX_BROWSER_MEMORY_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

/**
 * Determine if the current platform can receive large files (>2GB)
 * - Electron: yes (Node.js fs streaming)
 * - Chrome/Edge with FSAA: yes (disk streaming via showSaveFilePicker)
 * - Others: NO — limited to 2GB in memory
 */
export function canReceiveLargeFiles() {
  return isElectron || hasFSAccessAPI;
}

/**
 * Get the maximum receivable file size on this platform
 */
export function getMaxReceiveSize() {
  if (isElectron) return Infinity; // No limit — streams to disk
  if (hasFSAccessAPI) return Infinity; // Chrome/Edge — streams to disk
  return MAX_BROWSER_MEMORY_FILE_SIZE; // 2GB for memory-only browsers
}

/**
 * Get a human-readable platform capability name
 */
export function getPlatformCapability() {
  if (isElectron) return 'desktop-stream';
  if (hasFSAccessAPI) return 'browser-fsaa';
  return 'browser-memory';
}

// Configuration
const CONFIG = {
  // Chunk size: smaller on mobile to prevent memory pressure
  CHUNK_SIZE: isMobile ? 16384 : 65536,  // 16KB mobile, 64KB desktop
  // DataChannel buffer threshold for backpressure
  BUFFER_THRESHOLD: isMobile ? 512 * 1024 : 2 * 1024 * 1024, // 512KB mobile, 2MB desktop
  // How often to report progress to server (every N chunks)
  PROGRESS_REPORT_INTERVAL: 100,
  // Max concurrent transfers
  MAX_CONCURRENT_TRANSFERS: 3,
  // Header size for chunk metadata
  HEADER_SIZE: 12, // 4 bytes transferIndex + 4 bytes chunkIndex + 4 bytes chunkLength
};

/**
 * Represents a single file transfer session
 */
class TransferSession {
  constructor({ transferId, peerId, fileName, fileSize, totalChunks, chunkSize, isReceiver, file, resumeFrom }) {
    this.transferId = transferId;
    this.peerId = peerId;
    this.fileName = fileName;
    this.fileSize = fileSize;
    this.totalChunks = totalChunks;
    this.chunkSize = chunkSize || CONFIG.CHUNK_SIZE;
    this.isReceiver = isReceiver;
    this.file = file; // File object (sender only)
    
    // State
    this.peerConnection = null;
    this.dataChannel = null;
    this.status = 'pending'; // pending, connecting, transferring, paused, completed, failed, cancelled
    this.currentChunk = resumeFrom || 0;
    this.bytesTransferred = (resumeFrom || 0) * (chunkSize || CONFIG.CHUNK_SIZE);
    this.startTime = null;
    this.speed = 0;
    this.lastSpeedCalcTime = 0;
    this.lastSpeedCalcBytes = 0;
    this.isPaused = false;
    
    // Receiver: collected chunks for progressive writing
    this.receivedChunks = [];
    this.writeStream = null;
    this.writer = null;
    
    // ICE candidate queue — stores candidates that arrive before remoteDescription is set
    this._pendingIceCandidates = [];
    this._remoteDescriptionSet = false;
    
    // Callbacks
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onStatusChange = null;
  }

  get progress() {
    if (this.totalChunks === 0) return 0;
    return Math.min((this.currentChunk / this.totalChunks) * 100, 100);
  }

  get eta() {
    if (this.speed === 0) return Infinity;
    const remaining = this.fileSize - this.bytesTransferred;
    return remaining / this.speed; // seconds
  }

  destroy() {
    if (this.dataChannel) {
      this.dataChannel.onmessage = null;
      this.dataChannel.onopen = null;
      this.dataChannel.onclose = null;
      this.dataChannel.onerror = null;
      try { this.dataChannel.close(); } catch (e) {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.ondatachannel = null;
      try { this.peerConnection.close(); } catch (e) {}
      this.peerConnection = null;
    }
    if (this.writer) {
      try { this.writer.close(); } catch (e) {}
      this.writer = null;
    }
    // Cleanup Electron file stream if active
    if (this._useElectronStream && this._electronStreamId) {
      window.electronAPI?.abortFileStream(this._electronStreamId).catch(() => {});
    }
    // Cleanup browser FSAA stream if active
    if (this._useFSAAStream && this._fsaaWriter) {
      try { this._fsaaWriter.close(); } catch (e) {}
      this._fsaaWriter = null;
    }
    this.file = null;
    this.receivedChunks = [];
  }
}

/**
 * Main P2P File Transfer Manager
 */
class P2PFileTransferService {
  constructor() {
    // Active transfer sessions: transferId → TransferSession
    this.sessions = new Map();
    
    // Global callbacks
    this.onTransferUpdate = null;     // (transferId, session) => {}
    this.onIncomingTransfer = null;   // (transferData) => {}
    this.onTransferComplete = null;   // (transferId) => {}
    this.onTransferError = null;      // (transferId, error) => {}
    
    // Socket listeners bound flag
    this._socketListenersBound = false;
  }

  /**
   * Initialize socket listeners for file transfer signaling
   */
  bindSocketListeners() {
    if (this._socketListenersBound) return;
    
    const socket = getSocket();
    if (!socket) return;

    // Incoming transfer request
    socket.on('file-transfer:incoming', (data) => {
      if (this.onIncomingTransfer) {
        this.onIncomingTransfer(data);
      }
    });

    // Transfer accepted by receiver
    socket.on('file-transfer:accepted', async (data) => {
      console.log(`[P2P DEBUG] 📨 file-transfer:accepted received | transferId=${data.transferId} | receiverId=${data.receiverId} | lastReceivedChunk=${data.lastReceivedChunk}`);
      const session = this.sessions.get(data.transferId);
      if (session && !session.isReceiver) {
        // We are the sender, receiver accepted → setup DataChannel
        session.currentChunk = data.lastReceivedChunk >= 0 ? data.lastReceivedChunk + 1 : 0;
        session.bytesTransferred = session.currentChunk * session.chunkSize;
        await this._setupSenderConnection(session);
      } else {
        console.warn(`[P2P DEBUG] ⚠️ file-transfer:accepted — session not found or wrong role | transferId=${data.transferId} | found=${!!session} | isReceiver=${session?.isReceiver}`);
      }
    });

    // Transfer rejected
    socket.on('file-transfer:rejected', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.status = 'cancelled';
        session.destroy();
        this.sessions.delete(data.transferId);
        this._notifyUpdate(data.transferId, session);
      }
    });

    // Transfer cancelled
    socket.on('file-transfer:cancelled', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.status = 'cancelled';
        session.destroy();
        this.sessions.delete(data.transferId);
        this._notifyUpdate(data.transferId, session);
      }
    });

    // Transfer paused by peer
    socket.on('file-transfer:paused', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.isPaused = true;
        session.status = 'paused';
        this._notifyUpdate(data.transferId, session);
      }
    });

    // Transfer completed confirmation
    socket.on('file-transfer:completed', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.status = 'completed';
        this._notifyUpdate(data.transferId, session);
        session.destroy();
      }
    });

    // Peer offline
    socket.on('file-transfer:peer-offline', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.status = 'paused';
        session.isPaused = true;
        this._notifyUpdate(data.transferId, session);
      }
    });

    // Pending transfers list (on reconnect)
    socket.on('file-transfer:pending-list', (data) => {
      if (data.transfers && data.transfers.length > 0) {
        data.transfers.forEach(t => {
          if (!this.sessions.has(t.transferId)) {
            if (this.onIncomingTransfer) {
              this.onIncomingTransfer({
                ...t,
                isResume: true,
                senderId: t.sender._id || t.sender,
                senderName: t.sender.username || 'Unknown',
              });
            }
          }
        });
      }
    });

    // Resume request from peer
    socket.on('file-transfer:resume-request', (data) => {
      if (this.onIncomingTransfer) {
        this.onIncomingTransfer({
          ...data,
          isResume: true,
          senderId: data.requestedBy,
          senderName: data.requestedByName,
        });
      }
    });

    // Resume info
    socket.on('file-transfer:resume-info', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.currentChunk = data.resumeFrom || 0;
        session.bytesTransferred = session.currentChunk * session.chunkSize;
        if (data.peerOnline === false) {
          session.status = 'paused';
          session.isPaused = true;
        }
        this._notifyUpdate(data.transferId, session);
      }
    });

    // WebRTC signaling for file transfer
    socket.on('file-transfer:offer', async (data) => {
      console.log(`[P2P DEBUG] 📨 file-transfer:offer received | transferId=${data.transferId} | senderId=${data.senderId}`);
      const session = this.sessions.get(data.transferId);
      if (session && session.isReceiver) {
        await this._handleReceiverOffer(session, data.offer, data.senderId);
      } else {
        console.warn(`[P2P DEBUG] ⚠️ file-transfer:offer — no matching receiver session | transferId=${data.transferId} | found=${!!session} | isReceiver=${session?.isReceiver}`);
      }
    });

    socket.on('file-transfer:answer', async (data) => {
      console.log(`[P2P DEBUG] 📨 file-transfer:answer received | transferId=${data.transferId}`);
      const session = this.sessions.get(data.transferId);
      if (session && !session.isReceiver) {
        await this._handleSenderAnswer(session, data.answer);
      } else {
        console.warn(`[P2P DEBUG] ⚠️ file-transfer:answer — no matching sender session | transferId=${data.transferId} | found=${!!session} | isReceiver=${session?.isReceiver}`);
      }
    });

    socket.on('file-transfer:ice-candidate', async (data) => {
      console.log(`[P2P DEBUG] 📨 file-transfer:ice-candidate received | transferId=${data.transferId} | from=${data.senderId}`);
      const session = this.sessions.get(data.transferId);
      if (!session) {
        console.warn(`[P2P DEBUG] ⚠️ ICE candidate — no session found for ${data.transferId}`);
        return;
      }

      // If PeerConnection exists and remoteDescription is set → add immediately
      if (session.peerConnection && session._remoteDescriptionSet) {
        try {
          await session.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.warn('[P2P] Failed to add ICE candidate:', e);
        }
      } else {
        // Queue the candidate — will be flushed after setRemoteDescription
        session._pendingIceCandidates.push(data.candidate);
        console.log(`[P2P] Queued ICE candidate for ${data.transferId} (${session._pendingIceCandidates.length} queued)`);
      }
    });

    // Progress ack from server
    socket.on('file-transfer:progress-ack', (data) => {
      // Optional: use for sender-side progress display
    });

    this._socketListenersBound = true;
  }

  /**
   * Unbind socket listeners
   */
  unbindSocketListeners() {
    const socket = getSocket();
    if (!socket) return;
    
    const events = [
      'file-transfer:incoming', 'file-transfer:accepted', 'file-transfer:rejected',
      'file-transfer:cancelled', 'file-transfer:paused', 'file-transfer:completed',
      'file-transfer:peer-offline', 'file-transfer:pending-list', 'file-transfer:resume-request',
      'file-transfer:resume-info', 'file-transfer:offer', 'file-transfer:answer',
      'file-transfer:ice-candidate', 'file-transfer:progress-ack',
    ];
    events.forEach(e => socket.off(e));
    this._socketListenersBound = false;
  }

  // ============================================
  // SENDER METHODS
  // ============================================

  /**
   * Initiate a file transfer to a peer
   * @param {File} file - The File object to send
   * @param {string} receiverId - Target user ID
   * @returns {string} transferId
   */
  async sendFile(file, receiverId) {
    const transferId = this._generateTransferId();
    const chunkSize = CONFIG.CHUNK_SIZE;
    const totalChunks = Math.ceil(file.size / chunkSize);

    const session = new TransferSession({
      transferId,
      peerId: receiverId,
      fileName: file.name,
      fileSize: file.size,
      totalChunks,
      chunkSize,
      isReceiver: false,
      file,
      resumeFrom: 0,
    });

    this.sessions.set(transferId, session);

    // Request transfer via socket (server creates record)
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:request', {
        transferId,
        receiverId,
        fileName: file.name,
        fileSize: file.size,
        fileMimeType: file.type || 'application/octet-stream',
        totalChunks,
        chunkSize,
      });
    }

    this._notifyUpdate(transferId, session);
    return transferId;
  }

  /**
   * Accept an incoming file transfer (receiver side)
   */
  async acceptTransfer(transferData) {
    const {
      transferId,
      senderId,
      fileName,
      fileSize,
      totalChunks,
      chunkSize,
      isResume,
    } = transferData;

    const session = new TransferSession({
      transferId,
      peerId: senderId,
      fileName,
      fileSize,
      totalChunks,
      chunkSize: chunkSize || CONFIG.CHUNK_SIZE,
      isReceiver: true,
      resumeFrom: isResume ? transferData.resumeFrom || 0 : 0,
    });

    this.sessions.set(transferId, session);
    session.status = 'connecting';
    this._notifyUpdate(transferId, session);

    // Notify server
    const socket = getSocket();
    if (socket) {
      if (isResume) {
        socket.emit('file-transfer:resume', { transferId });
      } else {
        socket.emit('file-transfer:accept', { transferId });
      }
    }

    return transferId;
  }

  /**
   * Reject an incoming transfer
   */
  rejectTransfer(transferId) {
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:reject', { transferId, reason: 'Rejected by user' });
    }
  }

  /**
   * Cancel an active transfer
   */
  cancelTransfer(transferId) {
    const session = this.sessions.get(transferId);
    if (session) {
      session.status = 'cancelled';
      session.destroy();
      this.sessions.delete(transferId);
      this._notifyUpdate(transferId, session);
    }
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:cancel', { transferId });
    }
  }

  /**
   * Pause a transfer
   */
  pauseTransfer(transferId) {
    const session = this.sessions.get(transferId);
    if (session) {
      session.isPaused = true;
      session.status = 'paused';
      this._notifyUpdate(transferId, session);
    }
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:pause', { transferId });
    }
  }

  /**
   * Resume a paused transfer
   */
  resumeTransfer(transferId) {
    const session = this.sessions.get(transferId);
    if (session) {
      session.isPaused = false;
    }
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:resume', { transferId });
    }
  }

  /**
   * Check for pending transfers on reconnect
   */
  checkPendingTransfers() {
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:check-pending');
    }
  }

  // ============================================
  // WebRTC DataChannel Setup
  // ============================================

  /**
   * Sender creates PeerConnection + DataChannel and sends offer
   */
  async _setupSenderConnection(session) {
    console.log(`[P2P DEBUG] _setupSenderConnection called | transferId=${session.transferId} | peerId=${session.peerId}`);
    session.status = 'connecting';
    this._notifyUpdate(session.transferId, session);

    // Start connection timeout (30s)
    this._startConnectionTimeout(session);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    session.peerConnection = pc;
    console.log(`[P2P DEBUG] RTCPeerConnection created | iceServers:`, JSON.stringify(ICE_SERVERS.iceServers?.map(s => s.urls)));

    // Create DataChannel with ordered delivery
    const dc = pc.createDataChannel(`file-${session.transferId}`, {
      ordered: true,
      // No maxRetransmits — we need reliable delivery for files
    });
    session.dataChannel = dc;
    dc.binaryType = 'arraybuffer';
    console.log(`[P2P DEBUG] DataChannel created: file-${session.transferId}`);

    // DataChannel open → start sending
    dc.onopen = () => {
      console.log(`[P2P DEBUG] ✅ DataChannel OPEN for ${session.transferId}, starting send from chunk ${session.currentChunk}`);
      this._clearConnectionTimeout(session);
      session.status = 'transferring';
      session.startTime = Date.now();
      this._notifyUpdate(session.transferId, session);
      this._sendChunks(session);
    };

    dc.onclose = () => {
      console.log(`[P2P DEBUG] DataChannel CLOSED for ${session.transferId}, status was: ${session.status}`);
      if (session.status === 'transferring') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
      }
    };

    dc.onerror = (err) => {
      console.error(`[P2P DEBUG] ❌ DataChannel ERROR for ${session.transferId}:`, err);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[P2P DEBUG] Sender ICE candidate: ${event.candidate.candidate.substring(0, 60)}...`);
        const socket = getSocket();
        if (socket) {
          socket.emit('file-transfer:ice-candidate', {
            transferId: session.transferId,
            targetUserId: session.peerId,
            candidate: event.candidate,
          });
        }
      } else {
        console.log(`[P2P DEBUG] Sender ICE gathering complete for ${session.transferId}`);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[P2P DEBUG] Sender ICE connection state: ${pc.iceConnectionState} for ${session.transferId}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this._clearConnectionTimeout(session);
      }
      if (pc.iceConnectionState === 'failed') {
        this._clearConnectionTimeout(session);
        session.status = 'failed';
        session._failReason = 'ice_failed';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
      if (pc.iceConnectionState === 'disconnected') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[P2P DEBUG] Sender ICE gathering state: ${pc.iceGatheringState} for ${session.transferId}`);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[P2P DEBUG] Sender signaling state: ${pc.signalingState} for ${session.transferId}`);
    };

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      console.log(`[P2P DEBUG] Offer created | transferId=${session.transferId} | type=${offer.type}`);
      await pc.setLocalDescription(offer);
      console.log(`[P2P DEBUG] Local description set (offer) | transferId=${session.transferId}`);

      const socket = getSocket();
      if (socket) {
        console.log(`[P2P DEBUG] Emitting file-transfer:offer | transferId=${session.transferId} | targetUserId=${session.peerId}`);
        socket.emit('file-transfer:offer', {
          transferId: session.transferId,
          targetUserId: session.peerId,
          offer: pc.localDescription,
        });
      } else {
        console.error(`[P2P DEBUG] ❌ NO SOCKET when emitting offer for ${session.transferId}`);
      }
    } catch (err) {
      console.error(`[P2P DEBUG] ❌ Failed to create offer for ${session.transferId}:`, err);
      this._clearConnectionTimeout(session);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    }
  }

  /**
   * Receiver handles incoming offer, creates answer
   */
  async _handleReceiverOffer(session, offer, senderId) {
    console.log(`[P2P DEBUG] _handleReceiverOffer called | transferId=${session.transferId} | senderId=${senderId}`);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    session.peerConnection = pc;

    // Start connection timeout (30s) for receiver too
    this._startConnectionTimeout(session);

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[P2P DEBUG] Receiver ICE candidate: ${event.candidate.candidate.substring(0, 60)}...`);
        const socket = getSocket();
        if (socket) {
          socket.emit('file-transfer:ice-candidate', {
            transferId: session.transferId,
            targetUserId: senderId,
            candidate: event.candidate,
          });
        }
      } else {
        console.log(`[P2P DEBUG] Receiver ICE gathering complete for ${session.transferId}`);
      }
    };

    // Expect DataChannel from sender
    pc.ondatachannel = (event) => {
      console.log(`[P2P DEBUG] ✅ Receiver got DataChannel for ${session.transferId}`);
      const dc = event.channel;
      session.dataChannel = dc;
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => {
        console.log(`[P2P DEBUG] ✅ Receiver DataChannel OPEN for ${session.transferId}`);
        this._clearConnectionTimeout(session);
        session.status = 'transferring';
        session.startTime = Date.now();
        this._notifyUpdate(session.transferId, session);
        // Initialize progressive writer
        this._initReceiveWriter(session);
      };

      dc.onmessage = (event) => {
        this._handleReceivedChunk(session, event.data);
      };

      dc.onclose = () => {
        console.log(`[P2P DEBUG] Receiver DataChannel CLOSED for ${session.transferId}, status was: ${session.status}`);
        if (session.status === 'transferring') {
          session.status = 'paused';
          this._notifyUpdate(session.transferId, session);
          this._reportProgressToServer(session);
        }
      };

      dc.onerror = (err) => {
        console.error(`[P2P DEBUG] ❌ Receiver DataChannel ERROR for ${session.transferId}:`, err);
      };
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[P2P DEBUG] Receiver ICE connection state: ${pc.iceConnectionState} for ${session.transferId}`);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this._clearConnectionTimeout(session);
      }
      if (pc.iceConnectionState === 'failed') {
        this._clearConnectionTimeout(session);
        session.status = 'failed';
        session._failReason = 'ice_failed';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
      if (pc.iceConnectionState === 'disconnected') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[P2P DEBUG] Receiver ICE gathering state: ${pc.iceGatheringState} for ${session.transferId}`);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[P2P DEBUG] Receiver signaling state: ${pc.signalingState} for ${session.transferId}`);
    };

    // Set remote offer and create answer
    try {
      console.log(`[P2P DEBUG] Setting remote description (offer) | transferId=${session.transferId}`);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log(`[P2P DEBUG] Remote description set (offer) | transferId=${session.transferId}`);
      session._remoteDescriptionSet = true;

      // Flush any ICE candidates that arrived before remoteDescription was set
      await this._flushPendingIceCandidates(session);

      const answer = await pc.createAnswer();
      console.log(`[P2P DEBUG] Answer created | transferId=${session.transferId} | type=${answer.type}`);
      await pc.setLocalDescription(answer);
      console.log(`[P2P DEBUG] Local description set (answer) | transferId=${session.transferId}`);

      const socket = getSocket();
      if (socket) {
        console.log(`[P2P DEBUG] Emitting file-transfer:answer | transferId=${session.transferId} | targetUserId=${senderId}`);
        socket.emit('file-transfer:answer', {
          transferId: session.transferId,
          targetUserId: senderId,
          answer: pc.localDescription,
        });
      } else {
        console.error(`[P2P DEBUG] ❌ NO SOCKET when emitting answer for ${session.transferId}`);
      }
    } catch (err) {
      console.error(`[P2P DEBUG] ❌ Failed to handle offer for ${session.transferId}:`, err);
      this._clearConnectionTimeout(session);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    }
  }

  /**
   * Sender processes answer
   */
  async _handleSenderAnswer(session, answer) {
    try {
      console.log(`[P2P DEBUG] _handleSenderAnswer called | transferId=${session.transferId} | signalingState=${session.peerConnection?.signalingState}`);
      if (session.peerConnection && session.peerConnection.signalingState === 'have-local-offer') {
        await session.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log(`[P2P DEBUG] Remote description set (answer) | transferId=${session.transferId}`);
        session._remoteDescriptionSet = true;

        // Flush any ICE candidates that arrived before remoteDescription was set
        await this._flushPendingIceCandidates(session);
      } else {
        console.warn(`[P2P DEBUG] ⚠️ Cannot set answer — signalingState=${session.peerConnection?.signalingState} | transferId=${session.transferId}`);
      }
    } catch (err) {
      console.error(`[P2P DEBUG] ❌ Failed to set answer for ${session.transferId}:`, err);
    }
  }

  /**
   * Flush queued ICE candidates after remoteDescription is set
   * This fixes the race condition where candidates arrive before the remote description
   */
  async _flushPendingIceCandidates(session) {
    if (!session._pendingIceCandidates || session._pendingIceCandidates.length === 0) return;

    const candidates = [...session._pendingIceCandidates];
    session._pendingIceCandidates = [];

    console.log(`[P2P] Flushing ${candidates.length} queued ICE candidates for ${session.transferId}`);

    for (const candidate of candidates) {
      try {
        await session.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[P2P] Failed to add queued ICE candidate:', e);
      }
    }
  }

  // ============================================
  // CHUNK SENDING (Sender Side)
  // ============================================

  /**
   * Send file chunks through DataChannel with backpressure management
   */
  async _sendChunks(session) {
    const { file, dataChannel, chunkSize, totalChunks } = session;
    if (!file || !dataChannel) return;

    while (session.currentChunk < totalChunks && !session.isPaused && session.status === 'transferring') {
      // Backpressure: wait if buffer is too full
      if (dataChannel.bufferedAmount > CONFIG.BUFFER_THRESHOLD) {
        await this._waitForBufferDrain(dataChannel);
        continue;
      }

      const start = session.currentChunk * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const slice = file.slice(start, end);

      try {
        const arrayBuffer = await slice.arrayBuffer();
        
        // Create header: [chunkIndex (4 bytes)] + [data]
        const header = new ArrayBuffer(4);
        new DataView(header).setUint32(0, session.currentChunk, true); // little-endian
        
        // Combine header + chunk data
        const packet = new Uint8Array(4 + arrayBuffer.byteLength);
        packet.set(new Uint8Array(header), 0);
        packet.set(new Uint8Array(arrayBuffer), 4);
        
        dataChannel.send(packet.buffer);
        
        session.currentChunk++;
        session.bytesTransferred = Math.min(session.currentChunk * chunkSize, file.size);
        
        // Calculate speed every 500ms
        this._calculateSpeed(session);

        // Report progress to server periodically
        if (session.currentChunk % CONFIG.PROGRESS_REPORT_INTERVAL === 0) {
          this._reportProgressToServer(session);
        }

        // Notify UI
        this._notifyUpdate(session.transferId, session);
      } catch (err) {
        console.error(`Error sending chunk ${session.currentChunk}:`, err);
        session.status = 'failed';
        this._notifyUpdate(session.transferId, session);
        return;
      }
    }

    // Check if complete
    if (session.currentChunk >= totalChunks && session.status === 'transferring') {
      // Send completion marker
      const completeMarker = new ArrayBuffer(4);
      new DataView(completeMarker).setUint32(0, 0xFFFFFFFF, true); // special marker
      try { dataChannel.send(completeMarker); } catch (e) {}
      
      session.status = 'completed';
      this._reportProgressToServer(session);
      this._notifyUpdate(session.transferId, session);
      if (this.onTransferComplete) {
        this.onTransferComplete(session.transferId);
      }
    }
  }

  /**
   * Wait for DataChannel buffer to drain (backpressure)
   */
  _waitForBufferDrain(dataChannel) {
    return new Promise((resolve) => {
      const check = () => {
        if (dataChannel.bufferedAmount <= CONFIG.BUFFER_THRESHOLD / 2) {
          resolve();
        } else {
          // Use bufferedamountlow event if available, otherwise poll
          if (dataChannel.onbufferedamountlow !== undefined) {
            dataChannel.bufferedAmountLowThreshold = CONFIG.BUFFER_THRESHOLD / 2;
            dataChannel.onbufferedamountlow = () => {
              dataChannel.onbufferedamountlow = null;
              resolve();
            };
          } else {
            setTimeout(check, 50);
          }
        }
      };
      check();
    });
  }

  // ============================================
  // CHUNK RECEIVING (Receiver Side)
  // ============================================

  /**
   * Initialize progressive file writer
   * 
   * THREE PATHS (in priority order):
   * 1. Electron: Node.js fs.createWriteStream → zero memory (50-100GB ok)
   * 2. Browser FSAA: showSaveFilePicker → WritableStream → zero memory (Chrome/Edge)
   * 3. Browser Memory: accumulate chunks in RAM → HARD LIMIT 2GB (Firefox/Safari)
   */
  async _initReceiveWriter(session) {
    session._receivedCount = 0;
    session._totalBytesReceived = 0;
    session._useElectronStream = false;
    session._useFSAAStream = false;

    // ── PATH 1: Electron native file streaming ──────────────────────────
    if (isElectron) {
      try {
        const result = await window.electronAPI.showSaveDialog({
          fileName: session.fileName,
          fileSize: session.fileSize,
        });

        if (!result.canceled && result.filePath) {
          const streamId = session.transferId;
          const streamResult = await window.electronAPI.createFileStream(streamId, result.filePath);
          if (streamResult.success) {
            session._useElectronStream = true;
            session._electronStreamId = streamId;
            session._electronFilePath = result.filePath;
            session.receivedChunks = []; // Not used in streaming mode
            console.log(`[P2P] Electron stream created: ${result.filePath}`);
            return;
          }
        }
        // User cancelled save dialog — cancel transfer
        if (result.canceled) {
          session.status = 'cancelled';
          this._notifyUpdate(session.transferId, session);
          return;
        }
      } catch (e) {
        console.warn('[P2P] Electron stream init failed, falling back:', e);
      }
    }

    // ── PATH 2: Browser File System Access API (Chrome/Edge) ────────────
    if (hasFSAccessAPI) {
      try {
        // Build file type filter from extension
        const ext = session.fileName.split('.').pop()?.toLowerCase() || '';
        const mimeType = session.fileMimeType || 'application/octet-stream';

        const fileHandle = await window.showSaveFilePicker({
          suggestedName: session.fileName,
          types: [{
            description: 'File',
            accept: { [mimeType]: ext ? [`.${ext}`] : [] },
          }],
        });

        const writable = await fileHandle.createWritable();
        session._useFSAAStream = true;
        session._fsaaWriter = writable;
        session.receivedChunks = []; // Not used in streaming mode
        console.log(`[P2P] Browser FSAA stream created for: ${session.fileName}`);
        return;
      } catch (e) {
        // User cancelled picker (DOMException: AbortError) → cancel transfer
        if (e?.name === 'AbortError') {
          session.status = 'cancelled';
          this._notifyUpdate(session.transferId, session);
          return;
        }
        console.warn('[P2P] FSAA stream init failed, falling back to memory:', e);
      }
    }

    // ── PATH 3: Browser Memory fallback (Firefox/Safari) ────────────────
    // SAFETY: Reject files > 2GB for memory-only browsers
    if (session.fileSize > MAX_BROWSER_MEMORY_FILE_SIZE) {
      console.error(`[P2P] File ${session.fileName} (${(session.fileSize / 1073741824).toFixed(1)}GB) exceeds 2GB browser memory limit`);
      session.status = 'failed';
      session._failReason = 'browser_size_limit';
      this._notifyUpdate(session.transferId, session);
      if (this.onTransferError) {
        this.onTransferError(session.transferId, new Error(
          `File too large for this browser (${(session.fileSize / 1073741824).toFixed(1)}GB). Max 2GB without Chrome/Edge. Use the desktop app for larger files.`
        ));
      }
      return;
    }

    session.receivedChunks = new Array(session.totalChunks);
    console.log(`[P2P] Browser memory mode for: ${session.fileName} (${(session.fileSize / 1048576).toFixed(0)}MB)`);
  }

  /**
   * Handle a received chunk
   */
  async _handleReceivedChunk(session, data) {
    if (!(data instanceof ArrayBuffer)) return;

    // Check for completion marker
    if (data.byteLength === 4) {
      const marker = new DataView(data).getUint32(0, true);
      if (marker === 0xFFFFFFFF) {
        this._finalizeReceive(session);
        return;
      }
    }

    // Parse header
    if (data.byteLength < 4) return;
    const chunkIndex = new DataView(data, 0, 4).getUint32(0, true);
    const chunkData = data.slice(4);

    session._receivedCount = (session._receivedCount || 0) + 1;
    session._totalBytesReceived = (session._totalBytesReceived || 0) + chunkData.byteLength;
    session.currentChunk = chunkIndex + 1;
    session.bytesTransferred = session._totalBytesReceived;

    // ── Electron: write chunk directly to disk (zero memory) ──────────
    if (session._useElectronStream) {
      window.electronAPI.writeFileChunk(session._electronStreamId, chunkData)
        .catch(err => console.error('[P2P] Electron write error:', err));
    }
    // ── Browser FSAA: write chunk directly to disk via WritableStream ──
    else if (session._useFSAAStream && session._fsaaWriter) {
      try {
        // WritableStream.write() handles backpressure automatically
        await session._fsaaWriter.write(new Uint8Array(chunkData));
      } catch (err) {
        console.error('[P2P] FSAA write error:', err);
        session.status = 'failed';
        this._notifyUpdate(session.transferId, session);
        return;
      }
    }
    // ── Browser Memory: accumulate in array (<=2GB only) ─────────────
    else {
      if (chunkIndex < session.totalChunks && !session.receivedChunks[chunkIndex]) {
        session.receivedChunks[chunkIndex] = chunkData;
      }

      // For files approaching limit, periodically flush to Blob
      if (session._receivedCount % 5000 === 0) {
        this._partialFlush(session);
      }
    }

    // Calculate speed
    this._calculateSpeed(session);

    // Report progress periodically
    if (session._receivedCount % CONFIG.PROGRESS_REPORT_INTERVAL === 0) {
      this._reportProgressToServer(session);
    }

    this._notifyUpdate(session.transferId, session);
  }

  /**
   * Partial flush for huge files — converts processed chunks to a Blob
   * to allow garbage collection of ArrayBuffer references
   */
  _partialFlush(session) {
    // For files > 1GB, we consolidate older chunks into Blobs
    // This reduces individual ArrayBuffer references in memory
    if (session._totalBytesReceived > 1024 * 1024 * 1024) {
      const flushUpTo = session._receivedCount - 1000; // Keep last 1000 chunks as ArrayBuffers
      if (flushUpTo > (session._lastFlushedIndex || 0)) {
        const chunksToFlush = [];
        for (let i = session._lastFlushedIndex || 0; i < flushUpTo; i++) {
          if (session.receivedChunks[i]) {
            chunksToFlush.push(session.receivedChunks[i]);
            session.receivedChunks[i] = null; // Allow GC
          }
        }
        if (chunksToFlush.length > 0) {
          // Store as Blob (OS manages this, not JS heap)
          session._flushedBlobs = session._flushedBlobs || [];
          session._flushedBlobs.push(new Blob(chunksToFlush));
          session._lastFlushedIndex = flushUpTo;
        }
      }
    }
  }

  /**
   * Finalize received file — Electron: close stream, Browser: combine chunks and download
   */
  async _finalizeReceive(session) {
    try {
      session.status = 'completed';

      // ── Electron: close the write stream — file is already on disk!
      if (session._useElectronStream) {
        const result = await window.electronAPI.closeFileStream(session._electronStreamId);
        console.log(`[P2P] File saved: ${result.filePath} (${result.bytesWritten} bytes)`);
        
        // Show native notification
        window.electronAPI.showNotification({
          title: 'File received!',
          body: `${session.fileName} saved successfully.`,
        });
      }
      // ── Browser FSAA: close writable stream — file is already on disk!
      else if (session._useFSAAStream && session._fsaaWriter) {
        try {
          await session._fsaaWriter.close();
          console.log(`[P2P] FSAA file saved: ${session.fileName}`);
        } catch (err) {
          console.error('[P2P] FSAA close error:', err);
        }
        session._fsaaWriter = null;
      }
      // ── Browser Memory: build blob and trigger download
      else {
        const parts = [];
        if (session._flushedBlobs && session._flushedBlobs.length > 0) {
          parts.push(...session._flushedBlobs);
        }
        const startIdx = session._lastFlushedIndex || 0;
        for (let i = startIdx; i < session.totalChunks; i++) {
          if (session.receivedChunks[i]) {
            parts.push(session.receivedChunks[i]);
          }
        }
        const fileBlob = new Blob(parts, {
          type: session.fileMimeType || 'application/octet-stream'
        });
        this._downloadBlob(fileBlob, session.fileName);
      }

      // Report complete to server
      const socket = getSocket();
      if (socket) {
        socket.emit('file-transfer:complete', {
          transferId: session.transferId,
          verified: true,
        });
      }

      // Cleanup
      session.receivedChunks = [];
      session._flushedBlobs = [];
      this._notifyUpdate(session.transferId, session);

      if (this.onTransferComplete) {
        this.onTransferComplete(session.transferId);
      }
    } catch (err) {
      console.error('Failed to finalize received file:', err);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    }
  }

  /**
   * Download a blob as a file
   */
  _downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    // Clean up after download starts
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 10000);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  _calculateSpeed(session) {
    const now = Date.now();
    if (now - (session.lastSpeedCalcTime || 0) >= 500) {
      const timeDelta = (now - (session.lastSpeedCalcTime || session.startTime || now)) / 1000;
      const bytesDelta = session.bytesTransferred - (session.lastSpeedCalcBytes || 0);
      if (timeDelta > 0) {
        session.speed = bytesDelta / timeDelta;
      }
      session.lastSpeedCalcTime = now;
      session.lastSpeedCalcBytes = session.bytesTransferred;
    }
  }

  _reportProgressToServer(session) {
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:progress', {
        transferId: session.transferId,
        lastReceivedChunk: session.currentChunk - 1,
        bytesTransferred: session.bytesTransferred,
        speedBps: session.speed,
      });
    }
  }

  _notifyUpdate(transferId, session) {
    if (this.onTransferUpdate) {
      this.onTransferUpdate(transferId, {
        transferId: session.transferId,
        fileName: session.fileName,
        fileSize: session.fileSize,
        totalChunks: session.totalChunks,
        currentChunk: session.currentChunk,
        bytesTransferred: session.bytesTransferred,
        progress: session.progress,
        speed: session.speed,
        eta: session.eta,
        status: session.status,
        isReceiver: session.isReceiver,
        peerId: session.peerId,
        isPaused: session.isPaused,
      });
    }
  }

  /**
   * Start a connection timeout — if still "connecting" after timeoutMs, mark as failed
   */
  _startConnectionTimeout(session, timeoutMs = 30000) {
    this._clearConnectionTimeout(session);
    session._connectionTimer = setTimeout(() => {
      if (session.status === 'connecting') {
        const iceState = session.peerConnection?.iceConnectionState || 'unknown';
        const sigState = session.peerConnection?.signalingState || 'unknown';
        console.error(`[P2P DEBUG] ⏰ Connection TIMEOUT for ${session.transferId} after ${timeoutMs / 1000}s | ICE=${iceState} | signaling=${sigState}`);
        session.status = 'failed';
        session._failReason = 'connection_timeout';
        this._notifyUpdate(session.transferId, session);
        if (this.onTransferError) {
          this.onTransferError(session.transferId, new Error(
            `Connection timeout (${timeoutMs / 1000}s). ICE state: ${iceState}. ` +
            'Both devices may need to be on the same network, or a TURN server is required.'
          ));
        }
      }
    }, timeoutMs);
  }

  /**
   * Clear the connection timeout
   */
  _clearConnectionTimeout(session) {
    if (session._connectionTimer) {
      clearTimeout(session._connectionTimer);
      session._connectionTimer = null;
    }
  }

  _generateTransferId() {
    return `ft-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get all active sessions as array
   */
  getActiveSessions() {
    const result = [];
    for (const [id, session] of this.sessions) {
      result.push({
        transferId: id,
        fileName: session.fileName,
        fileSize: session.fileSize,
        progress: session.progress,
        speed: session.speed,
        eta: session.eta,
        status: session.status,
        isReceiver: session.isReceiver,
        peerId: session.peerId,
        bytesTransferred: session.bytesTransferred,
        currentChunk: session.currentChunk,
        totalChunks: session.totalChunks,
        isPaused: session.isPaused,
      });
    }
    return result;
  }

  /**
   * Cleanup all sessions
   */
  destroyAll() {
    for (const [, session] of this.sessions) {
      session.destroy();
    }
    this.sessions.clear();
    this.unbindSocketListeners();
  }
}

// Export singleton
const p2pFileTransfer = new P2PFileTransferService();
export default p2pFileTransfer;
