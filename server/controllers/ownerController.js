/**
 * ============================================
 * Owner Controller — Admin Dashboard APIs
 * ============================================
 * 
 * Owner-only features:
 * 1. View security logs (tamper-proof JSONL)
 * 2. View hacking/intrusion attempts
 * 3. Block/unblock users
 * 4. List all users with full details
 * 5. List all uploaded files
 * 6. Delete any file
 * 7. Download any file
 * 8. Toggle owner mode visibility
 * 9. System status (IDS, connections, etc.)
 */

const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Message = require('../models/Message');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const intrusionDetector = require('../security/IntrusionDetector');

const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './uploads');
const logsDir = path.resolve(__dirname, '..', 'logs', 'security');

// ============================================
// SECURITY LOGS
// ============================================

/**
 * GET /api/owner/logs
 * Get security log files list
 */
const getLogFiles = async (req, res) => {
  try {
    if (!fs.existsSync(logsDir)) {
      return res.json({ success: true, data: { files: [] } });
    }

    const files = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const stats = fs.statSync(path.join(logsDir, f));
        return {
          name: f,
          size: stats.size,
          modified: stats.mtime,
          date: f.replace('security-', '').replace('.jsonl', ''),
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ success: true, data: { files } });
  } catch (error) {
    console.error('Get log files error:', error);
    res.status(500).json({ success: false, message: 'Error fetching log files' });
  }
};

/**
 * GET /api/owner/logs/:date
 * Get security logs for a specific date
 * Query params: ?limit=100&offset=0&severity=CRITICAL&category=INTRUSION
 */
const getLogsByDate = async (req, res) => {
  try {
    const { date } = req.params;
    const { limit = 200, offset = 0, severity, category, search } = req.query;

    // Sanitize date to prevent path traversal
    const sanitizedDate = date.replace(/[^0-9-]/g, '');
    const logFile = path.join(logsDir, `security-${sanitizedDate}.jsonl`);

    // Verify path stays within logs dir
    const resolved = path.resolve(logFile);
    if (!resolved.startsWith(path.resolve(logsDir))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!fs.existsSync(logFile)) {
      return res.json({ success: true, data: { entries: [], total: 0 } });
    }

    const content = fs.readFileSync(logFile, 'utf8');
    let entries = content.trim().split('\n').filter(l => l).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // Reverse to show newest first
    entries.reverse();

    // Filter by severity
    if (severity) {
      entries = entries.filter(e => e.severity === severity.toUpperCase());
    }

    // Filter by category
    if (category) {
      entries = entries.filter(e => e.category === category.toUpperCase());
    }

    // Search in event name or data
    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter(e =>
        e.event?.toLowerCase().includes(q) ||
        JSON.stringify(e.data || {}).toLowerCase().includes(q)
      );
    }

    const total = entries.length;

    // Paginate
    const start = parseInt(offset);
    const end = start + parseInt(limit);
    entries = entries.slice(start, end);

    res.json({ success: true, data: { entries, total, limit: parseInt(limit), offset: start } });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching logs' });
  }
};

// ============================================
// HACKING / INTRUSION ALERTS
// ============================================

/**
 * GET /api/owner/security/alerts
 * Get recent security alerts (ALERT + CRITICAL severity events)
 * These represent hacking attempts, brute force, path traversal, etc.
 */
const getSecurityAlerts = async (req, res) => {
  try {
    const { limit = 100, days = 7 } = req.query;

    // Read logs from last N days
    const alerts = [];
    const now = new Date();

    for (let i = 0; i < parseInt(days); i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const logFile = path.join(logsDir, `security-${dateStr}.jsonl`);

      if (!fs.existsSync(logFile)) continue;

      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.severity === 'ALERT' || entry.severity === 'CRITICAL') {
            alerts.push(entry);
          }
        } catch {}
      }
    }

    // Sort newest first and limit
    alerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limited = alerts.slice(0, parseInt(limit));

    res.json({
      success: true,
      data: {
        alerts: limited,
        total: alerts.length,
        period: `${days} days`,
      },
    });
  } catch (error) {
    console.error('Get security alerts error:', error);
    res.status(500).json({ success: false, message: 'Error fetching security alerts' });
  }
};

/**
 * GET /api/owner/security/status
 * Get comprehensive system security status
 */
const getSystemStatus = async (req, res) => {
  try {
    const idsStatus = intrusionDetector.getStatus();

    // Count users
    const totalUsers = await User.countDocuments();
    const onlineUsers = await User.countDocuments({ isOnline: true });
    const blockedUsers = await User.countDocuments({ isBlocked: true });

    // Count files
    let totalFiles = 0;
    let totalFileSize = 0;
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      totalFiles = files.length;
      for (const f of files) {
        try {
          const stats = fs.statSync(path.join(uploadDir, f));
          totalFileSize += stats.size;
        } catch {}
      }
    }

    // Server uptime
    const uptime = process.uptime();

    res.json({
      success: true,
      data: {
        ids: idsStatus,
        users: { total: totalUsers, online: onlineUsers, blocked: blockedUsers },
        files: { total: totalFiles, totalSize: totalFileSize },
        server: {
          uptime: Math.floor(uptime),
          uptimeFormatted: formatUptime(uptime),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          platform: process.platform,
          serverTime: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    console.error('Get system status error:', error);
    res.status(500).json({ success: false, message: 'Error fetching system status' });
  }
};

// ============================================
// USER MANAGEMENT
// ============================================

/**
 * GET /api/owner/users
 * Get all users with full details (including blocked, security flags)
 */
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select('-password -refreshToken -deviceFingerprint')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: { users } });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
};

/**
 * POST /api/owner/users/:userId/block
 * Block a user
 */
const blockUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    // Can't block yourself
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot block yourself' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Can't block another owner
    if (user.role === 'owner') {
      return res.status(400).json({ success: false, message: 'Cannot block the owner' });
    }

    user.isBlocked = true;
    user.blockedAt = new Date();
    user.blockedBy = req.user._id;
    user.blockedReason = reason || 'Blocked by owner';

    // Force logout the blocked user
    user.securityFlags.forceLogout = true;
    user.isOnline = false;
    user.socketId = null;
    user.refreshToken = null;

    await user.save();

    // Find and disconnect ALL sockets belonging to this user in real-time.
    // We iterate io.sockets because the onlineUsers Map is local to
    // socket/index.js. Each socket has userId bound during auth middleware.
    const io = req.app.get('io');
    if (io) {
      for (const [, sock] of io.sockets.sockets) {
        if (sock.userId === userId) {
          sock.emit('security:force-logout', {
            reason: `Your account has been blocked. Reason: ${reason || 'Blocked by owner'}`,
          });
          sock.disconnect(true);
        }
      }
    }

    securityLogger.authEvent('user_blocked', SEVERITY.ALERT, {
      blockedUserId: userId,
      blockedUsername: user.username,
      blockedBy: req.user._id.toString(),
      reason,
    });

    res.json({
      success: true,
      message: `User ${user.username} has been blocked`,
      data: { user: user.toSafeObject() },
    });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ success: false, message: 'Error blocking user' });
  }
};

/**
 * POST /api/owner/users/:userId/unblock
 * Unblock a user
 */
const unblockUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.isBlocked = false;
    user.blockedAt = null;
    user.blockedBy = null;
    user.blockedReason = null;
    user.securityFlags.forceLogout = false;

    await user.save();

    securityLogger.authEvent('user_unblocked', SEVERITY.INFO, {
      unblockedUserId: userId,
      unblockedUsername: user.username,
      unblockedBy: req.user._id.toString(),
    });

    res.json({
      success: true,
      message: `User ${user.username} has been unblocked`,
      data: { user: user.toSafeObject() },
    });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ success: false, message: 'Error unblocking user' });
  }
};

// ============================================
// FILE MANAGEMENT
// ============================================

/**
 * GET /api/owner/files
 * List all uploaded files
 */
const getAllFiles = async (req, res) => {
  try {
    if (!fs.existsSync(uploadDir)) {
      return res.json({ success: true, data: { files: [] } });
    }

    const diskFiles = fs.readdirSync(uploadDir);
    const files = [];

    for (const filename of diskFiles) {
      const filePath = path.join(uploadDir, filename);
      try {
        const stats = fs.statSync(filePath);

        // Try to find the original name from messages
        let originalName = filename;
        let uploadedBy = null;
        try {
          const msg = await Message.findOne({ fileUrl: { $regex: filename } })
            .populate('sender', 'username');
          if (msg) {
            originalName = msg.fileName || filename;
            uploadedBy = msg.sender ? { _id: msg.sender._id, username: msg.sender.username } : null;
          }
        } catch {}

        files.push({
          storedName: filename,
          originalName,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          uploadedBy,
        });
      } catch {}
    }

    // Sort newest first
    files.sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({ success: true, data: { files, total: files.length } });
  } catch (error) {
    console.error('Get all files error:', error);
    res.status(500).json({ success: false, message: 'Error fetching files' });
  }
};

/**
 * DELETE /api/owner/files/:filename
 * Owner can delete ANY file
 */
const ownerDeleteFile = async (req, res) => {
  try {
    const { filename } = req.params;
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(uploadDir, sanitizedFilename);

    // Chroot validation
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(uploadDir))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    fs.unlinkSync(filePath);

    securityLogger.fileEvent('owner_delete', SEVERITY.INFO, {
      ownerId: req.user._id.toString(),
      filename: sanitizedFilename,
    });

    res.json({ success: true, message: 'File deleted by owner' });
  } catch (error) {
    console.error('Owner delete file error:', error);
    res.status(500).json({ success: false, message: 'Error deleting file' });
  }
};

/**
 * GET /api/owner/files/download/:filename
 * Owner can download ANY file
 */
const ownerDownloadFile = async (req, res) => {
  try {
    const { filename } = req.params;
    const sanitizedFilename = path.basename(filename);
    const filePath = path.join(uploadDir, sanitizedFilename);

    // Chroot validation
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(uploadDir))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    // Try to find original filename
    let downloadName = sanitizedFilename;
    try {
      const msg = await Message.findOne({ fileUrl: { $regex: sanitizedFilename } });
      if (msg && msg.fileName) downloadName = msg.fileName;
    } catch {}

    securityLogger.fileEvent('owner_download', SEVERITY.INFO, {
      ownerId: req.user._id.toString(),
      filename: sanitizedFilename,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, downloadName);
  } catch (error) {
    console.error('Owner download file error:', error);
    res.status(500).json({ success: false, message: 'Error downloading file' });
  }
};

// ============================================
// OWNER MODE TOGGLE
// ============================================

/**
 * POST /api/owner/toggle-visibility
 * Toggle whether other users can see this user is the owner
 */
const toggleOwnerVisibility = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    user.ownerModeVisible = !user.ownerModeVisible;
    await user.save();

    // Broadcast owner mode change via socket
    const io = req.app.get('io');
    if (io) {
      io.emit('owner:mode-changed', {
        userId: user._id,
        ownerModeVisible: user.ownerModeVisible,
      });
    }

    securityLogger.authEvent('owner_mode_toggled', SEVERITY.INFO, {
      userId: user._id.toString(),
      ownerModeVisible: user.ownerModeVisible,
    });

    res.json({
      success: true,
      message: `Owner mode ${user.ownerModeVisible ? 'ON' : 'OFF'}`,
      data: { ownerModeVisible: user.ownerModeVisible },
    });
  } catch (error) {
    console.error('Toggle owner visibility error:', error);
    res.status(500).json({ success: false, message: 'Error toggling owner visibility' });
  }
};

/**
 * GET /api/owner/logs/recent
 * Get the most recent logs across all dates — powers the terminal view
 * Query: ?limit=500&severity=&category=&search=
 */
const getRecentLogs = async (req, res) => {
  try {
    const { limit = 500, severity, category, search } = req.query;

    if (!fs.existsSync(logsDir)) {
      return res.json({ success: true, data: { entries: [], total: 0 } });
    }

    // Get all log files sorted newest first
    const logFileNames = fs.readdirSync(logsDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort()
      .reverse();

    let allEntries = [];
    const maxLimit = Math.min(parseInt(limit), 2000);

    // Read files starting from newest until we have enough entries
    for (const fname of logFileNames) {
      if (allEntries.length >= maxLimit) break;

      const content = fs.readFileSync(path.join(logsDir, fname), 'utf8');
      const lines = content.trim().split('\n').filter(l => l);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          allEntries.push(entry);
        } catch {}
      }
    }

    // Sort newest first
    allEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply filters
    if (severity) {
      allEntries = allEntries.filter(e => e.severity === severity.toUpperCase());
    }
    if (category) {
      allEntries = allEntries.filter(e => e.category === category.toUpperCase());
    }
    if (search) {
      const q = search.toLowerCase();
      allEntries = allEntries.filter(e =>
        e.event?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q) ||
        e.severity?.toLowerCase().includes(q) ||
        JSON.stringify(e.data || {}).toLowerCase().includes(q)
      );
    }

    const total = allEntries.length;
    allEntries = allEntries.slice(0, maxLimit);

    res.json({ success: true, data: { entries: allEntries, total } });
  } catch (error) {
    console.error('Get recent logs error:', error);
    res.status(500).json({ success: false, message: 'Error fetching recent logs' });
  }
};

/**
 * GET /api/owner/logs/download/:filename
 * Download a raw log file
 */
const downloadLogFile = async (req, res) => {
  try {
    const { filename } = req.params;
    const sanitized = path.basename(filename);
    const logFile = path.join(logsDir, sanitized);

    const resolved = path.resolve(logFile);
    if (!resolved.startsWith(path.resolve(logsDir))) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!fs.existsSync(logFile)) {
      return res.status(404).json({ success: false, message: 'Log file not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);
    res.setHeader('Content-Type', 'application/json');
    res.download(logFile, sanitized);
  } catch (error) {
    console.error('Download log file error:', error);
    res.status(500).json({ success: false, message: 'Error downloading log file' });
  }
};

// ─── Helpers ───────────────────────────────────────────

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

module.exports = {
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
  toggleOwnerVisibility,
  downloadLogFile,
};
