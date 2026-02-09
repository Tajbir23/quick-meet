const express = require('express');
const router = express.Router();
const {
  sendMessage,
  sendGroupMessage,
  getConversation,
  getGroupMessages,
  markAsRead,
  getUnreadCounts,
} = require('../controllers/messageController');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

router.use(protect);
router.use(apiLimiter);

// 1-to-1 messages
router.post('/', sendMessage);
router.get('/unread/count', getUnreadCounts);
router.get('/:userId', getConversation);
router.put('/read/:userId', markAsRead);

// Group messages
router.post('/group', sendGroupMessage);
router.get('/group/:groupId', getGroupMessages);

module.exports = router;
