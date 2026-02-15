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

const setupFileTransferHandlers = (io, socket, onlineUsers) => {

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

      if (transfer.status !== 'pending' && transfer.status !== 'paused') {
        console.warn(`[FT ACCEPT] ⚠️ Cannot accept — wrong status: ${transfer.status}`);
        socket.emit('file-transfer:error', { transferId, message: `Cannot accept: status is ${transfer.status}` });
        return;
      }

      transfer.status = 'accepted';
      transfer.acceptedAt = new Date();
      await transfer.save();

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
      await FileTransfer.updateOne(
        { transferId },
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
  socket.on('file-transfer:complete', async ({ transferId, verified }) => {
    try {
      const transfer = await FileTransfer.findOne({ transferId });
      if (!transfer) return;

      transfer.status = 'completed';
      transfer.completedAt = new Date();
      transfer.bytesTransferred = transfer.fileSize;
      transfer.lastReceivedChunk = transfer.totalChunks - 1;
      await transfer.save();

      // Notify sender
      const senderSocketId = onlineUsers.get(transfer.sender.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit('file-transfer:completed', {
          transferId,
          verified: verified || false,
        });
      }

      console.log(`📁 File transfer completed: ${transferId} (${transfer.fileName})`);
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
      // Auto-expire stale pending/paused transfers older than 24 hours
      const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await FileTransfer.updateMany(
        {
          status: { $in: ['pending', 'paused'] },
          updatedAt: { $lt: staleThreshold },
        },
        { $set: { status: 'expired', statusReason: 'Auto-expired after 24 hours' } }
      );

      // Find ONLY transfers where this user is the RECEIVER and status is resumable
      // Sender-side transfers cannot be resumed from client (file no longer in memory)
      const transfers = await FileTransfer.find({
        receiver: socket.userId,
        status: { $in: ['pending', 'paused'] },
        updatedAt: { $gte: staleThreshold },
      })
        .populate('sender', 'username avatar')
        .populate('receiver', 'username avatar')
        .lean();

      if (transfers.length > 0) {
        socket.emit('file-transfer:pending-list', { transfers });
      }

      // Auto-cancel any sender-side transfers that are stuck
      // (sender restarted app — file is no longer in memory)
      const senderStuck = await FileTransfer.updateMany(
        {
          sender: socket.userId,
          status: { $in: ['accepted', 'transferring'] },
          updatedAt: { $lt: staleThreshold },
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
        status: { $in: ['transferring', 'paused', 'accepted'] },
      });

      if (!transfer) {
        socket.emit('file-transfer:error', { transferId, message: 'Transfer not found or not resumable' });
        return;
      }

      const isSender = transfer.sender.toString() === socket.userId;
      const isReceiver = transfer.receiver.toString() === socket.userId;

      // ONLY the receiver should emit resume. The sender needs the file
      // in memory — if sender app restarted, they can't resume.
      if (isSender) {
        // Sender is trying to resume — check if they actually have a live
        // session. Since we can't verify client state from server, just
        // send resume-info back. Do NOT send resume-request to receiver
        // (that would cause the accept-loop).
        socket.emit('file-transfer:resume-info', {
          transferId,
          resumeFrom: transfer.lastReceivedChunk + 1,
          totalChunks: transfer.totalChunks,
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          chunkSize: transfer.chunkSize,
          peerOnline: !!onlineUsers.get(transfer.receiver.toString()),
          role: 'sender',
        });
        console.log(`📁 File transfer resume (sender): ${transferId} from chunk ${transfer.lastReceivedChunk + 1}`);
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
    console.log(`[FT SIGNAL] offer received | from=${socket.userId} | target=${targetUserId} | transferId=${transferId}`);
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
    console.log(`[FT SIGNAL] answer received | from=${socket.userId} | target=${targetUserId} | transferId=${transferId}`);
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
    const targetSocketId = onlineUsers.get(targetUserId);
    if (targetSocketId) {
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

      const result = await FileTransfer.updateMany(
        {
          $or: [{ sender: socket.userId }, { receiver: socket.userId }],
          status: { $in: ['transferring', 'accepted'] },
        },
        {
          $set: {
            status: 'paused',
            pausedAt: new Date(),
            statusReason: 'Peer disconnected',
          },
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`📁 Paused ${result.modifiedCount} transfers for disconnected user ${socket.username}`);
      }
    } catch (err) {
      // Log but never crash — this is non-critical cleanup
      console.warn('file-transfer disconnect cleanup error (non-fatal):', err.message);
    }
  });
};

module.exports = setupFileTransferHandlers;
