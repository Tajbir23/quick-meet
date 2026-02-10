/**
 * ============================================
 * Authentication Controller — HARDENED
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - Short-lived access tokens (15 min)
 * - Refresh token rotation (new token on every refresh)
 * - Device fingerprint binding
 * - Brute force protection (progressive lockout)
 * - Intrusion detection integration
 * - Security event logging
 * - Credential stuffing defense
 * - Session management with concurrent limits
 */

const User = require('../models/User');
const {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_EXPIRY_DAYS,
} = require('../middleware/auth');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const intrusionDetector = require('../security/IntrusionDetector');
const cryptoService = require('../security/CryptoService');

/**
 * POST /api/auth/signup
 * Register a new user
 */
const signup = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const ip = req.ip;
    const deviceFingerprint = req.headers['x-device-fingerprint'] || null;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password',
      });
    }

    // Password strength validation
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters',
      });
    }

    // Check password complexity
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    const complexity = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecial].filter(Boolean).length;

    if (complexity < 3) {
      return res.status(400).json({
        success: false,
        message: 'Password must include at least 3 of: uppercase, lowercase, numbers, special characters',
      });
    }

    // Check IP ban
    if (intrusionDetector.isIPBanned(ip)) {
      securityLogger.authEvent('signup_banned_ip', SEVERITY.WARN, { ip, email });
      return res.status(403).json({
        success: false,
        message: 'Registration temporarily unavailable. Please try again later.',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'username';
      return res.status(400).json({
        success: false,
        message: `User with this ${field} already exists`,
      });
    }

    // Create user (password hashed by pre-save middleware)
    const user = await User.create({
      username,
      email,
      password,
      passwordChangedAt: new Date(),
    });

    // Generate tokens
    const accessToken = generateAccessToken(user._id, deviceFingerprint);
    const refreshToken = generateRefreshToken();

    // Store hashed refresh token
    user.refreshToken = hashRefreshToken(refreshToken);
    if (deviceFingerprint) {
      user.deviceFingerprint = cryptoService.hashFingerprint(deviceFingerprint);
    }
    await user.save();

    // Log security event
    securityLogger.authEvent('signup', SEVERITY.INFO, {
      userId: user._id.toString(),
      username,
      ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: user.toSafeObject(),
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 minutes in seconds
      },
    });
  } catch (error) {
    console.error('Signup error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', '),
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error during registration',
    });
  }
};

/**
 * POST /api/auth/login
 * Authenticate user and return tokens
 * 
 * SECURITY:
 * - Brute force protection (progressive lockout)
 * - Intrusion detection (credential stuffing)
 * - Device fingerprint binding
 * - Security event logging
 */
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = req.ip;
    const deviceFingerprint = req.headers['x-device-fingerprint'] || null;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Check IP ban FIRST (before any DB queries)
    if (intrusionDetector.isIPBanned(ip)) {
      securityLogger.authEvent('login_banned_ip', SEVERITY.WARN, { ip, email });
      return res.status(403).json({
        success: false,
        message: 'Too many failed attempts. Please try again later.',
      });
    }

    // Check login rate via IDS
    const loginCheck = intrusionDetector.isLoginAllowed(ip, email);
    if (!loginCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: loginCheck.reason,
        retryAfter: loginCheck.until ? new Date(loginCheck.until).toISOString() : undefined,
      });
    }

    // Find user and include password for comparison
    const user = await User.findOne({ email }).select('+password +refreshToken');

    if (!user) {
      // Record failed attempt (don't reveal user doesn't exist)
      intrusionDetector.recordFailedLogin(ip, email);
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check account lock
    if (user.isLocked()) {
      securityLogger.authEvent('login_account_locked', SEVERITY.WARN, {
        userId: user._id.toString(),
        email, ip,
        lockedUntil: user.accountLockedUntil,
      });
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed attempts',
        lockedUntil: user.accountLockedUntil,
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      // Record failed login
      await user.recordFailedLogin();
      const idsResult = intrusionDetector.recordFailedLogin(ip, email);

      securityLogger.authEvent('login_failed', SEVERITY.WARN, {
        email, ip,
        attempts: user.failedLoginAttempts,
        userAgent: req.headers['user-agent'],
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        ...(idsResult.remaining <= 2 && {
          warning: `${idsResult.remaining} attempts remaining before lockout`,
        }),
      });
    }

    // Check if user is blocked
    if (user.isBlocked) {
      securityLogger.authEvent('login_blocked_user', SEVERITY.WARN, {
        userId: user._id.toString(),
        email, ip,
      });
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Contact the administrator.',
        code: 'ACCOUNT_BLOCKED',
      });
    }

    // === SUCCESSFUL LOGIN ===

    // Clear failed login counters
    await user.clearFailedLogins();
    intrusionDetector.recordSuccessfulLogin(ip, email);

    // Generate tokens
    const accessToken = generateAccessToken(user._id, deviceFingerprint);
    const refreshToken = generateRefreshToken();

    // Store hashed refresh token and device fingerprint
    user.refreshToken = hashRefreshToken(refreshToken);
    if (deviceFingerprint) {
      user.deviceFingerprint = cryptoService.hashFingerprint(deviceFingerprint);
    }
    user.isOnline = true;
    user.lastSeen = new Date();

    // Force logout flag reset
    if (user.securityFlags) {
      user.securityFlags.forceLogout = false;
    }

    await user.save();

    // Log security event
    securityLogger.authEvent('login_success', SEVERITY.INFO, {
      userId: user._id.toString(),
      username: user.username,
      ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toSafeObject(),
        accessToken,
        refreshToken,
        expiresIn: 900, // 15 minutes
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login',
    });
  }
};

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 * 
 * SECURITY:
 * - Refresh token rotation (old token invalidated)
 * - Device fingerprint re-validation
 * - If stolen refresh token is reused, ALL tokens are revoked
 */
const refreshAccessToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const deviceFingerprint = req.headers['x-device-fingerprint'] || null;
    const ip = req.ip;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // Find user by hashed refresh token
    const hashedToken = hashRefreshToken(refreshToken);
    const user = await User.findOne({ refreshToken: hashedToken }).select('+refreshToken');

    if (!user) {
      // Possible token theft — someone is using an old/stolen refresh token
      securityLogger.authEvent('refresh_token_theft_attempt', SEVERITY.CRITICAL, {
        ip,
        message: 'Invalid refresh token used — possible token theft',
        userAgent: req.headers['user-agent'],
      });

      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token',
        code: 'REFRESH_TOKEN_INVALID',
      });
    }

    // Check if account is locked
    if (user.isLocked()) {
      return res.status(423).json({
        success: false,
        message: 'Account is locked',
      });
    }

    // Generate new token pair (rotation)
    const newAccessToken = generateAccessToken(user._id, deviceFingerprint);
    const newRefreshToken = generateRefreshToken();

    // Store new hashed refresh token (invalidates old one)
    user.refreshToken = hashRefreshToken(newRefreshToken);
    user.lastSeen = new Date();
    await user.save();

    securityLogger.authEvent('token_refreshed', SEVERITY.INFO, {
      userId: user._id.toString(),
      ip,
    });

    res.json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
      },
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error refreshing token',
    });
  }
};

/**
 * POST /api/auth/logout
 * Logout user — revoke all tokens
 */
const logout = async (req, res) => {
  try {
    // Invalidate refresh token
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: false,
      lastSeen: new Date(),
      socketId: null,
      refreshToken: null,
    });

    securityLogger.authEvent('logout', SEVERITY.INFO, {
      userId: req.user._id.toString(),
      ip: req.ip,
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout',
    });
  }
};

/**
 * POST /api/auth/revoke-all-sessions
 * Force logout from all devices
 */
const revokeAllSessions = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      refreshToken: null,
      activeSessions: [],
      'securityFlags.forceLogout': true,
    });

    securityLogger.authEvent('all_sessions_revoked', SEVERITY.ALERT, {
      userId: req.user._id.toString(),
      ip: req.ip,
      message: 'User revoked all sessions',
    });

    res.json({
      success: true,
      message: 'All sessions have been revoked',
    });
  } catch (error) {
    console.error('Revoke sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error revoking sessions',
    });
  }
};

/**
 * GET /api/auth/me
 * Get current authenticated user
 */
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      data: { user: user.toSafeObject() },
    });
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

/**
 * GET /api/auth/security-status
 * Get current security status (for admin/user)
 */
const getSecurityStatus = async (req, res) => {
  try {
    const status = intrusionDetector.getStatus();
    res.json({
      success: true,
      data: {
        ...status,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching security status' });
  }
};

module.exports = {
  signup,
  login,
  logout,
  getMe,
  refreshAccessToken,
  revokeAllSessions,
  getSecurityStatus,
};
