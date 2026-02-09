/**
 * ============================================
 * Group Model
 * ============================================
 * 
 * Represents a chat group with members and admin.
 * 
 * WHY separate Group model:
 * - Clean separation of concerns
 * - Group metadata (name, description) lives here
 * - Members array enables efficient membership checks
 * - Admin field for group management permissions
 */

const mongoose = require('mongoose');

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
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
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
groupSchema.index({ members: 1 });
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
  return this.members.some(member =>
    member.toString() === userId.toString()
  );
};

/**
 * Instance method: Check if a user is the admin
 */
groupSchema.methods.isAdmin = function (userId) {
  return this.admin.toString() === userId.toString();
};

module.exports = mongoose.model('Group', groupSchema);
