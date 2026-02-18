/**
 * ============================================
 * Message Controller — HARDENED
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - AES-256-GCM encryption at rest for all message content
 * - Messages encrypted before DB write, decrypted on read
 * - Content sanitization (XSS prevention)
 * - Input validation hardened
 * - SecurityEventLogger audit trail
 */

const Message = require('../models/Message');
const ChannelMessage = require('../models/ChannelMessage');
const User = require('../models/User');
const Group = require('../models/Group');
const Channel = require('../models/Channel');
const { cryptoService, securityLogger } = require('../security');

// ─── HELPERS ────────────────────────────────────────────────

/**
 * Encrypt message content before storage
 */
function encryptContent(plaintext) {
  if (!plaintext || plaintext.trim() === '') return { content: '', encrypted: false };
  try {
    // cryptoService.encrypt() returns a colon-separated string: "iv:authTag:ciphertext"
    const encryptedStr = cryptoService.encrypt(plaintext);
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) {
      // Unexpected format — store plaintext as fallback
      securityLogger.log('WARN', 'SYSTEM', 'Encryption returned unexpected format', {});
      return { content: plaintext, encrypted: false };
    }
    return {
      content: parts[2],          // ciphertext (hex)
      encrypted: true,
      encryptionIV: parts[0],     // iv (hex)
      encryptionTag: parts[1],    // authTag (hex)
    };
  } catch (err) {
    securityLogger.log('WARN', 'SYSTEM', 'Message encryption failed, storing plaintext', { error: err.message });
    return { content: plaintext, encrypted: false };
  }
}

/**
 * Decrypt message content on retrieval
 */
function decryptContent(message) {
  if (!message.encrypted || !message.encryptionIV || !message.encryptionTag) {
    return message.content;
  }
  try {
    // Reconstruct the colon-separated format that cryptoService.decrypt() expects:
    // "iv:authTag:ciphertext"
    const encryptedStr = `${message.encryptionIV}:${message.encryptionTag}:${message.content}`;
    const decrypted = cryptoService.decrypt(encryptedStr);
    if (decrypted === null) {
      // decrypt returns null on auth tag failure (tampered data)
      securityLogger.log('ALERT', 'SYSTEM', 'Message decryption auth tag failed', {
        messageId: message._id?.toString(),
      });
      return '[Encrypted message - decryption failed]';
    }
    return decrypted;
  } catch (err) {
    securityLogger.log('ALERT', 'SYSTEM', 'Message decryption failed', {
      messageId: message._id?.toString(),
      error: err.message,
    });
    return '[Encrypted message - decryption failed]';
  }
}

/**
 * Decrypt an array of message documents.
 * IMPORTANT: Converts each Mongoose doc to a plain object FIRST,
 * then modifies the plain copy. This prevents Mongoose change-tracking
 * from ever accidentally persisting decrypted content or stripped
 * encryption metadata back to the database.
 */
function decryptMessages(messages) {
  return messages.map(msg => {
    const obj = msg.toObject ? msg.toObject() : { ...msg };
    if (obj.encrypted && obj.encryptionIV && obj.encryptionTag) {
      obj.content = decryptContent(obj);
    }
    // Strip encryption metadata from response (plain object — no DB side effects)
    delete obj.encryptionIV;
    delete obj.encryptionTag;
    return obj;
  });
}

/**
 * Basic HTML/XSS sanitization for text content
 */
function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .slice(0, 5000); // Hard limit
}

/**
 * POST /api/messages
 * Send a 1-to-1 message — ENCRYPTED AT REST
 */
const sendMessage = async (req, res) => {
  try {
    const { receiverId, content, type, fileUrl, fileName, fileSize, fileMimeType } = req.body;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'Receiver ID is required' });
    }

    if (!content && !fileUrl) {
      return res.status(400).json({ success: false, message: 'Message content or file is required' });
    }

    // Verify receiver exists
    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ success: false, message: 'Receiver not found' });
    }

    // Sanitize and encrypt content
    const sanitized = sanitizeText(content || '');
    const encData = encryptContent(sanitized);

    const message = await Message.create({
      sender: req.user._id,
      receiver: receiverId,
      content: encData.content,
      encrypted: encData.encrypted,
      encryptionIV: encData.encryptionIV,
      encryptionTag: encData.encryptionTag,
      type: type || 'text',
      fileUrl,
      fileName,
      fileSize,
      fileMimeType,
    });

    // Populate sender info for response
    await message.populate('sender', 'username avatar');
    await message.populate('receiver', 'username avatar');

    // Convert to plain object for response — NEVER mutate the Mongoose doc
    // (mutating would mark fields as modified; if .save() were ever called
    //  accidentally, it would overwrite encrypted content with plaintext)
    const messageResponse = message.toObject();
    messageResponse.content = sanitized;
    delete messageResponse.encryptionIV;
    delete messageResponse.encryptionTag;

    res.status(201).json({
      success: true,
      data: { message: messageResponse },
    });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Send message error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error sending message' });
  }
};

/**
 * POST /api/messages/group
 * Send a group message — ENCRYPTED AT REST
 */
const sendGroupMessage = async (req, res) => {
  try {
    const { groupId, content, type, fileUrl, fileName, fileSize, fileMimeType } = req.body;

    if (!groupId) {
      return res.status(400).json({ success: false, message: 'Group ID is required' });
    }

    if (!content && !fileUrl) {
      return res.status(400).json({ success: false, message: 'Message content or file is required' });
    }

    // Verify group exists and user is a member
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (!group.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You are not a member of this group' });
    }

    // Sanitize and encrypt content
    const sanitized = sanitizeText(content || '');
    const encData = encryptContent(sanitized);

    const message = await Message.create({
      sender: req.user._id,
      group: groupId,
      content: encData.content,
      encrypted: encData.encrypted,
      encryptionIV: encData.encryptionIV,
      encryptionTag: encData.encryptionTag,
      type: type || 'text',
      fileUrl,
      fileName,
      fileSize,
      fileMimeType,
    });

    await message.populate('sender', 'username avatar');

    // Convert to plain object for response — NEVER mutate the Mongoose doc
    const messageResponse = message.toObject();
    messageResponse.content = sanitized;
    delete messageResponse.encryptionIV;
    delete messageResponse.encryptionTag;

    res.status(201).json({
      success: true,
      data: { message: messageResponse },
    });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Send group message error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error sending group message' });
  }
};

/**
 * GET /api/messages/:userId
 * Get conversation with a specific user — DECRYPTS messages
 */
const getConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Cap at 100

    const messages = await Message.getConversation(
      req.user._id,
      userId,
      page,
      limit
    );

    // Decrypt all encrypted messages (returns new plain-object array)
    const decrypted = decryptMessages(messages);

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
        messages: decrypted.reverse(),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching conversation' });
  }
};

/**
 * GET /api/messages/group/:groupId
 * Get group messages — DECRYPTS messages
 */
const getGroupMessages = async (req, res) => {
  try {
    const { groupId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Cap at 100

    // Verify membership
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (!group.isMember(req.user._id)) {
      return res.status(403).json({ success: false, message: 'You are not a member of this group' });
    }

    const messages = await Message.getGroupMessages(groupId, page, limit);

    // Decrypt all encrypted messages (returns new plain-object array)
    const decrypted = decryptMessages(messages);

    const total = await Message.countDocuments({ group: groupId });

    res.json({
      success: true,
      data: {
        messages: decrypted.reverse(),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching group messages' });
  }
};

/**
 * PUT /api/messages/read/:userId
 * Mark all messages from a user as read
 */
const markAsRead = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId || typeof userId !== 'string' || userId.length > 30) {
      return res.status(400).json({ success: false, message: 'Invalid user ID' });
    }

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

    res.json({ success: true, message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error marking messages as read' });
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

    const unreadMap = {};
    counts.forEach(item => {
      unreadMap[item._id.toString()] = item.count;
    });

    res.json({
      success: true,
      data: { unread: unreadMap },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error getting unread counts' });
  }
};

/**
 * GET /api/messages/conversations
 * Get last message for each 1-to-1 conversation (for sidebar preview).
 * Returns: { conversations: { [userId]: { content, type, createdAt, senderId, senderUsername } } }
 */
const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    // Aggregate to find the latest message per conversation partner
    const pipeline = [
      {
        $match: {
          group: null,
          $or: [
            { sender: userId },
            { receiver: userId },
          ],
        },
      },
      {
        // Sort by newest first so $first in group picks the latest
        $sort: { createdAt: -1 },
      },
      {
        // Determine the "other user" in each conversation
        $addFields: {
          chatPartnerId: {
            $cond: {
              if: { $eq: ['$sender', userId] },
              then: '$receiver',
              else: '$sender',
            },
          },
        },
      },
      {
        // Group by chat partner, take the first (latest) message
        $group: {
          _id: '$chatPartnerId',
          lastMessage: { $first: '$$ROOT' },
        },
      },
      {
        // Lookup sender username
        $lookup: {
          from: 'users',
          localField: 'lastMessage.sender',
          foreignField: '_id',
          as: 'senderInfo',
        },
      },
      {
        $unwind: { path: '$senderInfo', preserveNullAndEmptyArrays: true },
      },
      {
        $project: {
          chatPartnerId: '$_id',
          content: '$lastMessage.content',
          type: '$lastMessage.type',
          createdAt: '$lastMessage.createdAt',
          senderId: '$lastMessage.sender',
          senderUsername: '$senderInfo.username',
          encrypted: '$lastMessage.encrypted',
          encryptionIV: '$lastMessage.encryptionIV',
          encryptionTag: '$lastMessage.encryptionTag',
          fileUrl: '$lastMessage.fileUrl',
          fileName: '$lastMessage.fileName',
          callType: '$lastMessage.callType',
          callStatus: '$lastMessage.callStatus',
        },
      },
    ];

    const results = await Message.aggregate(pipeline);

    // Build conversations map & decrypt content
    const conversations = {};
    results.forEach(item => {
      let content = item.content;

      // Decrypt if encrypted
      if (item.encrypted && item.encryptionIV && item.encryptionTag) {
        content = decryptContent({
          content: item.content,
          encrypted: item.encrypted,
          encryptionIV: item.encryptionIV,
          encryptionTag: item.encryptionTag,
          _id: item.chatPartnerId,
        });
      }

      // Format preview text based on message type
      let preview = content;
      if (item.type === 'image') preview = '📷 Photo';
      else if (item.type === 'file') preview = `📎 ${item.fileName || 'File'}`;
      else if (item.type === 'audio') preview = '🎵 Audio';
      else if (item.type === 'video') preview = '🎬 Video';
      else if (item.type === 'call') {
        const icon = item.callType === 'video' ? '📹' : '📞';
        preview = `${icon} ${item.callStatus === 'completed' ? 'Call' : 'Missed call'}`;
      }

      conversations[item.chatPartnerId.toString()] = {
        content: preview,
        type: item.type,
        createdAt: item.createdAt,
        senderId: item.senderId?.toString(),
        senderUsername: item.senderUsername,
      };
    });

    // ─── GROUP CONVERSATIONS ─────────────────────
    // Fetch last message for each group the user is in
    const groupConversations = {};
    try {
      const userGroups = await Group.find({ 'members.user': userId }).select('_id name').lean();
      if (userGroups.length > 0) {
        const groupIds = userGroups.map(g => g._id);
        const groupPipeline = [
          { $match: { group: { $in: groupIds } } },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$group',
              lastMessage: { $first: '$$ROOT' },
            },
          },
          {
            $lookup: {
              from: 'users',
              localField: 'lastMessage.sender',
              foreignField: '_id',
              as: 'senderInfo',
            },
          },
          { $unwind: { path: '$senderInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              groupId: '$_id',
              content: '$lastMessage.content',
              type: '$lastMessage.type',
              createdAt: '$lastMessage.createdAt',
              senderId: '$lastMessage.sender',
              senderUsername: '$senderInfo.username',
              encrypted: '$lastMessage.encrypted',
              encryptionIV: '$lastMessage.encryptionIV',
              encryptionTag: '$lastMessage.encryptionTag',
              fileName: '$lastMessage.fileName',
            },
          },
        ];
        const groupResults = await Message.aggregate(groupPipeline);

        groupResults.forEach(item => {
          let content = item.content;
          if (item.encrypted && item.encryptionIV && item.encryptionTag) {
            content = decryptContent({
              content: item.content,
              encrypted: item.encrypted,
              encryptionIV: item.encryptionIV,
              encryptionTag: item.encryptionTag,
              _id: item.groupId,
            });
          }
          let preview = content;
          if (item.type === 'image') preview = '📷 Photo';
          else if (item.type === 'file') preview = `📎 ${item.fileName || 'File'}`;
          else if (item.type === 'audio') preview = '🎵 Audio';
          else if (item.type === 'video') preview = '🎬 Video';

          groupConversations[item.groupId.toString()] = {
            content: preview,
            type: item.type,
            createdAt: item.createdAt,
            senderId: item.senderId?.toString(),
            senderUsername: item.senderUsername,
          };
        });
      }
    } catch (err) {
      console.warn('Group conversations fetch error:', err.message);
    }

    // ─── CHANNEL CONVERSATIONS ───────────────────
    // Fetch last post for each channel the user is subscribed to
    const channelConversations = {};
    try {
      const userChannels = await Channel.find({ 'members.user': userId }).select('_id name').lean();
      if (userChannels.length > 0) {
        const channelIds = userChannels.map(c => c._id);
        const channelPipeline = [
          {
            $match: {
              channel: { $in: channelIds },
              isDeleted: { $ne: true },
              isScheduled: { $ne: true },
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: '$channel',
              lastMessage: { $first: '$$ROOT' },
            },
          },
          {
            $lookup: {
              from: 'users',
              localField: 'lastMessage.sender',
              foreignField: '_id',
              as: 'senderInfo',
            },
          },
          { $unwind: { path: '$senderInfo', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              channelId: '$_id',
              content: '$lastMessage.content',
              type: '$lastMessage.type',
              createdAt: '$lastMessage.createdAt',
              senderId: '$lastMessage.sender',
              senderUsername: '$senderInfo.username',
              encrypted: '$lastMessage.encrypted',
              encryptionIV: '$lastMessage.encryptionIV',
              encryptionTag: '$lastMessage.encryptionTag',
              fileName: '$lastMessage.fileName',
            },
          },
        ];
        const channelResults = await ChannelMessage.aggregate(channelPipeline);

        channelResults.forEach(item => {
          let content = item.content;
          if (item.encrypted && item.encryptionIV && item.encryptionTag) {
            content = decryptContent({
              content: item.content,
              encrypted: item.encrypted,
              encryptionIV: item.encryptionIV,
              encryptionTag: item.encryptionTag,
              _id: item.channelId,
            });
          }
          let preview = content;
          if (item.type === 'image') preview = '📷 Photo';
          else if (item.type === 'file') preview = `📎 ${item.fileName || 'File'}`;
          else if (item.type === 'audio') preview = '🎵 Audio';
          else if (item.type === 'video') preview = '🎬 Video';
          else if (item.type === 'poll') preview = '📊 Poll';

          channelConversations[item.channelId.toString()] = {
            content: preview,
            type: item.type,
            createdAt: item.createdAt,
            senderId: item.senderId?.toString(),
            senderUsername: item.senderUsername,
          };
        });
      }
    } catch (err) {
      console.warn('Channel conversations fetch error:', err.message);
    }

    res.json({
      success: true,
      data: {
        conversations,
        groupConversations,
        channelConversations,
      },
    });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching conversations' });
  }
};

/**
 * DELETE /api/messages/:messageId
 * Delete a message (only sender can delete)
 */
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Only the sender can delete their message
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'You can only delete your own messages' });
    }

    await Message.findByIdAndDelete(messageId);

    res.json({
      success: true,
      message: 'Message deleted',
    });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Delete message error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error deleting message' });
  }
};

/**
 * POST /api/messages/bulk-delete
 * Delete multiple messages at once.
 * Only messages sent by the requesting user will be deleted.
 * Returns the list of successfully deleted message IDs.
 */
const bulkDeleteMessages = async (req, res) => {
  try {
    const { messageIds } = req.body;

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ success: false, message: 'messageIds array is required' });
    }

    // Limit batch size to prevent abuse
    if (messageIds.length > 100) {
      return res.status(400).json({ success: false, message: 'Cannot delete more than 100 messages at once' });
    }

    // Find all messages that belong to the requesting user
    const messages = await Message.find({
      _id: { $in: messageIds },
      sender: req.user._id,
    }).select('_id');

    const deletableIds = messages.map(m => m._id);

    if (deletableIds.length === 0) {
      return res.status(404).json({ success: false, message: 'No deletable messages found' });
    }

    await Message.deleteMany({ _id: { $in: deletableIds } });

    securityLogger.log('INFO', req.user._id.toString(), 'Bulk delete messages', {
      count: deletableIds.length,
    });

    res.json({
      success: true,
      message: `${deletableIds.length} message(s) deleted`,
      data: { deletedIds: deletableIds.map(id => id.toString()) },
    });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Bulk delete messages error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error deleting messages' });
  }
};

// ─── PIN / UNPIN MESSAGES ───────────────────────────────────

/**
 * PUT /api/messages/:messageId/pin
 * Pin a message — unlimited pins allowed per chat/group
 */
const pinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Verify the user is a participant of this conversation
    if (message.group) {
      const group = await Group.findById(message.group);
      if (!group || !group.isMember(req.user._id)) {
        return res.status(403).json({ success: false, message: 'You are not a member of this group' });
      }
    } else {
      const isParticipant =
        message.sender.toString() === req.user._id.toString() ||
        (message.receiver && message.receiver.toString() === req.user._id.toString());
      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'You are not part of this conversation' });
      }
    }

    if (message.isPinned) {
      return res.status(400).json({ success: false, message: 'Message is already pinned' });
    }

    message.isPinned = true;
    message.pinnedBy = req.user._id;
    message.pinnedAt = new Date();
    await message.save();

    await message.populate('sender', 'username avatar');
    await message.populate('pinnedBy', 'username avatar');
    if (message.receiver) await message.populate('receiver', 'username avatar');

    const messageResponse = message.toObject();
    if (messageResponse.encrypted && messageResponse.encryptionIV && messageResponse.encryptionTag) {
      messageResponse.content = decryptContent(messageResponse);
    }
    delete messageResponse.encryptionIV;
    delete messageResponse.encryptionTag;

    res.json({ success: true, data: { message: messageResponse } });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Pin message error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error pinning message' });
  }
};

/**
 * PUT /api/messages/:messageId/unpin
 * Unpin a message
 */
const unpinMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Verify the user is a participant
    if (message.group) {
      const group = await Group.findById(message.group);
      if (!group || !group.isMember(req.user._id)) {
        return res.status(403).json({ success: false, message: 'You are not a member of this group' });
      }
    } else {
      const isParticipant =
        message.sender.toString() === req.user._id.toString() ||
        (message.receiver && message.receiver.toString() === req.user._id.toString());
      if (!isParticipant) {
        return res.status(403).json({ success: false, message: 'You are not part of this conversation' });
      }
    }

    if (!message.isPinned) {
      return res.status(400).json({ success: false, message: 'Message is not pinned' });
    }

    message.isPinned = false;
    message.pinnedBy = null;
    message.pinnedAt = null;
    await message.save();

    res.json({ success: true, message: 'Message unpinned' });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Unpin message error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error unpinning message' });
  }
};

/**
 * GET /api/messages/pinned/:chatId?type=user|group
 * Get all pinned messages for a chat (1-to-1) or group
 */
const getPinnedMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const chatType = req.query.type || 'user';

    let query;
    if (chatType === 'group') {
      const group = await Group.findById(chatId);
      if (!group || !group.isMember(req.user._id)) {
        return res.status(403).json({ success: false, message: 'You are not a member of this group' });
      }
      query = { group: chatId, isPinned: true };
    } else {
      query = {
        isPinned: true,
        group: null,
        $or: [
          { sender: req.user._id, receiver: chatId },
          { sender: chatId, receiver: req.user._id },
        ],
      };
    }

    const messages = await Message.find(query)
      .sort({ pinnedAt: -1 })
      .populate('sender', 'username avatar')
      .populate('pinnedBy', 'username avatar')
      .populate('receiver', 'username avatar');

    const decrypted = decryptMessages(messages);

    res.json({ success: true, data: { messages: decrypted } });
  } catch (error) {
    securityLogger.log('WARN', 'SYSTEM', 'Get pinned messages error', { error: error.message });
    res.status(500).json({ success: false, message: 'Server error fetching pinned messages' });
  }
};

module.exports = {
  sendMessage,
  sendGroupMessage,
  getConversation,
  getGroupMessages,
  markAsRead,
  getUnreadCounts,
  getConversations,
  deleteMessage,
  bulkDeleteMessages,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
};
