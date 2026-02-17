/**
 * ============================================
 * Group Model — Role-Based Access Control
 * ============================================
 * 
 * Represents a chat group with role-based members.
 * 
 * ROLES:
 * - admin:     Full control — invite, remove, promote/demote, delete group
 * - moderator: Can invite and remove regular members
 * - member:    Can chat and join calls, cannot invite/remove
 * 
 * WHY separate Group model:
 * - Clean separation of concerns
 * - Group metadata (name, description) lives here
 * - Members array with roles enables fine-grained permission checks
 * - Admin field for backward compat + quick admin lookup
 */

const mongoose = require('mongoose');

/**
 * Role hierarchy: admin > moderator > member
 */
const ROLES = {
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  MEMBER: 'member',
};

const ROLE_HIERARCHY = {
  admin: 3,
  moderator: 2,
  member: 1,
};

const memberSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: Object.values(ROLES),
    default: ROLES.MEMBER,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const groupSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Group name is required'],
    trim: true,
    minlength: [2, 'Group name must be at least 2 characters'],
    maxlength: [50, 'Group name cannot exceed 50 characters'],
  },
  description: {
    type: String,
    default: '',
    maxlength: [200, 'Description cannot exceed 200 characters'],
  },
  avatar: {
    type: String,
    default: '',
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Group admin is required'],
  },
  /**
   * Role-based members array.
   * Each entry: { user: ObjectId, role: 'admin'|'moderator'|'member', joinedAt }
   */
  members: [memberSchema],
  // Maximum members for mesh-based group calls
  // WHY limit: Mesh topology = N*(N-1)/2 connections
  // 6 users = 15 connections, 8 users = 28 connections
  // Beyond ~6-8, performance degrades significantly
  maxMembers: {
    type: Number,
    default: 20, // Chat can have more members
  },
  maxCallMembers: {
    type: Number,
    default: 6, // But calls should be limited for mesh
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

// Index for member lookup
groupSchema.index({ 'members.user': 1 });
groupSchema.index({ admin: 1 });

/**
 * Virtual: member count
 */
groupSchema.virtual('memberCount').get(function () {
  return this.members.length;
});

// Ensure virtuals are included in JSON
groupSchema.set('toJSON', { virtuals: true });
groupSchema.set('toObject', { virtuals: true });

/**
 * Instance method: Check if a user is a member
 */
groupSchema.methods.isMember = function (userId) {
  return this.members.some(m =>
    (m.user?._id || m.user).toString() === userId.toString()
  );
};

/**
 * Instance method: Check if a user is the admin
 */
groupSchema.methods.isAdmin = function (userId) {
  return this.admin.toString() === userId.toString();
};

/**
 * Instance method: Get a member's role
 * Returns null if not a member
 */
groupSchema.methods.getMemberRole = function (userId) {
  const member = this.members.find(m =>
    (m.user?._id || m.user).toString() === userId.toString()
  );
  return member ? member.role : null;
};

/**
 * Instance method: Check if a user can invite others
 * Admin and Moderators can invite
 */
groupSchema.methods.canInvite = function (userId) {
  const role = this.getMemberRole(userId);
  return role === ROLES.ADMIN || role === ROLES.MODERATOR;
};

/**
 * Instance method: Check if a user can remove another user
 * Admin can remove anyone, Moderator can remove members only
 */
groupSchema.methods.canRemove = function (actorId, targetId) {
  const actorRole = this.getMemberRole(actorId);
  const targetRole = this.getMemberRole(targetId);
  if (!actorRole || !targetRole) return false;
  // Cannot remove yourself via this method (use leave)
  if (actorId.toString() === targetId.toString()) return false;
  // Admin can remove anyone except themselves
  if (actorRole === ROLES.ADMIN) return true;
  // Moderator can only remove regular members
  if (actorRole === ROLES.MODERATOR && targetRole === ROLES.MEMBER) return true;
  return false;
};

/**
 * Instance method: Check if a user can change another user's role
 * Only admin can promote/demote
 */
groupSchema.methods.canChangeRole = function (actorId) {
  return this.getMemberRole(actorId) === ROLES.ADMIN;
};

/**
 * Helper: Get user IDs from members array (for backward compat)
 */
groupSchema.methods.getMemberIds = function () {
  return this.members.map(m => (m.user?._id || m.user).toString());
};

// Export roles constant for use in controllers
groupSchema.statics.ROLES = ROLES;
groupSchema.statics.ROLE_HIERARCHY = ROLE_HIERARCHY;

module.exports = mongoose.model('Group', groupSchema);
