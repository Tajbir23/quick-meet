const express = require('express');
const router = express.Router();
const {
  getUsers,
  getActiveUsers,
  searchUsers,
  getUserById,
  updateProfile,
  updateSecurity,
  updatePrivacy,
  blockUser,
  unblockUser,
  getBlockedUsers,
  getBlockStatus,
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// All user routes are protected
router.use(protect);
router.use(apiLimiter);

router.get('/', getUsers);
router.get('/active', getActiveUsers);
router.get('/search', searchUsers);
router.get('/blocked', getBlockedUsers);
router.put('/profile', updateProfile);
router.put('/security', updateSecurity);
router.put('/privacy', updatePrivacy);
router.get('/:id', getUserById);
router.get('/:id/block-status', getBlockStatus);
router.post('/:id/block', blockUser);
router.post('/:id/unblock', unblockUser);

module.exports = router;
