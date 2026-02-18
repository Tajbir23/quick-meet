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

// Security
const { initializeSecurity, shutdownSecurity, intrusionDetector } = require('./security');
const securityLogger = require('./security/SecurityEventLogger');
const { SEVERITY } = require('./security/SecurityEventLogger');

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
const ownerRoutes = require('./routes/owner');
const fileTransferRoutes = require('./routes/fileTransfer');
const updateRoutes = require('./routes/update');
const webhookRoutes = require('./routes/webhook');
const pushRoutes = require('./routes/push');

// Socket handlers
const registerSocketHandlers = require('./socket');

// User presence cache
const userCache = require('./utils/userCache');

// ============================================
// Express App Setup
// ============================================
const app = express();

// Trust first proxy (nginx reverse proxy)
// WHY: Server runs behind Nginx which sets X-Forwarded-For header.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// and cannot correctly identify client IPs for rate limiting.
app.set('trust proxy', 1);

// Security headers (helmet) — HARDENED
// WHY: Prevents common web vulnerabilities (XSS, clickjacking, MIME sniffing)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss:', 'https:'],
      mediaSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  // Additional security headers
  hsts: {
    maxAge: 31536000,       // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false, // Allow WebRTC
}));

// Additional security headers not covered by helmet
app.use((req, res, next) => {
  // Prevent caching of sensitive data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // XSS protection (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Permissions policy (restrict browser features)
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=()');
  // Remove server identification
  res.removeHeader('X-Powered-By');
  next();
});

// CORS configuration — HARDENED
// WHY: Restrict to known origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['*']; // Default to * for dev; restrict in production

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    securityLogger.log('SYSTEM', 'cors_rejected', SEVERITY.WARN, {
      origin,
      message: `CORS request from unauthorized origin: ${origin}`,
    });
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Fingerprint', 'X-Request-Nonce'],
  credentials: true,
  maxAge: 600, // Cache preflight for 10 minutes
}));

// IP ban check middleware (before any routes)
app.use((req, res, next) => {
  const ip = req.ip;
  if (intrusionDetector.isIPBanned(ip)) {
    securityLogger.intrusionEvent('banned_ip_request', SEVERITY.WARN, {
      ip,
      path: req.path,
    });
    return res.status(403).json({
      success: false,
      message: 'Access denied',
    });
  }
  next();
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Static file serving for uploads — SECURED
// Files are now served through authenticated endpoints with time-limited tokens
// Direct static serving is DISABLED to prevent unauthorized access
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// NOTE: Use /api/files/download/:filename?token=xxx instead

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
app.use('/api/owner', ownerRoutes);
app.use('/api/transfers', fileTransferRoutes);
app.use('/api/updates', updateRoutes);
app.use('/api/push', pushRoutes);

// GitHub Webhook — auto-deploy on push
// NOTE: This route handles its own body parsing (raw) for HMAC verification
app.use('/webhook', webhookRoutes);

// Health check endpoint — sanitized (don't expose internals)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Catch-all for client-side routing in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Global error handler — sanitized
app.use((err, req, res, next) => {
  // Log error securely
  securityLogger.log('SYSTEM', 'unhandled_error', SEVERITY.WARN, {
    path: req.path,
    method: req.method,
    error: err.message,
    ip: req.ip,
  });

  // Never expose error details in production
  res.status(err.status || 500).json({
    success: false,
    message: 'Internal server error',
  });
});

// ============================================
// HTTPS Server + Socket.io + MongoDB
// ============================================
const startServer = async () => {
  try {
    // 0. Initialize security layer FIRST
    initializeSecurity();

    // 1. Connect to MongoDB
    await connectDB();

    // 2. Load SSL certificates (auto-generates if missing)
    const sslOptions = await getSSLOptions();

    // 3. Create HTTPS server
    const httpsServer = https.createServer(sslOptions, app);

    // 4. Initialize Socket.io with JWT auth
    const io = initializeSocket(httpsServer);

    // Store io on app so REST controllers can emit socket events
    app.set('io', io);

    // 5. Register all socket event handlers
    registerSocketHandlers(io);

    // 5.5. Start user presence cache background sync
    userCache.startSync();

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

      // Shutdown security modules
      shutdownSecurity();

      // Stop cache sync
      userCache.stopSync();
      // Final sync to DB before shutdown
      await userCache.syncToDatabase();

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
