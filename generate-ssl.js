/**
 * ============================================
 * Self-Signed SSL Certificate Generator
 * ============================================
 * 
 * WHY THIS EXISTS:
 * WebRTC REQUIRES HTTPS. Without it:
 * - navigator.mediaDevices.getUserMedia() → BLOCKED
 * - RTCPeerConnection → may silently fail
 * - Screen sharing → BLOCKED
 * 
 * Uses the 'selfsigned' npm package — pure JavaScript,
 * NO OpenSSL installation required.
 * 
 * USAGE:
 *   node generate-ssl.js
 * 
 * OUTPUT:
 *   ssl/server.key  — Private key
 *   ssl/server.cert — Self-signed certificate
 * 
 * NOTE: The server also auto-generates certs on startup if they don't exist.
 *       This script is for manual (re)generation only.
 */

const fs = require('fs');
const path = require('path');

// Install selfsigned if not present in root (it's in server/node_modules)
let selfsigned;
try {
  selfsigned = require('./server/node_modules/selfsigned');
} catch {
  try {
    selfsigned = require('selfsigned');
  } catch {
    console.error('❌ selfsigned package not found.');
    console.error('   Run: cd server && npm install selfsigned');
    process.exit(1);
  }
}

const SSL_DIR = path.join(__dirname, 'ssl');
const KEY_PATH = path.join(SSL_DIR, 'server.key');
const CERT_PATH = path.join(SSL_DIR, 'server.cert');

// Create ssl directory if it doesn't exist
if (!fs.existsSync(SSL_DIR)) {
  fs.mkdirSync(SSL_DIR, { recursive: true });
}

// Check if certificates already exist
if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
  console.log('⚠️  SSL certificates already exist at:');
  console.log(`   Key:  ${KEY_PATH}`);
  console.log(`   Cert: ${CERT_PATH}`);
  console.log('');
  console.log('To regenerate, delete the ssl/ directory and run again.');
  process.exit(0);
}

console.log('🔐 Generating self-signed SSL certificate (pure JS, no OpenSSL needed)...');
console.log('');

(async () => {
  try {
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = await selfsigned.generate(attrs, {
      keySize: 2048,
      days: 365,
      algorithm: 'sha256',
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '0.0.0.0' },
          ],
        },
      ],
    });

    fs.writeFileSync(KEY_PATH, pems.private);
    fs.writeFileSync(CERT_PATH, pems.cert);

    console.log('✅ SSL certificate generated successfully!');
    console.log('');
    console.log(`   Key:  ${KEY_PATH}`);
    console.log(`   Cert: ${CERT_PATH}`);
    console.log('');
    console.log('📋 Next steps:');
    console.log('   1. Start the server: npm run dev');
    console.log('   2. Open https://localhost:5000 in browser');
    console.log('   3. Accept the security warning (self-signed cert)');
    console.log('   4. The certificate is now trusted for that session');
    console.log('');
  } catch (error) {
    console.error('❌ Failed to generate SSL certificate.');
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
