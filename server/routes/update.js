/**
 * ============================================
 * Update Routes — App Version Management
 * ============================================
 * 
 * Public:
 *   GET /api/updates/check?platform=desktop|android&version=1.0.0
 *   GET /api/updates/versions
 * 
 * Owner-only:
 *   PUT /api/updates/versions
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const requireOwner = require('../middleware/ownerAuth');
const {
  checkUpdate,
  getVersionInfo,
  updateVersion,
} = require('../controllers/updateController');

// Public — apps call this on startup
router.get('/check', checkUpdate);
router.get('/versions', getVersionInfo);

// Owner-only — update version info from dashboard
router.put('/versions', protect, requireOwner, updateVersion);

module.exports = router;
