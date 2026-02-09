/**
 * ============================================
 * Message Model
 * ============================================
 * 
 * Supports both 1-to-1 and group messages.
 * 
 * DESIGN DECISION:
 * - If `receiver` is set and `group` is null → 1-to-1 message
 * - If `group` is set and `receiver` is null → group message
 * - This avoids needing separate collections for DMs vs group chats
 * 
 * Message types:
 * - text: Plain text message
 * - file: Any file attachment
 * - image: Image file (for inline preview)
 * - audio: Audio recording/file
 * - video: Video file
 * - system: System notifications (user joined/left)
 */

const mongoose = require('mongoose');

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
  content: {
    type: String,
    default: '',
    maxlength: [5000, 'Message cannot exceed 5000 characters'],
  },
  type: {
    type: String,
    enum: ['text', 'file', 'image', 'audio', 'video', 'system'],
    default: 'text',
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
    .populate('receiver', 'username avatar');
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
    .populate('sender', 'username avatar');
};

module.exports = mongoose.model('Message', messageSchema);
