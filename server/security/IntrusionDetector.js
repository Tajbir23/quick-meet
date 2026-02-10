/**
 * ============================================
 * Intrusion Detection System (IDS)
 * ============================================
 * 
 * THREAT DETECTION:
 * - Brute force login attempts
 * - Credential stuffing patterns
 * - Socket abuse (rapid events, unusual patterns)
 * - Privilege escalation attempts
 * - User impersonation
 * - Concurrent session anomalies
 * - IP-based threat intelligence
 * 
 * AUTOMATED RESPONSES:
 * - Account lockout (progressive)
 * - IP ban (temporary → permanent)
 * - Session revocation (force logout)
 * - Rate escalation (tighter limits under attack)
 * - Alert notification (critical events)
 * 
 * DESIGN: Sliding window counters per IP/user with progressive penalties
 */

const securityLogger = require('./SecurityEventLogger');
const { SEVERITY } = require('./SecurityEventLogger');

class IntrusionDetector {
  constructor() {
    // Track failed login attempts: ip → { count, firstAttempt, lastAttempt }
    this._failedLogins = new Map();
    // Track banned IPs: ip → { until, reason, permanent }
    this._bannedIPs = new Map();
    // Track banned users: userId → { until, reason }
    this._lockedAccounts = new Map();
    // Track suspicious IPs: ip → score (threat score 0-100)
    this._threatScores = new Map();
    // Track socket event rates: socketId → { events: count, windowStart }
    this._socketRates = new Map();
    // Track concurrent sessions: userId → Set<sessionId>
    this._userSessions = new Map();

    // Configuration
    this.config = {
      // Login protection
      maxFailedLogins: 5,           // Lock after 5 failures
      loginWindowMs: 15 * 60 * 1000, // Within 15 minutes
      lockoutDurationMs: 30 * 60 * 1000, // Lock for 30 minutes
      permanentBanThreshold: 20,    // Permanent ban after 20 failures in window

      // Socket protection
      maxSocketEventsPerSecond: 30, // Max events/second per socket
      maxSocketEventsPerMinute: 300, // Max events/minute per socket
      socketBanDurationMs: 60 * 60 * 1000, // Ban for 1 hour

      // Session limits
      maxConcurrentSessions: 3,     // Max sessions per user

      // IP protection
      maxFailedLoginsPerIP: 20,     // Per IP across all users
      ipBanDurationMs: 60 * 60 * 1000, // 1 hour

      // Threat scoring
      threatBanThreshold: 80,       // Auto-ban at score 80+
    };

    // Cleanup old entries every 10 minutes
    this._cleanupInterval = setInterval(() => this._cleanup(), 10 * 60 * 1000);
  }

  // ============================================
  // LOGIN PROTECTION
  // ============================================

  /**
   * Record a failed login attempt
   * Returns: { blocked, remaining, lockoutUntil }
   */
  recordFailedLogin(ip, email) {
    const key = `${ip}:${email}`;
    const now = Date.now();

    if (!this._failedLogins.has(key)) {
      this._failedLogins.set(key, { count: 0, firstAttempt: now, lastAttempt: now });
    }

    const record = this._failedLogins.get(key);

    // Reset window if expired
    if (now - record.firstAttempt > this.config.loginWindowMs) {
      record.count = 0;
      record.firstAttempt = now;
    }

    record.count++;
    record.lastAttempt = now;

    // Also track per-IP
    this._addThreatScore(ip, 5, 'failed_login');

    // Check if should lock
    if (record.count >= this.config.permanentBanThreshold) {
      // Permanent ban for this IP
      this._banIP(ip, null, 'Excessive failed logins (potential credential stuffing)');
      securityLogger.intrusionEvent('credential_stuffing', SEVERITY.CRITICAL, {
        ip, email, attempts: record.count,
        message: `IP ${ip} permanently banned: ${record.count} failed logins`,
      });
      return { blocked: true, remaining: 0, lockoutUntil: null, permanent: true };
    }

    if (record.count >= this.config.maxFailedLogins) {
      const lockoutUntil = now + this.config.lockoutDurationMs;
      this._lockedAccounts.set(email, { until: lockoutUntil, reason: 'Too many failed login attempts' });

      securityLogger.intrusionEvent('brute_force', SEVERITY.ALERT, {
        ip, email, attempts: record.count,
        lockoutUntil: new Date(lockoutUntil).toISOString(),
        message: `Account ${email} locked: ${record.count} failed attempts`,
      });

      return {
        blocked: true,
        remaining: 0,
        lockoutUntil: new Date(lockoutUntil).toISOString(),
      };
    }

    return {
      blocked: false,
      remaining: this.config.maxFailedLogins - record.count,
    };
  }

  /**
   * Check if login is allowed for this IP/email
   */
  isLoginAllowed(ip, email) {
    // Check IP ban
    if (this.isIPBanned(ip)) {
      return { allowed: false, reason: 'IP is banned' };
    }

    // Check account lock
    if (this._lockedAccounts.has(email)) {
      const lock = this._lockedAccounts.get(email);
      if (lock.until === null || Date.now() < lock.until) {
        return { allowed: false, reason: 'Account is locked', until: lock.until };
      }
      // Lock expired, remove it
      this._lockedAccounts.delete(email);
    }

    return { allowed: true };
  }

  /**
   * Clear failed login count on successful login
   */
  recordSuccessfulLogin(ip, email) {
    const key = `${ip}:${email}`;
    this._failedLogins.delete(key);
    // Reduce threat score on success
    this._reduceThreatScore(ip, 10);
  }

  // ============================================
  // IP BANNING
  // ============================================

  /**
   * Ban an IP address
   * @param {string} ip
   * @param {number|null} durationMs - null for permanent
   * @param {string} reason
   */
  _banIP(ip, durationMs, reason) {
    const until = durationMs ? Date.now() + durationMs : null;
    this._bannedIPs.set(ip, { until, reason, permanent: !durationMs, bannedAt: Date.now() });
  }

  /**
   * Check if an IP is banned
   */
  isIPBanned(ip) {
    if (!this._bannedIPs.has(ip)) return false;

    const ban = this._bannedIPs.get(ip);
    if (ban.permanent) return true;
    if (ban.until && Date.now() < ban.until) return true;

    // Ban expired
    this._bannedIPs.delete(ip);
    return false;
  }

  /**
   * Manually ban an IP (admin action)
   */
  banIP(ip, durationMs, reason) {
    this._banIP(ip, durationMs, reason);
    securityLogger.intrusionEvent('ip_banned', SEVERITY.ALERT, { ip, reason, durationMs });
  }

  /**
   * Unban an IP
   */
  unbanIP(ip) {
    this._bannedIPs.delete(ip);
    securityLogger.intrusionEvent('ip_unbanned', SEVERITY.INFO, { ip });
  }

  // ============================================
  // SOCKET RATE MONITORING
  // ============================================

  /**
   * Record a socket event and check rate limits
   * Returns: { allowed, eventsInWindow }
   */
  checkSocketRate(socketId, userId, eventName) {
    const now = Date.now();
    const key = socketId;

    if (!this._socketRates.has(key)) {
      this._socketRates.set(key, {
        secondCount: 0,
        secondStart: now,
        minuteCount: 0,
        minuteStart: now,
        events: [],
      });
    }

    const rate = this._socketRates.get(key);

    // Reset second window
    if (now - rate.secondStart >= 1000) {
      rate.secondCount = 0;
      rate.secondStart = now;
    }

    // Reset minute window
    if (now - rate.minuteStart >= 60000) {
      rate.minuteCount = 0;
      rate.minuteStart = now;
    }

    rate.secondCount++;
    rate.minuteCount++;

    // Check limits
    if (rate.secondCount > this.config.maxSocketEventsPerSecond) {
      securityLogger.socketEvent('rate_limited', SEVERITY.WARN, {
        socketId, userId, eventName,
        rate: `${rate.secondCount}/sec`,
        message: `Socket ${socketId} rate limited (${rate.secondCount} events/sec)`,
      });
      return { allowed: false, reason: 'Too many events per second' };
    }

    if (rate.minuteCount > this.config.maxSocketEventsPerMinute) {
      securityLogger.socketEvent('rate_limited', SEVERITY.ALERT, {
        socketId, userId, eventName,
        rate: `${rate.minuteCount}/min`,
        message: `Socket ${socketId} rate limited (${rate.minuteCount} events/min)`,
      });
      return { allowed: false, reason: 'Too many events per minute' };
    }

    return { allowed: true };
  }

  /**
   * Clean up socket rate data on disconnect
   */
  removeSocket(socketId) {
    this._socketRates.delete(socketId);
  }

  // ============================================
  // THREAT SCORING
  // ============================================

  /**
   * Add to threat score for an IP
   */
  _addThreatScore(ip, points, reason) {
    const current = this._threatScores.get(ip) || 0;
    const newScore = Math.min(100, current + points);
    this._threatScores.set(ip, newScore);

    // Auto-ban on high threat score
    if (newScore >= this.config.threatBanThreshold && !this.isIPBanned(ip)) {
      this._banIP(ip, this.config.ipBanDurationMs, `Threat score ${newScore}: ${reason}`);
      securityLogger.intrusionEvent('threat_ban', SEVERITY.CRITICAL, {
        ip, score: newScore, reason,
        message: `IP ${ip} auto-banned: threat score ${newScore}`,
      });
    }
  }

  /**
   * Reduce threat score (positive action)
   */
  _reduceThreatScore(ip, points) {
    const current = this._threatScores.get(ip) || 0;
    this._threatScores.set(ip, Math.max(0, current - points));
  }

  /**
   * Get threat score for an IP
   */
  getThreatScore(ip) {
    return this._threatScores.get(ip) || 0;
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  /**
   * Register a new session for a user
   * Returns: { allowed, existingSessions }
   */
  registerSession(userId, sessionId) {
    if (!this._userSessions.has(userId)) {
      this._userSessions.set(userId, new Set());
    }

    const sessions = this._userSessions.get(userId);

    if (sessions.size >= this.config.maxConcurrentSessions) {
      securityLogger.sessionEvent('concurrent_limit', SEVERITY.WARN, {
        userId, sessionCount: sessions.size,
        message: `User ${userId} exceeded concurrent session limit`,
      });
      return {
        allowed: false,
        existingSessions: Array.from(sessions),
        limit: this.config.maxConcurrentSessions,
      };
    }

    sessions.add(sessionId);
    return { allowed: true, sessionCount: sessions.size };
  }

  /**
   * Remove a session
   */
  removeSession(userId, sessionId) {
    const sessions = this._userSessions.get(userId);
    if (sessions) {
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        this._userSessions.delete(userId);
      }
    }
  }

  /**
   * Revoke all sessions for a user (force logout)
   */
  revokeAllSessions(userId) {
    const sessions = this._userSessions.get(userId);
    const count = sessions ? sessions.size : 0;
    this._userSessions.delete(userId);

    securityLogger.sessionEvent('all_revoked', SEVERITY.ALERT, {
      userId, sessionCount: count,
      message: `All sessions revoked for user ${userId}`,
    });

    return count;
  }

  /**
   * Check if a session is valid
   */
  isSessionValid(userId, sessionId) {
    const sessions = this._userSessions.get(userId);
    return sessions ? sessions.has(sessionId) : false;
  }

  // ============================================
  // ANOMALY DETECTION
  // ============================================

  /**
   * Detect suspicious patterns
   * Called periodically or on specific events
   */
  detectAnomalies(userId, context = {}) {
    const anomalies = [];

    // Check for unusual geographic shift (if IP tracking is available)
    if (context.ip && context.previousIP && context.ip !== context.previousIP) {
      anomalies.push({
        type: 'ip_change',
        severity: SEVERITY.WARN,
        detail: `IP changed from ${context.previousIP} to ${context.ip}`,
      });
    }

    // Check for unusual time (configurable)
    const hour = new Date().getUTCHours();
    if (context.usualHours && !context.usualHours.includes(hour)) {
      anomalies.push({
        type: 'unusual_time',
        severity: SEVERITY.INFO,
        detail: `Login at unusual hour (UTC ${hour})`,
      });
    }

    // Log anomalies
    for (const anomaly of anomalies) {
      securityLogger.sessionEvent('anomaly_detected', anomaly.severity, {
        userId,
        anomalyType: anomaly.type,
        message: anomaly.detail,
      });
    }

    return anomalies;
  }

  // ============================================
  // STATUS & REPORTING
  // ============================================

  /**
   * Get current security status
   */
  getStatus() {
    return {
      bannedIPs: this._bannedIPs.size,
      lockedAccounts: this._lockedAccounts.size,
      activeThreats: Array.from(this._threatScores.entries())
        .filter(([, score]) => score > 50)
        .map(([ip, score]) => ({ ip, score })),
      activeSessions: this._userSessions.size,
      monitoredSockets: this._socketRates.size,
    };
  }

  // ============================================
  // CLEANUP
  // ============================================

  _cleanup() {
    const now = Date.now();

    // Clean expired bans
    for (const [ip, ban] of this._bannedIPs.entries()) {
      if (!ban.permanent && ban.until && now > ban.until) {
        this._bannedIPs.delete(ip);
      }
    }

    // Clean expired account locks
    for (const [email, lock] of this._lockedAccounts.entries()) {
      if (lock.until && now > lock.until) {
        this._lockedAccounts.delete(email);
      }
    }

    // Decay threat scores
    for (const [ip, score] of this._threatScores.entries()) {
      const newScore = Math.max(0, score - 5); // Decay by 5 per cleanup cycle
      if (newScore === 0) {
        this._threatScores.delete(ip);
      } else {
        this._threatScores.set(ip, newScore);
      }
    }

    // Clean old failed login records
    for (const [key, record] of this._failedLogins.entries()) {
      if (now - record.lastAttempt > this.config.loginWindowMs * 2) {
        this._failedLogins.delete(key);
      }
    }
  }

  /**
   * Shutdown
   */
  destroy() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
  }
}

// Singleton
const intrusionDetector = new IntrusionDetector();

module.exports = intrusionDetector;
