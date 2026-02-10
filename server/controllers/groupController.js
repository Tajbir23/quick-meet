/**
 * ============================================
 * Group Controller
 * ============================================
 * 
 * Handles: Create group, join, leave, get groups, get members
 * 
 * GROUP CALL LIMITATION:
 * Mesh topology means each peer connects to every other peer.
 * N users = N*(N-1)/2 connections.
 * Beyond 6-8 users in a call, quality degrades significantly.
 * Chat groups can have more members, but calls are limited.
 */

const Group = require('../models/Group');
const User = require('../models/User');
const Message = require('../models/Message');

/**
 * POST /api/groups
 * Create a new group
 */
const createGroup = async (req, res) => {
  try {
    const { name, description, members } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Group name is required',
      });
    }

    // Create group with creator as admin and first member
    const memberIds = [req.user._id];

    // Add initial members if provided
    if (members && Array.isArray(members)) {
      for (const memberId of members) {
        const user = await User.findById(memberId);
        if (user && !memberIds.includes(memberId)) {
          memberIds.push(memberId);
        }
      }
    }

    const group = await Group.create({
      name,
      description: description || '',
      admin: req.user._id,
      members: memberIds,
    });

    await group.populate('members', 'username avatar isOnline');
    await group.populate('admin', 'username avatar');

    // Create system message for group creation
    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} created the group "${name}"`,
      type: 'system',
    });

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { group },
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error creating group',
    });
  }
};

/**
 * GET /api/groups
 * Get all groups the current user belongs to
 */
const getMyGroups = async (req, res) => {
  try {
    const groups = await Group.find({
      members: req.user._id,
      isActive: true,
    })
      .populate('members', 'username avatar isOnline')
      .populate('admin', 'username avatar')
      .sort({ updatedAt: -1 });

    res.json({
      success: true,
      data: { groups },
    });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching groups',
    });
  }
};

/**
 * GET /api/groups/:id
 * Get group details
 */
const getGroupById = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members', 'username avatar isOnline lastSeen')
      .populate('admin', 'username avatar');

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    res.json({
      success: true,
      data: { group },
    });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching group',
    });
  }
};

/**
 * POST /api/groups/:id/join
 * Join a group
 */
const joinGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    if (!group.isActive) {
      return res.status(400).json({
        success: false,
        message: 'This group is no longer active',
      });
    }

    if (group.isMember(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this group',
      });
    }

    if (group.members.length >= group.maxMembers) {
      return res.status(400).json({
        success: false,
        message: 'Group is full',
      });
    }

    group.members.push(req.user._id);
    await group.save();

    // System message
    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} joined the group`,
      type: 'system',
    });

    await group.populate('members', 'username avatar isOnline');
    await group.populate('admin', 'username avatar');

    res.json({
      success: true,
      message: 'Joined group successfully',
      data: { group },
    });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error joining group',
    });
  }
};

/**
 * POST /api/groups/:id/leave
 * Leave a group
 */
const leaveGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    if (!group.isMember(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this group',
      });
    }

    // If admin leaves, transfer admin to first remaining member
    if (group.isAdmin(req.user._id)) {
      const remainingMembers = group.members.filter(
        m => m.toString() !== req.user._id.toString()
      );

      if (remainingMembers.length > 0) {
        group.admin = remainingMembers[0];
      } else {
        // Last member leaving — deactivate group
        group.isActive = false;
      }
    }

    // Remove user from members
    group.members = group.members.filter(
      m => m.toString() !== req.user._id.toString()
    );

    await group.save();

    // System message
    if (group.isActive) {
      await Message.create({
        sender: req.user._id,
        group: group._id,
        content: `${req.user.username} left the group`,
        type: 'system',
      });
    }

    res.json({
      success: true,
      message: 'Left group successfully',
    });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error leaving group',
    });
  }
};

/**
 * POST /api/groups/:id/add-member
 * Add a member to group (admin only)
 */
const addMember = async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    if (!group.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only group members can add new members',
      });
    }

    if (group.isMember(userId)) {
      return res.status(400).json({
        success: false,
        message: 'User is already a member',
      });
    }

    const userToAdd = await User.findById(userId);
    if (!userToAdd) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (group.members.length >= group.maxMembers) {
      return res.status(400).json({
        success: false,
        message: 'Group is full',
      });
    }

    group.members.push(userId);
    await group.save();

    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} added ${userToAdd.username} to the group`,
      type: 'system',
    });

    await group.populate('members', 'username avatar isOnline');

    // Notify the added user via socket so they see the group immediately
    const io = req.app.get('io');
    if (io) {
      const eventData = {
        groupId: group._id.toString(),
        addedUserId: userId,
        addedUsername: userToAdd.username,
        addedBy: req.user.username,
      };

      // Tell existing group members about the new member
      io.to(`group:${group._id}`).emit('group:member-added', eventData);

      // Also emit directly to the added user's socket (they're not in the room yet)
      // Find their socketId from the connected sockets
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === userId);
      if (targetSocket) {
        targetSocket.emit('group:member-added', eventData);
        // Auto-join them into the group room
        targetSocket.join(`group:${group._id}`);
      }
    }

    res.json({
      success: true,
      message: 'Member added successfully',
      data: { group },
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error adding member',
    });
  }
};

/**
 * GET /api/groups/all
 * Get all available groups (for discovery/joining)
 */
const getAllGroups = async (req, res) => {
  try {
    const groups = await Group.find({ isActive: true })
      .populate('admin', 'username avatar')
      .select('name description members maxMembers admin createdAt')
      .sort({ createdAt: -1 });

    // Add member count without exposing member details
    const groupsWithCount = groups.map(g => ({
      ...g.toObject(),
      memberCount: g.members.length,
      isMember: g.members.some(m => m.toString() === req.user._id.toString()),
    }));

    res.json({
      success: true,
      data: { groups: groupsWithCount },
    });
  } catch (error) {
    console.error('Get all groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching groups',
    });
  }
};

module.exports = {
  createGroup,
  getMyGroups,
  getGroupById,
  joinGroup,
  leaveGroup,
  addMember,
  getAllGroups,
};
