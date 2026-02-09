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

const initializeSocket = (httpsServer) => {
  const io = new Server(httpsServer, {
    cors: {
      origin: '*', // In production, restrict to your client IP/origin
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Performance tuning
    pingInterval: 25000,    // How often to ping clients
    pingTimeout: 20000,     // How long to wait for pong
    maxHttpBufferSize: 1e6, // 1MB max message size (signaling only, not media)
    transports: ['websocket', 'polling'], // Prefer WebSocket
  });

  /**
   * JWT Authentication Middleware for Socket.io
   * 
   * WHY: Every socket connection MUST be authenticated.
   * Without this, anyone could connect and:
   * - Listen to other users' signaling data
   * - Inject fake ICE candidates
   * - Impersonate users
   * 
   * HOW: Client sends JWT token in auth handshake.
   * Server verifies token and binds userId ↔ socketId.
   */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Find user and attach to socket
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return next(new Error('Authentication error: User not found'));
      }

      // Bind user data to socket instance
      socket.userId = user._id.toString();
      socket.username = user.username;
      socket.user = user;

      next();
    } catch (error) {
      console.error('Socket auth error:', error.message);
      next(new Error('Authentication error: Invalid token'));
    }
  });

  return io;
};

module.exports = initializeSocket;
