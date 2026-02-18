/**
 * ============================================
 * Message Model — HARDENED
 * ============================================
 * 
 * Supports both 1-to-1 and group messages.
 * 
 * SECURITY UPGRADES:
 * - Encryption metadata fields for at-rest encryption
 * - Content is AES-256-GCM encrypted before storage
 * - IV (initialization vector) stored per-message for decryption
 * - Auth tag stored for integrity verification
 * 
 * DESIGN DECISION:
 * - If `receiver` is set and `group` is null → 1-to-1 message
 * - If `group` is set and `receiver` is null → group message
 */

const mongoose = require('mongoose');

// ─── REACTION SUB-SCHEMA ────────────────────
const reactionSchema = new mongoose.Schema({
  emoji: { type: String, required: true },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  count: { type: Number, default: 0 },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Sender is required'],
    index: true,
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null,
    index: true,
  },
  // ─── REPLY (THREAD) REFERENCE ─────────────
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
  },
  // ─── REACTIONS ────────────────────────────
  reactions: [reactionSchema],
  content: {
    type: String,
    default: '',
    maxlength: [10000, 'Message cannot exceed 10000 characters'], // Increased for encrypted content (base64 overhead)
  },
  type: {
    type: String,
    enum: ['text', 'file', 'image', 'audio', 'video', 'system', 'call'],
    default: 'text',
  },
  // ─── CALL LOG METADATA ────────────────────────
  callType: {
    type: String,
    enum: ['audio', 'video'],
    default: null,
  },
  callDuration: {
    type: Number,     // Duration in seconds (0 for missed/rejected)
    default: null,
  },
  callStatus: {
    type: String,
    enum: ['completed', 'missed', 'rejected', 'no_answer'],
    default: null,
  },
  // ─── ENCRYPTION METADATA ──────────────────────
  encrypted: {
    type: Boolean,
    default: false,
  },
  encryptionIV: {
    type: String,     // Hex-encoded IV used for AES-256-GCM
    default: null,
  },
  encryptionTag: {
    type: String,     // Hex-encoded auth tag for integrity verification
    default: null,
  },
  // File attachment metadata
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
  // ─── PIN METADATA ────────────────────────────
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
  // Read receipts
  read: {
    type: Boolean,
    default: false,
  },
  readAt: {
    type: Date,
    default: null,
  },
  // For group messages: track who has read it
  readBy: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    readAt: { type: Date, default: Date.now },
  }],
}, {
  timestamps: true,
});

// Compound indexes for efficient querying
// WHY: Most queries will be "get messages between two users" or "get messages in a group"
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ group: 1, createdAt: -1 });
messageSchema.index({ createdAt: -1 });
// Pinned messages indexes
messageSchema.index({ sender: 1, receiver: 1, isPinned: 1, pinnedAt: -1 });
messageSchema.index({ group: 1, isPinned: 1, pinnedAt: -1 });

/**
 * Static method: Get conversation between two users
 * Sorted by creation time, with pagination
 */
messageSchema.statics.getConversation = function (userId1, userId2, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  return this.find({
    $or: [
      { sender: userId1, receiver: userId2 },
      { sender: userId2, receiver: userId1 },
    ],
    group: null,
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'username avatar')
    .populate('receiver', 'username avatar')
    .populate({
      path: 'replyTo',
      select: 'content sender type fileUrl fileName encrypted encryptionIV encryptionTag',
      populate: { path: 'sender', select: 'username avatar' },
    });
};

/**
 * Static method: Get group messages
 */
messageSchema.statics.getGroupMessages = function (groupId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  return this.find({ group: groupId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'username avatar')
    .populate({
      path: 'replyTo',
      select: 'content sender type fileUrl fileName encrypted encryptionIV encryptionTag',
      populate: { path: 'sender', select: 'username avatar' },
    });
};

module.exports = mongoose.model('Message', messageSchema);
