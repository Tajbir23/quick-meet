#!/bin/bash
# ============================================
# Quick Meet — Auto-Deploy Script (VPS)
# ============================================
# 
# What this does:
# 1. Pull latest code from GitHub
# 2. Install server dependencies
# 3. Install client dependencies + build
# 4. Auto-bump version in versions.json
# 5. Restart PM2 server
# 6. Copy APK to builds folder (if GitHub Actions built it)
#
# Usage: ./deploy.sh [--bump-version 1.0.2] [--release-notes "Bug fixes"]
#
# Triggered by:
# - GitHub webhook on push (auto)
# - Manual: ssh root@167.71.235.56 "cd /var/www/quick-meet && ./deploy.sh"

set -e

PROJECT_DIR="/var/www/quick-meet"
cd "$PROJECT_DIR"

echo "============================================"
echo "  🚀 Quick Meet — Auto Deploy"
echo "  $(date)"
echo "============================================"

# ─── 1. Pull latest code ─────────────────────
echo ""
echo "📥 Pulling latest code..."
git stash 2>/dev/null || true
git pull origin main

# ─── 2. Ensure directories exist ─────────────
mkdir -p server/logs/security
mkdir -p server/updates/builds

# ─── 3. Server dependencies ──────────────────
echo ""
echo "📦 Installing server dependencies..."
cd server && npm install --production
cd ..

# ─── 4. Client dependencies + build ──────────
echo ""
echo "📦 Installing client dependencies..."
cd client && npm install

echo ""
echo "🔨 Building client..."
npm run build
cd ..

# ─── 5. Auto-bump version ────────────────────
# Read version from client/package.json (source of truth)
CLIENT_VERSION=$(node -p "require('./client/package.json').version")
echo ""
echo "📌 Client version: $CLIENT_VERSION"

# Update versions.json with new version + timestamp
node -e "
const fs = require('fs');
const path = './server/updates/versions.json';
let versions = {};
try { versions = JSON.parse(fs.readFileSync(path, 'utf8')); } catch(e) {}

const now = new Date().toISOString();
const version = '$CLIENT_VERSION';

// Update all platforms
['web', 'android', 'desktop'].forEach(p => {
  if (!versions[p]) versions[p] = {};
  versions[p].version = version;
  versions[p].lastUpdated = now;
  if (!versions[p].minVersion) versions[p].minVersion = '1.0.0';
  if (!versions[p].releaseNotes) versions[p].releaseNotes = 'Latest update';
});

fs.writeFileSync(path, JSON.stringify(versions, null, 2));
console.log('✅ versions.json updated — version: ' + version + ', time: ' + now);
"

# ─── 6. Download latest APK from GitHub Releases (if available) ──
echo ""
echo "📱 Checking for latest APK from GitHub Releases..."
LATEST_APK_URL=$(curl -s https://api.github.com/repos/Tajbir23/quick-meet/releases/latest | node -e "
const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString());
    const apk = (data.assets || []).find(a => a.name.endsWith('.apk'));
    if (apk) console.log(apk.browser_download_url);
    else console.log('');
  } catch(e) { console.log(''); }
});
" 2>/dev/null || echo "")

if [ -n "$LATEST_APK_URL" ]; then
  echo "  ⬇️  Downloading APK: $LATEST_APK_URL"
  curl -L -o server/updates/builds/quick-meet.apk "$LATEST_APK_URL" 2>/dev/null && \
    echo "  ✅ APK downloaded to server/updates/builds/quick-meet.apk" || \
    echo "  ⚠️  APK download failed (continuing anyway)"
else
  echo "  ℹ️  No APK found in latest release (GitHub Actions may not have built yet)"
fi

# ─── 7. Restart PM2 ──────────────────────────
echo ""
echo "♻️  Restarting PM2..."
pm2 restart quickmeet

# ─── 8. Done ─────────────────────────────────
echo ""
echo "============================================"
echo "  ✅ Deploy Complete!"
echo "  Version: $CLIENT_VERSION"
echo "  Time: $(date)"
echo "============================================"

# Show server status
sleep 2
pm2 status quick-meet
