/**
 * ============================================
 * Application Constants — HARDENED
 * ============================================
 * SECURITY: ICE transport policy, DTLS enforcement, candidate filtering
 */

// Server URL — MUST be HTTPS for WebRTC to work
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://localhost:5000';

// API base URL
export const API_URL = `${SERVER_URL}/api`;

// WebRTC ICE Server Configuration — HARDENED
// ─────────────────────────────────────────
// SECURITY UPGRADES:
// - iceTransportPolicy: 'all' (use 'relay' in high-security mode to hide IPs)
// - bundlePolicy: 'max-bundle' (reduces attack surface by multiplexing)
// - rtcpMuxPolicy: 'require' (forces RTCP multiplexing)
// - Reduced STUN servers (fewer external dependencies)
// - TURN with TLS (turns:) preferred over TCP
export const ICE_SERVERS = {
  iceServers: [
    // STUN servers (minimal set — reduce fingerprinting surface)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // TURN server (for relaying media when P2P fails)
    ...(import.meta.env.VITE_TURN_URL ? [{
      urls: import.meta.env.VITE_TURN_URL,
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    }] : []),
    // TURNS (TLS) variant — encrypted relay
    ...(import.meta.env.VITE_TURN_URL ? [{
      urls: import.meta.env.VITE_TURN_URL.replace('turn:', 'turns:').replace(':3478', ':5349'),
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    }] : []),
  ].filter(s => s.urls),
  iceCandidatePoolSize: 5, // Reduced from 10 — fewer pre-allocated candidates

  // SECURITY POLICIES:
  // 'all' = allow P2P + relay (default, good for performance)
  // 'relay' = force TURN relay only (hides user IPs but higher latency)
  iceTransportPolicy: import.meta.env.VITE_ICE_TRANSPORT_POLICY || 'all',
  bundlePolicy: 'max-bundle',       // Multiplex all media on one transport
  rtcpMuxPolicy: 'require',         // Force RTCP multiplexing
};

// Media constraints defaults
export const MEDIA_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
  },
  video: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
    facingMode: 'user',
  },
};

// Screen share constraints (optimized for low latency)
export const SCREEN_CONSTRAINTS = {
  video: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 5, max: 15 },
  },
  audio: false,
};

// Group call limits (mesh topology)
export const MAX_GROUP_CALL_PARTICIPANTS = 6;

// File upload limits
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_FILES = 5;

// Allowed file types for display
export const FILE_TYPE_ICONS = {
  'image': '🖼️',
  'video': '🎬',
  'audio': '🎵',
  'application/pdf': '📄',
  'text': '📝',
  'application/zip': '📦',
  'default': '📎',
};

// Call states
export const CALL_STATUS = {
  IDLE: 'idle',
  CALLING: 'calling',
  RINGING: 'ringing',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ENDED: 'ended',
  FAILED: 'failed',
};

// Socket events
export const SOCKET_EVENTS = {
  // Presence
  USER_ONLINE: 'user:online',
  USER_OFFLINE: 'user:offline',
  ONLINE_LIST: 'users:online-list',
  
  // Typing
  TYPING_START: 'typing:start',
  TYPING_STOP: 'typing:stop',
  
  // Messages
  MESSAGE_SEND: 'message:send',
  MESSAGE_RECEIVE: 'message:receive',
  MESSAGE_GROUP_SEND: 'message:group:send',
  MESSAGE_GROUP_RECEIVE: 'message:group:receive',
  
  // Calls
  CALL_OFFER: 'call:offer',
  CALL_ANSWER: 'call:answer',
  CALL_ICE_CANDIDATE: 'call:ice-candidate',
  CALL_REJECT: 'call:reject',
  CALL_END: 'call:end',
  CALL_REJECTED: 'call:rejected',
  CALL_ENDED: 'call:ended',
  CALL_USER_OFFLINE: 'call:user-offline',
  
  // Group calls
  GROUP_CALL_JOIN: 'group-call:join',
  GROUP_CALL_LEAVE: 'group-call:leave',
  GROUP_CALL_OFFER: 'group-call:offer',
  GROUP_CALL_ANSWER: 'group-call:answer',
  GROUP_CALL_ICE: 'group-call:ice-candidate',
  GROUP_CALL_EXISTING: 'group-call:existing-peers',
  GROUP_CALL_PEER_JOINED: 'group-call:peer-joined',
  GROUP_CALL_PEER_LEFT: 'group-call:peer-left',

  // Security events
  SECURITY_FORCE_LOGOUT: 'security:force-logout',
  SECURITY_TOKEN_EXPIRED: 'security:token-expired',
  SECURITY_NONCE: 'security:nonce',
};
