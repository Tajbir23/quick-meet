/**
 * ============================================
 * File Transfer Controller
 * ============================================
 * 
 * REST endpoints for P2P file transfer metadata.
 * Note: Actual file data NEVER passes through the server.
 * Only transfer metadata (progress, status, history) is stored.
 */

const FileTransfer = require('../models/FileTransfer');

/**
 * GET /api/transfers/active
 * Get all active transfers for the current user
 */
exports.getActiveTransfers = async (req, res) => {
  try {
    const transfers = await FileTransfer.getActiveTransfers(req.user._id);
    res.json({
      success: true,
      data: { transfers },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfers',
    });
  }
};

/**
 * GET /api/transfers/history/:userId
 * Get transfer history with a specific user
 */
exports.getTransferHistory = async (req, res) => {
  try {
    const transfers = await FileTransfer.getConversationTransfers(
      req.user._id,
      req.params.userId
    );
    res.json({
      success: true,
      data: { transfers },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer history',
    });
  }
};

/**
 * GET /api/transfers/:transferId
 * Get a specific transfer's details
 */
exports.getTransferDetails = async (req, res) => {
  try {
    const transfer = await FileTransfer.findOne({
      transferId: req.params.transferId,
      $or: [{ sender: req.user._id }, { receiver: req.user._id }],
    })
      .populate('sender', 'username avatar')
      .populate('receiver', 'username avatar');

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found',
      });
    }

    res.json({
      success: true,
      data: { transfer },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer',
    });
  }
};
