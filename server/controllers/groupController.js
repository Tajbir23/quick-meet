/**
 * ============================================
 * Group Controller — Role-Based Access Control
 * ============================================
 * 
 * Handles: Create, join, leave, add/remove member, change role, get groups
 * 
 * ROLES:
 * - admin:     Full control — invite, remove anyone, promote/demote, delete group
 * - moderator: Can invite members and remove regular members
 * - member:    Can chat and join calls only, cannot invite or remove
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

const { ROLES } = Group;

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

    // Build members array with roles
    const memberEntries = [
      { user: req.user._id, role: ROLES.ADMIN },
    ];

    // Add initial members if provided (as regular members)
    if (members && Array.isArray(members)) {
      const addedIds = new Set([req.user._id.toString()]);
      for (const memberId of members) {
        if (addedIds.has(memberId.toString())) continue;
        const user = await User.findById(memberId);
        if (user) {
          memberEntries.push({ user: memberId, role: ROLES.MEMBER });
          addedIds.add(memberId.toString());
        }
      }
    }

    const group = await Group.create({
      name,
      description: description || '',
      admin: req.user._id,
      members: memberEntries,
    });

    await group.populate('members.user', 'username avatar isOnline');
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
      'members.user': req.user._id,
      isActive: true,
    })
      .populate('members.user', 'username avatar isOnline')
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
      .populate('members.user', 'username avatar isOnline lastSeen')
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
 * Join a group (as regular member)
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

    group.members.push({ user: req.user._id, role: ROLES.MEMBER });
    await group.save();

    // System message
    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} joined the group`,
      type: 'system',
    });

    await group.populate('members.user', 'username avatar isOnline');
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

    // If admin leaves, transfer admin to the next moderator, or first remaining member
    if (group.isAdmin(req.user._id)) {
      const remainingMembers = group.members.filter(
        m => (m.user?._id || m.user).toString() !== req.user._id.toString()
      );

      if (remainingMembers.length > 0) {
        // Prefer a moderator for succession, else first member
        const successor = remainingMembers.find(m => m.role === ROLES.MODERATOR) || remainingMembers[0];
        successor.role = ROLES.ADMIN;
        group.admin = successor.user?._id || successor.user;
      } else {
        // Last member leaving — deactivate group
        group.isActive = false;
      }
    }

    // Remove user from members
    group.members = group.members.filter(
      m => (m.user?._id || m.user).toString() !== req.user._id.toString()
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
 * Add a member to group (admin & moderator only)
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

    // Check role-based permission: only admin & moderator can invite
    if (!group.canInvite(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admin and moderators can add members',
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

    group.members.push({ user: userId, role: ROLES.MEMBER });
    await group.save();

    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} added ${userToAdd.username} to the group`,
      type: 'system',
    });

    await group.populate('members.user', 'username avatar isOnline');

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
 * POST /api/groups/:id/remove-member
 * Remove a member from group (role-based)
 * - Admin can remove anyone
 * - Moderator can remove regular members only
 * - Member cannot remove anyone
 */
const removeMember = async (req, res) => {
  try {
    const { userId } = req.body;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    if (!group.canRemove(req.user._id, userId)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to remove this member',
      });
    }

    const userToRemove = await User.findById(userId);
    const removedUsername = userToRemove?.username || 'Unknown';

    // Remove from members
    group.members = group.members.filter(
      m => (m.user?._id || m.user).toString() !== userId.toString()
    );
    await group.save();

    // System message
    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} removed ${removedUsername} from the group`,
      type: 'system',
    });

    await group.populate('members.user', 'username avatar isOnline');

    // Notify via socket
    const io = req.app.get('io');
    if (io) {
      const eventData = {
        groupId: group._id.toString(),
        removedUserId: userId,
        removedUsername,
        removedBy: req.user.username,
      };

      io.to(`group:${group._id}`).emit('group:member-removed', eventData);

      // Notify the removed user directly
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === userId);
      if (targetSocket) {
        targetSocket.emit('group:member-removed', eventData);
        targetSocket.leave(`group:${group._id}`);
      }
    }

    res.json({
      success: true,
      message: 'Member removed successfully',
      data: { group },
    });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error removing member',
    });
  }
};

/**
 * PUT /api/groups/:id/change-role
 * Change a member's role (admin only)
 * Body: { userId, role: 'admin' | 'moderator' | 'member' }
 */
const changeMemberRole = async (req, res) => {
  try {
    const { userId, role } = req.body;
    const group = await Group.findById(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    // Only admin can change roles
    if (!group.canChangeRole(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Only admin can change member roles',
      });
    }

    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${Object.values(ROLES).join(', ')}`,
      });
    }

    // Cannot change own role
    if (req.user._id.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change your own role',
      });
    }

    const member = group.members.find(
      m => (m.user?._id || m.user).toString() === userId.toString()
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'User is not a member of this group',
      });
    }

    const oldRole = member.role;
    member.role = role;

    // If promoting to admin, transfer admin field too
    if (role === ROLES.ADMIN) {
      // Demote current admin to moderator
      const currentAdmin = group.members.find(
        m => (m.user?._id || m.user).toString() === req.user._id.toString()
      );
      if (currentAdmin) currentAdmin.role = ROLES.MODERATOR;
      group.admin = userId;
    }

    await group.save();

    const targetUser = await User.findById(userId);
    const targetName = targetUser?.username || 'Unknown';

    await Message.create({
      sender: req.user._id,
      group: group._id,
      content: `${req.user.username} changed ${targetName}'s role from ${oldRole} to ${role}`,
      type: 'system',
    });

    await group.populate('members.user', 'username avatar isOnline');
    await group.populate('admin', 'username avatar');

    // Notify via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`group:${group._id}`).emit('group:role-changed', {
        groupId: group._id.toString(),
        userId,
        username: targetName,
        oldRole,
        newRole: role,
        changedBy: req.user.username,
      });
    }

    res.json({
      success: true,
      message: `Role changed to ${role}`,
      data: { group },
    });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error changing role',
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
      isMember: g.members.some(m => (m.user?._id || m.user).toString() === req.user._id.toString()),
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
  removeMember,
  changeMemberRole,
  getAllGroups,
};
