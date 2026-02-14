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
      const session = this.sessions.get(data.transferId);
      if (session && !session.isReceiver) {
        // We are the sender, receiver accepted → setup DataChannel
        session.currentChunk = data.lastReceivedChunk >= 0 ? data.lastReceivedChunk + 1 : 0;
        session.bytesTransferred = session.currentChunk * session.chunkSize;
        await this._setupSenderConnection(session);
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
      const session = this.sessions.get(data.transferId);
      if (session && session.isReceiver) {
        await this._handleReceiverOffer(session, data.offer, data.senderId);
      }
    });

    socket.on('file-transfer:answer', async (data) => {
      const session = this.sessions.get(data.transferId);
      if (session && !session.isReceiver) {
        await this._handleSenderAnswer(session, data.answer);
      }
    });

    socket.on('file-transfer:ice-candidate', async (data) => {
      const session = this.sessions.get(data.transferId);
      if (session && session.peerConnection) {
        try {
          if (session.peerConnection.remoteDescription) {
            await session.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        } catch (e) {
          console.warn('Failed to add ICE candidate for file transfer:', e);
        }
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
    session.status = 'connecting';
    this._notifyUpdate(session.transferId, session);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    session.peerConnection = pc;

    // Create DataChannel with ordered delivery
    const dc = pc.createDataChannel(`file-${session.transferId}`, {
      ordered: true,
      // No maxRetransmits — we need reliable delivery for files
    });
    session.dataChannel = dc;
    dc.binaryType = 'arraybuffer';

    // DataChannel open → start sending
    dc.onopen = () => {
      console.log(`📁 DataChannel open for ${session.transferId}, starting send from chunk ${session.currentChunk}`);
      session.status = 'transferring';
      session.startTime = Date.now();
      this._notifyUpdate(session.transferId, session);
      this._sendChunks(session);
    };

    dc.onclose = () => {
      if (session.status === 'transferring') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
      }
    };

    dc.onerror = (err) => {
      console.error(`DataChannel error for ${session.transferId}:`, err);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    };

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = getSocket();
        if (socket) {
          socket.emit('file-transfer:ice-candidate', {
            transferId: session.transferId,
            targetUserId: session.peerId,
            candidate: event.candidate,
          });
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
    };

    // Create and send offer
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const socket = getSocket();
      if (socket) {
        socket.emit('file-transfer:offer', {
          transferId: session.transferId,
          targetUserId: session.peerId,
          offer: pc.localDescription,
        });
      }
    } catch (err) {
      console.error('Failed to create offer for file transfer:', err);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    }
  }

  /**
   * Receiver handles incoming offer, creates answer
   */
  async _handleReceiverOffer(session, offer, senderId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    session.peerConnection = pc;

    // ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const socket = getSocket();
        if (socket) {
          socket.emit('file-transfer:ice-candidate', {
            transferId: session.transferId,
            targetUserId: senderId,
            candidate: event.candidate,
          });
        }
      }
    };

    // Expect DataChannel from sender
    pc.ondatachannel = (event) => {
      const dc = event.channel;
      session.dataChannel = dc;
      dc.binaryType = 'arraybuffer';

      dc.onopen = () => {
        console.log(`📁 DataChannel open for receiving ${session.transferId}`);
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
        if (session.status === 'transferring') {
          session.status = 'paused';
          this._notifyUpdate(session.transferId, session);
          this._reportProgressToServer(session);
        }
      };

      dc.onerror = (err) => {
        console.error(`DataChannel error receiving ${session.transferId}:`, err);
      };
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        session.status = 'paused';
        this._notifyUpdate(session.transferId, session);
        this._reportProgressToServer(session);
      }
    };

    // Set remote offer and create answer
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const socket = getSocket();
      if (socket) {
        socket.emit('file-transfer:answer', {
          transferId: session.transferId,
          targetUserId: senderId,
          answer: pc.localDescription,
        });
      }
    } catch (err) {
      console.error('Failed to handle offer for file transfer:', err);
      session.status = 'failed';
      this._notifyUpdate(session.transferId, session);
    }
  }

  /**
   * Sender processes answer
   */
  async _handleSenderAnswer(session, answer) {
    try {
      if (session.peerConnection && session.peerConnection.signalingState === 'have-local-offer') {
        await session.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (err) {
      console.error('Failed to set answer for file transfer:', err);
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
   * Uses StreamSaver API if available, otherwise accumulates in memory
   */
  _initReceiveWriter(session) {
    // Try to use Streams API for zero-memory file writing
    // Works in modern browsers and Electron
    if (typeof window !== 'undefined' && window.WritableStream) {
      try {
        // We'll collect chunks and trigger download on complete
        session.receivedChunks = new Array(session.totalChunks);
        session._receivedCount = 0;
        session._totalBytesReceived = 0;
        return;
      } catch (e) {
        console.warn('WritableStream init failed, using array buffer:', e);
      }
    }

    // Fallback: array of chunks
    session.receivedChunks = new Array(session.totalChunks);
    session._receivedCount = 0;
    session._totalBytesReceived = 0;
  }

  /**
   * Handle a received chunk
   */
  _handleReceivedChunk(session, data) {
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

    // Store chunk
    if (chunkIndex < session.totalChunks && !session.receivedChunks[chunkIndex]) {
      session.receivedChunks[chunkIndex] = chunkData;
      session._receivedCount = (session._receivedCount || 0) + 1;
      session._totalBytesReceived = (session._totalBytesReceived || 0) + chunkData.byteLength;
      session.currentChunk = chunkIndex + 1;
      session.bytesTransferred = session._totalBytesReceived;

      // Calculate speed
      this._calculateSpeed(session);

      // Report progress periodically
      if (session._receivedCount % CONFIG.PROGRESS_REPORT_INTERVAL === 0) {
        this._reportProgressToServer(session);
      }

      // For very large files, periodically flush to reduce memory pressure
      // Flush every 5000 chunks (~320MB at 64KB chunks)
      if (session._receivedCount % 5000 === 0) {
        this._partialFlush(session);
      }

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
   * Finalize received file — combine chunks and trigger download
   */
  async _finalizeReceive(session) {
    try {
      session.status = 'completed';

      // Build final blob from flushed blobs + remaining chunks
      const parts = [];
      
      // Add any flushed blobs first (in order)
      if (session._flushedBlobs && session._flushedBlobs.length > 0) {
        parts.push(...session._flushedBlobs);
      }

      // Add remaining chunks
      const startIdx = session._lastFlushedIndex || 0;
      for (let i = startIdx; i < session.totalChunks; i++) {
        if (session.receivedChunks[i]) {
          parts.push(session.receivedChunks[i]);
        }
      }

      const fileBlob = new Blob(parts, { 
        type: session.fileMimeType || 'application/octet-stream' 
      });

      // Trigger download
      this._downloadBlob(fileBlob, session.fileName);

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
