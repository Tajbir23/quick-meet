/**
 * ============================================
 * MongoDB Connection Configuration
 * ============================================
 * 
 * WHY: Centralized database connection with retry logic.
 * Mongoose provides schema validation, middleware hooks,
 * and connection pooling out of the box.
 */

const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // Modern Mongoose (v6+) uses these defaults, but explicit is better
      maxPoolSize: 10,        // Maximum number of sockets in the pool
      serverSelectionTimeoutMS: 5000, // Timeout after 5s if can't connect
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}:${conn.connection.port}/${conn.connection.name}`);

    // Connection event handlers for production monitoring
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });

    return conn;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    // Exit process with failure - let process manager restart
    process.exit(1);
  }
};

module.exports = connectDB;
