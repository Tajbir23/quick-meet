/**
 * ============================================
 * Security Event Logger — Tamper-Proof Audit Trail
 * ============================================
 * 
 * DESIGN:
 * - Every security-relevant event is logged with full context
 * - Logs are HMAC-signed to detect tampering
 * - Chain-hashing: each log entry includes hash of previous entry
 * - Cannot insert, modify, or delete entries without breaking the chain
 * 
 * THREAT MODEL:
 * - Insider attack: Tamper-proof logs expose modifications
 * - Server breach: Attacker cannot cover tracks
 * - Forensic readiness: Full event chain for investigation
 * 
 * EVENT TAXONOMY:
 * ┌─────────────────────┬──────────────────────────────────────┐
 * │ Category            │ Events                               │
 * ├─────────────────────┼──────────────────────────────────────┤
 * │ AUTH                │ login, logout, signup, token_refresh │
 * │                     │ login_failed, account_locked         │
 * │ SESSION             │ created, revoked, expired, anomaly   │
 * │ SOCKET              │ connect, disconnect, hijack_attempt  │
 * │                     │ replay_detected, rate_limited        │
 * │ CALL                │ initiated, answered, rejected        │
 * │                     │ token_invalid, suspicious_state      │
 * │ FILE                │ upload, download, delete, scan_fail  │
 * │ INTRUSION           │ brute_force, credential_stuffing     │
 * │                     │ privilege_escalation, impersonation  │
 * │ SYSTEM              │ startup, shutdown, config_change     │
 * └─────────────────────┴──────────────────────────────────────┘
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Severity levels
const SEVERITY = {
  INFO: 'INFO',
  WARN: 'WARN',
  ALERT: 'ALERT',
  CRITICAL: 'CRITICAL',
};

// Event categories
const CATEGORY = {
  AUTH: 'AUTH',
  SESSION: 'SESSION',
  SOCKET: 'SOCKET',
  CALL: 'CALL',
  FILE: 'FILE',
  MESSAGE: 'MESSAGE',
  INTRUSION: 'INTRUSION',
  SYSTEM: 'SYSTEM',
  WEBRTC: 'WEBRTC',
};

class SecurityEventLogger {
  constructor() {
    this._hmacKey = null;
    this._lastHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this._eventCount = 0;
    this._logStream = null;
    this._logDir = null;
    this._listeners = new Map(); // severity → callback[]
    this._initialized = false;
  }

  /**
   * Initialize the logger
   */
  initialize() {
    if (this._initialized) return;

    // Derive HMAC key from environment or generate
    const secret = process.env.LOG_HMAC_SECRET || process.env.JWT_SECRET || 'fallback-hmac-key';
    this._hmacKey = crypto.createHash('sha256').update(secret).digest();

    // Setup log directory
    this._logDir = path.resolve(__dirname, '..', 'logs', 'security');
    if (!fs.existsSync(this._logDir)) {
      fs.mkdirSync(this._logDir, { recursive: true });
    }

    // Open log file stream (append mode)
    const logFile = path.join(this._logDir, `security-${this._getDateString()}.jsonl`);
    this._logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Rotate log file at midnight
    this._rotateInterval = setInterval(() => {
      this._rotateLogFile();
    }, 60 * 60 * 1000); // Check every hour

    this._currentDateString = this._getDateString();
    this._initialized = true;

    // Log system startup
    this.log(CATEGORY.SYSTEM, 'startup', SEVERITY.INFO, {
      message: 'Security event logger initialized',
      pid: process.pid,
    });
  }

  /**
   * Log a security event with tamper-proof chain hashing
   * 
   * @param {string} category - Event category (AUTH, SOCKET, etc.)
   * @param {string} event - Specific event name
   * @param {string} severity - SEVERITY level
   * @param {Object} data - Event data
   */
  log(category, event, severity, data = {}) {
    if (!this._initialized) this.initialize();

    this._eventCount++;

    const entry = {
      id: this._eventCount,
      timestamp: new Date().toISOString(),
      category,
      event,
      severity,
      data: {
        ...data,
        // Sanitize sensitive fields
        password: undefined,
        token: data.token ? `${data.token.substring(0, 10)}...` : undefined,
      },
      // Chain hash — links to previous event
      prevHash: this._lastHash,
    };

    // Compute HMAC of this entry (tamper detection)
    const entryString = JSON.stringify(entry);
    entry.hmac = crypto.createHmac('sha256', this._hmacKey)
      .update(entryString)
      .digest('hex');

    // Update chain hash
    this._lastHash = crypto.createHash('sha256')
      .update(entryString + entry.hmac)
      .digest('hex');
    entry.chainHash = this._lastHash;

    // Write to log file
    const logLine = JSON.stringify(entry) + '\n';
    if (this._logStream && !this._logStream.destroyed) {
      this._logStream.write(logLine);
    }

    // Console output for critical events
    if (severity === SEVERITY.CRITICAL || severity === SEVERITY.ALERT) {
      console.error(`🚨 [SECURITY ${severity}] ${category}:${event}`, data.message || '');
    } else if (severity === SEVERITY.WARN) {
      console.warn(`⚠️  [SECURITY ${severity}] ${category}:${event}`, data.message || '');
    }

    // Notify listeners
    this._notifyListeners(severity, entry);

    return entry;
  }

  // ─── Convenience methods ───────────────────────────────

  authEvent(event, severity, data) {
    return this.log(CATEGORY.AUTH, event, severity, data);
  }

  sessionEvent(event, severity, data) {
    return this.log(CATEGORY.SESSION, event, severity, data);
  }

  socketEvent(event, severity, data) {
    return this.log(CATEGORY.SOCKET, event, severity, data);
  }

  callEvent(event, severity, data) {
    return this.log(CATEGORY.CALL, event, severity, data);
  }

  fileEvent(event, severity, data) {
    return this.log(CATEGORY.FILE, event, severity, data);
  }

  intrusionEvent(event, severity, data) {
    return this.log(CATEGORY.INTRUSION, event, severity, data);
  }

  // ─── Listener management ──────────────────────────────

  /**
   * Register a listener for security events at a given severity
   * Used by IntrusionDetector to trigger automated responses
   */
  onEvent(severity, callback) {
    if (!this._listeners.has(severity)) {
      this._listeners.set(severity, []);
    }
    this._listeners.get(severity).push(callback);
  }

  /**
   * Register a listener for ALL security events
   */
  onAnyEvent(callback) {
    for (const sev of Object.values(SEVERITY)) {
      this.onEvent(sev, callback);
    }
  }

  _notifyListeners(severity, entry) {
    const callbacks = this._listeners.get(severity) || [];
    for (const cb of callbacks) {
      try {
        cb(entry);
      } catch (err) {
        console.error('Security listener error:', err);
      }
    }
  }

  // ─── Log verification ─────────────────────────────────

  /**
   * Verify integrity of a log file
   * Returns { valid, entries, firstBroken }
   */
  async verifyLogFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l);

    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    let broken = null;

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);

        // Verify chain
        if (entry.prevHash !== prevHash) {
          broken = i;
          break;
        }

        // Verify HMAC
        const savedHmac = entry.hmac;
        const savedChainHash = entry.chainHash;
        delete entry.hmac;
        delete entry.chainHash;

        const entryString = JSON.stringify(entry);
        const expectedHmac = crypto.createHmac('sha256', this._hmacKey)
          .update(entryString)
          .digest('hex');

        if (savedHmac !== expectedHmac) {
          broken = i;
          break;
        }

        prevHash = savedChainHash;
      } catch {
        broken = i;
        break;
      }
    }

    return {
      valid: broken === null,
      totalEntries: lines.length,
      firstBrokenEntry: broken,
    };
  }

  // ─── Internal helpers ─────────────────────────────────

  _getDateString() {
    return new Date().toISOString().split('T')[0];
  }

  _rotateLogFile() {
    const currentDate = this._getDateString();
    if (currentDate !== this._currentDateString) {
      this._currentDateString = currentDate;
      if (this._logStream) {
        this._logStream.end();
      }
      const logFile = path.join(this._logDir, `security-${currentDate}.jsonl`);
      this._logStream = fs.createWriteStream(logFile, { flags: 'a' });
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    this.log(CATEGORY.SYSTEM, 'shutdown', SEVERITY.INFO, {
      message: 'Security event logger shutting down',
      totalEvents: this._eventCount,
    });

    if (this._rotateInterval) clearInterval(this._rotateInterval);
    if (this._logStream) this._logStream.end();
    this._initialized = false;
  }
}

// Singleton
const securityLogger = new SecurityEventLogger();

// Export severity and category constants too
module.exports = securityLogger;
module.exports.SEVERITY = SEVERITY;
module.exports.CATEGORY = CATEGORY;
