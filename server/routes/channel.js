/**
 * ============================================
 * Channel Routes — Telegram-Style Channels
 * ============================================
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');
const {
  // CRUD
  createChannel,
  editChannel,
  deleteChannel,
  getMyChannels,
  discoverChannels,
  getChannelById,
  getChannelByUsername,
  // Subscription
  subscribeChannel,
  unsubscribeChannel,
  // Invite links
  createInviteLink,
  getInviteLinks,
  revokeInviteLink,
  joinViaInviteLink,
  // Join requests
  getJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  // Members & roles
  changeMemberRole,
  transferOwnership,
  banMember,
  unbanMember,
  removeMember,
  getBannedMembers,
  // Posts
  createPost,
  getPosts,
  getPinnedPosts,
  getScheduledPosts,
  editPost,
  deletePost,
  togglePinPost,
  // Reactions & comments
  toggleReaction,
  addComment,
  deleteComment,
  // Polls
  votePoll,
  closePoll,
  // Forward
  forwardPost,
  // Live stream
  startLiveStream,
  stopLiveStream,
  joinLiveStream,
  leaveLiveStream,
  // Stats
  getChannelStats,
  // Mute
  toggleMute,
} = require('../controllers/channelController');

// All routes require authentication
router.use(protect);
router.use(apiLimiter);

// ─── CHANNEL CRUD ───────────────────────────
router.post('/', createChannel);
router.get('/', getMyChannels);
router.get('/discover', discoverChannels);
router.get('/by-username/:username', getChannelByUsername);
router.get('/:id', getChannelById);
router.put('/:id', editChannel);
router.delete('/:id', deleteChannel);

// ─── SUBSCRIPTION ───────────────────────────
router.post('/:id/subscribe', subscribeChannel);
router.post('/:id/unsubscribe', unsubscribeChannel);
router.post('/:id/mute', toggleMute);

// ─── INVITE LINKS ───────────────────────────
router.post('/:id/invite-links', createInviteLink);
router.get('/:id/invite-links', getInviteLinks);
router.delete('/:id/invite-links/:linkId', revokeInviteLink);
router.post('/join/:code', joinViaInviteLink);

// ─── JOIN REQUESTS ──────────────────────────
router.get('/:id/join-requests', getJoinRequests);
router.post('/:id/join-requests/:requestId/approve', approveJoinRequest);
router.post('/:id/join-requests/:requestId/reject', rejectJoinRequest);

// ─── MEMBER MANAGEMENT ─────────────────────
router.put('/:id/members/:userId/role', changeMemberRole);
router.post('/:id/transfer-ownership', transferOwnership);
router.post('/:id/ban/:userId', banMember);
router.post('/:id/unban/:userId', unbanMember);
router.post('/:id/remove-member/:userId', removeMember);
router.get('/:id/banned', getBannedMembers);

// ─── POSTS ──────────────────────────────────
router.post('/:id/posts', createPost);
router.get('/:id/posts', getPosts);
router.get('/:id/posts/pinned', getPinnedPosts);
router.get('/:id/posts/scheduled', getScheduledPosts);
router.put('/:id/posts/:postId', editPost);
router.delete('/:id/posts/:postId', deletePost);
router.post('/:id/posts/:postId/pin', togglePinPost);

// ─── REACTIONS & COMMENTS ───────────────────
router.post('/:id/posts/:postId/react', toggleReaction);
router.post('/:id/posts/:postId/comments', addComment);
router.delete('/:id/posts/:postId/comments/:commentId', deleteComment);

// ─── POLLS ──────────────────────────────────
router.post('/:id/posts/:postId/vote', votePoll);
router.post('/:id/posts/:postId/close-poll', closePoll);

// ─── FORWARD ────────────────────────────────
router.post('/:id/posts/:postId/forward', forwardPost);

// ─── LIVE STREAM ────────────────────────────
router.post('/:id/live-stream/start', startLiveStream);
router.post('/:id/live-stream/stop', stopLiveStream);
router.post('/:id/live-stream/join', joinLiveStream);
router.post('/:id/live-stream/leave', leaveLiveStream);

// ─── STATISTICS ─────────────────────────────
router.get('/:id/stats', getChannelStats);

module.exports = router;
