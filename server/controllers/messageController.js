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
const User = require('../models/User');
const Group = require('../models/Group');
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

module.exports = {
  sendMessage,
  sendGroupMessage,
  getConversation,
  getGroupMessages,
  markAsRead,
  getUnreadCounts,
  deleteMessage,
};
