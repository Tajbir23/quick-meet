/**
 * ============================================
 * Update Routes — App Version Management
 * ============================================
 * 
 * Public:
 *   GET /api/updates/check?platform=desktop|android|web&version=1.0.0
 *   GET /api/updates/versions
 *   GET /api/updates/download/:platform  (android | desktop)
 *   GET /api/updates/builds
 * 
 * Owner-only:
 *   PUT /api/updates/versions
 * 
 * Internal (deploy script):
 *   POST /api/updates/bump  (auto-bump version after deploy)
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireOwner } = require('../middleware/ownerAuth');
const {
  checkUpdate,
  getVersionInfo,
  updateVersion,
  downloadBuild,
  bumpVersion,
  listBuilds,
} = require('../controllers/updateController');

// Public — apps call this on startup
router.get('/check', checkUpdate);
router.get('/versions', getVersionInfo);
router.get('/download/:platform', downloadBuild);
router.get('/builds', listBuilds);

// Deploy script — auto-bump version after deploy
// Uses owner auth to prevent unauthorized bumps
router.post('/bump', protect, requireOwner, bumpVersion);

// Owner-only — update version info from dashboard
router.put('/versions', protect, requireOwner, updateVersion);

module.exports = router;
