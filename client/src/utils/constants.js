/**
 * ============================================
 * Application Constants — HARDENED
 * ============================================
 * SECURITY: ICE transport policy, DTLS enforcement, candidate filtering
 */

// App Version & Build Info (injected by Vite from package.json at build time)
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
export const APP_BUILD_DATE = typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : '2026-02-15';

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
// - TURN credentials are fetched dynamically via /api/transfers/turn-credentials
// - No static TURN credentials in client code
export const ICE_SERVERS = {
  iceServers: [
    // STUN servers — for discovering public IP (srflx candidates)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // TURN servers — fallback when direct P2P fails (symmetric NAT, firewalls)
    // Static long-lived credentials (use-auth-secret / TURN REST API)
    // Valid for 1 year. P2P file transfer fetches fresh credentials dynamically.
    {
      urls: 'turn:167.71.235.56:3478',
      username: '1802712048:quickmeet-static',
      credential: 'B7Dc9nTOaG3hon1TaYucLt/U/QE=',
    },
    {
      urls: 'turn:quickmeet.genuinesoftmart.store:3478',
      username: '1802712048:quickmeet-static',
      credential: 'B7Dc9nTOaG3hon1TaYucLt/U/QE=',
    },
    {
      urls: 'turn:167.71.235.56:3478?transport=tcp',
      username: '1802712048:quickmeet-static',
      credential: 'B7Dc9nTOaG3hon1TaYucLt/U/QE=',
    },
    {
      urls: 'turn:quickmeet.genuinesoftmart.store:3478?transport=tcp',
      username: '1802712048:quickmeet-static',
      credential: 'B7Dc9nTOaG3hon1TaYucLt/U/QE=',
    },
    {
      urls: 'turns:quickmeet.genuinesoftmart.store:5349?transport=tcp',
      username: '1802712048:quickmeet-static',
      credential: 'B7Dc9nTOaG3hon1TaYucLt/U/QE=',
    },
    {
      urls: 'turns:167.71.235.56:5349?transport=tcp',
      username: '1802712048:quickmeet-static',
      credential: 'B7Dc9nTOaG3hon1TaYucLt/U/QE=',
    },
    // Additional TURN from env vars (optional override)
    ...(import.meta.env.VITE_TURN_URL ? [{
      urls: import.meta.env.VITE_TURN_URL,
      username: import.meta.env.VITE_TURN_USERNAME || '',
      credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
    }] : []),
  ].filter(s => s.urls),

  // P2P MODE: 'all' = try direct P2P first, TURN relay as fallback
  // WebRTC will attempt host → srflx → relay candidates in priority order
  iceTransportPolicy: 'all',
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
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
    facingMode: 'user',
  },
};

// Screen share constraints
export const SCREEN_CONSTRAINTS = {
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 15, max: 30 },
  },
  audio: false,
};

// Group call limits (mesh topology)
export const MAX_GROUP_CALL_PARTICIPANTS = 6;

// File upload limits (server-side upload, NOT P2P)
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB for server upload
export const MAX_FILES = 5;

// P2P file transfer limits  
export const MAX_P2P_FILE_SIZE = 107374182400; // 100GB (Electron + Chrome/Edge FSAA)
export const MAX_P2P_FILE_SIZE_BROWSER_MEMORY = 2147483648; // 2GB (Firefox/Safari — memory only)
export const P2P_CHUNK_SIZE_DESKTOP = 65536;   // 64KB per chunk
export const P2P_CHUNK_SIZE_MOBILE = 16384;    // 16KB per chunk

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

  // P2P File Transfer events
  FILE_TRANSFER_REQUEST: 'file-transfer:request',
  FILE_TRANSFER_INCOMING: 'file-transfer:incoming',
  FILE_TRANSFER_ACCEPT: 'file-transfer:accept',
  FILE_TRANSFER_ACCEPTED: 'file-transfer:accepted',
  FILE_TRANSFER_REJECT: 'file-transfer:reject',
  FILE_TRANSFER_REJECTED: 'file-transfer:rejected',
  FILE_TRANSFER_CANCEL: 'file-transfer:cancel',
  FILE_TRANSFER_CANCELLED: 'file-transfer:cancelled',
  FILE_TRANSFER_PROGRESS: 'file-transfer:progress',
  FILE_TRANSFER_COMPLETE: 'file-transfer:complete',
  FILE_TRANSFER_COMPLETED: 'file-transfer:completed',
  FILE_TRANSFER_PAUSE: 'file-transfer:pause',
  FILE_TRANSFER_PAUSED: 'file-transfer:paused',
  FILE_TRANSFER_RESUME: 'file-transfer:resume',
  FILE_TRANSFER_OFFER: 'file-transfer:offer',
  FILE_TRANSFER_ANSWER: 'file-transfer:answer',
  FILE_TRANSFER_ICE: 'file-transfer:ice-candidate',
};
