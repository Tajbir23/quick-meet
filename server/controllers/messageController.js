/**
 * ============================================
 * Message Controller
 * ============================================
 * 
 * Handles: Send message, get conversations, mark as read
 * 
 * NOTE: Messages are persisted via REST API.
 * Real-time delivery is handled by Socket.io (see socket/chat.js).
 * The flow is:
 * 1. Client sends message via REST → saved to DB
 * 2. Server emits socket event → recipient gets real-time notification
 */

const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');

/**
 * POST /api/messages
 * Send a 1-to-1 message
 */
const sendMessage = async (req, res) => {
  try {
    const { receiverId, content, type, fileUrl, fileName, fileSize, fileMimeType } = req.body;

    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: 'Receiver ID is required',
      });
    }

    if (!content && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Message content or file is required',
      });
    }

    // Verify receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found',
      });
    }

    const message = await Message.create({
      sender: req.user._id,
      receiver: receiverId,
      content: content || '',
      type: type || 'text',
      fileUrl,
      fileName,
      fileSize,
      fileMimeType,
    });

    // Populate sender info for response
    await message.populate('sender', 'username avatar');
    await message.populate('receiver', 'username avatar');

    res.status(201).json({
      success: true,
      data: { message },
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error sending message',
    });
  }
};

/**
 * POST /api/messages/group
 * Send a group message
 */
const sendGroupMessage = async (req, res) => {
  try {
    const { groupId, content, type, fileUrl, fileName, fileSize, fileMimeType } = req.body;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
    }

    if (!content && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Message content or file is required',
      });
    }

    // Verify group exists and user is a member
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    if (!group.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group',
      });
    }

    const message = await Message.create({
      sender: req.user._id,
      group: groupId,
      content: content || '',
      type: type || 'text',
      fileUrl,
      fileName,
      fileSize,
      fileMimeType,
    });

    await message.populate('sender', 'username avatar');

    res.status(201).json({
      success: true,
      data: { message },
    });
  } catch (error) {
    console.error('Send group message error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error sending group message',
    });
  }
};

/**
 * GET /api/messages/:userId
 * Get conversation with a specific user (paginated)
 */
const getConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const messages = await Message.getConversation(
      req.user._id,
      userId,
      page,
      limit
    );

    // Get total count for pagination
    const total = await Message.countDocuments({
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id },
      ],
      group: null,
    });

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Oldest first for display
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching conversation',
    });
  }
};

/**
 * GET /api/messages/group/:groupId
 * Get group messages (paginated)
 */
const getGroupMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    // Verify membership
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found',
      });
    }

    if (!group.isMember(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group',
      });
    }

    const messages = await Message.getGroupMessages(groupId, page, limit);

    const total = await Message.countDocuments({ group: groupId });

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching group messages',
    });
  }
};

/**
 * PUT /api/messages/read/:userId
 * Mark all messages from a user as read
 */
const markAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    await Message.updateMany(
      {
        sender: userId,
        receiver: req.user._id,
        read: false,
      },
      {
        read: true,
        readAt: new Date(),
      }
    );

    res.json({
      success: true,
      message: 'Messages marked as read',
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error marking messages as read',
    });
  }
};

/**
 * GET /api/messages/unread/count
 * Get unread message count per conversation
 */
const getUnreadCounts = async (req, res) => {
  try {
    const counts = await Message.aggregate([
      {
        $match: {
          receiver: req.user._id,
          read: false,
          group: null,
        },
      },
      {
        $group: {
          _id: '$sender',
          count: { $sum: 1 },
        },
      },
    ]);

    // Convert to object { senderId: count }
    const unreadMap = {};
    counts.forEach(item => {
      unreadMap[item._id.toString()] = item.count;
    });

    res.json({
      success: true,
      data: { unread: unreadMap },
    });
  } catch (error) {
    console.error('Get unread counts error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error getting unread counts',
    });
  }
};

module.exports = {
  sendMessage,
  sendGroupMessage,
  getConversation,
  getGroupMessages,
  markAsRead,
  getUnreadCounts,
};
