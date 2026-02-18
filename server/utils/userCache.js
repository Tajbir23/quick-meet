/**
 * ============================================
 * In-Memory User Cache
 * ============================================
 * 
 * High-performance in-memory cache for user presence data.
 * Reduces MongoDB queries for frequently accessed user info
 * (online status, lastSeen timestamps).
 * 
 * ARCHITECTURE:
 * - userPresence Map: userId → { lastSeen, isOnline, username, socketId }
 * - Auto-syncs to MongoDB periodically (every 60s) to persist lastSeen
 * - Socket events update cache instantly (no DB round-trip)
 * - API endpoints read from cache first, fallback to DB
 * 
 * WHY in-memory:
 * - Presence data changes every second (heartbeats, connect/disconnect)
 * - Reading from Map = O(1), reading from MongoDB = 5-50ms
 * - For 100 users sending heartbeats every 30s, this saves ~200 DB ops/min
 */

const mongoose = require('mongoose');

// ─── CACHE STORAGE ──────────────────────────────────
const userPresenceCache = new Map(); // userId → { lastSeen, isOnline, username, socketId, updatedAt }
const userDataCache = new Map();     // userId → { user data object, cachedAt }

const USER_DATA_TTL = 5 * 60 * 1000;  // 5 minutes TTL for full user data
const SYNC_INTERVAL = 60 * 1000;       // Sync to DB every 60 seconds
const BATCH_SIZE = 50;                  // Max users to sync per batch

let syncTimer = null;

// ─── PRESENCE CACHE ─────────────────────────────────

/**
 * Update user presence in cache (called on connect, heartbeat, activity)
 */
const updatePresence = (userId, data) => {
  const existing = userPresenceCache.get(userId) || {};
  userPresenceCache.set(userId, {
    ...existing,
    ...data,
    lastSeen: data.lastSeen || new Date(),
    updatedAt: Date.now(),
  });
};

/**
 * Mark user as online in cache
 */
const setOnline = (userId, username, socketId) => {
  updatePresence(userId, {
    isOnline: true,
    username,
    socketId,
    lastSeen: new Date(),
  });
};

/**
 * Mark user as offline in cache
 */
const setOffline = (userId) => {
  const existing = userPresenceCache.get(userId);
  if (existing) {
    existing.isOnline = false;
    existing.socketId = null;
    existing.lastSeen = new Date();
    existing.updatedAt = Date.now();
  }
};

/**
 * Update lastSeen on heartbeat (lightweight update)
 */
const heartbeat = (userId) => {
  const existing = userPresenceCache.get(userId);
  if (existing) {
    existing.lastSeen = new Date();
    existing.updatedAt = Date.now();
  }
};

/**
 * Get user presence from cache
 */
const getPresence = (userId) => {
  return userPresenceCache.get(userId) || null;
};

/**
 * Get all online users from cache
 */
const getOnlineUsers = () => {
  const result = [];
  for (const [userId, data] of userPresenceCache.entries()) {
    if (data.isOnline) {
      result.push({ userId, ...data });
    }
  }
  return result;
};

/**
 * Get lastSeen for a specific user
 */
const getLastSeen = (userId) => {
  const presence = userPresenceCache.get(userId);
  return presence?.lastSeen || null;
};

/**
 * Get lastSeen map for multiple users
 */
const getLastSeenBatch = (userIds) => {
  const result = {};
  for (const id of userIds) {
    const presence = userPresenceCache.get(id);
    if (presence?.lastSeen) {
      result[id] = presence.lastSeen;
    }
  }
  return result;
};

// ─── USER DATA CACHE ────────────────────────────────

/**
 * Cache full user data (from DB query)
 */
const cacheUserData = (userId, userData) => {
  userDataCache.set(userId, {
    data: userData,
    cachedAt: Date.now(),
  });
};

/**
 * Cache multiple users at once
 */
const cacheUsersBatch = (users) => {
  const now = Date.now();
  for (const user of users) {
    const id = user._id?.toString() || user.id;
    userDataCache.set(id, {
      data: user,
      cachedAt: now,
    });
  }
};

/**
 * Get cached user data (returns null if expired or not cached)
 */
const getCachedUser = (userId) => {
  const entry = userDataCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > USER_DATA_TTL) {
    userDataCache.delete(userId);
    return null;
  }
  return entry.data;
};

/**
 * Invalidate a specific user's data cache
 */
const invalidateUser = (userId) => {
  userDataCache.delete(userId);
};

/**
 * Invalidate all user data cache
 */
const invalidateAll = () => {
  userDataCache.clear();
};

// ─── DB SYNC (Periodic background sync) ─────────────

/**
 * Sync in-memory lastSeen timestamps to MongoDB.
 * Runs periodically to persist presence data without
 * hitting DB on every heartbeat.
 */
const syncToDatabase = async () => {
  if (mongoose.connection.readyState !== 1) return;

  const User = require('../models/User');
  const entries = Array.from(userPresenceCache.entries());
  
  // Only sync entries that were updated since last sync
  const dirtyEntries = entries.filter(([_, data]) => {
    return data.updatedAt && (Date.now() - data.updatedAt < SYNC_INTERVAL + 5000);
  });

  if (dirtyEntries.length === 0) return;

  // Batch updates using bulkWrite for efficiency
  const bulkOps = dirtyEntries.slice(0, BATCH_SIZE).map(([userId, data]) => ({
    updateOne: {
      filter: { _id: userId },
      update: {
        $set: {
          lastSeen: data.lastSeen,
          isOnline: data.isOnline,
        },
      },
    },
  }));

  try {
    await User.bulkWrite(bulkOps, { ordered: false });
  } catch (err) {
    console.warn('UserCache: DB sync failed (non-fatal):', err.message);
  }
};

/**
 * Start periodic DB sync
 */
const startSync = () => {
  if (syncTimer) return;
  syncTimer = setInterval(syncToDatabase, SYNC_INTERVAL);
  console.log('📦 UserCache: Background sync started (every 60s)');
};

/**
 * Stop periodic DB sync (for graceful shutdown)
 */
const stopSync = () => {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
};

/**
 * Get cache statistics (for monitoring)
 */
const getStats = () => ({
  presenceEntries: userPresenceCache.size,
  userDataEntries: userDataCache.size,
  onlineCount: getOnlineUsers().length,
});

module.exports = {
  // Presence
  updatePresence,
  setOnline,
  setOffline,
  heartbeat,
  getPresence,
  getOnlineUsers,
  getLastSeen,
  getLastSeenBatch,
  // User data
  cacheUserData,
  cacheUsersBatch,
  getCachedUser,
  invalidateUser,
  invalidateAll,
  // Sync
  startSync,
  stopSync,
  syncToDatabase,
  getStats,
};
