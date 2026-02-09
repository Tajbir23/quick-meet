/**
 * ============================================
 * SSL Certificate Configuration
 * ============================================
 * 
 * WHY SSL IS MANDATORY:
 * 1. WebRTC requires a "secure context" (HTTPS or localhost)
 * 2. navigator.mediaDevices.getUserMedia() WILL NOT WORK on plain HTTP
 * 3. RTCPeerConnection may silently fail without HTTPS
 * 4. Even on raw IP (no domain), HTTPS with self-signed cert works
 * 
 * HOW IT WORKS:
 * - If SSL cert files exist on disk → use them
 * - If not → auto-generate using 'selfsigned' package (pure JS, no OpenSSL)
 * - Generated certs are saved to ssl/ folder for reuse
 * 
 * FOR PRODUCTION:
 * - Replace with Let's Encrypt cert if you have a domain
 * - Or use a properly signed certificate
 */

const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

/**
 * Generate self-signed SSL certificate using pure JavaScript.
 * No OpenSSL installation required.
 */
const generateCertificates = async (keyPath, certPath) => {
  console.log('🔐 Auto-generating self-signed SSL certificate (no OpenSSL needed)...');
  console.log('');

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: 'sha256',
    extensions: [
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },     // DNS
        { type: 7, ip: '127.0.0.1' },        // IP
        { type: 7, ip: '0.0.0.0' },          // IP
      ]},
    ],
  });

  // Ensure directory exists
  const sslDir = path.dirname(keyPath);
  if (!fs.existsSync(sslDir)) {
    fs.mkdirSync(sslDir, { recursive: true });
  }

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);

  console.log('✅ SSL certificate generated successfully!');
  console.log(`   Key:  ${keyPath}`);
  console.log(`   Cert: ${certPath}`);
  console.log('');
  console.log('⚠️  First time? Open https://localhost:5000 in browser');
  console.log('   Click "Advanced" → "Proceed" to trust the certificate');
  console.log('');

  return { key: pems.private, cert: pems.cert };
};

const getSSLOptions = async () => {
  const keyPath = path.resolve(__dirname, '..', process.env.SSL_KEY_PATH || '../ssl/server.key');
  const certPath = path.resolve(__dirname, '..', process.env.SSL_CERT_PATH || '../ssl/server.cert');

  // If certs exist, use them
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    console.log('🔒 Using existing SSL certificates');
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }

  // Auto-generate certs (no OpenSSL needed)
  const pems = await generateCertificates(keyPath, certPath);
  return {
    key: pems.key,
    cert: pems.cert,
  };
};

module.exports = getSSLOptions;
