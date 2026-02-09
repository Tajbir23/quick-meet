const express = require('express');
const router = express.Router();
const {
  createGroup,
  getMyGroups,
  getGroupById,
  joinGroup,
  leaveGroup,
  addMember,
  getAllGroups,
} = require('../controllers/groupController');
const { protect } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimiter');

router.use(protect);
router.use(apiLimiter);

router.post('/', createGroup);
router.get('/', getMyGroups);
router.get('/all', getAllGroups);
router.get('/:id', getGroupById);
router.post('/:id/join', joinGroup);
router.post('/:id/leave', leaveGroup);
router.post('/:id/add-member', addMember);

module.exports = router;
