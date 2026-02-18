/**
 * ============================================
 * Channel Model — Telegram-Style Channels
 * ============================================
 * 
 * Full Telegram-like channel system with:
 * 
 * CHANNEL TYPES:
 * - public:   Discoverable, anyone can join via link/search
 * - private:  Invite-only, hidden from search
 * 
 * ROLES (Telegram-compatible hierarchy):
 * - owner:       Full control, transfer ownership, delete channel
 * - admin:       Manage members, edit channel, post, pin, manage messages
 * - moderator:   Can delete messages, ban users, manage comments
 * - subscriber:  Can view content, react, comment (if enabled)
 * 
 * FEATURES:
 * - Subscriber count / member management
 * - Discussion group linking (comments)
 * - Slow mode (rate limit posting)
 * - Sign messages (show admin name)
 * - Silent broadcasting
 * - Channel invite links
 * - Pinned messages
 * - Admin posting rights
 * - Content restrictions (media, links, etc.)
 * - Live stream support
 * - Polls
 * - Scheduled messages
 * - Channel statistics
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

// ─── ROLE DEFINITIONS ────────────────────────
const CHANNEL_ROLES = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  SUBSCRIBER: 'subscriber',
};

const CHANNEL_ROLE_HIERARCHY = {
  owner: 4,
  admin: 3,
  moderator: 2,
  subscriber: 1,
};

// ─── ADMIN PERMISSIONS ──────────────────────
const ADMIN_PERMISSIONS = {
  CHANGE_CHANNEL_INFO: 'change_channel_info',
  POST_MESSAGES: 'post_messages',
  EDIT_MESSAGES: 'edit_messages',
  DELETE_MESSAGES: 'delete_messages',
  INVITE_USERS: 'invite_users',
  MANAGE_LIVE_STREAMS: 'manage_live_streams',
  PIN_MESSAGES: 'pin_messages',
  MANAGE_SUBSCRIBERS: 'manage_subscribers',
  ADD_ADMINS: 'add_admins',
  REMAIN_ANONYMOUS: 'remain_anonymous',
};

// ─── MEMBER SCHEMA ──────────────────────────
const channelMemberSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: Object.values(CHANNEL_ROLES),
    default: CHANNEL_ROLES.SUBSCRIBER,
  },
  // Custom title for admins (e.g., "Editor", "News Bot")
  customTitle: {
    type: String,
    default: '',
    maxlength: 32,
  },
  // Granular admin permissions
  permissions: {
    change_channel_info: { type: Boolean, default: true },
    post_messages: { type: Boolean, default: true },
    edit_messages: { type: Boolean, default: true },
    delete_messages: { type: Boolean, default: true },
    invite_users: { type: Boolean, default: true },
    manage_live_streams: { type: Boolean, default: false },
    pin_messages: { type: Boolean, default: true },
    manage_subscribers: { type: Boolean, default: true },
    add_admins: { type: Boolean, default: false },
    remain_anonymous: { type: Boolean, default: false },
  },
  // Mute notifications for this subscriber
  isMuted: {
    type: Boolean,
    default: false,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  // Ban info
  isBanned: {
    type: Boolean,
    default: false,
  },
  bannedAt: {
    type: Date,
    default: null,
  },
  bannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  bannedReason: {
    type: String,
    default: '',
  },
}, { _id: false });

// ─── INVITE LINK SCHEMA ────────────────────
const inviteLinkSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  name: {
    type: String,
    default: '',
    maxlength: 64,
  },
  // Expiration
  expiresAt: {
    type: Date,
    default: null, // null = never expires
  },
  // Usage limit
  maxUses: {
    type: Number,
    default: 0, // 0 = unlimited
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  // Request approval before join
  requiresApproval: {
    type: Boolean,
    default: false,
  },
  isRevoked: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

// ─── JOIN REQUEST SCHEMA ────────────────────
const joinRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  message: {
    type: String,
    default: '',
    maxlength: 200,
  },
  inviteLink: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: true });

// ─── MAIN CHANNEL SCHEMA ───────────────────
const channelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Channel name is required'],
    trim: true,
    minlength: [1, 'Channel name must be at least 1 character'],
    maxlength: [128, 'Channel name cannot exceed 128 characters'],
  },
  // Unique public username (like @channelname)
  username: {
    type: String,
    trim: true,
    lowercase: true,
    unique: true,
    sparse: true, // Allow null for private channels
    match: [/^[a-z][a-z0-9_]{3,31}$/, 'Username must be 4-32 chars, start with letter, only a-z, 0-9, _'],
  },
  description: {
    type: String,
    default: '',
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
  },
  avatar: {
    type: String,
    default: '',
  },
  // Channel type
  type: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
  },
  // Channel owner
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Channel owner is required'],
  },
  // Members with roles
  members: [channelMemberSchema],
  // Invite links
  inviteLinks: [inviteLinkSchema],
  // Join requests (for private channels / links with approval)
  joinRequests: [joinRequestSchema],

  // ─── CHANNEL SETTINGS ────────────────────
  settings: {
    // Sign messages: show admin name on posts
    signMessages: {
      type: Boolean,
      default: false,
    },
    // Allow comments / discussion
    allowComments: {
      type: Boolean,
      default: true,
    },
    // Linked discussion group (if comments link to a group)
    discussionGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      default: null,
    },
    // Slow mode: seconds between subscriber comments (0 = off)
    slowMode: {
      type: Number,
      default: 0,
      min: 0,
      max: 86400, // max 24 hours
    },
    // Restrict content types
    allowedContentTypes: {
      text: { type: Boolean, default: true },
      photo: { type: Boolean, default: true },
      video: { type: Boolean, default: true },
      file: { type: Boolean, default: true },
      link: { type: Boolean, default: true },
      poll: { type: Boolean, default: true },
      voice: { type: Boolean, default: true },
      sticker: { type: Boolean, default: true },
    },
    // Reactions
    allowReactions: {
      type: Boolean,
      default: true,
    },
    // Available reaction emojis (empty = all allowed)
    availableReactions: {
      type: [String],
      default: ['👍', '👎', '❤️', '🔥', '🎉', '😢', '😮', '💩'],
    },
    // Who can see subscriber list
    subscriberListVisible: {
      type: Boolean,
      default: true,
    },
    // Protected content (disable forwarding)
    protectedContent: {
      type: Boolean,
      default: false,
    },
    // Aggressive anti-spam
    aggressiveAntiSpam: {
      type: Boolean,
      default: false,
    },
  },

  // ─── LIVE STREAM ─────────────────────────
  liveStream: {
    isLive: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      default: '',
    },
    startedAt: {
      type: Date,
      default: null,
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Viewer count (updated periodically)
    viewerCount: {
      type: Number,
      default: 0,
    },
    // Stream key for RTMP/WebRTC
    streamKey: {
      type: String,
      default: null,
    },
    // Recording
    isRecording: {
      type: Boolean,
      default: false,
    },
    // Chat enabled during stream
    chatEnabled: {
      type: Boolean,
      default: true,
    },
  },

  // ─── STATISTICS ──────────────────────────
  stats: {
    totalViews: {
      type: Number,
      default: 0,
    },
    // Recent growth (subscribers gained in last 24h)
    recentGrowth: {
      type: Number,
      default: 0,
    },
    // Average post views
    avgPostViews: {
      type: Number,
      default: 0,
    },
    // Posts per day (rolling average)
    postsPerDay: {
      type: Number,
      default: 0,
    },
    // Engagement rate (reactions + comments / views)
    engagementRate: {
      type: Number,
      default: 0,
    },
    lastStatsUpdate: {
      type: Date,
      default: null,
    },
  },

  // Default invite link code
  defaultInviteCode: {
    type: String,
    default: null,
  },

  // Pinned message IDs
  pinnedMessageIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ChannelMessage',
  }],

  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// ─── INDEXES ────────────────────────────────
channelSchema.index({ 'members.user': 1 });
channelSchema.index({ owner: 1 });
channelSchema.index({ username: 1 });
channelSchema.index({ type: 1, isActive: 1 });
channelSchema.index({ 'inviteLinks.code': 1 });
channelSchema.index({ name: 'text', description: 'text' });
channelSchema.index({ createdAt: -1 });

// ─── VIRTUALS ───────────────────────────────
channelSchema.virtual('subscriberCount').get(function () {
  return this.members.filter(m => !m.isBanned).length;
});

channelSchema.set('toJSON', { virtuals: true });
channelSchema.set('toObject', { virtuals: true });

// ─── INSTANCE METHODS ───────────────────────

/**
 * Check if a user is a member (not banned)
 */
channelSchema.methods.isMember = function (userId) {
  return this.members.some(m =>
    (m.user?._id || m.user).toString() === userId.toString() && !m.isBanned
  );
};

/**
 * Check if a user is banned
 */
channelSchema.methods.isBannedMember = function (userId) {
  const member = this.members.find(m =>
    (m.user?._id || m.user).toString() === userId.toString()
  );
  return member?.isBanned || false;
};

/**
 * Get a member's role
 */
channelSchema.methods.getMemberRole = function (userId) {
  const member = this.members.find(m =>
    (m.user?._id || m.user).toString() === userId.toString()
  );
  return member ? member.role : null;
};

/**
 * Get a member object
 */
channelSchema.methods.getMember = function (userId) {
  return this.members.find(m =>
    (m.user?._id || m.user).toString() === userId.toString()
  );
};

/**
 * Check if user is owner
 */
channelSchema.methods.isOwner = function (userId) {
  return this.owner.toString() === userId.toString();
};

/**
 * Check if user can post messages
 */
channelSchema.methods.canPost = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.post_messages !== false;
  if (member.role === CHANNEL_ROLES.MODERATOR) return member.permissions.post_messages !== false;
  return false; // subscribers can't post in channels
};

/**
 * Check if user can edit channel info
 */
channelSchema.methods.canEditInfo = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.change_channel_info !== false;
  return false;
};

/**
 * Check if user can delete messages
 */
channelSchema.methods.canDeleteMessages = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.delete_messages !== false;
  if (member.role === CHANNEL_ROLES.MODERATOR) return true;
  return false;
};

/**
 * Check if user can invite others
 */
channelSchema.methods.canInvite = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.invite_users !== false;
  return false;
};

/**
 * Check if user can pin messages
 */
channelSchema.methods.canPin = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.pin_messages !== false;
  return false;
};

/**
 * Check if user can manage subscribers (ban/unban/remove)
 */
channelSchema.methods.canManageSubscribers = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.manage_subscribers !== false;
  if (member.role === CHANNEL_ROLES.MODERATOR) return true;
  return false;
};

/**
 * Check if user can add admins
 */
channelSchema.methods.canAddAdmins = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.add_admins === true;
  return false;
};

/**
 * Check if user can manage live streams
 */
channelSchema.methods.canManageLiveStream = function (userId) {
  const member = this.getMember(userId);
  if (!member || member.isBanned) return false;
  if (member.role === CHANNEL_ROLES.OWNER) return true;
  if (member.role === CHANNEL_ROLES.ADMIN) return member.permissions.manage_live_streams === true;
  return false;
};

/**
 * Check if actorId can change targetId's role
 */
channelSchema.methods.canChangeRole = function (actorId, targetId) {
  const actor = this.getMember(actorId);
  const target = this.getMember(targetId);
  if (!actor || !target) return false;
  if (actor.isBanned) return false;
  
  const actorLevel = CHANNEL_ROLE_HIERARCHY[actor.role] || 0;
  const targetLevel = CHANNEL_ROLE_HIERARCHY[target.role] || 0;

  // Owner can change anyone
  if (actor.role === CHANNEL_ROLES.OWNER) return true;
  // Admin with add_admins perm can promote up to moderator
  if (actor.role === CHANNEL_ROLES.ADMIN && actor.permissions.add_admins) {
    return actorLevel > targetLevel;
  }
  return false;
};

/**
 * Generate a unique invite code
 */
channelSchema.methods.generateInviteLink = function (createdBy, options = {}) {
  const code = crypto.randomBytes(8).toString('base64url');
  const link = {
    code,
    createdBy,
    name: options.name || '',
    expiresAt: options.expiresAt || null,
    maxUses: options.maxUses || 0,
    requiresApproval: options.requiresApproval || false,
  };
  this.inviteLinks.push(link);
  return code;
};

/**
 * Get member IDs (non-banned)
 */
channelSchema.methods.getMemberIds = function () {
  return this.members
    .filter(m => !m.isBanned)
    .map(m => (m.user?._id || m.user).toString());
};

/**
 * Get admin/owner IDs
 */
channelSchema.methods.getAdminIds = function () {
  return this.members
    .filter(m => !m.isBanned && (m.role === CHANNEL_ROLES.OWNER || m.role === CHANNEL_ROLES.ADMIN))
    .map(m => (m.user?._id || m.user).toString());
};

// ─── STATICS ────────────────────────────────
channelSchema.statics.ROLES = CHANNEL_ROLES;
channelSchema.statics.ROLE_HIERARCHY = CHANNEL_ROLE_HIERARCHY;
channelSchema.statics.ADMIN_PERMISSIONS = ADMIN_PERMISSIONS;

module.exports = mongoose.model('Channel', channelSchema);
