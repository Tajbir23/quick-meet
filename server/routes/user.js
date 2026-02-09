const express = require('express');
const router = express.Router();
const {
  getUsers,
  getActiveUsers,
  searchUsers,
  getUserById,
  updateProfile,
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

// All user routes are protected
router.use(protect);
router.use(apiLimiter);

router.get('/', getUsers);
router.get('/active', getActiveUsers);
router.get('/search', searchUsers);
router.put('/profile', updateProfile);
router.get('/:id', getUserById);

module.exports = router;
