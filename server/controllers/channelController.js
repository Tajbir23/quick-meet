/**
 * ============================================
 * Channel Controller — Telegram-Style Channels
 * ============================================
 * 
 * Full CRUD + advanced features:
 * - Create/edit/delete channels
 * - Subscribe/unsubscribe
 * - Role management (owner/admin/moderator/subscriber)
 * - Admin permissions (granular)
 * - Post messages (admins only)
 * - Reactions, comments, polls
 * - Invite links (with expiry, usage limit, approval)
 * - Join requests (approve/reject)
 * - Ban/unban subscribers
 * - Pin/unpin messages
 * - Schedule posts
 * - Edit/delete posts
 * - View tracking
 * - Channel statistics
 * - Live stream management
 * - Forward posts
 * - Search channels
 */

const Channel = require('../models/Channel');
const ChannelMessage = require('../models/ChannelMessage');
const User = require('../models/User');

const { ROLES: CHANNEL_ROLES } = Channel;

// ══════════════════════════════════════════════
// CHANNEL CRUD
// ══════════════════════════════════════════════

/**
 * POST /api/channels
 * Create a new channel
 */
const createChannel = async (req, res) => {
  try {
    const { name, username, description, type } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Channel name is required' });
    }

    // Check username uniqueness
    if (username) {
      const existing = await Channel.findOne({ username: username.toLowerCase() });
      if (existing) {
        return res.status(400).json({ success: false, message: 'This username is already taken' });
      }
    }

    const memberEntry = {
      user: req.user._id,
      role: CHANNEL_ROLES.OWNER,
      permissions: {
        change_channel_info: true,
        post_messages: true,
        edit_messages: true,
        delete_messages: true,
        invite_users: true,
        manage_live_streams: true,
        pin_messages: true,
        manage_subscribers: true,
        add_admins: true,
        remain_anonymous: false,
      },
    };

    const channel = await Channel.create({
      name,
      username: username?.toLowerCase() || undefined,
      description: description || '',
      type: type || 'public',
      owner: req.user._id,
      members: [memberEntry],
    });

    // Generate default invite link
    const code = channel.generateInviteLink(req.user._id, { name: 'Default' });
    channel.defaultInviteCode = code;
    await channel.save();

    await channel.populate('members.user', 'username avatar isOnline');
    await channel.populate('owner', 'username avatar');

    // System message
    await ChannelMessage.create({
      channel: channel._id,
      sender: req.user._id,
      content: `Channel "${name}" was created`,
      type: 'system',
    });

    res.status(201).json({
      success: true,
      message: 'Channel created successfully',
      data: { channel },
    });
  } catch (error) {
    console.error('Create channel error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Channel username already taken' });
    }
    res.status(500).json({ success: false, message: 'Server error creating channel' });
  }
};

/**
 * PUT /api/channels/:id
 * Edit channel info
 */
const editChannel = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canEditInfo(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission to edit channel' });
    }

    const { name, username, description, type, settings } = req.body;

    if (name) channel.name = name;
    if (description !== undefined) channel.description = description;
    if (type) channel.type = type;

    // Username change
    if (username !== undefined) {
      if (username) {
        const existing = await Channel.findOne({
          username: username.toLowerCase(),
          _id: { $ne: channel._id },
        });
        if (existing) {
          return res.status(400).json({ success: false, message: 'Username already taken' });
        }
        channel.username = username.toLowerCase();
      } else {
        channel.username = undefined;
      }
    }

    // Update settings
    if (settings) {
      Object.keys(settings).forEach(key => {
        if (channel.settings[key] !== undefined) {
          channel.settings[key] = settings[key];
        }
      });
    }

    await channel.save();
    await channel.populate('members.user', 'username avatar isOnline');
    await channel.populate('owner', 'username avatar');

    // Notify via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:updated', {
        channelId: channel._id.toString(),
        channel: channel.toObject(),
      });
    }

    res.json({
      success: true,
      message: 'Channel updated',
      data: { channel },
    });
  } catch (error) {
    console.error('Edit channel error:', error);
    res.status(500).json({ success: false, message: 'Server error editing channel' });
  }
};

/**
 * DELETE /api/channels/:id
 * Delete channel (owner only)
 */
const deleteChannel = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.isOwner(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only channel owner can delete' });
    }

    channel.isActive = false;
    await channel.save();

    // Notify all members
    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:deleted', {
        channelId: channel._id.toString(),
      });
    }

    // Delete all messages
    await ChannelMessage.updateMany(
      { channel: channel._id },
      { isDeleted: true }
    );

    res.json({ success: true, message: 'Channel deleted' });
  } catch (error) {
    console.error('Delete channel error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting channel' });
  }
};

/**
 * GET /api/channels
 * Get my channels (subscribed)
 */
const getMyChannels = async (req, res) => {
  try {
    const channels = await Channel.find({
      'members.user': req.user._id,
      'members.isBanned': { $ne: true },
      isActive: true,
    })
      .populate('members.user', 'username avatar isOnline')
      .populate('owner', 'username avatar')
      .sort({ updatedAt: -1 });

    // Filter out channels where user is banned
    const filtered = channels.filter(ch => {
      const member = ch.members.find(m =>
        (m.user?._id || m.user).toString() === req.user._id.toString()
      );
      return member && !member.isBanned;
    });

    res.json({ success: true, data: { channels: filtered } });
  } catch (error) {
    console.error('Get my channels error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/discover
 * Discover public channels
 */
const discoverChannels = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = { type: 'public', isActive: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const channels = await Channel.find(query)
      .populate('owner', 'username avatar')
      .select('name username description avatar type members owner stats createdAt')
      .sort({ 'members.length': -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Channel.countDocuments(query);

    const channelsWithMeta = channels.map(ch => ({
      ...ch.toObject(),
      subscriberCount: ch.members.filter(m => !m.isBanned).length,
      isSubscribed: ch.members.some(m =>
        (m.user?._id || m.user).toString() === req.user._id.toString() && !m.isBanned
      ),
    }));

    res.json({
      success: true,
      data: {
        channels: channelsWithMeta,
        total,
        page: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error('Discover channels error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/:id
 * Get channel details
 */
const getChannelById = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id)
      .populate('members.user', 'username avatar isOnline lastSeen')
      .populate('owner', 'username avatar');

    if (!channel || !channel.isActive) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    res.json({ success: true, data: { channel } });
  } catch (error) {
    console.error('Get channel error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/by-username/:username
 * Get channel by public username (@username)
 */
const getChannelByUsername = async (req, res) => {
  try {
    const channel = await Channel.findOne({
      username: req.params.username.toLowerCase(),
      isActive: true,
    })
      .populate('members.user', 'username avatar isOnline')
      .populate('owner', 'username avatar');

    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    res.json({ success: true, data: { channel } });
  } catch (error) {
    console.error('Get channel by username error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// SUBSCRIPTION
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/subscribe
 * Subscribe to a channel
 */
const subscribeChannel = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel || !channel.isActive) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (channel.isBannedMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You are banned from this channel' });
    }

    if (channel.isMember(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Already subscribed' });
    }

    // Private channels need invite link or request
    if (channel.type === 'private') {
      return res.status(403).json({
        success: false,
        message: 'This is a private channel. Use an invite link to join.',
      });
    }

    channel.members.push({
      user: req.user._id,
      role: CHANNEL_ROLES.SUBSCRIBER,
    });
    await channel.save();

    await channel.populate('members.user', 'username avatar isOnline');
    await channel.populate('owner', 'username avatar');

    // Socket: join room + notify
    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:subscriber-joined', {
        channelId: channel._id.toString(),
        userId: req.user._id.toString(),
        username: req.user.username,
        subscriberCount: channel.subscriberCount,
      });

      // Auto-join socket room
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === req.user._id.toString());
      if (targetSocket) {
        targetSocket.join(`channel:${channel._id}`);
      }
    }

    res.json({
      success: true,
      message: 'Subscribed successfully',
      data: { channel },
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/unsubscribe
 * Leave a channel
 */
const unsubscribeChannel = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.isMember(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Not subscribed' });
    }

    // Owner cannot leave (must transfer first)
    if (channel.isOwner(req.user._id)) {
      return res.status(400).json({
        success: false,
        message: 'Owner cannot leave. Transfer ownership first.',
      });
    }

    channel.members = channel.members.filter(
      m => (m.user?._id || m.user).toString() !== req.user._id.toString()
    );
    await channel.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:subscriber-left', {
        channelId: channel._id.toString(),
        userId: req.user._id.toString(),
        subscriberCount: channel.subscriberCount,
      });
    }

    res.json({ success: true, message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// INVITE LINKS
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/invite-links
 * Create an invite link
 */
const createInviteLink = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canInvite(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const { name, expiresAt, maxUses, requiresApproval } = req.body;
    const code = channel.generateInviteLink(req.user._id, {
      name, expiresAt, maxUses, requiresApproval,
    });
    await channel.save();

    res.status(201).json({
      success: true,
      data: { code, inviteLink: channel.inviteLinks.find(l => l.code === code) },
    });
  } catch (error) {
    console.error('Create invite link error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/:id/invite-links
 * List all invite links
 */
const getInviteLinks = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id)
      .populate('inviteLinks.createdBy', 'username');

    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canInvite(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    res.json({
      success: true,
      data: {
        inviteLinks: channel.inviteLinks.filter(l => !l.isRevoked),
        defaultInviteCode: channel.defaultInviteCode,
      },
    });
  } catch (error) {
    console.error('Get invite links error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/channels/:id/invite-links/:linkId
 * Revoke an invite link
 */
const revokeInviteLink = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canInvite(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const link = channel.inviteLinks.id(req.params.linkId);
    if (!link) return res.status(404).json({ success: false, message: 'Link not found' });

    link.isRevoked = true;
    await channel.save();

    res.json({ success: true, message: 'Invite link revoked' });
  } catch (error) {
    console.error('Revoke invite link error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/join/:code
 * Join via invite link
 */
const joinViaInviteLink = async (req, res) => {
  try {
    const { code } = req.params;
    const channel = await Channel.findOne({
      'inviteLinks.code': code,
      isActive: true,
    });

    if (!channel) {
      return res.status(404).json({ success: false, message: 'Invalid or expired invite link' });
    }

    const link = channel.inviteLinks.find(l => l.code === code);
    if (!link || link.isRevoked) {
      return res.status(400).json({ success: false, message: 'Invite link has been revoked' });
    }
    if (link.expiresAt && new Date() > link.expiresAt) {
      return res.status(400).json({ success: false, message: 'Invite link has expired' });
    }
    if (link.maxUses > 0 && link.usedCount >= link.maxUses) {
      return res.status(400).json({ success: false, message: 'Invite link usage limit reached' });
    }

    if (channel.isBannedMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You are banned from this channel' });
    }

    if (channel.isMember(req.user._id)) {
      return res.status(400).json({ success: false, message: 'Already subscribed' });
    }

    // If requires approval, create join request
    if (link.requiresApproval) {
      const existingRequest = channel.joinRequests.find(
        r => (r.user?.toString() || r.user) === req.user._id.toString() && r.status === 'pending'
      );
      if (existingRequest) {
        return res.status(400).json({ success: false, message: 'Join request already pending' });
      }

      channel.joinRequests.push({
        user: req.user._id,
        inviteLink: code,
        message: req.body.message || '',
      });
      await channel.save();

      // Notify admins
      const io = req.app.get('io');
      if (io) {
        io.to(`channel:${channel._id}`).emit('channel:join-request', {
          channelId: channel._id.toString(),
          userId: req.user._id.toString(),
          username: req.user.username,
        });
      }

      return res.json({
        success: true,
        message: 'Join request sent. An admin will review it.',
        data: { requiresApproval: true },
      });
    }

    // Direct join
    channel.members.push({
      user: req.user._id,
      role: CHANNEL_ROLES.SUBSCRIBER,
    });
    link.usedCount += 1;
    await channel.save();

    await channel.populate('members.user', 'username avatar isOnline');
    await channel.populate('owner', 'username avatar');

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === req.user._id.toString());
      if (targetSocket) {
        targetSocket.join(`channel:${channel._id}`);
      }
    }

    res.json({
      success: true,
      message: 'Joined channel',
      data: { channel },
    });
  } catch (error) {
    console.error('Join via invite error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// JOIN REQUESTS
// ══════════════════════════════════════════════

/**
 * GET /api/channels/:id/join-requests
 */
const getJoinRequests = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id)
      .populate('joinRequests.user', 'username avatar');

    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const pendingRequests = channel.joinRequests.filter(r => r.status === 'pending');
    res.json({ success: true, data: { requests: pendingRequests } });
  } catch (error) {
    console.error('Get join requests error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/join-requests/:requestId/approve
 */
const approveJoinRequest = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const request = channel.joinRequests.id(req.params.requestId);
    if (!request || request.status !== 'pending') {
      return res.status(404).json({ success: false, message: 'Request not found or already processed' });
    }

    request.status = 'approved';
    request.reviewedBy = req.user._id;

    if (!channel.isMember(request.user)) {
      channel.members.push({
        user: request.user,
        role: CHANNEL_ROLES.SUBSCRIBER,
      });
    }

    await channel.save();

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === request.user.toString());
      if (targetSocket) {
        targetSocket.join(`channel:${channel._id}`);
        targetSocket.emit('channel:join-approved', {
          channelId: channel._id.toString(),
          channelName: channel.name,
        });
      }
    }

    res.json({ success: true, message: 'Join request approved' });
  } catch (error) {
    console.error('Approve join request error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/join-requests/:requestId/reject
 */
const rejectJoinRequest = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const request = channel.joinRequests.id(req.params.requestId);
    if (!request || request.status !== 'pending') {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }

    request.status = 'rejected';
    request.reviewedBy = req.user._id;
    await channel.save();

    res.json({ success: true, message: 'Join request rejected' });
  } catch (error) {
    console.error('Reject join request error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// MEMBER / ROLE MANAGEMENT
// ══════════════════════════════════════════════

/**
 * PUT /api/channels/:id/members/:userId/role
 * Change member role
 */
const changeMemberRole = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    const { role, permissions, customTitle } = req.body;
    const targetUserId = req.params.userId;

    if (!channel.canChangeRole(req.user._id, targetUserId)) {
      return res.status(403).json({ success: false, message: 'No permission to change role' });
    }

    if (!Object.values(CHANNEL_ROLES).includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    // Can't set someone as owner through this endpoint
    if (role === CHANNEL_ROLES.OWNER) {
      return res.status(400).json({ success: false, message: 'Use transfer-ownership endpoint' });
    }

    const member = channel.getMember(targetUserId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    member.role = role;
    if (customTitle !== undefined) member.customTitle = customTitle;
    if (permissions && (role === CHANNEL_ROLES.ADMIN || role === CHANNEL_ROLES.MODERATOR)) {
      Object.keys(permissions).forEach(key => {
        if (member.permissions[key] !== undefined) {
          member.permissions[key] = permissions[key];
        }
      });
    }

    await channel.save();
    await channel.populate('members.user', 'username avatar isOnline');

    const targetUser = await User.findById(targetUserId);

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:role-changed', {
        channelId: channel._id.toString(),
        userId: targetUserId,
        username: targetUser?.username || 'Unknown',
        newRole: role,
        changedBy: req.user.username,
      });
    }

    res.json({
      success: true,
      message: `Role changed to ${role}`,
      data: { channel },
    });
  } catch (error) {
    console.error('Change role error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/transfer-ownership
 * Transfer channel ownership
 */
const transferOwnership = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.isOwner(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Only owner can transfer ownership' });
    }

    const { userId } = req.body;
    if (!channel.isMember(userId)) {
      return res.status(400).json({ success: false, message: 'Target is not a member' });
    }

    // Current owner becomes admin
    const currentOwner = channel.getMember(req.user._id);
    currentOwner.role = CHANNEL_ROLES.ADMIN;

    // New owner
    const newOwner = channel.getMember(userId);
    newOwner.role = CHANNEL_ROLES.OWNER;
    newOwner.permissions = {
      change_channel_info: true,
      post_messages: true,
      edit_messages: true,
      delete_messages: true,
      invite_users: true,
      manage_live_streams: true,
      pin_messages: true,
      manage_subscribers: true,
      add_admins: true,
      remain_anonymous: false,
    };

    channel.owner = userId;
    await channel.save();

    const targetUser = await User.findById(userId);

    await ChannelMessage.create({
      channel: channel._id,
      sender: req.user._id,
      content: `${req.user.username} transferred ownership to ${targetUser?.username}`,
      type: 'system',
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:ownership-transferred', {
        channelId: channel._id.toString(),
        newOwnerId: userId,
        newOwnerUsername: targetUser?.username,
      });
    }

    res.json({ success: true, message: 'Ownership transferred' });
  } catch (error) {
    console.error('Transfer ownership error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/ban/:userId
 * Ban a subscriber
 */
const banMember = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const targetUserId = req.params.userId;
    const member = channel.getMember(targetUserId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    // Can't ban someone with higher or equal role
    const actorRole = channel.getMemberRole(req.user._id);
    const targetLevel = Channel.ROLE_HIERARCHY[member.role] || 0;
    const actorLevel = Channel.ROLE_HIERARCHY[actorRole] || 0;
    if (targetLevel >= actorLevel) {
      return res.status(403).json({ success: false, message: 'Cannot ban someone with higher/equal role' });
    }

    member.isBanned = true;
    member.bannedAt = new Date();
    member.bannedBy = req.user._id;
    member.bannedReason = req.body.reason || '';
    await channel.save();

    const targetUser = await User.findById(targetUserId);

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === targetUserId);
      if (targetSocket) {
        targetSocket.emit('channel:banned', {
          channelId: channel._id.toString(),
          channelName: channel.name,
          reason: req.body.reason || '',
        });
        targetSocket.leave(`channel:${channel._id}`);
      }
    }

    res.json({ success: true, message: `${targetUser?.username} has been banned` });
  } catch (error) {
    console.error('Ban member error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/unban/:userId
 */
const unbanMember = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const member = channel.getMember(req.params.userId);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

    member.isBanned = false;
    member.bannedAt = null;
    member.bannedBy = null;
    member.bannedReason = '';
    await channel.save();

    res.json({ success: true, message: 'Member unbanned' });
  } catch (error) {
    console.error('Unban member error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/remove-member/:userId
 * Remove member from channel (without banning)
 */
const removeMember = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const targetUserId = req.params.userId;
    if (channel.isOwner(targetUserId)) {
      return res.status(403).json({ success: false, message: 'Cannot remove channel owner' });
    }

    channel.members = channel.members.filter(
      m => (m.user?._id || m.user).toString() !== targetUserId
    );
    await channel.save();

    res.json({ success: true, message: 'Member removed' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/:id/banned
 * Get banned members
 */
const getBannedMembers = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id)
      .populate('members.user', 'username avatar');

    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageSubscribers(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const banned = channel.members.filter(m => m.isBanned);
    res.json({ success: true, data: { banned } });
  } catch (error) {
    console.error('Get banned error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// MESSAGES / POSTS
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/posts
 * Create a channel post (admins/owner only)
 */
const createPost = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel || !channel.isActive) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (!channel.canPost(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission to post' });
    }

    const {
      content, type, fileUrl, fileName, fileSize, fileMimeType,
      mediaGroup, poll, isSilent, scheduledFor, commentsDisabled,
    } = req.body;

    const postData = {
      channel: channel._id,
      sender: req.user._id,
      content: content || '',
      type: type || 'text',
      fileUrl, fileName, fileSize, fileMimeType,
      mediaGroup: mediaGroup || [],
      isSilent: isSilent || false,
      commentsDisabled: commentsDisabled || false,
    };

    // Author signature
    if (channel.settings.signMessages) {
      const member = channel.getMember(req.user._id);
      postData.authorSignature = member.customTitle || req.user.username;
    }

    // Poll
    if (type === 'poll' && poll) {
      postData.poll = {
        question: poll.question,
        options: poll.options.map(o => ({ text: o.text || o, voters: [] })),
        isAnonymous: poll.isAnonymous !== false,
        allowMultipleAnswers: poll.allowMultipleAnswers || false,
        isQuiz: poll.isQuiz || false,
        correctOptionId: poll.correctOptionId || null,
        explanation: poll.explanation || '',
        closesAt: poll.closesAt || null,
      };
    }

    // Scheduled post
    if (scheduledFor && new Date(scheduledFor) > new Date()) {
      postData.isScheduled = true;
      postData.scheduledFor = new Date(scheduledFor);
    }

    const post = await ChannelMessage.create(postData);
    await post.populate('sender', 'username avatar');

    // Only broadcast if not scheduled
    if (!postData.isScheduled) {
      const io = req.app.get('io');
      if (io) {
        io.to(`channel:${channel._id}`).emit('channel:new-post', {
          channelId: channel._id.toString(),
          post: post.toObject(),
          isSilent: postData.isSilent,
        });
      }
    }

    res.status(201).json({
      success: true,
      message: postData.isScheduled ? 'Post scheduled' : 'Post published',
      data: { post },
    });
  } catch (error) {
    console.error('Create post error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/:id/posts
 * Get channel posts
 */
const getPosts = async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const posts = await ChannelMessage.getChannelPosts(
      req.params.id,
      parseInt(page),
      parseInt(limit)
    );

    // Track views
    const userId = req.user._id;
    const postIds = posts.map(p => p._id);
    if (postIds.length > 0) {
      // Bulk add views (fire-and-forget)
      ChannelMessage.updateMany(
        { _id: { $in: postIds }, viewedBy: { $ne: userId } },
        { $inc: { views: 1 }, $addToSet: { viewedBy: userId } }
      ).catch(() => {});
    }

    res.json({ success: true, data: { posts } });
  } catch (error) {
    console.error('Get posts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/:id/posts/pinned
 * Get pinned posts
 */
const getPinnedPosts = async (req, res) => {
  try {
    const posts = await ChannelMessage.getPinnedPosts(req.params.id);
    res.json({ success: true, data: { posts } });
  } catch (error) {
    console.error('Get pinned posts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/channels/:id/posts/scheduled
 * Get scheduled posts (admins only)
 */
const getScheduledPosts = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canPost(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const posts = await ChannelMessage.getScheduledPosts(req.params.id);
    res.json({ success: true, data: { posts } });
  } catch (error) {
    console.error('Get scheduled posts error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * PUT /api/channels/:id/posts/:postId
 * Edit a post
 */
const editPost = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    // Check edit permission
    const member = channel.getMember(req.user._id);
    const canEdit = post.sender.toString() === req.user._id.toString() ||
      (member && (member.role === CHANNEL_ROLES.OWNER || 
       (member.role === CHANNEL_ROLES.ADMIN && member.permissions.edit_messages)));

    if (!canEdit) {
      return res.status(403).json({ success: false, message: 'No permission to edit' });
    }

    // Save edit history
    post.editHistory.push({ content: post.content });
    post.content = req.body.content;
    post.isEdited = true;
    post.lastEditedAt = new Date();
    await post.save();

    await post.populate('sender', 'username avatar');

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:post-edited', {
        channelId: channel._id.toString(),
        post: post.toObject(),
      });
    }

    res.json({ success: true, data: { post } });
  } catch (error) {
    console.error('Edit post error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/channels/:id/posts/:postId
 * Delete a post
 */
const deletePost = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canDeleteMessages(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission to delete' });
    }

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    post.isDeleted = true;
    post.deletedBy = req.user._id;
    await post.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:post-deleted', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
      });
    }

    res.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    console.error('Delete post error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/posts/:postId/pin
 * Pin/unpin a post
 */
const togglePinPost = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canPin(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission to pin' });
    }

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    post.isPinned = !post.isPinned;
    if (post.isPinned) {
      post.pinnedBy = req.user._id;
      post.pinnedAt = new Date();
      if (!channel.pinnedMessageIds.includes(post._id)) {
        channel.pinnedMessageIds.push(post._id);
      }
    } else {
      post.pinnedBy = null;
      post.pinnedAt = null;
      channel.pinnedMessageIds = channel.pinnedMessageIds.filter(
        id => id.toString() !== post._id.toString()
      );
    }

    await post.save();
    await channel.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:post-pinned', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
        isPinned: post.isPinned,
      });
    }

    res.json({
      success: true,
      message: post.isPinned ? 'Post pinned' : 'Post unpinned',
    });
  } catch (error) {
    console.error('Pin post error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// REACTIONS
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/posts/:postId/react
 * Add/remove reaction
 */
const toggleReaction = async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ success: false, message: 'Emoji required' });

    const channel = await Channel.findById(req.params.id);
    if (!channel || !channel.settings.allowReactions) {
      return res.status(400).json({ success: false, message: 'Reactions not allowed' });
    }

    if (!channel.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not a subscriber' });
    }

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post || post.isDeleted) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    let reaction = post.reactions.find(r => r.emoji === emoji);
    let added = false;

    if (reaction) {
      const userIndex = reaction.users.findIndex(
        u => u.toString() === req.user._id.toString()
      );
      if (userIndex > -1) {
        reaction.users.splice(userIndex, 1);
        reaction.count -= 1;
        if (reaction.count <= 0) {
          post.reactions = post.reactions.filter(r => r.emoji !== emoji);
        }
      } else {
        reaction.users.push(req.user._id);
        reaction.count += 1;
        added = true;
      }
    } else {
      post.reactions.push({
        emoji,
        users: [req.user._id],
        count: 1,
      });
      added = true;
    }

    post.totalReactions = post.reactions.reduce((sum, r) => sum + r.count, 0);
    await post.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:reaction-updated', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
        reactions: post.reactions,
        totalReactions: post.totalReactions,
      });
    }

    res.json({
      success: true,
      message: added ? 'Reaction added' : 'Reaction removed',
      data: { reactions: post.reactions, totalReactions: post.totalReactions },
    });
  } catch (error) {
    console.error('Reaction error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/posts/:postId/comments
 * Add a comment
 */
const addComment = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel || !channel.settings.allowComments) {
      return res.status(400).json({ success: false, message: 'Comments not allowed' });
    }

    if (!channel.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not a subscriber' });
    }

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post || post.isDeleted || post.commentsDisabled) {
      return res.status(404).json({ success: false, message: 'Post not found or comments disabled' });
    }

    // Slow mode check
    if (channel.settings.slowMode > 0) {
      const member = channel.getMember(req.user._id);
      if (member.role === CHANNEL_ROLES.SUBSCRIBER) {
        const lastComment = post.comments
          .filter(c => c.sender.toString() === req.user._id.toString())
          .sort((a, b) => b.createdAt - a.createdAt)[0];

        if (lastComment) {
          const elapsed = (Date.now() - new Date(lastComment.createdAt).getTime()) / 1000;
          if (elapsed < channel.settings.slowMode) {
            return res.status(429).json({
              success: false,
              message: `Slow mode: wait ${Math.ceil(channel.settings.slowMode - elapsed)}s`,
            });
          }
        }
      }
    }

    const { content, type, fileUrl, fileName, fileSize } = req.body;

    post.comments.push({
      sender: req.user._id,
      content,
      type: type || 'text',
      fileUrl, fileName, fileSize,
    });
    post.commentCount = post.comments.filter(c => !c.isDeleted).length;
    await post.save();

    const newComment = post.comments[post.comments.length - 1];
    await post.populate('comments.sender', 'username avatar');

    const populatedComment = post.comments.find(
      c => c._id.toString() === newComment._id.toString()
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:new-comment', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
        comment: populatedComment,
        commentCount: post.commentCount,
      });
    }

    res.status(201).json({
      success: true,
      data: { comment: populatedComment, commentCount: post.commentCount },
    });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * DELETE /api/channels/:id/posts/:postId/comments/:commentId
 * Delete a comment
 */
const deleteComment = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

    // Can delete own comment or if have moderator+ role
    const canDelete = comment.sender.toString() === req.user._id.toString() ||
      channel.canDeleteMessages(req.user._id);

    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    comment.isDeleted = true;
    comment.content = 'This comment was deleted';
    post.commentCount = post.comments.filter(c => !c.isDeleted).length;
    await post.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:comment-deleted', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
        commentId: req.params.commentId,
        commentCount: post.commentCount,
      });
    }

    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// POLLS
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/posts/:postId/vote
 * Vote on a poll
 */
const votePoll = async (req, res) => {
  try {
    const { optionIds } = req.body; // array of option IDs

    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not a subscriber' });
    }

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post || !post.poll || post.isDeleted) {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }

    if (post.poll.isClosed) {
      return res.status(400).json({ success: false, message: 'Poll is closed' });
    }

    if (post.poll.closesAt && new Date() > post.poll.closesAt) {
      post.poll.isClosed = true;
      await post.save();
      return res.status(400).json({ success: false, message: 'Poll has expired' });
    }

    // Remove existing votes
    post.poll.options.forEach(opt => {
      opt.voters = opt.voters.filter(v => v.toString() !== req.user._id.toString());
    });

    // Add new votes
    const selectedIds = Array.isArray(optionIds) ? optionIds : [optionIds];
    if (!post.poll.allowMultipleAnswers && selectedIds.length > 1) {
      return res.status(400).json({ success: false, message: 'Only one answer allowed' });
    }

    selectedIds.forEach(optId => {
      const option = post.poll.options.id(optId);
      if (option) {
        option.voters.push(req.user._id);
      }
    });

    // Update total voters
    const allVoters = new Set();
    post.poll.options.forEach(opt => {
      opt.voters.forEach(v => allVoters.add(v.toString()));
    });
    post.poll.totalVoters = allVoters.size;

    await post.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:poll-updated', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
        poll: post.poll,
      });
    }

    res.json({ success: true, data: { poll: post.poll } });
  } catch (error) {
    console.error('Vote poll error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/posts/:postId/close-poll
 * Close a poll (admin only)
 */
const closePoll = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canPost(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    const post = await ChannelMessage.findById(req.params.postId);
    if (!post || !post.poll) {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }

    post.poll.isClosed = true;
    await post.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${channel._id}`).emit('channel:poll-closed', {
        channelId: channel._id.toString(),
        postId: post._id.toString(),
        poll: post.poll,
      });
    }

    res.json({ success: true, message: 'Poll closed' });
  } catch (error) {
    console.error('Close poll error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// FORWARD
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/posts/:postId/forward
 * Forward a post to another channel
 */
const forwardPost = async (req, res) => {
  try {
    const { targetChannelId } = req.body;

    const sourceChannel = await Channel.findById(req.params.id);
    if (!sourceChannel) return res.status(404).json({ success: false, message: 'Source channel not found' });

    if (sourceChannel.settings.protectedContent) {
      return res.status(403).json({ success: false, message: 'Content forwarding is disabled for this channel' });
    }

    const targetChannel = await Channel.findById(targetChannelId);
    if (!targetChannel || !targetChannel.isActive) {
      return res.status(404).json({ success: false, message: 'Target channel not found' });
    }

    if (!targetChannel.canPost(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission to post in target channel' });
    }

    const originalPost = await ChannelMessage.findById(req.params.postId);
    if (!originalPost || originalPost.isDeleted) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const forwardedPost = await ChannelMessage.create({
      channel: targetChannelId,
      sender: req.user._id,
      content: originalPost.content,
      type: originalPost.type,
      fileUrl: originalPost.fileUrl,
      fileName: originalPost.fileName,
      fileSize: originalPost.fileSize,
      fileMimeType: originalPost.fileMimeType,
      mediaGroup: originalPost.mediaGroup,
      poll: originalPost.poll ? { ...originalPost.poll.toObject(), totalVoters: 0 } : undefined,
      forwardedFrom: {
        channelId: sourceChannel._id,
        channelName: sourceChannel.name,
        originalMessageId: originalPost._id,
      },
    });

    await forwardedPost.populate('sender', 'username avatar');

    const io = req.app.get('io');
    if (io) {
      io.to(`channel:${targetChannelId}`).emit('channel:new-post', {
        channelId: targetChannelId,
        post: forwardedPost.toObject(),
      });
    }

    res.json({ success: true, data: { post: forwardedPost } });
  } catch (error) {
    console.error('Forward post error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// LIVE STREAM
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/live-stream/start
 * Start a live stream
 */
const startLiveStream = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageLiveStream(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    if (channel.liveStream.isLive) {
      return res.status(400).json({ success: false, message: 'Stream already active' });
    }

    const streamKey = require('crypto').randomBytes(16).toString('hex');

    channel.liveStream = {
      isLive: true,
      title: req.body.title || `Live Stream - ${channel.name}`,
      startedAt: new Date(),
      startedBy: req.user._id,
      viewerCount: 0,
      streamKey,
      isRecording: req.body.isRecording || false,
      chatEnabled: req.body.chatEnabled !== false,
    };
    await channel.save();

    // System message
    await ChannelMessage.create({
      channel: channel._id,
      sender: req.user._id,
      content: `🔴 Live stream started: ${channel.liveStream.title}`,
      type: 'live_stream',
    });

    const io = req.app.get('io');
    if (io) {
      // Join broadcaster to the live room (server-side)
      const sockets = await io.fetchSockets();
      const broadcasterSocket = sockets.find(s => s.userId === req.user._id.toString());
      if (broadcasterSocket) {
        broadcasterSocket.join(`channel-live:${channel._id}`);
      }

      io.to(`channel:${channel._id}`).emit('channel:live-stream-started', {
        channelId: channel._id.toString(),
        liveStream: {
          ...channel.liveStream.toObject(),
          streamKey: undefined, // Don't send stream key to subscribers
        },
      });
    }

    res.json({
      success: true,
      message: 'Live stream started',
      data: {
        liveStream: channel.liveStream,
        streamKey, // Only return to the admin who started it
      },
    });
  } catch (error) {
    console.error('Start live stream error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/live-stream/stop
 * Stop a live stream
 */
const stopLiveStream = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (!channel.canManageLiveStream(req.user._id)) {
      return res.status(403).json({ success: false, message: 'No permission' });
    }

    if (!channel.liveStream.isLive) {
      return res.status(400).json({ success: false, message: 'No active stream' });
    }

    const duration = channel.liveStream.startedAt
      ? Math.round((Date.now() - channel.liveStream.startedAt.getTime()) / 1000)
      : 0;

    channel.liveStream.isLive = false;
    channel.liveStream.streamKey = null;
    await channel.save();

    // System message
    await ChannelMessage.create({
      channel: channel._id,
      sender: req.user._id,
      content: `Live stream ended (Duration: ${Math.round(duration / 60)} min)`,
      type: 'system',
    });

    const io = req.app.get('io');
    if (io) {
      // Clean up stored stream offer
      if (io._channelStreamOffers) {
        delete io._channelStreamOffers[channel._id.toString()];
      }

      io.to(`channel:${channel._id}`).emit('channel:live-stream-ended', {
        channelId: channel._id.toString(),
        duration,
      });

      // Also notify live room
      io.to(`channel-live:${channel._id}`).emit('channel:live-stream-ended', {
        channelId: channel._id.toString(),
        duration,
      });
    }

    res.json({ success: true, message: 'Live stream stopped', data: { duration } });
  } catch (error) {
    console.error('Stop live stream error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/live-stream/join
 * Join as viewer
 */
const joinLiveStream = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel || !channel.liveStream.isLive) {
      return res.status(404).json({ success: false, message: 'No active stream' });
    }

    if (!channel.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not a subscriber' });
    }

    channel.liveStream.viewerCount += 1;
    await channel.save();

    const io = req.app.get('io');
    if (io) {
      // Join live stream room
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === req.user._id.toString());
      if (targetSocket) {
        targetSocket.join(`channel-live:${channel._id}`);
      }

      io.to(`channel:${channel._id}`).emit('channel:live-viewer-count', {
        channelId: channel._id.toString(),
        viewerCount: channel.liveStream.viewerCount,
      });
    }

    res.json({
      success: true,
      data: {
        liveStream: {
          ...channel.liveStream.toObject(),
          streamKey: undefined,
        },
      },
    });
  } catch (error) {
    console.error('Join live stream error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/channels/:id/live-stream/leave
 * Leave as viewer
 */
const leaveLiveStream = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    if (channel.liveStream.viewerCount > 0) {
      channel.liveStream.viewerCount -= 1;
      await channel.save();
    }

    const io = req.app.get('io');
    if (io) {
      const sockets = await io.fetchSockets();
      const targetSocket = sockets.find(s => s.userId === req.user._id.toString());
      if (targetSocket) {
        targetSocket.leave(`channel-live:${channel._id}`);
      }

      io.to(`channel:${channel._id}`).emit('channel:live-viewer-count', {
        channelId: channel._id.toString(),
        viewerCount: channel.liveStream.viewerCount,
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Leave live stream error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// STATISTICS
// ══════════════════════════════════════════════

/**
 * GET /api/channels/:id/stats
 * Get channel statistics (admin only)
 */
const getChannelStats = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    const member = channel.getMember(req.user._id);
    if (!member || (member.role !== CHANNEL_ROLES.OWNER && member.role !== CHANNEL_ROLES.ADMIN)) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    // Compute stats
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [totalPosts, recentPosts, recentMessages] = await Promise.all([
      ChannelMessage.countDocuments({ channel: channel._id, isDeleted: false, type: { $ne: 'system' } }),
      ChannelMessage.countDocuments({ channel: channel._id, isDeleted: false, createdAt: { $gte: oneDayAgo } }),
      ChannelMessage.find({
        channel: channel._id,
        isDeleted: false,
        createdAt: { $gte: oneWeekAgo },
      }).select('views reactions commentCount'),
    ]);

    const totalViews = recentMessages.reduce((sum, m) => sum + (m.views || 0), 0);
    const totalReactions = recentMessages.reduce((sum, m) => sum + (m.totalReactions || 0), 0);
    const totalComments = recentMessages.reduce((sum, m) => sum + (m.commentCount || 0), 0);

    const subscriberCount = channel.members.filter(m => !m.isBanned).length;
    const newSubscribers = channel.members.filter(
      m => !m.isBanned && new Date(m.joinedAt) >= oneDayAgo
    ).length;

    const avgViews = recentMessages.length > 0
      ? Math.round(totalViews / recentMessages.length)
      : 0;

    const engagementRate = totalViews > 0
      ? ((totalReactions + totalComments) / totalViews * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        stats: {
          subscriberCount,
          newSubscribers24h: newSubscribers,
          totalPosts,
          postsToday: recentPosts,
          totalViewsWeek: totalViews,
          avgPostViews: avgViews,
          totalReactionsWeek: totalReactions,
          totalCommentsWeek: totalComments,
          engagementRate: parseFloat(engagementRate),
        },
      },
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════
// MUTE NOTIFICATIONS
// ══════════════════════════════════════════════

/**
 * POST /api/channels/:id/mute
 */
const toggleMute = async (req, res) => {
  try {
    const channel = await Channel.findById(req.params.id);
    if (!channel) return res.status(404).json({ success: false, message: 'Channel not found' });

    const member = channel.getMember(req.user._id);
    if (!member) return res.status(403).json({ success: false, message: 'Not a subscriber' });

    member.isMuted = !member.isMuted;
    await channel.save();

    res.json({
      success: true,
      message: member.isMuted ? 'Channel muted' : 'Channel unmuted',
      data: { isMuted: member.isMuted },
    });
  } catch (error) {
    console.error('Mute error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  // CRUD
  createChannel,
  editChannel,
  deleteChannel,
  getMyChannels,
  discoverChannels,
  getChannelById,
  getChannelByUsername,
  // Subscription
  subscribeChannel,
  unsubscribeChannel,
  // Invite links
  createInviteLink,
  getInviteLinks,
  revokeInviteLink,
  joinViaInviteLink,
  // Join requests
  getJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  // Members & roles
  changeMemberRole,
  transferOwnership,
  banMember,
  unbanMember,
  removeMember,
  getBannedMembers,
  // Posts
  createPost,
  getPosts,
  getPinnedPosts,
  getScheduledPosts,
  editPost,
  deletePost,
  togglePinPost,
  // Reactions & comments
  toggleReaction,
  addComment,
  deleteComment,
  // Polls
  votePoll,
  closePoll,
  // Forward
  forwardPost,
  // Live stream
  startLiveStream,
  stopLiveStream,
  joinLiveStream,
  leaveLiveStream,
  // Stats
  getChannelStats,
  // Mute
  toggleMute,
};
