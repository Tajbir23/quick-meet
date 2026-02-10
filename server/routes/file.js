const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles, downloadFile, deleteFile, getFileAccessToken } = require('../controllers/fileController');
const { protect } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

// ─── ALL FILE ROUTES NOW REQUIRE AUTHENTICATION ─────────────
// WHY: Direct public access is a security risk
// Downloads now go through authenticated endpoint
router.use(protect);

// Download file (authenticated)
router.get('/download/:filename', downloadFile);

// Get time-limited access token for a file
router.get('/access-token/:filename', getFileAccessToken);

// Upload single file
router.post('/upload', uploadLimiter, upload.single('file'), handleUploadError, uploadFile);

// Upload multiple files (max 5)
router.post('/upload-multiple', uploadLimiter, upload.array('files', 5), handleUploadError, uploadMultipleFiles);

// Delete file (only authenticated users)
router.delete('/:filename', deleteFile);

module.exports = router;
