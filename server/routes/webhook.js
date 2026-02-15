/**
 * ============================================
 * GitHub Webhook — Auto-Deploy on Push
 * ============================================
 * 
 * GitHub sends a POST to /webhook on every push to main.
 * This endpoint:
 *   1. Verifies HMAC-SHA256 signature using WEBHOOK_SECRET
 *   2. Checks it's a push to main branch
 *   3. Runs deploy script (git pull, build, restart PM2)
 * 
 * SETUP (GitHub repo → Settings → Webhooks → Add):
 *   Payload URL: https://quickmeet.genuinesoftmart.store/webhook
 *   Content type: application/json
 *   Secret: <same as WEBHOOK_SECRET in .env>
 *   Events: Just the push event
 * 
 * VPS .env needs:
 *   WEBHOOK_SECRET=your-secret-here
 */

const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Deploy log file
const DEPLOY_LOG = path.join(__dirname, '../logs/deploy.log');

/**
 * Verify GitHub webhook signature
 */
function verifySignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  const sig = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
  } catch {
    return false;
  }
}

/**
 * Append to deploy log
 */
function logDeploy(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  
  try {
    const logDir = path.dirname(DEPLOY_LOG);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(DEPLOY_LOG, line);
  } catch (e) {
    console.error('Deploy log write failed:', e.message);
  }
  console.log(`[DEPLOY] ${message}`);
}

// Track deploy status to prevent concurrent deploys
let isDeploying = false;

/**
 * POST /webhook — GitHub push event handler
 */
router.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  
  // 1. Verify signature
  const signature = req.headers['x-hub-signature-256'];
  const rawBody = typeof req.body === 'string' ? req.body : 
                  Buffer.isBuffer(req.body) ? req.body.toString('utf8') : 
                  JSON.stringify(req.body);
  
  if (secret && !verifySignature(rawBody, signature, secret)) {
    logDeploy('❌ Webhook signature verification FAILED');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // 2. Parse body
  let payload;
  try {
    payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) 
      ? req.body 
      : JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  
  // 3. Check if it's a push to main
  const ref = payload.ref || '';
  const branch = ref.replace('refs/heads/', '');
  
  if (branch !== 'main' && branch !== 'master') {
    logDeploy(`⏭️ Skipped deploy — push to ${branch} (not main)`);
    return res.json({ status: 'skipped', branch });
  }
  
  // 4. Prevent concurrent deploys
  if (isDeploying) {
    logDeploy('⏳ Deploy already in progress, skipping');
    return res.json({ status: 'busy', message: 'Deploy already in progress' });
  }
  
  // 5. Acknowledge immediately, deploy in background
  const pusher = payload.pusher?.name || 'unknown';
  const commitMsg = payload.head_commit?.message || '';
  
  logDeploy(`🚀 Deploy triggered by ${pusher}: "${commitMsg.substring(0, 80)}"`);
  res.json({ status: 'deploying', branch, pusher });
  
  // 6. Run deploy
  isDeploying = true;
  const projectRoot = path.join(__dirname, '../..');
  
  // Deploy commands — runs inline (no separate deploy.sh needed)
  const deployCmd = `
    cd "${projectRoot}" && \
    git stash 2>/dev/null; \
    git pull origin main && \
    cd server && npm install --production 2>&1 && cd .. && \
    cd client && npm install 2>&1 && npm run build 2>&1 && cd .. && \
    echo "BUILD_SUCCESS"
  `;
  
  exec(deployCmd, { 
    maxBuffer: 10 * 1024 * 1024,
    timeout: 300000, // 5 min max
    env: { ...process.env, NODE_ENV: 'production' }
  }, (error, stdout, stderr) => {
    if (error) {
      logDeploy(`❌ Deploy FAILED: ${error.message}`);
      logDeploy(`STDERR: ${stderr?.substring(0, 500) || 'none'}`);
      isDeploying = false;
      return;
    }
    
    if (!stdout.includes('BUILD_SUCCESS')) {
      logDeploy(`⚠️ Deploy finished but BUILD_SUCCESS not found`);
      logDeploy(`STDOUT: ${stdout?.substring(stdout.length - 500) || 'none'}`);
      isDeploying = false;
      return;
    }
    
    logDeploy('✅ Build successful. Updating versions.json...');
    
    // Auto-bump versions.json
    try {
      const clientPkg = require(path.join(projectRoot, 'client/package.json'));
      const versionsPath = path.join(projectRoot, 'server/updates/versions.json');
      let versions = {};
      try { versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8')); } catch {}
      
      const now = new Date().toISOString();
      // Only auto-bump web and desktop — NOT android.
      // Android version is only bumped manually when a new APK is built,
      // because the Android app's native APK version (from build.gradle)
      // doesn't change on web deploys. Auto-bumping android would make
      // the server think the latest version matches the APK, preventing
      // the update prompt from appearing.
      ['web', 'desktop'].forEach(platform => {
        if (!versions[platform]) versions[platform] = {};
        versions[platform].version = clientPkg.version;
        versions[platform].lastUpdated = now;
        if (!versions[platform].minVersion) versions[platform].minVersion = '1.0.0';
      });
      
      fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
      logDeploy(`📦 versions.json updated to v${clientPkg.version}`);
    } catch (e) {
      logDeploy(`⚠️ versions.json update failed: ${e.message}`);
    }
    
    // Restart PM2
    exec('pm2 restart quickmeet', (pmError, pmOut) => {
      if (pmError) {
        logDeploy(`⚠️ PM2 restart failed: ${pmError.message}. Try manual restart.`);
      } else {
        logDeploy('🔄 PM2 restarted successfully');
      }
      logDeploy('🎉 Deploy complete!');
      isDeploying = false;
    });
  });
});

/**
 * GET /webhook — Status check
 */
router.get('/', (req, res) => {
  // Read last 20 lines of deploy log
  let recentLogs = [];
  try {
    const logContent = fs.readFileSync(DEPLOY_LOG, 'utf8');
    recentLogs = logContent.split('\n').filter(Boolean).slice(-20);
  } catch {}
  
  res.json({
    status: 'active',
    deploying: isDeploying,
    recentLogs,
  });
});

module.exports = router;
