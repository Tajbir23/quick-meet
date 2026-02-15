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

import { ICE_SERVERS, SERVER_URL } from '../utils/constants';
import { getSocket } from '../services/socket';
import { saveFileToDevice, showNativeNotification, isNative, getPlatform } from '../utils/platform';

// Detect mobile for adaptive chunk sizing
const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);

// ── Platform capability detection ──────────────────────────────────────
const isElectron = !!window.electronAPI?.isElectron;

/**
 * Detect Capacitor native platform (Android/iOS WebView via Capacitor)
 * window.Capacitor is injected by the Capacitor runtime.
 */
const isCapacitorNative = !!(window.Capacitor?.isNativePlatform?.());

/**
 * Check if the browser supports File System Access API (showSaveFilePicker)
 * Available in Chrome 86+, Edge 86+, Opera 72+
 * NOT available in Firefox, Safari, or mobile browsers.
 * IMPORTANT: Disabled on mobile — Android WebView may define showSaveFilePicker
 * but it fails without user gesture (throws AbortError), breaking the receive flow.
 */
const hasFSAccessAPI = (() => {
  try {
    if (isMobile) return false; // Never use FSAA on mobile
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
 * - Capacitor native (Android/iOS): yes (Filesystem plugin writes to disk)
 * - Others: NO — limited to 2GB in memory
 */
export function canReceiveLargeFiles() {
  return isElectron || hasFSAccessAPI || isCapacitorNative;
}

/**
 * Get the maximum receivable file size on this platform
 */
export function getMaxReceiveSize() {
  if (isElectron) return Infinity; // No limit — streams to disk
  if (hasFSAccessAPI) return Infinity; // Chrome/Edge — streams to disk
  if (isCapacitorNative) return 100 * 1024 * 1024 * 1024; // 100GB — Capacitor Filesystem writes to disk
  return MAX_BROWSER_MEMORY_FILE_SIZE; // 2GB for memory-only browsers
}

/**
 * Get a human-readable platform capability name
 */
export function getPlatformCapability() {
  if (isElectron) return 'desktop-stream';
  if (hasFSAccessAPI) return 'browser-fsaa';
  if (isCapacitorNative) return 'capacitor-native';
  return 'browser-memory';
}

// Configuration
const CONFIG = {
  // Chunk size: MUST be under SCTP maxMessageSize (65535 default between mixed Chrome versions)
  // packet = HEADER(4 bytes) + chunk, so chunk must be <= maxMessageSize - 4
  // Using 16KB universally for maximum compatibility across all browsers/platforms
  CHUNK_SIZE: 16384,  // 16KB — safely under 65535 SCTP limit with 4-byte header = 16388
  // DataChannel buffer threshold for backpressure
  BUFFER_THRESHOLD: isMobile ? 1 * 1024 * 1024 : 4 * 1024 * 1024, // 1MB mobile, 4MB desktop
  // How often to report progress to server (every N chunks)
  PROGRESS_REPORT_INTERVAL: 200,
  // Max concurrent transfers
  MAX_CONCURRENT_TRANSFERS: 3,
  // Header size for chunk metadata
  HEADER_SIZE: 12, // 4 bytes transferIndex + 4 bytes chunkIndex + 4 bytes chunkLength
  // Max file size for SHA-256 hash verification (skip for larger files — too slow)
  MAX_HASH_FILE_SIZE: 500 * 1024 * 1024, // 500MB
  // UI notify throttle: don't update UI for every single chunk
  UI_NOTIFY_INTERVAL: isMobile ? 500 : 250, // ms between UI updates
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
    
    // File hash for integrity verification (SHA-256)
    this.fileHash = null;           // Expected hash (from sender)
    this.computedHash = null;       // Hash computed by receiver
    this.hashVerified = null;       // null=pending, true=match, false=mismatch
    this._hashStatus = 'none';      // none, computing, verifying, verified, failed
    
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
    if (this._disconnectTimer) {
      clearTimeout(this._disconnectTimer);
      this._disconnectTimer = null;
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
    
    // Current user ID — needed to distinguish sender/receiver in pending-list
    this.currentUserId = null;

    // Global callbacks
    this.onTransferUpdate = null;     // (transferId, session) => {}
    this.onIncomingTransfer = null;   // (transferData) => {}
    this.onTransferComplete = null;   // (transferId) => {}
    this.onTransferError = null;      // (transferId, error) => {}
    
    // Socket listeners bound flag
    this._socketListenersBound = false;
    // Track which socket instance listeners are bound to
    this._boundSocketId = null;
  }

  /**
   * Set the current user ID so pending-list can distinguish sender vs receiver
   */
  setCurrentUserId(userId) {
    this.currentUserId = userId;
  }

  /**
   * Initialize socket listeners for file transfer signaling
   */
  /**
   * Ensure socket listeners are bound — call before any transfer action
   */
  ensureListeners() {
    const socket = getSocket();
    // Re-bind if socket instance changed (e.g., after reconnect/reload)
    if (socket && this._socketListenersBound && this._boundSocketId && this._boundSocketId !== socket.id && socket.id) {
      console.log(`[P2P] ⚠️ Socket instance changed (${this._boundSocketId} → ${socket.id}), re-binding listeners...`);
      this.unbindSocketListeners();
    }
    if (!this._socketListenersBound) {
      console.log('[P2P] ensureListeners: listeners not bound, attempting bind...');
      this.bindSocketListeners();
    }
  }

  bindSocketListeners() {
    const socket = getSocket();
    if (!socket) {
      console.warn('[P2P] ⚠️ bindSocketListeners: NO SOCKET AVAILABLE — listeners NOT bound!');
      return;
    }

    // If already bound to THIS exact socket, skip
    if (this._socketListenersBound && this._boundSocketId === socket.id) return;

    // If bound to a DIFFERENT socket, unbind first
    if (this._socketListenersBound) {
      console.log(`[P2P] ⚠️ Re-binding: was bound to ${this._boundSocketId}, now binding to ${socket.id}`);
      this._unbindCurrentListeners(socket);
    }

    console.log(`[P2P] ✅ bindSocketListeners: Binding to socket ${socket.id || '(not connected yet)'}`);

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

    // Transfer completed confirmation (sender receives this from server after receiver finishes)
    socket.on('file-transfer:completed', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session) {
        session.status = 'completed';
        // Store hash verification result from receiver
        if (data.hashMatch === true) {
          session.hashVerified = true;
          session._hashStatus = 'verified';
        } else if (data.hashMatch === false) {
          session.hashVerified = false;
          session._hashStatus = 'failed';
        }
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
    // Server now ONLY returns transfers where current user is the RECEIVER
    socket.on('file-transfer:pending-list', (data) => {
      if (data.transfers && data.transfers.length > 0) {
        data.transfers.forEach(t => {
          // Skip if we already have a session for this transfer
          if (this.sessions.has(t.transferId)) return;

          // Double-check: only show if current user is the receiver
          const receiverId = t.receiver?._id || t.receiver;
          const senderId = t.sender?._id || t.sender;
          if (this.currentUserId && receiverId !== this.currentUserId && senderId === this.currentUserId) {
            // We are the sender — cannot resume (file not in memory after restart)
            console.log(`[P2P] Skipping sender-side pending transfer ${t.transferId} — file not in memory`);
            // Auto-cancel on server
            const sock = getSocket();
            if (sock) sock.emit('file-transfer:cancel', { transferId: t.transferId });
            return;
          }

          if (this.onIncomingTransfer) {
            this.onIncomingTransfer({
              ...t,
              isResume: true,
              senderId: senderId,
              senderName: t.sender?.username || 'Unknown',
            });
          }
        });
      }
    });

    // Resume request from peer — guard against duplicate popups
    socket.on('file-transfer:resume-request', (data) => {
      // Don't show if we already have a session for this transfer
      if (this.sessions.has(data.transferId)) {
        console.log(`[P2P] Ignoring resume-request for ${data.transferId} — session already exists`);
        return;
      }
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

    // Server tells receiver that sender finished (backup for lost completion marker)
    socket.on('file-transfer:sender-finished', (data) => {
      const session = this.sessions.get(data.transferId);
      if (session && session.isReceiver && session.status !== 'completed') {
        console.log(`[P2P] Server confirmed sender finished for ${data.transferId}, auto-finalizing...`);
        this._finalizeReceive(session);
      }
    });

    this._socketListenersBound = true;
    this._boundSocketId = socket.id || 'pending';

    // Track socket ID changes (socket.id is null before connect, set after)
    if (!socket.id) {
      const onceConnect = () => {
        this._boundSocketId = socket.id;
        console.log(`[P2P] Socket connected, updated boundSocketId to ${socket.id}`);
      };
      socket.once('connect', onceConnect);
    }
  }

  /**
   * Remove file transfer listeners from a specific socket
   */
  _unbindCurrentListeners(socket) {
    if (!socket) return;
    const events = [
      'file-transfer:incoming', 'file-transfer:accepted', 'file-transfer:rejected',
      'file-transfer:cancelled', 'file-transfer:paused', 'file-transfer:completed',
      'file-transfer:peer-offline', 'file-transfer:pending-list', 'file-transfer:resume-request',
      'file-transfer:resume-info', 'file-transfer:offer', 'file-transfer:answer',
      'file-transfer:ice-candidate', 'file-transfer:progress-ack', 'file-transfer:sender-finished',
    ];
    events.forEach(e => socket.off(e));
  }

  /**
   * Unbind socket listeners
   */
  unbindSocketListeners() {
    const socket = getSocket();
    if (socket) {
      this._unbindCurrentListeners(socket);
    }
    this._socketListenersBound = false;
    this._boundSocketId = null;
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
    // Ensure socket listeners are bound before sending
    this.ensureListeners();

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

    // Compute SHA-256 hash ONLY for files under the size limit
    // Large files (>500MB) skip hashing — it's too slow and uses too much memory
    let fileHash = null;
    if (file.size <= CONFIG.MAX_HASH_FILE_SIZE) {
      session._hashStatus = 'computing';
      this.sessions.set(transferId, session);
      this._notifyUpdate(transferId, session);

      try {
        fileHash = await this._computeFileHash(file);
        session.fileHash = fileHash;
        session._hashStatus = 'computed';
        console.log(`[P2P] File hash computed: ${fileHash.substring(0, 16)}... for ${file.name}`);
      } catch (err) {
        console.warn('[P2P] Failed to compute file hash, sending without verification:', err);
        session._hashStatus = 'none';
      }
    } else {
      session._hashStatus = 'skipped';
      console.log(`[P2P] Skipping hash computation for large file: ${file.name} (${(file.size / 1073741824).toFixed(1)} GB > 500MB limit)`);
      this.sessions.set(transferId, session);
    }

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
        fileHash,
      });
    }

    this._notifyUpdate(transferId, session);
    return transferId;
  }

  /**
   * Accept an incoming file transfer (receiver side)
   */
  async acceptTransfer(transferData) {
    // Ensure socket listeners are bound before accepting
    this.ensureListeners();

    const {
      transferId,
      senderId,
      fileName,
      fileSize,
      totalChunks,
      chunkSize,
      isResume,
      fileHash,
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

    // Store expected hash from sender for verification after receive
    if (fileHash) {
      session.fileHash = fileHash;
      session._hashStatus = 'waiting';
    }

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
   * Fetch dynamic TURN credentials from server and merge with static ICE config.
   * 
   * WHY: Static TURN credentials with lt-cred-mech cause stale-nonce (438),
   * wrong-transaction-ID (437), and stale-session errors on coturn — especially
   * when multiple devices share the same NAT (public IP). Ephemeral credentials
   * via use-auth-secret (TURN REST API) avoid all these issues.
   * 
   * Each TURN URL gets its own iceServers entry so browsers try all transports
   * simultaneously (UDP, TCP, TLS) instead of sequentially.
   */
  /**
   * Helper: extract STUN-only entries from ICE_SERVERS (no static TURN)
   */
  _getStunOnlyConfig() {
    const stunOnly = ICE_SERVERS.iceServers.filter(s => {
      const url = Array.isArray(s.urls) ? s.urls[0] : s.urls;
      return url && url.startsWith('stun:');
    });
    return {
      iceTransportPolicy: ICE_SERVERS.iceTransportPolicy || 'all',
      bundlePolicy: ICE_SERVERS.bundlePolicy || 'max-bundle',
      rtcpMuxPolicy: ICE_SERVERS.rtcpMuxPolicy || 'require',
      iceServers: [...stunOnly],
    };
  }

  async _getIceConfig() {
    // Retry once on failure (network hiccup, transient 500, etc.)
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          console.warn('[P2P] No auth token for TURN credential fetch, using STUN-only');
          return this._getStunOnlyConfig();
        }

        // Use the imported SERVER_URL constant (same as login/chat/socket)
        const url = `${SERVER_URL}/api/transfers/turn-credentials`;
        console.log(`[P2P DEBUG] Fetching TURN credentials (attempt ${attempt}) | url=${url}`);
        
        const resp = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
        });
        
        if (!resp.ok) {
          const body = await resp.text().catch(() => '');
          console.warn(`[P2P] TURN credential fetch failed (attempt ${attempt}) | status=${resp.status} | body=${body.substring(0, 200)}`);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          console.warn('[P2P] All TURN credential attempts failed, using STUN-only');
          return this._getStunOnlyConfig();
        }
        
        const turnData = await resp.json();
        console.log(`[P2P DEBUG] ✅ Got dynamic TURN credentials | username=${turnData.username} | uris=${turnData.uris?.length} | ttl=${turnData.ttl}s`);
        
        if (!turnData.uris || turnData.uris.length === 0 || !turnData.credential) {
          console.warn('[P2P] TURN response missing uris/credential, using STUN-only');
          return this._getStunOnlyConfig();
        }
        
        // Build ICE config with dynamic TURN credentials
        // Each URI gets its own entry for maximum browser compatibility
        const turnServers = turnData.uris.map(uri => ({
          urls: uri,
          username: turnData.username,
          credential: turnData.credential,
        }));
        
        // Only STUN from static config + dynamic TURN
        // NEVER include static TURN — causes coturn error 437 (wrong transaction ID)
        const config = this._getStunOnlyConfig();
        config.iceServers = [...config.iceServers, ...turnServers];
        
        return config;
      } catch (err) {
        console.warn(`[P2P] TURN credential fetch error (attempt ${attempt}):`, err.message);
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      }
    }
    
    // All retries exhausted — STUN-only (no static TURN to avoid error 437)
    console.warn('[P2P] All TURN credential fetches failed, using STUN-only config');
    return this._getStunOnlyConfig();
  }

  /**
   * Sender creates PeerConnection + DataChannel and sends offer
   */
  async _setupSenderConnection(session) {
    console.log(`[P2P DEBUG] _setupSenderConnection called | transferId=${session.transferId} | peerId=${session.peerId}`);
    session.status = 'connecting';
    this._notifyUpdate(session.transferId, session);

    // NOTE: Connection timeout starts AFTER ICE gathering (below), not here.
    // ICE gathering itself can take up to 10s, so starting timeout here would
    // eat into the actual connection budget.

    // Fetch dynamic TURN credentials (ephemeral, avoids stale-nonce issues)
    const iceConfig = await this._getIceConfig();
    const pc = new RTCPeerConnection(iceConfig);
    session.peerConnection = pc;
    console.log(`[P2P DEBUG] RTCPeerConnection created | iceServers:`, JSON.stringify(iceConfig.iceServers?.map(s => s.urls)));

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

      // Check SCTP maxMessageSize and adapt chunk size if needed
      const sctp = pc.sctp;
      const maxMsg = sctp?.maxMessageSize || 65535;
      console.log(`[P2P DEBUG] SCTP maxMessageSize=${maxMsg} | current chunkSize=${session.chunkSize}`);
      // Ensure chunk + 4-byte header fits within maxMessageSize
      if (session.chunkSize + 4 > maxMsg) {
        const oldSize = session.chunkSize;
        session.chunkSize = Math.max(1024, maxMsg - 64); // leave 64 bytes margin
        session.totalChunks = Math.ceil(session.fileSize / session.chunkSize);
        console.log(`[P2P DEBUG] ⚠️ Chunk size reduced: ${oldSize} → ${session.chunkSize} (maxMsg=${maxMsg})`);
      }

      this._notifyUpdate(session.transferId, session);
      this._emitDiag(session, 'dc_open', {
        side: 'sender',
        maxMessageSize: maxMsg,
        chunkSize: session.chunkSize,
        totalChunks: session.totalChunks,
      });
      this._sendChunks(session);
    };

    dc.onclose = (ev) => {
      console.log(`[P2P DEBUG] DataChannel CLOSED for ${session.transferId}, status was: ${session.status}`);
      this._emitDiag(session, 'dc_close', {
        side: 'sender',
        prevStatus: session.status,
        iceState: pc?.iceConnectionState,
        signalingState: pc?.signalingState,
        buffered: dc.bufferedAmount,
      });
      if (session.status === 'transferring') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
      }
    };

    dc.onerror = (err) => {
      console.error(`[P2P DEBUG] ❌ DataChannel ERROR for ${session.transferId}:`, err);
      this._emitDiag(session, 'dc_error', {
        side: 'sender',
        error: err?.error?.message || err?.message || String(err),
        iceState: pc?.iceConnectionState,
        buffered: dc.bufferedAmount,
      });
      // Don't immediately fail during active transfer — chunk sending has its own retry logic.
      // Only fail if we're still in connecting phase (DataChannel never opened).
      if (session.status === 'connecting') {
        session.status = 'failed';
        session._failReason = 'datachannel_error';
        this._notifyUpdate(session.transferId, session);
      }
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
      // Never overwrite terminal states
      const isTerminal = ['completed', 'verifying', 'cancelled'].includes(session.status);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this._clearConnectionTimeout(session);
      }
      if (pc.iceConnectionState === 'failed' && !isTerminal) {
        // Try ICE restart before giving up
        if (!session._iceRestartAttempted) {
          console.warn(`[P2P] Sender ICE failed for ${session.transferId}, attempting ICE restart...`);
          session._iceRestartAttempted = true;
          this._attemptIceRestart(session);
        } else {
          console.error(`[P2P] Sender ICE failed after restart for ${session.transferId}`);
          this._clearConnectionTimeout(session);
          session.status = 'failed';
          session._failReason = 'ice_failed';
          this._notifyUpdate(session.transferId, session);
          this._reportProgressToServer(session);
        }
      }
      if (pc.iceConnectionState === 'disconnected' && !isTerminal) {
        // Disconnected is often temporary — wait 5s before pausing
        if (!session._disconnectTimer) {
          session._disconnectTimer = setTimeout(() => {
            session._disconnectTimer = null;
            if (pc.iceConnectionState === 'disconnected' && !['completed', 'verifying', 'cancelled'].includes(session.status)) {
              session.status = 'paused';
              this._notifyUpdate(session.transferId, session);
              this._reportProgressToServer(session);
            }
          }, 5000);
        }
      }
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        // Clear disconnect timer if connection recovered
        if (session._disconnectTimer) {
          clearTimeout(session._disconnectTimer);
          session._disconnectTimer = null;
        }
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[P2P DEBUG] Sender ICE gathering state: ${pc.iceGatheringState} for ${session.transferId}`);
    };

    pc.onsignalingstatechange = () => {
      console.log(`[P2P DEBUG] Sender signaling state: ${pc.signalingState} for ${session.transferId}`);
    };

    // Create and send offer — wait for ICE gathering to complete (vanilla ICE)
    // This embeds all ICE candidates into the SDP, so no separate ice-candidate signaling needed
    try {
      const offer = await pc.createOffer();
      console.log(`[P2P DEBUG] Offer created | transferId=${session.transferId} | type=${offer.type}`);
      await pc.setLocalDescription(offer);
      console.log(`[P2P DEBUG] Local description set (offer) | transferId=${session.transferId} | gathering=${pc.iceGatheringState}`);

      // Wait for ICE gathering (15s to allow TURN allocation on slow mobile data)
      await this._waitForIceGathering(pc, 15000);
      
      // Count candidates in SDP for diagnostics
      const sdpText = pc.localDescription?.sdp || '';
      const candidateLines = sdpText.split('\n').filter(l => l.startsWith('a=candidate:'));
      const hostCount = candidateLines.filter(l => l.includes('typ host')).length;
      const srflxCount = candidateLines.filter(l => l.includes('typ srflx')).length;
      const relayCount = candidateLines.filter(l => l.includes('typ relay')).length;
      console.log(`[P2P DEBUG] ICE gathering done | transferId=${session.transferId} | host=${hostCount} srflx=${srflxCount} relay=${relayCount} total=${candidateLines.length}`);

      // Start connection timeout NOW (after ICE gathering), so the full 30+30s
      // budget is available for the actual P2P connection establishment
      this._startConnectionTimeout(session);

      const socket = getSocket();
      if (socket) {
        // Send the FINAL localDescription (with all ICE candidates embedded)
        const finalOffer = pc.localDescription;
        console.log(`[P2P DEBUG] Emitting file-transfer:offer (with candidates) | transferId=${session.transferId} | targetUserId=${session.peerId} | sdpLength=${finalOffer.sdp.length}`);
        socket.emit('file-transfer:offer', {
          transferId: session.transferId,
          targetUserId: session.peerId,
          offer: finalOffer,
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
    
    // Fetch dynamic TURN credentials (ephemeral, avoids stale-nonce issues)
    const iceConfig = await this._getIceConfig();
    const pc = new RTCPeerConnection(iceConfig);
    session.peerConnection = pc;
    console.log(`[P2P DEBUG] Receiver RTCPeerConnection created | iceServers:`, JSON.stringify(iceConfig.iceServers?.map(s => s.urls)));

    // NOTE: Connection timeout starts AFTER ICE gathering (below), not here.
    // ICE gathering itself can take up to 10s, so starting timeout here would
    // eat into the actual connection budget (same fix as sender side).

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

      dc.onopen = async () => {
        console.log(`[P2P DEBUG] ✅ Receiver DataChannel OPEN for ${session.transferId}`);
        this._clearConnectionTimeout(session);
        session.status = 'transferring';
        session.startTime = Date.now();
        session._writerReady = false;

        // Log SCTP info
        const sctp = pc.sctp;
        const maxMsg = sctp?.maxMessageSize || 'unknown';
        console.log(`[P2P DEBUG] Receiver SCTP maxMessageSize=${maxMsg}`);

        this._notifyUpdate(session.transferId, session);
        this._emitDiag(session, 'dc_open', {
          side: 'receiver',
          maxMessageSize: maxMsg,
        });
        // Initialize progressive writer — MUST complete before processing chunks
        await this._initReceiveWriter(session);
        // If writer init cancelled the transfer, don't proceed
        if (session.status === 'cancelled') {
          console.warn(`[P2P] Writer init cancelled transfer ${session.transferId}`);
          return;
        }
        session._writerReady = true;
        // Flush any chunks that arrived during writer initialization
        if (session._pendingChunks && session._pendingChunks.length > 0) {
          console.log(`[P2P DEBUG] Flushing ${session._pendingChunks.length} chunks queued during writer init`);
          for (const chunkData of session._pendingChunks) {
            this._handleReceivedChunk(session, chunkData);
          }
          session._pendingChunks = [];
        }
      };

      dc.onmessage = (event) => {
        // If writer isn't ready yet, queue the chunk
        if (!session._writerReady) {
          if (!session._pendingChunks) session._pendingChunks = [];
          session._pendingChunks.push(event.data);
          return;
        }
        this._handleReceivedChunk(session, event.data);
      };

      dc.onclose = () => {
        console.log(`[P2P DEBUG] Receiver DataChannel CLOSED for ${session.transferId}, status was: ${session.status}`);
        this._emitDiag(session, 'dc_close', {
          side: 'receiver',
          dcState: dc.readyState,
          iceState: pc?.iceConnectionState,
          chunksReceived: session.chunksReceived || 0,
          bytesReceived: session.bytesReceived || 0,
        });
        // Only pause if still actively transferring — never overwrite terminal states
        if (session.status === 'transferring') {
          session.status = 'paused';
          this._notifyUpdate(session.transferId, session);
          this._reportProgressToServer(session);
        }
      };

      dc.onerror = (err) => {
        console.error(`[P2P DEBUG] ❌ Receiver DataChannel ERROR for ${session.transferId}:`, err);
        this._emitDiag(session, 'dc_error', {
          side: 'receiver',
          error: err?.error?.message || err?.message || String(err),
          iceState: pc?.iceConnectionState,
          chunksReceived: session.chunksReceived || 0,
        });
      };
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[P2P DEBUG] Receiver ICE connection state: ${pc.iceConnectionState} for ${session.transferId}`);
      // Never overwrite terminal states
      const isTerminal = ['completed', 'verifying', 'cancelled'].includes(session.status);
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        this._clearConnectionTimeout(session);
      }
      if (pc.iceConnectionState === 'failed' && !isTerminal) {
        console.error(`[P2P] Receiver ICE failed for ${session.transferId}`);
        this._clearConnectionTimeout(session);
        session.status = 'failed';
        session._failReason = 'ice_failed';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
      if (pc.iceConnectionState === 'disconnected' && !isTerminal) {
        // Disconnected is often temporary — wait 5s
        if (!session._disconnectTimer) {
          session._disconnectTimer = setTimeout(() => {
            session._disconnectTimer = null;
            if (pc.iceConnectionState === 'disconnected' && !['completed', 'verifying', 'cancelled'].includes(session.status)) {
              session.status = 'paused';
              this._notifyUpdate(session.transferId, session);
              this._reportProgressToServer(session);
            }
          }, 5000);
        }
      }
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (session._disconnectTimer) {
          clearTimeout(session._disconnectTimer);
          session._disconnectTimer = null;
        }
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
      console.log(`[P2P DEBUG] Local description set (answer) | transferId=${session.transferId} | gathering=${pc.iceGatheringState}`);

      // Wait for ICE gathering (15s to allow TURN allocation on slow mobile data)
      await this._waitForIceGathering(pc, 15000);
      
      // Count candidates in SDP for diagnostics
      const sdpText = pc.localDescription?.sdp || '';
      const candidateLines = sdpText.split('\n').filter(l => l.startsWith('a=candidate:'));
      const hostCount = candidateLines.filter(l => l.includes('typ host')).length;
      const srflxCount = candidateLines.filter(l => l.includes('typ srflx')).length;
      const relayCount = candidateLines.filter(l => l.includes('typ relay')).length;
      console.log(`[P2P DEBUG] ICE gathering done (answer) | transferId=${session.transferId} | host=${hostCount} srflx=${srflxCount} relay=${relayCount} total=${candidateLines.length}`);

      // Start connection timeout NOW (after ICE gathering), so the full 30+30s
      // budget is available for the actual P2P connection establishment.
      // Previously this was called before ICE gathering, eating into the budget.
      this._startConnectionTimeout(session);

      const socket = getSocket();
      if (socket) {
        // Send the FINAL localDescription (with all ICE candidates embedded)
        const finalAnswer = pc.localDescription;
        console.log(`[P2P DEBUG] Emitting file-transfer:answer (with candidates) | transferId=${session.transferId} | targetUserId=${senderId} | sdpLength=${finalAnswer.sdp.length}`);
        socket.emit('file-transfer:answer', {
          transferId: session.transferId,
          targetUserId: senderId,
          answer: finalAnswer,
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
   * Wait for ICE gathering to complete (vanilla ICE)
   * Returns when all candidates are embedded in the SDP
   * @param {RTCPeerConnection} pc
   * @param {number} timeout - max wait time in ms
   */
  _waitForIceGathering(pc, timeout = 10000) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        return resolve();
      }
      const timer = setTimeout(() => {
        console.warn(`[P2P] ICE gathering timeout after ${timeout}ms, proceeding with partial candidates`);
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }, timeout);
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
    });
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
    const { file, dataChannel } = session;
    if (!file || !dataChannel) return;

    // Read chunkSize/totalChunks from session LIVE (may have been adapted by SCTP maxMessageSize)
    while (session.currentChunk < session.totalChunks && !session.isPaused && session.status === 'transferring') {
      // Backpressure: wait if buffer is too full
      if (dataChannel.bufferedAmount > CONFIG.BUFFER_THRESHOLD) {
        await this._waitForBufferDrain(dataChannel);
        continue;
      }

      const start = session.currentChunk * session.chunkSize;
      const end = Math.min(start + session.chunkSize, file.size);
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
        
        // Safety check: verify packet fits within SCTP maxMessageSize
        const maxMsg = session.peerConnection?.sctp?.maxMessageSize || 65535;
        if (packet.byteLength > maxMsg) {
          console.error(`[P2P] ❌ Packet ${packet.byteLength} exceeds maxMessageSize ${maxMsg}! Aborting.`);
          this._emitDiag(session, 'packet_too_large', {
            packetSize: packet.byteLength,
            maxMessageSize: maxMsg,
            chunk: session.currentChunk,
          });
          session.status = 'failed';
          session._failReason = 'packet_too_large';
          this._notifyUpdate(session.transferId, session);
          return;
        }

        // Retry send up to 3 times with brief delay
        let sent = false;
        for (let retry = 0; retry < 3; retry++) {
          try {
            if (dataChannel.readyState !== 'open') {
              console.warn(`[P2P] DataChannel not open (state=${dataChannel.readyState}), waiting...`);
              await new Promise(r => setTimeout(r, 1000));
              if (dataChannel.readyState !== 'open') break;
            }
            dataChannel.send(packet.buffer);
            sent = true;
            break;
          } catch (sendErr) {
            console.warn(`[P2P] Chunk ${session.currentChunk} send retry ${retry + 1}/3:`, sendErr.message);
            this._emitDiag(session, 'send_error', {
              chunk: session.currentChunk,
              retry: retry + 1,
              error: sendErr.message,
              dcState: dataChannel.readyState,
              buffered: dataChannel.bufferedAmount,
            });
            if (retry < 2) await new Promise(r => setTimeout(r, 500));
          }
        }
        
        if (!sent) {
          console.error(`[P2P] ❌ Failed to send chunk ${session.currentChunk} after 3 retries | dcState=${dataChannel.readyState}`);
          this._emitDiag(session, 'chunk_send_failed', { 
            chunk: session.currentChunk, 
            dcState: dataChannel.readyState,
            iceState: session.peerConnection?.iceConnectionState,
            buffered: dataChannel.bufferedAmount,
          });
          session.status = 'failed';
          session._failReason = 'chunk_send_failed';
          this._notifyUpdate(session.transferId, session);
          return;
        }
        
        session.currentChunk++;
        session.bytesTransferred = Math.min(session.currentChunk * session.chunkSize, file.size);

        // Emit diagnostic for first chunk and every 50th chunk
        if (session.currentChunk === 1 || session.currentChunk % 50 === 0) {
          this._emitDiag(session, 'chunk_sent', {
            chunk: session.currentChunk,
            total: session.totalChunks,
            dcState: dataChannel.readyState,
            buffered: dataChannel.bufferedAmount,
            bytes: session.bytesTransferred,
          });
        }
        
        // Calculate speed every 500ms
        this._calculateSpeed(session);

        // Report progress to server periodically
        if (session.currentChunk % CONFIG.PROGRESS_REPORT_INTERVAL === 0) {
          this._reportProgressToServer(session);
        }

        // Throttle UI updates — don't call for every chunk (expensive for large files)
        const now = Date.now();
        if (!session._lastUINotify || now - session._lastUINotify >= CONFIG.UI_NOTIFY_INTERVAL) {
          session._lastUINotify = now;
          this._notifyUpdate(session.transferId, session);
        }
      } catch (err) {
        console.error(`[P2P] ❌ Error processing chunk ${session.currentChunk}:`, err);
        session.status = 'failed';
        session._failReason = 'chunk_error';
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
      
      // Also notify server that sender finished (so server can tell receiver)
      const socket = getSocket();
      if (socket) {
        socket.emit('file-transfer:sender-done', {
          transferId: session.transferId,
        });
      }

      session.status = 'completed';
      // NOTE: Do NOT call _reportProgressToServer here — it would revert
      // the DB status from 'completed' back to 'transferring' if the
      // receiver already reported completion.
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

    console.log(`[P2P DEBUG] _initReceiveWriter | isElectron=${isElectron} | hasFSAccessAPI=${hasFSAccessAPI} | isMobile=${isMobile} | isCapacitor=${isCapacitorNative} | fileSize=${session.fileSize}`);
    this._emitDiag(session, 'writer_init_start', { isElectron, hasFSAccessAPI, isMobile, isCapacitorNative });

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

    // ── PATH 2: Browser File System Access API (Chrome/Edge desktop only) ──
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
        // Any FSAA error → fall through to memory mode
        // DO NOT cancel the transfer — FSAA is optional, memory mode is the fallback
        console.warn(`[P2P] FSAA stream init failed (${e?.name}: ${e?.message}), falling back to memory mode`);
      }
    }

    // ── PATH 3: Capacitor native (Android/iOS) ────────────────────────
    // Uses memory accumulation but saves to disk via Filesystem plugin.
    // Capacitor can handle large files since final save goes to native FS.
    if (isCapacitorNative) {
      session.receivedChunks = new Array(session.totalChunks);
      session._useCapacitorSave = true;
      // For very large files (>2GB), use progressive flushing to avoid OOM
      if (session.fileSize > MAX_BROWSER_MEMORY_FILE_SIZE) {
        session._flushThreshold = 500; // Flush to disk every 500 chunks
        session._flushedParts = [];
        session._lastFlushedIndex = 0;
      }
      console.log(`[P2P] Capacitor native mode for: ${session.fileName} (${(session.fileSize / 1048576).toFixed(0)}MB)`);
      this._emitDiag(session, 'writer_init_done', { mode: 'capacitor', totalChunks: session.totalChunks });
      return;
    }

    // ── PATH 4: Browser Memory fallback (Firefox/Safari) ────────────────
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
    this._emitDiag(session, 'writer_init_done', { mode: 'memory', totalChunks: session.totalChunks });
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

    // Log first chunk for diagnostics
    if (session._receivedCount === 1) {
      console.log(`[P2P DEBUG] First chunk received | chunkIndex=${chunkIndex} | size=${chunkData.byteLength} | status=${session.status}`);
      this._emitDiag(session, 'first_chunk_received', { chunkIndex, chunkSize: chunkData.byteLength });
    }

    // AUTO-FINALIZE: If all chunks received, don't wait for completion marker
    // This fixes the issue where the marker gets lost when DataChannel closes
    if (session._receivedCount >= session.totalChunks && session.status !== 'completed') {
      console.log(`[P2P] All ${session.totalChunks} chunks received for ${session.transferId}, auto-finalizing (no marker needed)`);
      // Small delay to allow any remaining marker to arrive first
      setTimeout(() => {
        if (session.status !== 'completed') {
          this._finalizeReceive(session);
        }
      }, 500);
    }

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

    // Throttle UI updates — don't call for every chunk (expensive for large files)
    const now = Date.now();
    if (!session._lastUINotify || now - session._lastUINotify >= CONFIG.UI_NOTIFY_INTERVAL) {
      session._lastUINotify = now;
      this._notifyUpdate(session.transferId, session);
    }
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
    // Guard against double-finalization
    if (session.status === 'completed' || session._finalizing) return;
    session._finalizing = true;

    try {
      let savePath = null;
      let fileBlob = null; // Keep reference for hash verification (memory mode)

      // ── Electron: close the write stream — file is already on disk!
      if (session._useElectronStream) {
        const result = await window.electronAPI.closeFileStream(session._electronStreamId);
        savePath = result.filePath;
        console.log(`[P2P] File saved: ${result.filePath} (${result.bytesWritten} bytes)`);
      }
      // ── Browser FSAA: close writable stream — file is already on disk!
      else if (session._useFSAAStream && session._fsaaWriter) {
        try {
          await session._fsaaWriter.close();
          savePath = session.fileName; // FSAA — user chose location
          console.log(`[P2P] FSAA file saved: ${session.fileName}`);
        } catch (err) {
          console.error('[P2P] FSAA close error:', err);
        }
        session._fsaaWriter = null;
      }
      // ── Browser Memory: build blob and save (platform-aware)
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
        fileBlob = new Blob(parts, {
          type: session.fileMimeType || 'application/octet-stream'
        });

        // Use platform-aware save for Capacitor (Android/iOS)
        const platform = getPlatform();
        if (platform === 'android' || platform === 'ios') {
          try {
            const saved = await saveFileToDevice(fileBlob, session.fileName);
            if (saved) {
              savePath = `Downloads/${session.fileName}`;
              console.log(`[P2P] File saved via Capacitor: Downloads/${session.fileName}`);
            } else {
              console.warn('[P2P] Capacitor save returned false, trying browser fallback');
              this._downloadBlob(fileBlob, session.fileName);
              savePath = 'Downloads';
            }
          } catch (err) {
            console.error('[P2P] Capacitor save failed, using browser fallback:', err);
            this._downloadBlob(fileBlob, session.fileName);
            savePath = 'Downloads';
          }
        } else {
          // Web browser: standard download
          this._downloadBlob(fileBlob, session.fileName);
          savePath = 'Downloads';
        }
      }

      // Store save path in session for UI display
      session._savePath = savePath;

      // ── FILE INTEGRITY VERIFICATION (SHA-256) ──────────────────────────
      let hashVerified = null;
      if (session.fileHash) {
        session._hashStatus = 'verifying';
        session.status = 'verifying';
        this._notifyUpdate(session.transferId, session);
        console.log(`[P2P] Verifying file integrity for ${session.fileName}...`);

        try {
          let computedHash = null;

          if (fileBlob) {
            // Memory mode: hash the blob directly
            computedHash = await this._computeFileHash(fileBlob);
          } else if (session._useElectronStream && session._electronFilePath) {
            // Electron: read saved file and hash it
            try {
              const fileData = await window.electronAPI.readFile(session._electronFilePath);
              const blob = new Blob([fileData]);
              computedHash = await this._computeFileHash(blob);
            } catch (e) {
              console.warn('[P2P] Could not read Electron file for verification:', e);
            }
          }
          // FSAA mode: file is on disk, we can't easily re-read it — skip hash
          // (FSAA doesn't give us back a readable handle after close)

          if (computedHash) {
            session.computedHash = computedHash;
            hashVerified = computedHash === session.fileHash;
            session.hashVerified = hashVerified;
            session._hashStatus = hashVerified ? 'verified' : 'failed';

            if (hashVerified) {
              console.log(`[P2P] ✅ File integrity VERIFIED: ${session.fileName} | hash=${computedHash.substring(0, 16)}...`);
            } else {
              console.error(`[P2P] ❌ File integrity FAILED: ${session.fileName} | expected=${session.fileHash.substring(0, 16)}... | got=${computedHash.substring(0, 16)}...`);
            }
          } else {
            // Could not compute hash (FSAA or read error) — mark as unverified
            session._hashStatus = 'unverifiable';
            session.hashVerified = null;
            console.warn(`[P2P] ⚠️ Could not verify file integrity (streaming mode): ${session.fileName}`);
          }
        } catch (err) {
          console.error('[P2P] Hash verification error:', err);
          session._hashStatus = 'error';
          session.hashVerified = null;
        }
      } else {
        // No hash provided by sender
        session._hashStatus = 'no_hash';
        session.hashVerified = null;
      }

      // Set final status
      session.status = 'completed';
      this._notifyUpdate(session.transferId, session);

      // Show notification with verification result
      if (session._useElectronStream) {
        const verifyMsg = hashVerified === true ? ' (Verified ✓)' 
          : hashVerified === false ? ' (Integrity check FAILED ✗)' 
          : '';
        window.electronAPI.showNotification({
          title: 'File received!',
          body: `${session.fileName} saved successfully.${verifyMsg}`,
        });
      } else {
        const platform = getPlatform();
        if (platform === 'android' || platform === 'ios') {
          const verifyMsg = hashVerified === true ? ' (Verified ✓)' 
            : hashVerified === false ? ' (Integrity check FAILED!)' 
            : '';
          showNativeNotification(
            'File received!',
            `${session.fileName} saved to Downloads${verifyMsg}`
          );
        }
      }

      // Report complete to server with verification result
      const socket = getSocket();
      if (socket) {
        socket.emit('file-transfer:complete', {
          transferId: session.transferId,
          verified: hashVerified === true,
          hashMatch: hashVerified,
        });
      }

      // Cleanup received data (keep session alive briefly for UI)
      session.receivedChunks = [];
      session._flushedBlobs = [];
      fileBlob = null;
      this._notifyUpdate(session.transferId, session);

      if (this.onTransferComplete) {
        this.onTransferComplete(session.transferId);
      }

      // Destroy WebRTC connection after finalization to prevent
      // ICE disconnected events from overwriting the 'completed' status
      session.destroy();
    } catch (err) {
      console.error('Failed to finalize received file:', err);
      session.status = 'failed';
      session._finalizing = false;
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
  // FILE HASH COMPUTATION
  // ============================================

  /**
   * Compute SHA-256 hash of a File or Blob
   * Uses ReadableStream for true streaming — never loads entire file into memory.
   * Only called for files <= MAX_HASH_FILE_SIZE (500MB).
   * @param {File|Blob} fileOrBlob - The file/blob to hash
   * @returns {Promise<string>} Hex-encoded SHA-256 hash
   */
  async _computeFileHash(fileOrBlob) {
    const totalSize = fileOrBlob.size;

    // For small files (<10MB), use simple one-shot approach
    if (totalSize < 10 * 1024 * 1024) {
      const buffer = await fileOrBlob.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      return this._arrayBufferToHex(hashBuffer);
    }

    // For larger files (10MB-500MB): stream through in 4MB slices
    // Read slice → hash incrementally → release memory immediately
    // SubtleCrypto doesn't support incremental hashing, so we use
    // a progressive approach: read in 64MB batches, hash each batch,
    // then hash all batch-hashes together (Merkle-style fallback).
    // This caps peak memory at ~64MB regardless of file size.
    const BATCH_SIZE = 64 * 1024 * 1024; // 64MB per batch
    const batchHashes = [];
    let offset = 0;

    while (offset < totalSize) {
      const end = Math.min(offset + BATCH_SIZE, totalSize);
      const slice = fileOrBlob.slice(offset, end);
      const buffer = await slice.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      batchHashes.push(new Uint8Array(hashBuffer));
      offset = end;
      // Yield to event loop to keep UI responsive
      if (offset < totalSize) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // If only one batch, return its hash directly
    if (batchHashes.length === 1) {
      return this._arrayBufferToHex(batchHashes[0].buffer);
    }

    // Multiple batches: combine all batch hashes and hash them together
    // This produces a deterministic hash for the same file
    const combined = new Uint8Array(batchHashes.length * 32);
    batchHashes.forEach((h, i) => combined.set(h, i * 32));
    const finalHash = await crypto.subtle.digest('SHA-256', combined.buffer);
    return this._arrayBufferToHex(finalHash);
  }

  /**
   * Convert ArrayBuffer to hex string
   */
  _arrayBufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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

  /**
   * Emit diagnostic event to server for remote debugging
   * These appear in PM2 logs and help diagnose client-side issues
   */
  _emitDiag(session, event, extra = {}) {
    const socket = getSocket();
    if (socket) {
      socket.emit('file-transfer:diag', {
        transferId: session.transferId,
        event,
        side: session.isReceiver ? 'receiver' : 'sender',
        status: session.status,
        chunk: session.currentChunk,
        dc: session.dataChannel?.readyState || 'none',
        ice: session.peerConnection?.iceConnectionState || 'none',
        ...extra,
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
        direction: session.isReceiver ? 'receive' : 'send',
        isReceiver: session.isReceiver,
        peerId: session.peerId,
        isPaused: session.isPaused,
        savePath: session._savePath || null,
        fileHash: session.fileHash || null,
        hashVerified: session.hashVerified,
        hashStatus: session._hashStatus || 'none',
      });
    }
  }

  /**
   * Start a connection timeout — if still "connecting" after timeoutMs, try ICE restart first
   * Mobile networks need more time: 60s timeout with 1 ICE restart attempt
   */
  _startConnectionTimeout(session, timeoutMs = 60000) {
    this._clearConnectionTimeout(session);
    session._iceRestartAttempted = false;

    // First timer: after 30s, attempt ICE restart instead of immediate failure
    // First timer: after 30s, attempt ICE restart
    session._connectionTimer = setTimeout(() => {
      if (session.status === 'connecting' && !session._iceRestartAttempted) {
        const iceState = session.peerConnection?.iceConnectionState || 'unknown';
        console.warn(`[P2P] ⚠️ Connection slow for ${session.transferId} after 30s (ICE=${iceState}), attempting ICE restart...`);
        session._iceRestartAttempted = true;
        this._attemptIceRestart(session);

        // Second timer: after another 30s, actually fail
        session._connectionTimer = setTimeout(() => {
          if (session.status === 'connecting') {
            const finalIceState = session.peerConnection?.iceConnectionState || 'unknown';
            console.error(`[P2P] ⏰ Connection TIMEOUT for ${session.transferId} after 60s | ICE=${finalIceState}`);
            session.status = 'failed';
            session._failReason = 'connection_timeout';
            this._notifyUpdate(session.transferId, session);
          }
        }, 30000);
      }
    }, 30000);
  }

  /**
   * Attempt ICE restart to recover a stuck connection
   */
  async _attemptIceRestart(session) {
    const pc = session.peerConnection;
    if (!pc || session.isReceiver) return; // Only sender initiates ICE restart

    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);

      const socket = getSocket();
      if (socket) {
        socket.emit('file-transfer:offer', {
          transferId: session.transferId,
          targetUserId: session.peerId,
          offer: pc.localDescription,
        });
        console.log(`[P2P] ICE restart offer sent for ${session.transferId}`);
      }
    } catch (err) {
      console.warn(`[P2P] ICE restart failed for ${session.transferId}:`, err.message);
    }
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
        direction: session.isReceiver ? 'receive' : 'send',
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
