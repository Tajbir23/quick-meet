/**
 * ============================================
 * User Controller
 * ============================================
 * 
 * Handles: Get users, active users, search, update profile
 */

const User = require('../models/User');

/**
 * GET /api/users
 * Get all users (excluding current user)
 */
const getUsers = async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user._id } })
      .select('-password')
      .sort({ isOnline: -1, username: 1 }); // Online users first

    res.json({
      success: true,
      data: { users },
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
 * Get online users only
 */
const getActiveUsers = async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.user._id },
      isOnline: true,
    }).select('username avatar isOnline lastSeen');

    res.json({
      success: true,
      data: { users },
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
    })
      .select('username avatar isOnline lastSeen')
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
      .select('username avatar isOnline lastSeen createdAt');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      data: { user },
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

module.exports = { getUsers, getActiveUsers, searchUsers, getUserById, updateProfile };
