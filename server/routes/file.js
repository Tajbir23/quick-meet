const express = require('express');
const router = express.Router();
const { uploadFile, uploadMultipleFiles, downloadFile, deleteFile } = require('../controllers/fileController');
const { protect } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimiter');

// ─── PUBLIC ROUTES (no auth needed) ─────────────────────────
// Download is public because:
// 1. Browser <a> clicks and window.open() cannot send Authorization headers
// 2. Filenames are UUID-based (unguessable) — security-by-obscurity
// 3. Images are already public via static /uploads/ serving
router.get('/download/:filename', downloadFile);

// ─── PROTECTED ROUTES (require JWT) ─────────────────────────
router.use(protect);

// Upload single file
router.post('/upload', uploadLimiter, upload.single('file'), handleUploadError, uploadFile);

// Upload multiple files (max 5)
router.post('/upload-multiple', uploadLimiter, upload.array('files', 5), handleUploadError, uploadMultipleFiles);

// Delete file (only authenticated users)
router.delete('/:filename', deleteFile);

module.exports = router;
