/**
 * ============================================
 * P2P File Transfer Socket Handlers
 * ============================================
 * 
 * Signaling layer for WebRTC DataChannel file transfers.
 * 
 * FLOW:
 * 1. Sender → 'file-transfer:request' → Server → Receiver
 * 2. Receiver → 'file-transfer:accept' → Server → Sender
 * 3. Both establish WebRTC DataChannel (reuse signaling)
 * 4. Chunks flow P2P through DataChannel
 * 5. Progress updates sent to server for resume tracking
 * 6. On disconnect → server stores last chunk index
 * 7. On reconnect → 'file-transfer:resume' picks up where left off
 */

const FileTransfer = require('../models/FileTransfer');
const { socketGuard } = require('../security');
const { storePendingNotification, clearPendingFileTransferNotifications } = require('../controllers/pushController');

const setupFileTransferHandlers = (io, socket, onlineUsers) => {

  /**
   * DIAGNOSTIC EVENT — logs client-side P2P state for debugging
   */
  socket.on('file-transfer:diag', (data) => {
    // Build a human-readable summary based on event type
    const evt = data.event || '?';
    const side = data.side || '?';
    const tid = (data.transferId || '').slice(-12); // last 12 chars for readability
    let extra = '';
    if (evt === 'dc_open') {
      extra = ` | maxMsg=${data.maxMessageSize} | chunkSize=${data.chunkSize} | totalChunks=${data.totalChunks}`;
    } else if (evt === 'dc_close') {
      extra = ` | prevStatus=${data.prevStatus} | buffered=${data.buffered} | sigState=${data.signalingState}`;
    } else if (evt === 'dc_error' || evt === 'send_error') {
      extra = ` | error=${data.error} | buffered=${data.buffered}`;
    } else if (evt === 'chunk_sent') {
      extra = ` | chunk=${data.chunk}/${data.total} | buffered=${data.buffered} | bytes=${data.bytes}`;
    } else if (evt === 'chunk_send_failed' || evt === 'packet_too_large') {
      extra = ` | chunk=${data.chunk} | dcState=${data.dcState} | buffered=${data.buffered} | maxMsg=${data.maxMessageSize}`;
    } else if (evt === 'writer_init_start') {
      extra = ` | isElectron=${data.isElectron} | hasFSAAP=${data.hasFSAccessAPI} | isMobile=${data.isMobile}`;
    } else if (evt === 'writer_init_done') {
      extra = ` | mode=${data.mode} | totalChunks=${data.totalChunks}`;
    } else if (evt === 'first_chunk_received') {
      extra = ` | chunkIdx=${data.chunkIndex} | size=${data.chunkSize}`;
    } else if (evt === 'send_start') {
      extra = ` | hasFile=${data.hasFile} | fileType=${data.fileType} | constr=${data.fileConstructor} | fileName=${data.fileName} | fileSize=${data.fileSize} | hasDC=${data.hasDataChannel} | dcState=${data.dcState} | chunk=${data.currentChunk}/${data.totalChunks} | chunkSize=${data.chunkSize} | paused=${data.isPaused} | sessStatus=${data.sessionStatus}`;
    } else if (evt === 'send_early_return') {
      extra = ` | hasFile=${data.hasFile} | hasDC=${data.hasDC}`;
    } else if (evt === 'send_chunks_crash' || evt === 'send_chunks_outer_error') {
      extra = ` | error=${data.error} | chunk=${data.chunk} | status=${data.status} | stack=${(data.stack || '').substring(0, 150)}`;
    } else if (evt === 'chunk_processing_error') {
      extra = ` | chunk=${data.chunk} | error=${data.error} | dcState=${data.dcState}`;
    }
    console.log(`[FT DIAG] ${evt} | ${side} | ...${tid} | status=${data.status} | dc=${data.dc} | ice=${data.ice}${extra}`);
  });

  /**
   * REQUEST FILE TRANSFER
   * Sender initiates a transfer request to receiver
   */
  socket.on('file-transfer:request', async (data) => {
    try {
      const {
        transferId,
        receiverId,
        fileName,
        fileSize,
        fileMimeType,
        totalChunks,
        chunkSize,
        fileHash,
      } = data;

      // Validate
      if (!transferId || !receiverId || !fileName || !fileSize || !totalChunks) {
        socket.emit('file-transfer:error', {
          transferId,
          message: 'Missing required fields',
        });
        return;
      }

      // File size limit: 100GB
      if (fileSize > 107374182400) {
        socket.emit('file-transfer:error', {
          transferId,
          message: 'File exceeds 100GB limit',
        });
        return;
      }

      // Create transfer record
      const transfer = await FileTransfer.create({
        transferId,
        sender: socket.userId,
        receiver: receiverId,
        fileName,
        fileSize,
        fileMimeType: fileMimeType || 'application/octet-stream',
        totalChunks,
        chunkSize: chunkSize || 65536,
        fileHash: fileHash || null,
        status: 'pending',
      });

      // Notify receiver
      const receiverSocketId = onlineUsers.get(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('file-transfer:incoming', {
          transferId,
          senderId: socket.userId,
          senderName: socket.username,
          fileName,
          fileSize,
          fileMimeType,
          totalChunks,
          chunkSize: chunkSize || 65536,
          fileHash,
        });
      } else {
        // Receiver offline — transfer stays pending, will be notified on login
        socket.emit('file-transfer:peer-offline', {
          transferId,
          message: 'Receiver is offline. Transfer will be available when they come online.',
        });
      }

      // ALWAYS store a pending notification for native polling.
      // Even if receiver socket is connected, WebView JS may be suspended.
      // The native BackgroundService polls for these every 5 seconds.
      const sizeMB = (fileSize / 1048576).toFixed(1);
      storePendingNotification(receiverId, {
        type: 'file_transfer',
        title: `📁 ${socket.username} wants to send a file`,
        body: `${fileName} (${sizeMB} MB)`,
        data: {
          transferId,
          senderId: socket.userId,
          senderName: socket.username,
          fileName,
          fileSize,
          fileMimeType,
        },
      });

      console.log(`📁 File transfer request: ${socket.username} → ${receiverId} | ${fileName} (${(fileSize / 1048576).toFixed(1)}MB)`);
    } catch (err) {
      console.error('file-transfer:request error:', err);
      socket.emit('file-transfer:error', {
        transferId: data?.transferId,
        message: 'Failed to create transfer',
      });
    }
  });

  /**
   * ACCEPT FILE TRANSFER
   * Receiver accepts the transfer — initiate WebRTC DataChannel setup
   */
  socket.on('file-transfer:accept', async ({ transferId }) => {
    try {
      console.log(`[FT ACCEPT] Received accept | transferId=${transferId} | from=${socket.userId} (${socket.username})`);

      const transfer = await FileTransfer.findOne({ transferId, receiver: socket.userId });
      if (!transfer) {
        console.warn(`[FT ACCEPT] ⚠️ Transfer NOT FOUND in DB | transferId=${transferId} | receiver=${socket.userId}`);
        socket.emit('file-transfer:error', { transferId, message: 'Transfer not found' });
        return;
      }

      console.log(`[FT ACCEPT] Transfer found | sender=${transfer.sender} | receiver=${transfer.receiver} | status=${transfer.status}`);

      // If already accepted, treat as idempotent — don't error
      if (transfer.status === 'accepted') {
        console.log(`[FT ACCEPT] Transfer already accepted — idempotent, ignoring duplicate`);
        return;
      }

      if (transfer.status !== 'pending' && transfer.status !== 'paused') {
        console.warn(`[FT ACCEPT] ⚠️ Cannot accept — wrong status: ${transfer.status}`);
        socket.emit('file-transfer:error', { transferId, message: `Cannot accept: status is ${transfer.status}` });
        return;
      }

      transfer.status = 'accepted';
      transfer.acceptedAt = new Date();
      await transfer.save();

      // Clear file transfer pending notifications (accepted)
      clearPendingFileTransferNotifications(socket.userId);

      // Notify sender to start DataChannel setup
      const senderId = transfer.sender.toString();
      const senderSocketId = onlineUsers.get(senderId);
      console.log(`[FT ACCEPT] Looking up sender | senderId=${senderId} | senderSocketId=${senderSocketId || 'NOT FOUND'} | onlineUsers size=${onlineUsers.size}`);

      if (senderSocketId) {
        io.to(senderSocketId).emit('file-transfer:accepted', {
          transferId,
          receiverId: socket.userId,
          receiverName: socket.username,
          // Send resume info if applicable
          lastReceivedChunk: transfer.lastReceivedChunk,
        });
        console.log(`[FT ACCEPT] ✅ Emitted file-transfer:accepted to sender | socketId=${senderSocketId}`);
      } else {
        console.error(`[FT ACCEPT] ❌ Sender NOT in onlineUsers! senderId=${senderId} | onlineUsers keys:`, [...onlineUsers.keys()]);
        // Fallback: try to find sender by checking all sockets
        socket.emit('file-transfer:error', { transferId, message: 'Sender appears to be offline' });
      }

      console.log(`📁 File transfer accepted: ${socket.username} accepted ${transferId}`);
    } catch (err) {
      console.error('file-transfer:accept error:', err);
    }
  });

  /**
   * REJECT FILE TRANSFER
   */
  socket.on('file-transfer:reject', async ({ transferId, reason }) => {
    try {
      const transfer = await FileTransfer.findOne({ transferId, receiver: socket.userId });
      if (!transfer) return;

      // Clear file transfer pending notifications (rejected)
      clearPendingFileTransferNotifications(socket.userId);

      transfer.status = 'cancelled';
      transfer.statusReason = reason || 'Rejected by receiver';
      await transfer.save();

      const senderSocketId = onlineUsers.get(transfer.sender.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit('file-transfer:rejected', {
          transferId,
          reason: reason || 'Transfer rejected',
        });
      }
    } catch (err) {
      console.error('file-transfer:reject error:', err);
    }
  });

  /**
   * CANCEL FILE TRANSFER (either party)
   */
  socket.on('file-transfer:cancel', async ({ transferId }) => {
    try {
      const transfer = await FileTransfer.findOne({
        transferId,
        $or: [{ sender: socket.userId }, { receiver: socket.userId }],
      });
      if (!transfer) return;

      transfer.status = 'cancelled';
      transfer.statusReason = `Cancelled by ${socket.username}`;
      await transfer.save();

      // Notify the other party
      const otherUserId = transfer.sender.toString() === socket.userId
        ? transfer.receiver.toString()
        : transfer.sender.toString();
      const otherSocketId = onlineUsers.get(otherUserId);

      if (otherSocketId) {
        io.to(otherSocketId).emit('file-transfer:cancelled', {
          transferId,
          cancelledBy: socket.userId,
          reason: `Cancelled by ${socket.username}`,
        });
      }

      console.log(`📁 File transfer cancelled: ${transferId} by ${socket.username}`);
    } catch (err) {
      console.error('file-transfer:cancel error:', err);
    }
  });

  /**
   * PROGRESS UPDATE
   * Receiver periodically reports progress to server (for resume capability)
   * Sent every N chunks (e.g., every 100 chunks) to avoid overwhelming the server
   */
  socket.on('file-transfer:progress', async ({ transferId, lastReceivedChunk, bytesTransferred, speedBps }) => {
    try {
      // Only update if transfer is NOT in a terminal state (completed/cancelled/failed)
      // This prevents late progress events from reverting a completed transfer
      await FileTransfer.updateOne(
        { transferId, status: { $nin: ['completed', 'cancelled', 'failed', 'expired'] } },
        {
          $set: {
            lastReceivedChunk,
            bytesTransferred: bytesTransferred || 0,
            lastSpeedBps: speedBps || 0,
            status: 'transferring',
          },
        }
      );

      // Notify sender about receiver's progress (for UI)
      const transfer = await FileTransfer.findOne({ transferId }).lean();
      if (transfer) {
        const senderSocketId = onlineUsers.get(transfer.sender.toString());
        if (senderSocketId) {
          io.to(senderSocketId).emit('file-transfer:progress-ack', {
            transferId,
            lastReceivedChunk,
            bytesTransferred,
            speedBps,
          });
        }
      }
    } catch (err) {
      console.error('file-transfer:progress error:', err);
    }
  });

  /**
   * TRANSFER COMPLETE
   * Receiver confirms all chunks received and verified
   */
  socket.on('file-transfer:complete', async ({ transferId, verified, hashMatch }) => {
    try {
      const transfer = await FileTransfer.findOne({ transferId });
      if (!transfer) return;

      transfer.status = 'completed';
      transfer.completedAt = new Date();
      transfer.bytesTransferred = transfer.fileSize;
      transfer.lastReceivedChunk = transfer.totalChunks - 1;
      if (typeof hashMatch === 'boolean') {
        transfer.hashVerified = hashMatch;
      }
      await transfer.save();

      // Notify sender (include verification result)
      const senderSocketId = onlineUsers.get(transfer.sender.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit('file-transfer:completed', {
          transferId,
          verified: verified || false,
          hashMatch: hashMatch != null ? hashMatch : null,
        });
      }

      const verifyStr = hashMatch === true ? ' [VERIFIED]' : hashMatch === false ? ' [HASH MISMATCH]' : '';
      console.log(`📁 File transfer completed: ${transferId} (${transfer.fileName})${verifyStr}`);
    } catch (err) {
      console.error('file-transfer:complete error:', err);
    }
  });

  /**
   * SENDER DONE — sender confirms all chunks sent
   * This acts as a backup signal: if the DataChannel completion marker
   * is lost (common on mobile), the server relays this to the receiver
   * so it can auto-finalize.
   */
  socket.on('file-transfer:sender-done', async ({ transferId }) => {
    try {
      const transfer = await FileTransfer.findOne({ transferId, sender: socket.userId });
      if (!transfer) return;

      // Only relay if transfer is still in progress (not already completed)
      if (transfer.status === 'completed') return;

      // Notify receiver that sender has finished sending all chunks
      const receiverSocketId = onlineUsers.get(transfer.receiver.toString());
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('file-transfer:sender-finished', {
          transferId,
          totalChunks: transfer.totalChunks,
        });
        console.log(`📁 Sender done signal relayed to receiver: ${transferId}`);
      }
    } catch (err) {
      console.error('file-transfer:sender-done error:', err);
    }
  });

  /**
   * RESUME REQUEST
   * When a user reconnects, check for paused/interrupted transfers
   */
  socket.on('file-transfer:check-pending', async () => {
    try {
      // Auto-expire stale pending transfers older than 5 minutes
      // (sender probably left or app was closed — file no longer in memory)
      const pendingStaleThreshold = new Date(Date.now() - 5 * 60 * 1000);
      await FileTransfer.updateMany(
        {
          status: 'pending',
          updatedAt: { $lt: pendingStaleThreshold },
        },
        { $set: { status: 'expired', statusReason: 'Auto-expired pending after 5 minutes' } }
      );

      // Auto-expire stale paused transfers older than 24 hours
      const pausedStaleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await FileTransfer.updateMany(
        {
          status: 'paused',
          updatedAt: { $lt: pausedStaleThreshold },
        },
        { $set: { status: 'expired', statusReason: 'Auto-expired paused after 24 hours' } }
      );

      // Find transfers where this user is the RECEIVER and status is resumable
      const transfers = await FileTransfer.find({
        receiver: socket.userId,
        status: { $in: ['pending', 'paused'] },
      })
        .select('+fileHash')
        .populate('sender', 'username avatar')
        .populate('receiver', 'username avatar')
        .lean();

      // CRITICAL: Only show pending transfers if the sender is currently online
      // (stale pending = sender left/reloaded, file no longer in memory)
      const validTransfers = transfers.filter(t => {
        if (t.status === 'pending') {
          const senderId = t.sender?._id?.toString() || t.sender?.toString();
          const senderOnline = senderId && onlineUsers.has(senderId);
          if (!senderOnline) {
            // Auto-cancel this stale pending transfer
            FileTransfer.updateOne(
              { _id: t._id },
              { $set: { status: 'cancelled', statusReason: 'Sender offline — auto-cancelled' } }
            ).catch(() => {});
            return false;
          }
        }
        return true;
      });

      if (validTransfers.length > 0) {
        socket.emit('file-transfer:pending-list', { transfers: validTransfers });
        console.log(`📁 Sent ${validTransfers.length} pending transfers to ${socket.username} (filtered ${transfers.length - validTransfers.length} stale)`);
      }

      // Auto-cancel any sender-side transfers that are stuck
      // (sender restarted app — file is no longer in memory)
      const senderStuck = await FileTransfer.updateMany(
        {
          sender: socket.userId,
          status: { $in: ['accepted', 'transferring'] },
          updatedAt: { $lt: pendingStaleThreshold },
        },
        { $set: { status: 'failed', statusReason: 'Sender reconnected without file — auto-cancelled' } }
      );
      if (senderStuck.modifiedCount > 0) {
        console.log(`📁 Auto-cancelled ${senderStuck.modifiedCount} stale sender transfers for ${socket.username}`);
      }
    } catch (err) {
      console.error('file-transfer:check-pending error:', err);
    }
  });

  /**
   * RESUME TRANSFER
   * After reconnection, sender wants to resume from last known chunk
   */
  socket.on('file-transfer:resume', async ({ transferId }) => {
    try {
      const transfer = await FileTransfer.findOne({
        transferId,
        $or: [{ sender: socket.userId }, { receiver: socket.userId }],
        status: { $in: ['transferring', 'paused', 'accepted', 'pending'] },
      });

      if (!transfer) {
        socket.emit('file-transfer:error', { transferId, message: 'Transfer not found or not resumable' });
        return;
      }

      const isSender = transfer.sender.toString() === socket.userId;
      const isReceiver = transfer.receiver.toString() === socket.userId;

      // Sender is trying to resume — they still have the file in memory
      // (auto-resume from background). Need to notify receiver to set up their side.
      if (isSender) {
        const receiverSocketId = onlineUsers.get(transfer.receiver.toString());
        const peerOnline = !!receiverSocketId;

        if (peerOnline) {
          // Update status to accepted — sender has file, receiver is online
          transfer.status = 'accepted';
          transfer.pausedAt = null;
          await transfer.save();

          // Tell receiver to set up their side (shows as resume-request)
          io.to(receiverSocketId).emit('file-transfer:resume-request', {
            transferId,
            requestedBy: socket.userId,
            requestedByName: socket.username,
            fileName: transfer.fileName,
            fileSize: transfer.fileSize,
            totalChunks: transfer.totalChunks,
            chunkSize: transfer.chunkSize,
            resumeFrom: transfer.lastReceivedChunk + 1,
            fileHash: transfer.fileHash || null,
          });
        }

        socket.emit('file-transfer:resume-info', {
          transferId,
          resumeFrom: transfer.lastReceivedChunk + 1,
          totalChunks: transfer.totalChunks,
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          chunkSize: transfer.chunkSize,
          peerOnline,
          role: 'sender',
        });
        console.log(`📁 File transfer resume (sender): ${transferId} from chunk ${transfer.lastReceivedChunk + 1} | receiverOnline=${peerOnline}`);
        return;
      }

      // Receiver is resuming
      transfer.status = 'accepted';
      transfer.pausedAt = null;
      await transfer.save();

      const senderSocketId = onlineUsers.get(transfer.sender.toString());

      if (senderSocketId) {
        // Tell the SENDER that the receiver is ready to resume
        // Use file-transfer:accepted (NOT resume-request) to trigger
        // sender-side DataChannel setup without showing a new popup
        io.to(senderSocketId).emit('file-transfer:accepted', {
          transferId,
          receiverId: socket.userId,
          receiverName: socket.username,
          lastReceivedChunk: transfer.lastReceivedChunk,
        });

        socket.emit('file-transfer:resume-info', {
          transferId,
          resumeFrom: transfer.lastReceivedChunk + 1,
          totalChunks: transfer.totalChunks,
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          chunkSize: transfer.chunkSize,
          peerOnline: true,
          role: 'receiver',
        });
      } else {
        transfer.status = 'paused';
        transfer.pausedAt = new Date();
        await transfer.save();

        socket.emit('file-transfer:resume-info', {
          transferId,
          resumeFrom: transfer.lastReceivedChunk + 1,
          peerOnline: false,
          role: 'receiver',
          message: 'Sender is offline. Transfer will resume when they reconnect.',
        });
      }

      console.log(`📁 File transfer resume (receiver): ${transferId} from chunk ${transfer.lastReceivedChunk + 1}`);
    } catch (err) {
      console.error('file-transfer:resume error:', err);
    }
  });

  /**
   * PAUSE TRANSFER
   */
  socket.on('file-transfer:pause', async ({ transferId }) => {
    try {
      const transfer = await FileTransfer.findOne({
        transferId,
        $or: [{ sender: socket.userId }, { receiver: socket.userId }],
      });
      if (!transfer) return;

      transfer.status = 'paused';
      transfer.pausedAt = new Date();
      await transfer.save();

      // Notify other party
      const isSender = transfer.sender.toString() === socket.userId;
      const otherUserId = isSender ? transfer.receiver.toString() : transfer.sender.toString();
      const otherSocketId = onlineUsers.get(otherUserId);

      if (otherSocketId) {
        io.to(otherSocketId).emit('file-transfer:paused', {
          transferId,
          pausedBy: socket.userId,
          pausedByName: socket.username,
        });
      }
    } catch (err) {
      console.error('file-transfer:pause error:', err);
    }
  });

  /**
   * WebRTC signaling for file transfer DataChannel
   * Separate from call signaling to avoid conflicts
   */
  socket.on('file-transfer:offer', ({ transferId, targetUserId, offer }) => {
    // Count candidates in SDP for diagnostics
    const sdp = offer?.sdp || '';
    const candidates = sdp.split('\n').filter(l => l.startsWith('a=candidate:'));
    const host = candidates.filter(l => l.includes('typ host')).length;
    const srflx = candidates.filter(l => l.includes('typ srflx')).length;
    const relay = candidates.filter(l => l.includes('typ relay')).length;
    console.log(`[FT SIGNAL] offer received | from=${socket.userId} | target=${targetUserId} | transferId=${transferId} | ICE: host=${host} srflx=${srflx} relay=${relay} total=${candidates.length}`);
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      console.log(`[FT SIGNAL] offer relayed | targetSocket=${targetSocketId}`);
      io.to(targetSocketId).emit('file-transfer:offer', {
        transferId,
        senderId: socket.userId,
        offer,
      });
    } else {
      console.warn(`[FT SIGNAL] ⚠️ offer DROPPED — target ${targetUserId} NOT in onlineUsers | onlineUsers keys:`, [...onlineUsers.keys()]);
      socket.emit('file-transfer:error', { transferId, message: 'Receiver is offline' });
    }
  });

  socket.on('file-transfer:answer', ({ transferId, targetUserId, answer }) => {
    // Count candidates in SDP for diagnostics
    const sdp = answer?.sdp || '';
    const candidates = sdp.split('\n').filter(l => l.startsWith('a=candidate:'));
    const host = candidates.filter(l => l.includes('typ host')).length;
    const srflx = candidates.filter(l => l.includes('typ srflx')).length;
    const relay = candidates.filter(l => l.includes('typ relay')).length;
    console.log(`[FT SIGNAL] answer received | from=${socket.userId} | target=${targetUserId} | transferId=${transferId} | ICE: host=${host} srflx=${srflx} relay=${relay} total=${candidates.length}`);
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      console.log(`[FT SIGNAL] answer relayed | targetSocket=${targetSocketId}`);
      io.to(targetSocketId).emit('file-transfer:answer', {
        transferId,
        senderId: socket.userId,
        answer,
      });
    } else {
      console.warn(`[FT SIGNAL] ⚠️ answer DROPPED — target ${targetUserId} NOT in onlineUsers`);
    }
  });

  socket.on('file-transfer:ice-candidate', ({ transferId, targetUserId, candidate }) => {
    console.log(`[FT SIGNAL] ICE candidate received | from=${socket.userId} | target=${targetUserId} | transferId=${transferId} | candidate=${candidate?.candidate?.substring(0, 50)}`);
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
      console.log(`[FT SIGNAL] ICE candidate relayed | targetSocket=${targetSocketId}`);
      io.to(targetSocketId).emit('file-transfer:ice-candidate', {
        transferId,
        senderId: socket.userId,
        candidate,
      });
    } else {
      console.warn(`[FT SIGNAL] ⚠️ ICE candidate DROPPED — target ${targetUserId} NOT in onlineUsers | transferId=${transferId}`);
    }
  });

  /**
   * On disconnect — pause all active transfers for this user
   * IMPORTANT: Must be fault-tolerant — if MongoDB is temporarily
   * disconnected (e.g. during server restart), this should NOT crash
   * or cause PM2 to restart the process.
   */
  socket.on('disconnect', async () => {
    try {
      const mongoose = require('mongoose');
      // Skip DB operation if mongoose is not connected
      if (mongoose.connection.readyState !== 1) {
        console.warn(`📁 Skipping file-transfer disconnect cleanup for ${socket.username} — MongoDB not connected (state: ${mongoose.connection.readyState})`);
        return;
      }

      // PAUSE active transfers (NOT cancel!) so they can be resumed.
      // P2P DataChannel dies on disconnect, but both sides can re-establish
      // when the disconnected user comes back online.
      const activeTransfers = await FileTransfer.find({
        $or: [{ sender: socket.userId }, { receiver: socket.userId }],
        status: { $in: ['transferring', 'accepted'] },
      }).lean();

      if (activeTransfers.length > 0) {
        await FileTransfer.updateMany(
          {
            _id: { $in: activeTransfers.map(t => t._id) },
          },
          {
            $set: {
              status: 'paused',
              pausedAt: new Date(),
              statusReason: 'Peer disconnected — will resume on reconnect',
            },
          }
        );

        // Notify the ONLINE peer that transfer is paused (so their UI updates)
        for (const t of activeTransfers) {
          const isSender = t.sender.toString() === socket.userId;
          const otherUserId = isSender ? t.receiver.toString() : t.sender.toString();
          const otherSocketId = onlineUsers.get(otherUserId);
          if (otherSocketId) {
            io.to(otherSocketId).emit('file-transfer:paused', {
              transferId: t.transferId,
              pausedBy: socket.userId,
              pausedByName: socket.username,
              reason: 'peer_disconnected',
            });
          }
        }

        console.log(`📁 Paused ${activeTransfers.length} active transfers for disconnected user ${socket.username} (resumable)`);
      }

      // Cancel PENDING transfers only when SENDER disconnects.
      // The file lives in sender's memory — if sender leaves, it's gone.
      // Do NOT cancel when receiver disconnects — they may reconnect
      // and accept via background notification.
      const pendingSenderResult = await FileTransfer.updateMany(
        {
          sender: socket.userId,
          status: 'pending',
        },
        {
          $set: {
            status: 'cancelled',
            pausedAt: new Date(),
            statusReason: 'Sender disconnected — file no longer available',
          },
        }
      );

      if (pendingSenderResult.modifiedCount > 0) {
        console.log(`📁 Cancelled ${pendingSenderResult.modifiedCount} pending sender transfers for ${socket.username}`);
      }
    } catch (err) {
      // Log but never crash — this is non-critical cleanup
      console.warn('file-transfer disconnect cleanup error (non-fatal):', err.message);
    }
  });
};

module.exports = setupFileTransferHandlers;
