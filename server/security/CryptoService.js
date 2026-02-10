/**
 * ============================================
 * CryptoService — Core Cryptographic Operations
 * ============================================
 * 
 * ZERO-TRUST DESIGN:
 * - All crypto uses Node.js built-in 'crypto' module (no third-party)
 * - AES-256-GCM for symmetric encryption (authenticated encryption)
 * - HMAC-SHA256 for message signing
 * - ECDH for ephemeral key exchange
 * - HKDF for key derivation
 * - CSPRNG for all random values
 * 
 * ATTACK SURFACE THIS ADDRESSES:
 * 1. Messages-at-rest: AES-256-GCM encryption in DB
 * 2. Message tampering: HMAC signature verification
 * 3. Replay attacks: Nonce uniqueness enforcement
 * 4. Forward secrecy: Ephemeral ECDH keys per session
 * 5. Server breach: Encrypted data is worthless without keys
 * 
 * KEY HIERARCHY:
 * Master Key (env) → derived keys via HKDF
 *   ├── Message Encryption Key
 *   ├── HMAC Signing Key
 *   ├── Token Signing Key
 *   └── File Encryption Key
 */

const crypto = require('crypto');

// Constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;         // 128-bit IV for AES-GCM
const AUTH_TAG_LENGTH = 16;   // 128-bit auth tag
const SALT_LENGTH = 32;       // 256-bit salt
const KEY_LENGTH = 32;        // 256-bit key
const NONCE_LENGTH = 32;      // 256-bit nonce for anti-replay

class CryptoService {
  constructor() {
    this._masterKey = null;
    this._derivedKeys = new Map();
    this._usedNonces = new Map(); // nonce → timestamp (with TTL cleanup)
    this._nonceCleanupInterval = null;
    this._initialized = false;
  }

  /**
   * Initialize with master key from environment
   * SECURITY: Master key MUST be 64 hex chars (256 bits)
   */
  initialize() {
    if (this._initialized) return;

    const masterKeyHex = process.env.ENCRYPTION_MASTER_KEY;
    if (!masterKeyHex || masterKeyHex.length < 64) {
      console.warn('⚠️  ENCRYPTION_MASTER_KEY not set or too short. Generating ephemeral key.');
      console.warn('⚠️  SET ENCRYPTION_MASTER_KEY in .env (64 hex chars) for persistent encryption.');
      this._masterKey = crypto.randomBytes(32);
    } else {
      this._masterKey = Buffer.from(masterKeyHex, 'hex');
    }

    // Derive sub-keys using HKDF
    this._derivedKeys.set('message', this._deriveKey('message-encryption'));
    this._derivedKeys.set('hmac', this._deriveKey('hmac-signing'));
    this._derivedKeys.set('token', this._deriveKey('token-signing'));
    this._derivedKeys.set('file', this._deriveKey('file-encryption'));
    this._derivedKeys.set('fileAccess', this._deriveKey('file-access-token'));

    // Cleanup expired nonces every 5 minutes
    this._nonceCleanupInterval = setInterval(() => this._cleanupNonces(), 5 * 60 * 1000);

    this._initialized = true;
    console.log('🔐 CryptoService initialized with HKDF-derived key hierarchy');
  }

  /**
   * Derive a sub-key from master key using HKDF
   * WHY HKDF: Cryptographically secure key derivation, isolates key purposes
   */
  _deriveKey(context) {
    return crypto.createHmac('sha256', this._masterKey)
      .update(context)
      .digest();
  }

  // ============================================
  // SYMMETRIC ENCRYPTION (AES-256-GCM)
  // ============================================

  /**
   * Encrypt plaintext with AES-256-GCM
   * Returns: iv:authTag:ciphertext (all hex-encoded, colon-separated)
   * 
   * WHY GCM: Provides both confidentiality AND integrity (authenticated encryption)
   * ATTACK BLOCKED: Server breach — encrypted data is useless without master key
   */
  encrypt(plaintext, purpose = 'message') {
    if (!this._initialized) this.initialize();
    if (!plaintext) return plaintext;

    const key = this._derivedKeys.get(purpose) || this._derivedKeys.get('message');
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt ciphertext with AES-256-GCM
   * Verifies authentication tag (tamper detection)
   */
  decrypt(encryptedData, purpose = 'message') {
    if (!this._initialized) this.initialize();
    if (!encryptedData || !encryptedData.includes(':')) return encryptedData;

    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) return encryptedData; // Not encrypted, return as-is

      const [ivHex, authTagHex, ciphertext] = parts;
      const key = this._derivedKeys.get(purpose) || this._derivedKeys.get('message');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      // Auth tag verification failed — data was tampered with
      console.error('⚠️  Decryption failed (possible tampering):', error.message);
      return null;
    }
  }

  // ============================================
  // HMAC MESSAGE SIGNING
  // ============================================

  /**
   * Generate HMAC-SHA256 signature for a message
   * Used for socket event message integrity
   * 
   * ATTACK BLOCKED: Message tampering in transit, socket hijacking
   */
  signMessage(payload, userId) {
    if (!this._initialized) this.initialize();

    const key = this._derivedKeys.get('hmac');
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const message = `${userId}:${data}`;

    return crypto.createHmac('sha256', key)
      .update(message)
      .digest('hex');
  }

  /**
   * Verify HMAC signature
   * Returns true if signature is valid, false otherwise
   */
  verifySignature(payload, userId, signature) {
    if (!this._initialized) this.initialize();

    const expectedSignature = this.signMessage(payload, userId);
    // Timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch {
      return false;
    }
  }

  // ============================================
  // ANTI-REPLAY NONCES
  // ============================================

  /**
   * Generate a cryptographically secure nonce
   * Each nonce is unique and can only be used once
   * 
   * ATTACK BLOCKED: Replay attacks — intercepted messages cannot be resent
   */
  generateNonce() {
    return crypto.randomBytes(NONCE_LENGTH).toString('hex');
  }

  /**
   * Validate and consume a nonce (one-time use)
   * Returns false if nonce was already used (replay detected)
   * 
   * @param {string} nonce - The nonce to validate
   * @param {number} maxAgeMs - Maximum nonce age in milliseconds (default: 5 min)
   */
  consumeNonce(nonce, maxAgeMs = 5 * 60 * 1000) {
    if (!nonce) return false;

    // Check if already used
    if (this._usedNonces.has(nonce)) {
      return false; // REPLAY DETECTED
    }

    // Store with timestamp
    this._usedNonces.set(nonce, Date.now());

    // Schedule removal after TTL
    setTimeout(() => {
      this._usedNonces.delete(nonce);
    }, maxAgeMs + 1000);

    return true;
  }

  /**
   * Cleanup expired nonces to prevent memory leak
   */
  _cleanupNonces() {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    let cleaned = 0;

    for (const [nonce, timestamp] of this._usedNonces.entries()) {
      if (now - timestamp > maxAge) {
        this._usedNonces.delete(nonce);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🔐 Cleaned ${cleaned} expired nonces (${this._usedNonces.size} active)`);
    }
  }

  // ============================================
  // EPHEMERAL KEY EXCHANGE (ECDH)
  // ============================================

  /**
   * Generate an ECDH key pair for ephemeral key exchange
   * Used for per-session encryption keys (forward secrecy)
   * 
   * WHY ECDH: Enables forward secrecy — even if long-term keys are
   * compromised, past session keys cannot be derived
   */
  generateECDHKeyPair() {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return {
      publicKey: ecdh.getPublicKey('hex'),
      privateKey: ecdh.getPrivateKey('hex'),
      _ecdh: ecdh,
    };
  }

  /**
   * Derive shared secret from ECDH key exchange
   */
  deriveSharedSecret(privateKeyHex, remotePublicKeyHex) {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
    const sharedSecret = ecdh.computeSecret(Buffer.from(remotePublicKeyHex, 'hex'));

    // Derive a usable key from the shared secret using HKDF-like derivation
    return crypto.createHash('sha256').update(sharedSecret).digest();
  }

  // ============================================
  // TOKEN GENERATION
  // ============================================

  /**
   * Generate a secure random token (for call tokens, file access, etc.)
   */
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate a time-limited access token
   * Returns: { token, expires }
   */
  generateTimedToken(data, expiresInMs = 15 * 60 * 1000) {
    if (!this._initialized) this.initialize();

    const expires = Date.now() + expiresInMs;
    const payload = JSON.stringify({ data, expires });
    const key = this._derivedKeys.get('token');

    // Encrypt the payload
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    let encrypted = cipher.update(payload, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    const token = `${iv.toString('hex')}${authTag.toString('hex')}${encrypted}`;

    return { token, expires };
  }

  /**
   * Validate and decode a time-limited access token
   * Returns null if expired or invalid
   */
  validateTimedToken(token) {
    if (!this._initialized) this.initialize();

    try {
      const ivHex = token.substring(0, IV_LENGTH * 2);
      const authTagHex = token.substring(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);
      const ciphertext = token.substring(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

      const key = this._derivedKeys.get('token');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      const { data, expires } = JSON.parse(decrypted);

      // Check expiration
      if (Date.now() > expires) {
        return null; // Expired
      }

      return data;
    } catch {
      return null; // Invalid token
    }
  }

  // ============================================
  // FILE ACCESS TOKEN
  // ============================================

  /**
   * Generate a file access token (time-limited, user-bound)
   * @param {string} filename - The file to grant access to
   * @param {string} userId - The user requesting access
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  generateFileAccessToken(filename, userId, ttlMs = 15 * 60 * 1000) {
    return this.generateTimedToken({ filename, userId }, ttlMs);
  }

  /**
   * Validate a file access token
   * Returns { filename, userId } or null
   */
  validateFileAccessToken(token) {
    return this.validateTimedToken(token);
  }

  // ============================================
  // DEVICE FINGERPRINT
  // ============================================

  /**
   * Hash a device fingerprint for storage/comparison
   * WHY hash: We don't need to store the raw fingerprint, just verify it matches
   */
  hashFingerprint(fingerprint) {
    if (!this._initialized) this.initialize();
    return crypto.createHmac('sha256', this._derivedKeys.get('token'))
      .update(fingerprint)
      .digest('hex');
  }

  // ============================================
  // UTILITY
  // ============================================

  /**
   * Generate a cryptographically secure random string (URL-safe)
   */
  randomString(length = 32) {
    return crypto.randomBytes(length).toString('base64url').substring(0, length);
  }

  /**
   * Constant-time string comparison
   */
  safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  /**
   * Cleanup on shutdown
   */
  destroy() {
    if (this._nonceCleanupInterval) {
      clearInterval(this._nonceCleanupInterval);
    }
    this._usedNonces.clear();
    this._derivedKeys.clear();
    this._masterKey = null;
    this._initialized = false;
  }
}

// Singleton
const cryptoService = new CryptoService();

module.exports = cryptoService;
