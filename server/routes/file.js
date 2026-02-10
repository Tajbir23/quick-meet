const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles, downloadFile, deleteFile, getFileAccessToken } = require('../controllers/fileController');
const { protect } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

// ─── PUBLIC ROUTES ──────────────────────────────────────────
// Download files WITHOUT auth — required because <img>, <video>, and
// <audio> tags in the browser cannot send Authorization headers.
// Files are stored with UUID filenames (e.g. 9d358ea2-...jpg) which
// are unguessable, same pattern used by Slack, Discord, Google Drive.
router.get('/download/:filename', downloadFile);

// ─── PROTECTED ROUTES (require JWT) ─────────────────────────
router.use(protect);

// Get time-limited access token for a file
router.get('/access-token/:filename', getFileAccessToken);

// Upload single file
router.post('/upload', uploadLimiter, upload.single('file'), handleUploadError, uploadFile);

// Upload multiple files (max 5)
router.post('/upload-multiple', uploadLimiter, upload.array('files', 5), handleUploadError, uploadMultipleFiles);

// Delete file (only authenticated users)
router.delete('/:filename', deleteFile);

module.exports = router;
