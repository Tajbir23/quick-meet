/**
 * File Transfer Routes
 * REST endpoints for P2P file transfer metadata (not file data)
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getActiveTransfers,
  getTransferHistory,
  getTransferDetails,
} = require('../controllers/fileTransferController');

// All routes require authentication
router.use(protect);

router.get('/active', getActiveTransfers);
router.get('/history/:userId', getTransferHistory);
router.get('/:transferId', getTransferDetails);

module.exports = router;
