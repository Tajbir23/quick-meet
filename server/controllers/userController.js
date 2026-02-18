/**
 * ============================================
 * User Controller
 * ============================================
 * 
 * Handles: Get users, active users, search, update profile,
 *          security settings, privacy settings
 */

const User = require('../models/User');
const bcrypt = require('bcryptjs');
const userCache = require('../utils/userCache');

/**
 * GET /api/users
 * Get all users (excluding current user)
 * Sorted: Online first, then by lastSeen (most recent first)
 * Includes cached lastSeen timestamps for real-time accuracy
 */
const getUsers = async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.user._id },
      isBlocked: { $ne: true },
      profileHidden: { $ne: true },
    })
      .select('-password')
      .sort({ isOnline: -1, lastSeen: -1, username: 1 });

    // Map users to public objects and enrich with cached lastSeen
    const publicUsers = users.map(u => {
      const obj = u.toPublicObject();
      // Override lastSeen with cached value (more accurate than DB)
      const cachedPresence = userCache.getPresence(u._id.toString());
      if (cachedPresence?.lastSeen) {
        obj.lastSeen = cachedPresence.lastSeen;
      }
      return obj;
    });

    // Cache the user data for future requests
    userCache.cacheUsersBatch(publicUsers);

    res.json({
      success: true,
      data: { users: publicUsers },
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching users',
    });
  }
};

/**
 * GET /api/users/active
 * Get online users only (with cached lastSeen)
 */
const getActiveUsers = async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.user._id },
      isOnline: true,
      isBlocked: { $ne: true },
    }).select('username avatar isOnline lastSeen role ownerModeVisible');

    const publicUsers = users.map(u => {
      const obj = u.toPublicObject();
      const cachedPresence = userCache.getPresence(u._id.toString());
      if (cachedPresence?.lastSeen) {
        obj.lastSeen = cachedPresence.lastSeen;
      }
      return obj;
    });

    res.json({
      success: true,
      data: { users: publicUsers },
    });
  } catch (error) {
    console.error('Get active users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching active users',
    });
  }
};

/**
 * GET /api/users/search?q=query
 * Search users by username or email
 */
const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
      });
    }

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { username: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
      profileHidden: { $ne: true },
    })
      .select('username avatar isOnline lastSeen emailHidden')
      .limit(20);

    res.json({
      success: true,
      data: { users },
    });
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error searching users',
    });
  }
};

/**
 * GET /api/users/:id
 * Get single user profile
 */
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('username avatar isOnline lastSeen createdAt email emailHidden role ownerModeVisible');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const userObj = user.toObject();
    // Hide email if user opted to hide
    if (userObj.emailHidden) {
      delete userObj.email;
    }
    // Hide owner role if ownerModeVisible is off
    if (userObj.role === 'owner' && !userObj.ownerModeVisible) {
      userObj.role = 'user';
    }
    delete userObj.ownerModeVisible;

    res.json({
      success: true,
      data: { user: userObj },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching user',
    });
  }
};

/**
 * PUT /api/users/profile
 * Update current user's profile
 */
const updateProfile = async (req, res) => {
  try {
    const { username, avatar } = req.body;
    const updates = {};

    if (username) {
      // Check if username is taken
      const existing = await User.findOne({
        username,
        _id: { $ne: req.user._id },
      });
      if (existing) {
        return res.status(400).json({
          success: false,
          message: 'Username already taken',
        });
      }
      updates.username = username;
    }

    if (avatar !== undefined) {
      updates.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Profile updated',
      data: { user },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating profile',
    });
  }
};

/**
 * PUT /api/users/security
 * Update email and/or password (requires current password)
 */
const updateSecurity = async (req, res) => {
  try {
    const { currentPassword, email, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password is required',
      });
    }

    // Fetch user with password
    const user = await User.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update email if changed
    if (email && email !== user.email) {
      const existing = await User.findOne({ email, _id: { $ne: req.user._id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already taken' });
      }
      user.email = email;
    }

    // Update password if provided
    if (newPassword) {
      if (newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      }
      user.password = newPassword;
      user.passwordChangedAt = new Date();
    }

    await user.save();

    const safeUser = user.toSafeObject();

    res.json({
      success: true,
      message: 'Security settings updated',
      data: { user: safeUser },
    });
  } catch (error) {
    console.error('Update security error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating security settings',
    });
  }
};

/**
 * PUT /api/users/privacy
 * Update privacy settings (profileHidden, emailHidden)
 */
const updatePrivacy = async (req, res) => {
  try {
    const { profileHidden, emailHidden } = req.body;
    const updates = {};

    if (typeof profileHidden === 'boolean') updates.profileHidden = profileHidden;
    if (typeof emailHidden === 'boolean') updates.emailHidden = emailHidden;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Privacy settings updated',
      data: { user },
    });
  } catch (error) {
    console.error('Update privacy error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating privacy settings',
    });
  }
};

module.exports = { getUsers, getActiveUsers, searchUsers, getUserById, updateProfile, updateSecurity, updatePrivacy };
