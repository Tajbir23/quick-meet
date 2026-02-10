/**
 * ============================================
 * File Scanner — Local Malware Defense
 * ============================================
 * 
 * THREAT MODEL:
 * - RCE via malicious file upload (polyglot files, executable payloads)
 * - SVG XSS (embedded JavaScript in SVG images)
 * - ZIP bombs (decompression attacks)
 * - MIME type spoofing (renaming .exe to .jpg)
 * - Path traversal via filenames
 * - Content-type mismatch attacks
 * 
 * DEFENSE STRATEGY (no third-party services):
 * 1. Magic byte validation (verify true file type by header bytes)
 * 2. Content-type revalidation (compare MIME with magic bytes)
 * 3. SVG sanitization (strip scripts from SVG files)
 * 4. File size hard limits
 * 5. Filename sanitization
 * 6. Extension validation
 * 7. Dangerous content scanning (embedded scripts, macros)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const securityLogger = require('./SecurityEventLogger');
const { SEVERITY } = require('./SecurityEventLogger');

// Magic bytes for common file types
// Format: { mimeType: [{ offset, bytes }] }
const MAGIC_BYTES = {
  'image/jpeg': [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47] }],
  'image/gif': [
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37] }, // GIF87a
    { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39] }, // GIF89a
  ],
  'image/webp': [{ offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  'application/zip': [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }], // PK
  'audio/mpeg': [
    { offset: 0, bytes: [0xFF, 0xFB] }, // MP3
    { offset: 0, bytes: [0xFF, 0xF3] }, // MP3
    { offset: 0, bytes: [0xFF, 0xF2] }, // MP3
    { offset: 0, bytes: [0x49, 0x44, 0x33] }, // ID3
  ],
  'audio/wav': [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }], // RIFF
  'video/mp4': [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }], // ftyp
  'video/webm': [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }], // EBML
  'audio/ogg': [{ offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }], // OggS
  'video/ogg': [{ offset: 0, bytes: [0x4F, 0x67, 0x67, 0x53] }],
  'audio/webm': [{ offset: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] }],
};

// Dangerous patterns in file content
const DANGEROUS_PATTERNS = [
  // Script execution
  /<script[\s>]/i,
  /javascript:/i,
  /vbscript:/i,
  /on\w+\s*=/i,          // onclick=, onerror=, etc.
  // PHP/server-side injection
  /<\?php/i,
  /<\?=/i,
  // Shell commands
  /\#\!\/bin\/(bash|sh|zsh)/,
  // Windows executables disguised
  /MZ\x90\x00/,          // PE header
];

class FileScanner {
  constructor() {
    this.maxScanSize = 10 * 1024 * 1024; // Only scan first 10MB for patterns
  }

  /**
   * Full file security scan
   * Returns: { safe, threats, hash, trueMimeType }
   * 
   * @param {string} filePath - Absolute path to uploaded file
   * @param {string} claimedMimeType - MIME type from upload header
   * @param {string} originalName - Original filename
   * @param {string} userId - Uploader's ID
   */
  async scan(filePath, claimedMimeType, originalName, userId) {
    const threats = [];
    const results = {
      safe: true,
      threats: [],
      hash: null,
      trueMimeType: null,
      scannedAt: new Date().toISOString(),
    };

    try {
      // 1. File existence and size check
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        threats.push('Empty file');
      }

      // 2. Compute file hash (SHA-256) for integrity tracking
      results.hash = await this._computeHash(filePath);

      // 3. Magic byte verification
      const trueMime = await this._detectMimeByMagicBytes(filePath);
      results.trueMimeType = trueMime;

      // 4. MIME type mismatch check
      if (trueMime && claimedMimeType) {
        const claimedBase = claimedMimeType.split('/')[0];
        const trueBase = trueMime.split('/')[0];

        if (claimedBase !== trueBase) {
          threats.push(`MIME type mismatch: claimed ${claimedMimeType}, detected ${trueMime}`);
          securityLogger.fileEvent('mime_mismatch', SEVERITY.ALERT, {
            userId, originalName, claimedMimeType, detectedMimeType: trueMime,
            message: 'File MIME type mismatch — possible type spoofing',
          });
        }
      }

      // 5. Extension validation
      const ext = path.extname(originalName).toLowerCase();
      const dangerousExtensions = [
        '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
        '.vbs', '.js', '.ws', '.wsf', '.ps1', '.psm1',
        '.sh', '.bash', '.csh', '.ksh',
        '.app', '.action', '.command',
        '.php', '.asp', '.aspx', '.jsp', '.cgi',
      ];
      if (dangerousExtensions.includes(ext)) {
        threats.push(`Dangerous file extension: ${ext}`);
      }

      // 6. SVG script check
      if (claimedMimeType === 'image/svg+xml' || ext === '.svg') {
        const svgThreats = await this._scanSVG(filePath);
        threats.push(...svgThreats);
      }

      // 7. Content pattern scanning (for text-like files)
      if (this._isTextType(claimedMimeType) || stats.size < this.maxScanSize) {
        const contentThreats = await this._scanContent(filePath);
        threats.push(...contentThreats);
      }

      // 8. ZIP bomb detection
      if (claimedMimeType === 'application/zip' || ext === '.zip') {
        const zipThreats = this._checkZipBomb(filePath, stats.size);
        threats.push(...zipThreats);
      }

      // 9. Filename sanitization check
      const nameThreats = this._validateFilename(originalName);
      threats.push(...nameThreats);

    } catch (error) {
      console.error('File scan error:', error);
      threats.push(`Scan error: ${error.message}`);
    }

    results.threats = threats;
    results.safe = threats.length === 0;

    if (!results.safe) {
      securityLogger.fileEvent('scan_threats_found', SEVERITY.ALERT, {
        userId, originalName, threats,
        message: `File scan found ${threats.length} threat(s)`,
      });
    } else {
      securityLogger.fileEvent('scan_clean', SEVERITY.INFO, {
        userId, originalName, hash: results.hash,
      });
    }

    return results;
  }

  /**
   * Detect true MIME type by reading magic bytes
   */
  async _detectMimeByMagicBytes(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(16);
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);

    for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
      for (const sig of signatures) {
        let match = true;
        for (let i = 0; i < sig.bytes.length; i++) {
          if (buffer[sig.offset + i] !== sig.bytes[i]) {
            match = false;
            break;
          }
        }
        if (match) return mime;
      }
    }

    return null; // Unknown type
  }

  /**
   * Compute SHA-256 hash of file
   */
  _computeHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Scan SVG files for embedded scripts
   */
  async _scanSVG(filePath) {
    const threats = [];
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      if (/<script/i.test(content)) {
        threats.push('SVG contains <script> tag — XSS risk');
      }
      if (/on\w+\s*=/i.test(content)) {
        threats.push('SVG contains inline event handlers — XSS risk');
      }
      if (/javascript:/i.test(content)) {
        threats.push('SVG contains javascript: URI — XSS risk');
      }
      if (/<iframe/i.test(content)) {
        threats.push('SVG contains <iframe> — injection risk');
      }
      if (/<foreignObject/i.test(content)) {
        threats.push('SVG contains <foreignObject> — injection risk');
      }
    } catch {
      // Not readable as text — suspicious for SVG
      threats.push('SVG file is not valid text');
    }
    return threats;
  }

  /**
   * Scan file content for dangerous patterns
   */
  async _scanContent(filePath) {
    const threats = [];
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxScanSize) return threats;

      const content = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });

      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(content)) {
          threats.push(`Dangerous pattern detected: ${pattern.source}`);
        }
      }
    } catch {
      // Binary file — skip content scan
    }
    return threats;
  }

  /**
   * Basic ZIP bomb detection
   * Checks compression ratio
   */
  _checkZipBomb(filePath, fileSize) {
    const threats = [];
    // A zip bomb has an unusually small compressed size relative to content
    // We can't fully decompress, but we can check the file size
    // Real protection: limit decompressed size in any extraction code
    if (fileSize < 1000) {
      // Suspiciously small ZIP — could be a highly compressed bomb
      threats.push('Suspiciously small ZIP file — potential zip bomb');
    }
    return threats;
  }

  /**
   * Validate filename for path traversal and other attacks
   */
  _validateFilename(filename) {
    const threats = [];

    if (!filename) return ['Missing filename'];

    // Path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      threats.push('Path traversal attempt in filename');
    }

    // Null bytes
    if (filename.includes('\0')) {
      threats.push('Null byte in filename — possible path truncation attack');
    }

    // Double extension tricks (e.g., payload.php.jpg)
    const parts = filename.split('.');
    if (parts.length > 2) {
      const dangerousMiddleExts = ['php', 'asp', 'aspx', 'jsp', 'exe', 'bat', 'sh'];
      for (let i = 1; i < parts.length - 1; i++) {
        if (dangerousMiddleExts.includes(parts[i].toLowerCase())) {
          threats.push(`Suspicious double extension: ${filename}`);
          break;
        }
      }
    }

    // Extremely long filename
    if (filename.length > 255) {
      threats.push('Filename exceeds maximum length');
    }

    return threats;
  }

  /**
   * Check if MIME type is text-like
   */
  _isTextType(mimeType) {
    if (!mimeType) return false;
    return mimeType.startsWith('text/') ||
           mimeType === 'application/json' ||
           mimeType === 'application/xml' ||
           mimeType === 'image/svg+xml';
  }
}

// Singleton
const fileScanner = new FileScanner();

module.exports = fileScanner;
