/**
 * ============================================
 * Owner Routes — Admin Dashboard API
 * ============================================
 * 
 * ALL routes require: protect + requireOwner
 * Only the database-assigned owner can access these
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireOwner } = require('../middleware/ownerAuth');
const { apiLimiter } = require('../middleware/rateLimiter');
const {
  getLogFiles,
  getLogsByDate,
  getRecentLogs,
  getSecurityAlerts,
  getSystemStatus,
  getAllUsers,
  blockUser,
  unblockUser,
  getAllFiles,
  ownerDeleteFile,
  ownerDownloadFile,
  downloadAllFilesZip,
  uploadAndExtractZip,
  toggleOwnerVisibility,
  downloadLogFile,
} = require('../controllers/ownerController');
const multer = require('multer');

// Multer config for ZIP upload (temp storage)
const zipUpload = multer({
  dest: require('path').resolve(__dirname, '..', 'uploads'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'), false);
    }
  },
});

// All owner routes require authentication + owner role
router.use(protect);
router.use(requireOwner);
router.use(apiLimiter);

// ─── Security Logs ──────────────────────────────────────
router.get('/logs', getLogFiles);
router.get('/logs/recent', getRecentLogs);
router.get('/logs/download/:filename', downloadLogFile);
router.get('/logs/:date', getLogsByDate);

// ─── Security Alerts / Hacking Attempts ────────────────
router.get('/security/alerts', getSecurityAlerts);
router.get('/security/status', getSystemStatus);

// ─── User Management ───────────────────────────────────
router.get('/users', getAllUsers);
router.post('/users/:userId/block', blockUser);
router.post('/users/:userId/unblock', unblockUser);

// ─── File Management ───────────────────────────────────
router.get('/files', getAllFiles);
router.get('/files/download-all', downloadAllFilesZip);
router.post('/files/upload-zip', zipUpload.single('zipFile'), uploadAndExtractZip);
router.get('/files/download/:filename', ownerDownloadFile);
router.delete('/files/:filename', ownerDeleteFile);

// ─── Owner Settings ────────────────────────────────────
router.post('/toggle-visibility', toggleOwnerVisibility);

module.exports = router;
