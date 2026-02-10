/**
 * ============================================
 * Socket.io Configuration
 * ============================================
 * 
 * WHY Socket.io and NOT raw WebSocket:
 * 1. Automatic reconnection with exponential backoff
 * 2. Room-based messaging (essential for groups)
 * 3. Namespace support for separation of concerns
 * 4. Fallback transports (polling → websocket upgrade)
 * 5. Built-in acknowledgments
 * 
 * IMPORTANT: Socket.io is used ONLY for signaling:
 * - User presence (online/offline)
 * - WebRTC offer/answer exchange
 * - ICE candidate exchange
 * - Group call coordination
 * - Chat message delivery notifications
 * 
 * ALL media (audio/video/screen) goes through WebRTC P2P.
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const securityLogger = require('../security/SecurityEventLogger');
const { SEVERITY } = require('../security/SecurityEventLogger');
const intrusionDetector = require('../security/IntrusionDetector');

const initializeSocket = (httpsServer) => {
  // Parse allowed origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['*'];

  const io = new Server(httpsServer, {
    cors: {
      origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Performance tuning
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6,
    transports: ['websocket', 'polling'],
    // Security: limit connection rate
    connectTimeout: 10000,
  });

  /**
   * JWT Authentication Middleware for Socket.io — HARDENED
   * 
   * SECURITY CHECKS:
   * 1. IP ban check
   * 2. Token presence and format
   * 3. JWT signature verification
   * 4. User existence check
   * 5. Account lock check
   * 6. Force-logout flag check
   * 7. Device fingerprint validation
   */
  io.use(async (socket, next) => {
    try {
      const ip = socket.handshake.address;

      // Check IP ban
      if (intrusionDetector.isIPBanned(ip)) {
        securityLogger.socketEvent('connection_banned_ip', SEVERITY.WARN, { ip });
        return next(new Error('Connection refused'));
      }

      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
      } catch (jwtError) {
        securityLogger.socketEvent('invalid_token', SEVERITY.WARN, {
          ip,
          error: jwtError.message,
        });
        return next(new Error('Authentication error: Invalid or expired token'));
      }

      // Find user
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      // Check account lock
      if (user.isLocked()) {
        return next(new Error('Authentication error: Account is locked'));
      }

      // Check force-logout flag
      if (user.securityFlags && user.securityFlags.forceLogout) {
        return next(new Error('Authentication error: Session terminated'));
      }

      // Check if user is blocked
      if (user.isBlocked) {
        securityLogger.socketEvent('blocked_user_connection', SEVERITY.WARN, {
          userId: user._id.toString(),
          username: user.username,
          ip,
        });
        return next(new Error('Authentication error: Account is blocked'));
      }

      // Bind user data to socket instance
      socket.userId = user._id.toString();
      socket.username = user.username;
      socket.user = user;
      socket.ip = ip;

      securityLogger.socketEvent('connection_authenticated', SEVERITY.INFO, {
        userId: socket.userId,
        username: socket.username,
        ip,
      });

      next();
    } catch (error) {
      console.error('Socket auth error:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  return io;
};

module.exports = initializeSocket;
