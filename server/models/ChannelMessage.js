/**
 * ============================================
 * ChannelMessage Model — Telegram-Style Channel Posts
 * ============================================
 * 
 * Separate from Message model because channel posts have unique features:
 * - Views tracking
 * - Reactions with counts
 * - Forwarding info
 * - Scheduled posting
 * - Edit history
 * - Comments / reply threads
 * - Polls
 * - Author signature
 * - Silent notifications
 */

const mongoose = require('mongoose');

// ─── POLL OPTION SCHEMA ─────────────────────
const pollOptionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    maxlength: 100,
  },
  voters: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
}, { _id: true });

// ─── POLL SCHEMA ────────────────────────────
const pollSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    maxlength: 300,
  },
  options: [pollOptionSchema],
  // Poll settings
  isAnonymous: {
    type: Boolean,
    default: true,
  },
  allowMultipleAnswers: {
    type: Boolean,
    default: false,
  },
  // Quiz mode: one correct answer
  isQuiz: {
    type: Boolean,
    default: false,
  },
  correctOptionId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  explanation: {
    type: String,
    default: '',
    maxlength: 200,
  },
  // Close date
  closesAt: {
    type: Date,
    default: null,
  },
  isClosed: {
    type: Boolean,
    default: false,
  },
  totalVoters: {
    type: Number,
    default: 0,
  },
}, { _id: false });

// ─── REACTION SCHEMA ────────────────────────
const reactionSchema = new mongoose.Schema({
  emoji: {
    type: String,
    required: true,
  },
  users: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  count: {
    type: Number,
    default: 0,
  },
}, { _id: false });

// ─── EDIT HISTORY ───────────────────────────
const editEntrySchema = new mongoose.Schema({
  content: String,
  editedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

// ─── COMMENT SCHEMA ─────────────────────────
const commentSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxlength: 4000,
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'audio', 'video'],
    default: 'text',
  },
  fileUrl: { type: String, default: null },
  fileName: { type: String, default: null },
  fileSize: { type: Number, default: null },
  reactions: [reactionSchema],
  isDeleted: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

// ─── MAIN CHANNEL MESSAGE SCHEMA ────────────
const channelMessageSchema = new mongoose.Schema({
  channel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Channel',
    required: true,
    index: true,
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Message content
  content: {
    type: String,
    default: '',
    maxlength: [10000, 'Message cannot exceed 10000 characters'],
  },
  // Message type
  type: {
    type: String,
    enum: ['text', 'image', 'video', 'audio', 'file', 'poll', 'system', 'live_stream', 'voice_note'],
    default: 'text',
  },
  // File attachment
  fileUrl: {
    type: String,
    default: null,
  },
  fileName: {
    type: String,
    default: null,
  },
  fileSize: {
    type: Number,
    default: null,
  },
  fileMimeType: {
    type: String,
    default: null,
  },
  // Multiple media (album/gallery)
  mediaGroup: [{
    type: {
      type: String,
      enum: ['image', 'video'],
    },
    url: String,
    thumbnail: String,
    width: Number,
    height: Number,
    duration: Number, // for video
    size: Number,
  }],

  // ─── POLL ─────────────────────────────────
  poll: pollSchema,

  // ─── REACTIONS ────────────────────────────
  reactions: [reactionSchema],
  totalReactions: {
    type: Number,
    default: 0,
  },

  // ─── VIEWS ────────────────────────────────
  views: {
    type: Number,
    default: 0,
  },
  viewedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],

  // ─── COMMENTS ─────────────────────────────
  comments: [commentSchema],
  commentCount: {
    type: Number,
    default: 0,
  },
  commentsDisabled: {
    type: Boolean,
    default: false,
  },

  // ─── FORWARDING ───────────────────────────
  forwardedFrom: {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel',
      default: null,
    },
    channelName: {
      type: String,
      default: null,
    },
    originalMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },

  // ─── AUTHOR SIGNATURE ────────────────────
  // Shown when channel has "Sign Messages" enabled
  authorSignature: {
    type: String,
    default: null,
  },

  // ─── SCHEDULING ──────────────────────────
  scheduledFor: {
    type: Date,
    default: null,
  },
  isScheduled: {
    type: Boolean,
    default: false,
  },

  // ─── SILENT / NOTIFICATION ────────────────
  isSilent: {
    type: Boolean,
    default: false,
  },

  // ─── EDIT HISTORY ────────────────────────
  isEdited: {
    type: Boolean,
    default: false,
  },
  editHistory: [editEntrySchema],
  lastEditedAt: {
    type: Date,
    default: null,
  },

  // ─── PIN ──────────────────────────────────
  isPinned: {
    type: Boolean,
    default: false,
    index: true,
  },
  pinnedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  pinnedAt: {
    type: Date,
    default: null,
  },

  // ─── DELETION ─────────────────────────────
  isDeleted: {
    type: Boolean,
    default: false,
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // ─── ENCRYPTION ───────────────────────────
  encrypted: {
    type: Boolean,
    default: false,
  },
  encryptionIV: {
    type: String,
    default: null,
  },
  encryptionTag: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

// ─── INDEXES ────────────────────────────────
channelMessageSchema.index({ channel: 1, createdAt: -1 });
channelMessageSchema.index({ channel: 1, isPinned: 1 });
channelMessageSchema.index({ channel: 1, isScheduled: 1, scheduledFor: 1 });
channelMessageSchema.index({ channel: 1, type: 1 });
channelMessageSchema.index({ sender: 1 });

// ─── STATIC METHODS ─────────────────────────

/**
 * Get channel posts with pagination
 */
channelMessageSchema.statics.getChannelPosts = function (channelId, page = 1, limit = 30) {
  const skip = (page - 1) * limit;
  return this.find({
    channel: channelId,
    isDeleted: false,
    isScheduled: false,
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'username avatar')
    .populate('comments.sender', 'username avatar')
    .populate('pinnedBy', 'username');
};

/**
 * Get scheduled posts for a channel
 */
channelMessageSchema.statics.getScheduledPosts = function (channelId) {
  return this.find({
    channel: channelId,
    isScheduled: true,
    isDeleted: false,
  })
    .sort({ scheduledFor: 1 })
    .populate('sender', 'username avatar');
};

/**
 * Get pinned posts
 */
channelMessageSchema.statics.getPinnedPosts = function (channelId) {
  return this.find({
    channel: channelId,
    isPinned: true,
    isDeleted: false,
  })
    .sort({ pinnedAt: -1 })
    .populate('sender', 'username avatar')
    .populate('pinnedBy', 'username');
};

/**
 * Increment view count
 */
channelMessageSchema.statics.addView = async function (messageId, userId) {
  return this.findOneAndUpdate(
    {
      _id: messageId,
      viewedBy: { $ne: userId },
    },
    {
      $inc: { views: 1 },
      $addToSet: { viewedBy: userId },
    },
    { new: true }
  );
};

module.exports = mongoose.model('ChannelMessage', channelMessageSchema);
