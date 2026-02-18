const express = require('express');
const router = express.Router();
const {
  sendMessage,
  sendGroupMessage,
  getConversation,
  getGroupMessages,
  markAsRead,
  getUnreadCounts,
  getConversations,
  deleteMessage,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
} = require('../controllers/messageController');
const { protect } = require('../middleware/auth');
const { apiLimiter, messageLimiter } = require('../middleware/rateLimiter');

router.use(protect);
router.use(apiLimiter);

// 1-to-1 messages (send is additionally rate-limited for spam prevention)
router.post('/', messageLimiter, sendMessage);
router.get('/unread/count', getUnreadCounts);
router.get('/conversations', getConversations);

// Pinned messages — must be before /:messageId and /:userId routes
router.get('/pinned/:chatId', getPinnedMessages);
router.put('/:messageId/pin', pinMessage);
router.put('/:messageId/unpin', unpinMessage);

router.delete('/:messageId', deleteMessage);
router.get('/:userId', getConversation);
router.put('/read/:userId', markAsRead);

// Group messages
router.post('/group', messageLimiter, sendGroupMessage);
router.get('/group/:groupId', getGroupMessages);

module.exports = router;
