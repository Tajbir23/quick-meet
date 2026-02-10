/**
 * ============================================
 * Quick Meet — Main Server Entry Point
 * ============================================
 * 
 * ARCHITECTURE:
 * 
 *   Client (React + WebRTC)
 *        │
 *        ├── HTTPS REST API (Express) ─── Auth, Messages, Files, Groups
 *        │
 *        └── WSS (Socket.io) ─── Signaling, Presence, Chat events
 *               │
 *               └── WebRTC P2P ─── Audio, Video, Screen Share
 * 
 * WHY HTTPS:
 * WebRTC REQUIRES a secure context. navigator.mediaDevices will NOT work
 * on plain HTTP (except localhost). Since this system is hosted on a
 * remote server accessed via IP, HTTPS with self-signed SSL is mandatory.
 * 
 * FLOW:
 * 1. Load SSL certificates
 * 2. Create Express app with security middleware
 * 3. Create HTTPS server
 * 4. Initialize Socket.io on HTTPS server
 * 5. Connect to MongoDB
 * 6. Register socket event handlers
 * 7. Start listening
 */

require('dotenv').config();

// ─── Force server process to UTC ────────────────────────────────
// WHY: If the server is hosted in India (UTC+5:30), Date objects
// can give misleading local strings. By pinning TZ=UTC, every
// new Date() / Date.now() behaves identically regardless of where
// the VPS is physically located. MongoDB already stores UTC, so
// this makes the whole pipeline consistent.
process.env.TZ = 'UTC';

const https = require('https');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

// Config
const connectDB = require('./config/db');
const getSSLOptions = require('./config/ssl');
const initializeSocket = require('./config/socket');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const messageRoutes = require('./routes/message');
const groupRoutes = require('./routes/group');
const fileRoutes = require('./routes/file');

// Socket handlers
const registerSocketHandlers = require('./socket');

// ============================================
// Express App Setup
// ============================================
const app = express();

// Trust first proxy (nginx reverse proxy)
// WHY: Server runs behind Nginx which sets X-Forwarded-For header.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// and cannot correctly identify client IPs for rate limiting.
app.set('trust proxy', 1);

// Security headers (helmet)
// WHY: Prevents common web vulnerabilities (XSS, clickjacking, MIME sniffing)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // Disable CSP for development; enable in production
}));

// CORS configuration
// WHY: Client runs on different port during development
// In production, restrict origin to your actual client IP/port
app.use(cors({
  origin: '*', // TODO: Restrict in production to specific origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve client build in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
}

// ============================================
// API Routes
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/files', fileRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

// Catch-all for client-side routing in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ============================================
// HTTPS Server + Socket.io + MongoDB
// ============================================
const startServer = async () => {
  try {
    // 1. Connect to MongoDB
    await connectDB();

    // 2. Load SSL certificates (auto-generates if missing)
    const sslOptions = await getSSLOptions();

    // 3. Create HTTPS server
    const httpsServer = https.createServer(sslOptions, app);

    // 4. Initialize Socket.io with JWT auth
    const io = initializeSocket(httpsServer);

    // 5. Register all socket event handlers
    registerSocketHandlers(io);

    // 6. Start listening
    const PORT = process.env.PORT || 5000;
    const HOST = process.env.SERVER_IP || '0.0.0.0';

    httpsServer.listen(PORT, HOST, () => {
      console.log('');
      console.log('============================================');
      console.log('   🚀 Quick Meet Server Running');
      console.log('============================================');
      console.log(`   🔒 HTTPS:    https://${HOST}:${PORT}`);
      console.log(`   📡 Socket:   wss://${HOST}:${PORT}`);
      console.log(`   🗄️  MongoDB:  ${process.env.MONGODB_URI}`);
      console.log(`   🌍 ENV:      ${process.env.NODE_ENV}`);
      console.log(`   📁 Uploads:  ${path.resolve(__dirname, 'uploads')}`);
      console.log('============================================');
      console.log('');
      console.log('⚠️  If using self-signed SSL:');
      console.log(`   Open https://${HOST}:${PORT} in browser`);
      console.log('   Accept the security warning to trust the certificate');
      console.log('');
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      console.log(`\n${signal} received. Shutting down gracefully...`);

      // Close socket connections
      io.close(() => {
        console.log('Socket.io connections closed');
      });

      // Close HTTPS server
      httpsServer.close(() => {
        console.log('HTTPS server closed');
      });

      // Close MongoDB
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      console.log('MongoDB connection closed');

      process.exit(0);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
