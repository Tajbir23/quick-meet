/**
 * ============================================
 * Channel Socket Handlers — Telegram-Style
 * ============================================
 * 
 * Real-time events for channels:
 * - Join/leave socket rooms
 * - Live stream signaling (WebRTC)
 * - Live chat during streams
 * - Typing indicators for comments
 * - Real-time viewer count
 * - Scheduled post publishing
 */

const Channel = require('../models/Channel');
const ChannelMessage = require('../models/ChannelMessage');
const socketGuard = require('../security/SocketGuard');

const setupChannelHandlers = (io, socket, onlineUsers) => {
  const userId = socket.userId;
  const username = socket.username;

  // ─── JOIN CHANNEL ROOM ────────────────────
  socket.on('channel:join-room', socketGuard.wrapHandler(socket, async ({ channelId }) => {
    if (!channelId) return;
    socket.join(`channel:${channelId}`);
    console.log(`📺 ${username} joined channel room: ${channelId}`);
  }));

  // ─── LEAVE CHANNEL ROOM ──────────────────
  socket.on('channel:leave-room', socketGuard.wrapHandler(socket, async ({ channelId }) => {
    if (!channelId) return;
    socket.leave(`channel:${channelId}`);
    console.log(`📺 ${username} left channel room: ${channelId}`);
  }));

  // ─── JOIN LIVE ROOM (broadcaster + viewer) ────
  socket.on('channel:join-live-room', socketGuard.wrapHandler(socket, async ({ channelId }) => {
    if (!channelId) return;
    socket.join(`channel-live:${channelId}`);
    console.log(`📺 ${username} joined live room: ${channelId}`);
  }));

  // ─── LIVE STREAM: WebRTC Signaling ────────
  // Broadcaster sends offer to the channel
  socket.on('channel:live-stream-offer', socketGuard.wrapHandler(socket, async ({ channelId, offer }) => {
    if (!channelId || !offer) return;

    try {
      const channel = await Channel.findById(channelId);
      if (!channel || !channel.canManageLiveStream(userId)) return;

      // Store offer for late joiners
      if (!io._channelStreamOffers) io._channelStreamOffers = {};
      io._channelStreamOffers[channelId] = {
        offer,
        broadcaster: socket.id,
        broadcasterId: userId,
      };

      // Broadcast to all viewers in the live room
      socket.to(`channel-live:${channelId}`).emit('channel:live-stream-offer', {
        channelId,
        offer,
        broadcasterId: userId,
      });
    } catch (err) {
      console.error('Live stream offer error:', err);
    }
  }));

  // Viewer sends answer to broadcaster
  socket.on('channel:live-stream-answer', socketGuard.wrapHandler(socket, async ({ channelId, answer, broadcasterId }) => {
    if (!channelId || !answer || !broadcasterId) return;

    const broadcasterSocketId = onlineUsers.get(broadcasterId);
    if (broadcasterSocketId) {
      io.to(broadcasterSocketId).emit('channel:live-stream-answer', {
        channelId,
        answer,
        viewerId: userId,
        viewerSocketId: socket.id,
      });
    }
  }));

  // ICE candidates for live stream — broadcast to the live room
  socket.on('channel:live-stream-ice', socketGuard.wrapHandler(socket, async ({ channelId, candidate, targetId }) => {
    if (!channelId || !candidate) return;

    if (targetId) {
      // Direct ICE to specific user
      const targetSocketId = onlineUsers.get(targetId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('channel:live-stream-ice', {
          channelId,
          candidate,
          fromId: userId,
        });
      }
    } else {
      // Broadcast ICE to all in the live room (for 1-to-many)
      socket.to(`channel-live:${channelId}`).emit('channel:live-stream-ice', {
        channelId,
        candidate,
        fromId: userId,
      });
    }
  }));

  // Request current stream offer (late joiner)
  socket.on('channel:live-stream-request-offer', socketGuard.wrapHandler(socket, async ({ channelId }) => {
    if (!channelId) return;

    // Auto-join the live room
    socket.join(`channel-live:${channelId}`);

    const stored = io._channelStreamOffers?.[channelId];
    if (stored) {
      socket.emit('channel:live-stream-offer', {
        channelId,
        offer: stored.offer,
        broadcasterId: stored.broadcasterId,
      });
    }
  }));

  // ─── LIVE STREAM CHAT ────────────────────
  socket.on('channel:live-chat-message', socketGuard.wrapHandler(socket, async ({ channelId, content }) => {
    if (!channelId || !content) return;

    try {
      const channel = await Channel.findById(channelId);
      if (!channel || !channel.liveStream.isLive || !channel.liveStream.chatEnabled) return;
      if (!channel.isMember(userId)) return;

      io.to(`channel-live:${channelId}`).emit('channel:live-chat-message', {
        channelId,
        message: {
          senderId: userId,
          senderName: username,
          content,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('Live chat message error:', err);
    }
  }));

  // ─── TYPING INDICATOR (for comments) ─────
  socket.on('channel:typing-start', socketGuard.wrapHandler(socket, ({ channelId, postId }) => {
    if (!channelId) return;
    socket.to(`channel:${channelId}`).emit('channel:typing', {
      channelId,
      postId,
      userId,
      username,
      isTyping: true,
    });
  }));

  socket.on('channel:typing-stop', socketGuard.wrapHandler(socket, ({ channelId, postId }) => {
    if (!channelId) return;
    socket.to(`channel:${channelId}`).emit('channel:typing', {
      channelId,
      postId,
      userId,
      username,
      isTyping: false,
    });
  }));

  // ─── VIEW TRACKING ───────────────────────
  socket.on('channel:mark-viewed', socketGuard.wrapHandler(socket, async ({ postIds }) => {
    if (!postIds || !Array.isArray(postIds)) return;

    try {
      // Bulk update views (fire-and-forget)
      ChannelMessage.updateMany(
        { _id: { $in: postIds }, viewedBy: { $ne: userId } },
        { $inc: { views: 1 }, $addToSet: { viewedBy: userId } }
      ).catch(() => {});
    } catch (err) {
      console.error('Mark viewed error:', err);
    }
  }));
};

// ─── SCHEDULED POST PUBLISHER ───────────────
// Run every 30 seconds to check for due scheduled posts
let scheduledPostInterval = null;

const startScheduledPostPublisher = (io) => {
  if (scheduledPostInterval) return;

  scheduledPostInterval = setInterval(async () => {
    try {
      const now = new Date();
      const duePosts = await ChannelMessage.find({
        isScheduled: true,
        scheduledFor: { $lte: now },
        isDeleted: false,
      }).populate('sender', 'username avatar');

      for (const post of duePosts) {
        post.isScheduled = false;
        post.scheduledFor = null;
        await post.save();

        io.to(`channel:${post.channel}`).emit('channel:new-post', {
          channelId: post.channel.toString(),
          post: post.toObject(),
          isSilent: post.isSilent,
        });
      }
    } catch (err) {
      console.error('Scheduled post publisher error:', err);
    }
  }, 30000);
};

const stopScheduledPostPublisher = () => {
  if (scheduledPostInterval) {
    clearInterval(scheduledPostInterval);
    scheduledPostInterval = null;
  }
};

module.exports = setupChannelHandlers;
module.exports.startScheduledPostPublisher = startScheduledPostPublisher;
module.exports.stopScheduledPostPublisher = stopScheduledPostPublisher;
