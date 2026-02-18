/**
 * ============================================
 * User Model
 * ============================================
 * 
 * Stores user account data including authentication credentials,
 * profile info, and real-time presence state.
 * 
 * WHY socketId is stored:
 * When a user connects via Socket.io, we bind their socketId to their
 * userId. This allows us to route signaling messages (WebRTC offers,
 * answers, ICE candidates) to the correct socket.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false, // Never return password by default in queries
  },
  avatar: {
    type: String,
    default: '', // URL or filename of user's avatar
  },
  isOnline: {
    type: Boolean,
    default: false,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  socketId: {
    type: String,
    default: null,
  },

  // ─── ROLE & BLOCKING ─────────────────────────────────
  // Only ONE user can have 'owner' role (set directly in DB)
  role: {
    type: String,
    enum: ['user', 'owner'],
    default: 'user',
  },

  // Owner mode visibility: when ON, other users can see this user is the owner
  ownerModeVisible: {
    type: Boolean,
    default: false,
  },

  // Privacy settings
  profileHidden: {
    type: Boolean,
    default: false,
  },
  emailHidden: {
    type: Boolean,
    default: false,
  },

  // Block status: only the owner can block users
  isBlocked: {
    type: Boolean,
    default: false,
  },
  blockedAt: {
    type: Date,
    default: null,
  },
  blockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  blockedReason: {
    type: String,
    default: null,
  },

  // User-to-user blocking: array of user IDs this user has blocked
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],

  // ─── SECURITY FIELDS ─────────────────────────────

  // Refresh token (hashed) for token rotation
  refreshToken: {
    type: String,
    select: false,
    default: null,
  },

  // When the refresh token was created (for expiry enforcement)
  refreshTokenCreatedAt: {
    type: Date,
    select: false,
    default: null,
  },

  // Device fingerprint hash — binds token to device
  deviceFingerprint: {
    type: String,
    select: false,
    default: null,
  },

  // Failed login tracking (brute force protection)
  failedLoginAttempts: {
    type: Number,
    default: 0,
  },
  lastFailedLogin: {
    type: Date,
    default: null,
  },
  accountLockedUntil: {
    type: Date,
    default: null,
  },

  // Session tracking
  activeSessions: [{
    sessionId: String,
    deviceFingerprint: String,
    ip: String,
    userAgent: String,
    createdAt: { type: Date, default: Date.now },
    lastActivity: { type: Date, default: Date.now },
  }],

  // Password policy
  passwordChangedAt: {
    type: Date,
    default: null,
  },

  // Security flags
  securityFlags: {
    forceLogout: { type: Boolean, default: false },
    requirePasswordChange: { type: Boolean, default: false },
    twoFactorEnabled: { type: Boolean, default: false },
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

/**
 * Pre-save middleware: Hash password before saving
 * 
 * WHY bcrypt: 
 * - Includes salt automatically (prevents rainbow table attacks)
 * - Configurable cost factor (rounds) for future-proofing
 * - Industry standard for password hashing
 * 
 * Salt rounds = 12 (good balance of security vs speed)
 */
userSchema.pre('save', async function (next) {
  // Only hash if password is new or modified
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Instance method: Compare candidate password with stored hash
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Instance method: Return user object without sensitive fields
 */
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.deviceFingerprint;
  delete obj.activeSessions;
  delete obj.securityFlags;
  delete obj.failedLoginAttempts;
  delete obj.lastFailedLogin;
  delete obj.accountLockedUntil;
  delete obj.passwordChangedAt;
  delete obj.blockedBy;
  delete obj.blockedReason;
  delete obj.blockedAt;
  delete obj.__v;
  return obj;
};

/**
 * Return user as seen by other users
 * Hides role unless ownerModeVisible is true
 */
userSchema.methods.toPublicObject = function () {
  const obj = this.toSafeObject();
  // Hide owner role if ownerModeVisible is off
  if (obj.role === 'owner' && !obj.ownerModeVisible) {
    obj.role = 'user';
  }
  delete obj.ownerModeVisible;
  delete obj.isBlocked;
  // Respect email visibility
  if (obj.emailHidden) {
    delete obj.email;
  }
  return obj;
};

/**
 * Check if account is currently locked
 */
userSchema.methods.isLocked = function () {
  if (!this.accountLockedUntil) return false;
  if (new Date() > this.accountLockedUntil) {
    // Lock expired
    this.accountLockedUntil = null;
    this.failedLoginAttempts = 0;
    return false;
  }
  return true;
};

/**
 * Record a failed login attempt
 */
userSchema.methods.recordFailedLogin = async function () {
  this.failedLoginAttempts += 1;
  this.lastFailedLogin = new Date();

  // Progressive lockout: 5 failures = 15 min, 10 = 1 hour, 15+ = 24 hours
  if (this.failedLoginAttempts >= 15) {
    this.accountLockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  } else if (this.failedLoginAttempts >= 10) {
    this.accountLockedUntil = new Date(Date.now() + 60 * 60 * 1000);
  } else if (this.failedLoginAttempts >= 5) {
    this.accountLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
  }

  await this.save();
};

/**
 * Clear failed login attempts on successful login
 */
userSchema.methods.clearFailedLogins = async function () {
  if (this.failedLoginAttempts > 0) {
    this.failedLoginAttempts = 0;
    this.lastFailedLogin = null;
    this.accountLockedUntil = null;
    await this.save();
  }
};

/**
 * Check if password was changed after a token was issued
 */
userSchema.methods.changedPasswordAfter = function (tokenIssuedAt) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return tokenIssuedAt < changedTimestamp;
  }
  return false;
};

// Index for faster presence queries
userSchema.index({ isOnline: 1 });
userSchema.index({ username: 'text', email: 'text' });

module.exports = mongoose.model('User', userSchema);
