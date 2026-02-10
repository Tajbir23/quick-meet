/**
 * ============================================
 * Security Module — Index / Initializer
 * ============================================
 * 
 * Aggregates all security modules and provides a single
 * initialization point for the server startup.
 */

const cryptoService = require('./CryptoService');
const securityLogger = require('./SecurityEventLogger');
const intrusionDetector = require('./IntrusionDetector');
const socketGuard = require('./SocketGuard');
const callTokenService = require('./CallTokenService');
const sdpSanitizer = require('./SDPSanitizer');
const fileScanner = require('./FileScanner');

/**
 * Initialize all security modules
 * Called once during server startup
 */
function initializeSecurity() {
  console.log('');
  console.log('🔐 ═══════════════════════════════════════');
  console.log('🔐  Initializing Zero-Trust Security Layer');
  console.log('🔐 ═══════════════════════════════════════');

  // 1. Initialize crypto (master key, derived keys)
  cryptoService.initialize();

  // 2. Initialize security event logger
  securityLogger.initialize();

  // 3. Wire up intrusion detector to security logger
  // Critical events trigger automated responses
  securityLogger.onEvent('CRITICAL', (entry) => {
    console.error(`🚨 CRITICAL SECURITY EVENT: ${entry.category}:${entry.event}`);
    // Could add automated response here (email, webhook, etc.)
  });

  securityLogger.onEvent('ALERT', (entry) => {
    console.warn(`⚠️  SECURITY ALERT: ${entry.category}:${entry.event}`);
  });

  console.log('🔐  ✅ CryptoService: AES-256-GCM + HMAC-SHA256 + ECDH');
  console.log('🔐  ✅ SecurityEventLogger: Tamper-proof chain-hashed logs');
  console.log('🔐  ✅ IntrusionDetector: Brute-force + rate limiting + auto-ban');
  console.log('🔐  ✅ SocketGuard: Per-event auth + HMAC + anti-replay');
  console.log('🔐  ✅ CallTokenService: One-time call tokens + mutual verification');
  console.log('🔐  ✅ SDPSanitizer: SDP validation + ICE sanitization');
  console.log('🔐  ✅ FileScanner: Magic-byte + content scanning');
  console.log('🔐 ═══════════════════════════════════════');
  console.log('');
}

/**
 * Graceful shutdown of all security modules
 */
function shutdownSecurity() {
  securityLogger.destroy();
  cryptoService.destroy();
  intrusionDetector.destroy();
  callTokenService.destroy();
}

module.exports = {
  initializeSecurity,
  shutdownSecurity,
  cryptoService,
  securityLogger,
  intrusionDetector,
  socketGuard,
  callTokenService,
  sdpSanitizer,
  fileScanner,
};
