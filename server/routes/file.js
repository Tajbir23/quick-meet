const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles, downloadFile, deleteFile } = require('../controllers/fileController');
const { protect } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

// All file routes are protected
router.use(protect);

// Upload single file
router.post('/upload', uploadLimiter, upload.single('file'), handleUploadError, uploadFile);

// Upload multiple files (max 5)
router.post('/upload-multiple', uploadLimiter, upload.array('files', 5), handleUploadError, uploadMultipleFiles);

// Download file
router.get('/download/:filename', downloadFile);

// Delete file
router.delete('/:filename', deleteFile);

module.exports = router;
