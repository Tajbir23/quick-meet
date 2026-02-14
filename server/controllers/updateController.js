/**
 * ============================================
 * Update Controller — App Version Management
 * ============================================
 * 
 * Manages version checking and update distribution
 * for Desktop (Electron) and Mobile (Android) apps.
 * 
 * ARCHITECTURE:
 * - Versions stored in server/updates/versions.json
 * - Desktop: electron-updater uses GitHub Releases (auto)
 * - Android: Manual check + download link to GitHub Release
 * - Owner can update version info via API
 */

const fs = require('fs');
const path = require('path');

const VERSIONS_FILE = path.join(__dirname, '../updates/versions.json');

// Default versions config
const DEFAULT_VERSIONS = {
  desktop: {
    version: '1.0.0',
    minVersion: '1.0.0',
    releaseNotes: 'Initial release',
    forceUpdate: false,
    downloadUrl: 'https://github.com/Tajbir23/quick-meet/releases/latest',
  },
  android: {
    version: '1.0.0',
    minVersion: '1.0.0',
    releaseNotes: 'Initial release',
    forceUpdate: false,
    downloadUrl: 'https://github.com/Tajbir23/quick-meet/releases/latest',
  },
};

/**
 * Read versions from file, fallback to defaults
 */
function getVersions() {
  try {
    if (fs.existsSync(VERSIONS_FILE)) {
      const data = fs.readFileSync(VERSIONS_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to read versions.json:', e.message);
  }
  return DEFAULT_VERSIONS;
}

/**
 * Save versions to file
 */
function saveVersions(versions) {
  const dir = path.dirname(VERSIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VERSIONS_FILE, JSON.stringify(versions, null, 2));
}

/**
 * Compare semver versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Ensure versions file exists on startup
if (!fs.existsSync(VERSIONS_FILE)) {
  saveVersions(DEFAULT_VERSIONS);
}

/**
 * GET /api/updates/check
 * Query: ?platform=desktop|android&version=1.0.0
 * 
 * Returns update info for the given platform
 */
const checkUpdate = (req, res) => {
  try {
    const { platform, version: currentVersion } = req.query;

    if (!platform || !currentVersion) {
      return res.status(400).json({
        success: false,
        message: 'Missing platform or version parameter',
      });
    }

    const versions = getVersions();
    const platformInfo = versions[platform];

    if (!platformInfo) {
      return res.status(404).json({
        success: false,
        message: `Unknown platform: ${platform}`,
      });
    }

    const hasUpdate = compareVersions(platformInfo.version, currentVersion) > 0;
    const mustUpdate = compareVersions(platformInfo.minVersion, currentVersion) > 0;

    return res.json({
      success: true,
      hasUpdate,
      mustUpdate: mustUpdate || platformInfo.forceUpdate,
      latestVersion: platformInfo.version,
      currentVersion,
      releaseNotes: hasUpdate ? platformInfo.releaseNotes : null,
      downloadUrl: hasUpdate ? platformInfo.downloadUrl : null,
    });
  } catch (error) {
    console.error('Update check error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/updates/versions
 * Returns all version info (public)
 */
const getVersionInfo = (req, res) => {
  try {
    const versions = getVersions();
    return res.json({ success: true, versions });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * PUT /api/updates/versions
 * Owner-only: Update version info for a platform
 * 
 * Body: { platform, version, minVersion, releaseNotes, forceUpdate, downloadUrl }
 */
const updateVersion = (req, res) => {
  try {
    const { platform, version, minVersion, releaseNotes, forceUpdate, downloadUrl } = req.body;

    if (!platform || !version) {
      return res.status(400).json({
        success: false,
        message: 'Missing platform or version',
      });
    }

    if (!['desktop', 'android'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Platform must be desktop or android',
      });
    }

    const versions = getVersions();
    versions[platform] = {
      version,
      minVersion: minVersion || version,
      releaseNotes: releaseNotes || `Version ${version}`,
      forceUpdate: forceUpdate || false,
      downloadUrl: downloadUrl || versions[platform]?.downloadUrl || `https://github.com/Tajbir23/quick-meet/releases/latest`,
    };

    saveVersions(versions);

    return res.json({
      success: true,
      message: `${platform} version updated to ${version}`,
      versions,
    });
  } catch (error) {
    console.error('Update version error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  checkUpdate,
  getVersionInfo,
  updateVersion,
};
