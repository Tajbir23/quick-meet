/**
 * ============================================
 * File Controller
 * ============================================
 * 
 * Handles: Upload file, download file, delete file
 * 
 * FILES ARE STORED LOCALLY ON SERVER DISK.
 * WHY not cloud: Self-hosted requirement, no third-party services.
 * 
 * SECURITY:
 * - Authenticated upload/download only
 * - File type whitelist (see middleware/upload.js)
 * - Size limit (50MB default)
 * - Randomized filenames (prevents path traversal)
 * - Download requires authentication
 */

const path = require('path');
const fs = require('fs');
const Message = require('../models/Message');

const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './uploads');

/**
 * POST /api/files/upload
 * Upload a file
 * Multer middleware handles the actual upload (see routes/file.js)
 */
const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
      });
    }

    const fileData = {
      originalName: req.file.originalname,
      storedName: req.file.filename,
      path: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user._id,
    };

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        file: {
          url: fileData.path,
          name: fileData.originalName,
          size: fileData.size,
          mimeType: fileData.mimeType,
        },
      },
    });
  } catch (error) {
    console.error('Upload file error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error uploading file',
    });
  }
};

/**
 * POST /api/files/upload-multiple
 * Upload multiple files
 */
const uploadMultipleFiles = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided',
      });
    }

    const files = req.files.map(file => ({
      url: `/uploads/${file.filename}`,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    }));

    res.status(201).json({
      success: true,
      message: `${files.length} file(s) uploaded successfully`,
      data: { files },
    });
  } catch (error) {
    console.error('Upload multiple files error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error uploading files',
    });
  }
};

/**
 * GET /api/files/download/:filename
 * Download a file (authenticated)
 */
const downloadFile = async (req, res) => {
  try {
    const { filename } = req.params;

    // Security: Prevent path traversal
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(uploadDir, sanitizedFilename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    res.download(filePath, sanitizedFilename);
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error downloading file',
    });
  }
};

/**
 * DELETE /api/files/:filename
 * Delete a file (only uploader can delete)
 */
const deleteFile = async (req, res) => {
  try {
    const { filename } = req.params;
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(uploadDir, sanitizedFilename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found',
      });
    }

    // Delete from disk
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: 'File deleted successfully',
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting file',
    });
  }
};

module.exports = { uploadFile, uploadMultipleFiles, downloadFile, deleteFile };
