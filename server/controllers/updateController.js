/**
 * ============================================
 * Update Controller — App Version Management
 * ============================================
 * 
 * Manages version checking and update distribution
 * for Desktop (Electron), Mobile (Android), and Web apps.
 * 
 * ARCHITECTURE:
 * - Versions stored in server/updates/versions.json
 * - Build files stored in server/updates/builds/
 * - Desktop: electron-updater uses GitHub Releases (auto) + download fallback
 * - Android: Check API + download APK from server/GitHub
 * - Web: Check API + reload page (auto-deployed via webhook)
 * - Owner can update version info via API
 * - Deploy script auto-bumps version + sets lastUpdated
 */

const fs = require('fs');
const path = require('path');

const VERSIONS_FILE = path.join(__dirname, '../updates/versions.json');
const BUILDS_DIR = path.join(__dirname, '../updates/builds');

// Default versions config
const DEFAULT_VERSIONS = {
  desktop: {
    version: '1.0.0',
    minVersion: '1.0.0',
    releaseNotes: 'Initial release',
    forceUpdate: false,
    downloadUrl: 'https://github.com/Tajbir23/quick-meet/releases/latest',
    lastUpdated: new Date().toISOString(),
  },
  android: {
    version: '1.0.0',
    minVersion: '1.0.0',
    releaseNotes: 'Initial release',
    forceUpdate: false,
    downloadUrl: 'https://github.com/Tajbir23/quick-meet/releases/latest',
    lastUpdated: new Date().toISOString(),
  },
  web: {
    version: '1.0.0',
    minVersion: '1.0.0',
    releaseNotes: 'Initial release',
    forceUpdate: false,
    lastUpdated: new Date().toISOString(),
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

// Ensure versions file and builds directory exist on startup
if (!fs.existsSync(VERSIONS_FILE)) {
  saveVersions(DEFAULT_VERSIONS);
}
if (!fs.existsSync(BUILDS_DIR)) {
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
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
      lastUpdated: platformInfo.lastUpdated || null,
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

    if (!['desktop', 'android', 'web'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Platform must be desktop, android, or web',
      });
    }

    const versions = getVersions();
    versions[platform] = {
      version,
      minVersion: minVersion || version,
      releaseNotes: releaseNotes || `Version ${version}`,
      forceUpdate: forceUpdate || false,
      downloadUrl: downloadUrl || versions[platform]?.downloadUrl || `https://github.com/Tajbir23/quick-meet/releases/latest`,
      lastUpdated: new Date().toISOString(),
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

/**
 * GET /api/updates/download/:platform
 * Download the latest build file for a platform.
 * 
 * Looks for files in server/updates/builds/ :
 * - android: quick-meet.apk or app-debug.apk
 * - desktop: Quick Meet Setup*.exe
 * 
 * Falls back to GitHub Releases redirect if no local file.
 */
const downloadBuild = (req, res) => {
  try {
    const { platform } = req.params;

    // File name patterns per platform
    const filePatterns = {
      android: ['quick-meet.apk', 'app-debug.apk', 'app-release.apk'],
      desktop: [],
    };

    if (!filePatterns[platform]) {
      return res.status(400).json({
        success: false,
        message: 'Platform must be android or desktop',
      });
    }

    // Check for local build files
    if (fs.existsSync(BUILDS_DIR)) {
      const files = fs.readdirSync(BUILDS_DIR);

      // For desktop, look for any .exe file
      if (platform === 'desktop') {
        const exe = files.find(f => f.endsWith('.exe'));
        if (exe) {
          const filePath = path.join(BUILDS_DIR, exe);
          res.setHeader('Content-Disposition', `attachment; filename="${exe}"`);
          return res.sendFile(filePath);
        }
      }

      // For android, look for APK files
      if (platform === 'android') {
        for (const pattern of filePatterns.android) {
          if (files.includes(pattern)) {
            const filePath = path.join(BUILDS_DIR, pattern);
            res.setHeader('Content-Disposition', `attachment; filename="${pattern}"`);
            return res.sendFile(filePath);
          }
        }
        // Try any .apk file
        const apk = files.find(f => f.endsWith('.apk'));
        if (apk) {
          const filePath = path.join(BUILDS_DIR, apk);
          res.setHeader('Content-Disposition', `attachment; filename="${apk}"`);
          return res.sendFile(filePath);
        }
      }
    }

    // Fallback: redirect to GitHub Releases latest asset
    const versions = getVersions();
    const ver = versions[platform]?.version || 'latest';
    const ext = platform === 'desktop' ? 'setup.exe' : 'release.apk';
    const githubUrl = ver === 'latest'
      ? 'https://github.com/Tajbir23/quick-meet/releases/latest'
      : `https://github.com/Tajbir23/quick-meet/releases/download/v${ver}/quick-meet-v${ver}-${ext}`;
    return res.redirect(302, githubUrl);
  } catch (error) {
    console.error('Download build error:', error);
    return res.status(500).json({ success: false, message: 'Download failed' });
  }
};

/**
 * POST /api/updates/bump (internal — called by deploy script)
 * Auto-bump version for all platforms after deploy.
 * 
 * Body: { version, releaseNotes, forceUpdate, platforms }
 * platforms: ['web', 'android', 'desktop'] — which ones to bump
 */
const bumpVersion = (req, res) => {
  try {
    const { version, releaseNotes, forceUpdate, platforms } = req.body;

    if (!version) {
      return res.status(400).json({ success: false, message: 'Missing version' });
    }

    const versions = getVersions();
    const targetPlatforms = platforms || ['web', 'android', 'desktop'];

    for (const platform of targetPlatforms) {
      if (versions[platform]) {
        versions[platform].version = version;
        versions[platform].releaseNotes = releaseNotes || `Version ${version}`;
        versions[platform].lastUpdated = new Date().toISOString();
        if (typeof forceUpdate === 'boolean') {
          versions[platform].forceUpdate = forceUpdate;
        }
      }
    }

    saveVersions(versions);

    return res.json({
      success: true,
      message: `Bumped version to ${version} for [${targetPlatforms.join(', ')}]`,
      versions,
    });
  } catch (error) {
    console.error('Bump version error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/updates/builds
 * List available build files
 */
const listBuilds = (req, res) => {
  try {
    if (!fs.existsSync(BUILDS_DIR)) {
      return res.json({ success: true, builds: [] });
    }

    const files = fs.readdirSync(BUILDS_DIR);
    const builds = files.map(f => {
      const stats = fs.statSync(path.join(BUILDS_DIR, f));
      return {
        name: f,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        platform: f.endsWith('.apk') ? 'android' : f.endsWith('.exe') ? 'desktop' : 'unknown',
      };
    });

    return res.json({ success: true, builds });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  checkUpdate,
  getVersionInfo,
  updateVersion,
  downloadBuild,
  bumpVersion,
  listBuilds,
};
