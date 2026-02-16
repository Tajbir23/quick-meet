# 🚀 Quick Meet — VPS Full Setup Guide
> **Domain:** quickmeet.genuinesoftmart.store  
> **VPS IP:** 167.71.235.56  
> **VPS Provider:** DigitalOcean (Ubuntu)  
> **VPS Path:** /var/www/quick-meet/  
> **GitHub:** https://github.com/Tajbir23/quick-meet.git  
> **App Version:** 1.0.37+  
> **Last Updated:** February 16, 2026

---

## 🏗️ Project Architecture Overview

```
Quick Meet — Self-hosted Real-time Communication Ecosystem
├── Server  (Express 4.21 + MongoDB Atlas + Socket.io 4.8 + HTTPS)
├── Client  (React 18.3 + Vite 5.4 + Zustand 5.0 + Tailwind CSS 3.4)
├── Desktop (Electron 28 — Windows/Linux/Mac native app)
├── Mobile  (Capacitor 5.6 — Android native app with background service)
└── CI/CD   (GitHub Actions → Build → Release → Auto-Deploy to VPS)
```

### Core Features
- **Real-time Chat** — 1-to-1 and group messaging with AES-256-GCM encryption
- **Audio/Video Calls** — WebRTC P2P with STUN/TURN support
- **Group Calls** — Multi-participant audio/video conferencing
- **P2P File Transfer** — Direct WebRTC DataChannel large file transfers (50GB+)
- **Desktop App** — Electron with system tray, native notifications, frameless window, auto-updater
- **Mobile App** — Capacitor Android with foreground service, notification actions, boot auto-start, battery optimization bypass
- **Security** — Military-grade encryption, intrusion detection, rate limiting, brute-force protection
- **Owner Dashboard** — Admin panel for user/system management
- **CI/CD Pipeline** — GitHub Actions: auto-bump version → build APK + Windows EXE → GitHub Release → SSH deploy to VPS
- **Webhook Deploy** — GitHub webhook → HMAC-SHA256 verified → auto git pull + build + PM2 restart

---

## 📋 সম্পূর্ণ Setup Checklist

| # | কাজ | Command/Details | কখন করতে হয় |
|---|------|----------------|-------------|
| 1 | SSH দিয়ে VPS তে ঢোকা | `ssh root@167.71.235.56` | প্রতিবার |
| 2 | Node.js install | নিচে দেখো | একবারই |
| 3 | PM2 install | `npm i -g pm2` | একবারই |
| 4 | Nginx install + config | নিচে দেখো | একবারই |
| 5 | Let's Encrypt SSL | নিচে দেখো | একবারই (auto-renew) |
| 6 | Git clone project | নিচে দেখো | একবারই |
| 7 | Server `.env` তৈরি | নিচে দেখো | একবারই |
| 8 | Client `.env` তৈরি | নিচে দেখো | একবারই |
| 9 | npm install (server + client) | নিচে দেখো | প্রথমবার + dependency change এ |
| 10 | Client build | `npm run build` | প্রতিটা deploy এ |
| 11 | PM2 দিয়ে server চালু | নিচে দেখো | একবারই |
| 12 | coturn (TURN server) install | নিচে দেখো | একবারই |
| 13 | Firewall (UFW) setup | নিচে দেখো | একবারই |
| 14 | GitHub Actions CI/CD setup | নিচে দেখো | একবারই |
| 15 | Webhook auto-deploy setup | নিচে দেখো | একবারই |
| 16 | Desktop app build (optional) | নিচে দেখো | release এর সময় |
| 17 | Android APK build (optional) | নিচে দেখো | release এর সময় |

---

## 📌 Step 1: VPS তে SSH

```bash
ssh root@167.71.235.56
```
Password দিয়ে ঢোকো।

---

## 📌 Step 2: Node.js Install (v20 LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs
```

Verify:
```bash
node -v    # v20.x.x
npm -v     # 10.x.x
```

---

## 📌 Step 3: PM2 Install (Process Manager)

```bash
npm install -g pm2
```

PM2 auto-start on reboot:
```bash
pm2 startup
```
(যে command দেখায় সেটা copy-paste করো)

---

## 📌 Step 4: Nginx Install & Configure

### Install:
```bash
apt-get install -y nginx
```

### Config file তৈরি:
```bash
nano /etc/nginx/sites-available/quickmeet
```

### Config paste করো:
```nginx
server {
    listen 80;
    server_name quickmeet.genuinesoftmart.store;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name quickmeet.genuinesoftmart.store;

    # SSL (Let's Encrypt — Step 5 এ install হবে)
    ssl_certificate /etc/letsencrypt/live/quickmeet.genuinesoftmart.store/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/quickmeet.genuinesoftmart.store/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Frontend (React build)
    location / {
        root /var/www/quick-meet/client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass https://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Socket.io
    location /socket.io/ {
        proxy_pass https://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Webhook (GitHub auto-deploy)
    location /webhook {
        proxy_pass https://127.0.0.1:5000/webhook;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
    }

    # ⛔ File uploads — DISABLED (security hardening)
    # Files এখন authenticated endpoint দিয়ে serve হয়: /api/files/download/:filename
    # Direct static access বন্ধ — unauthorized access প্রতিরোধ
    # location /uploads/ { ... }  ← মুছে দেওয়া হয়েছে

    # Security headers (HARDENED)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(), payment=()" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Max upload size
    client_max_body_size 50M;
}
```

Save: `Ctrl+X` → `Y` → `Enter`

### Enable site:
```bash
ln -sf /etc/nginx/sites-available/quickmeet /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
```

---

## 📌 Step 5: Let's Encrypt SSL (Free HTTPS)

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d quickmeet.genuinesoftmart.store
```

Email দিলে auto-renew setup হয়ে যাবে। Test:
```bash
certbot renew --dry-run
```

> ⚠️ **নোট:** SSL নেওয়ার আগে DNS A record সঠিক থাকতে হবে:
> - Type: A
> - Host: quickmeet
> - Value: 167.71.235.56
> - Namecheap → Advanced DNS → এখানে set করো

---

## 📌 Step 6: Project Clone

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/Tajbir23/quick-meet.git
cd quick-meet
```

---

## 📌 Step 7: Server `.env` তৈরি

```bash
nano /var/www/quick-meet/server/.env
```

### ⚡ প্রথমে Secret keys generate করো (VPS terminal এ run করো):
```bash
# JWT_SECRET (128 char hex string)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# ENCRYPTION_MASTER_KEY (64 hex chars = 256-bit key)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# LOG_HMAC_SECRET (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# WEBHOOK_SECRET (random strong secret)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
> ⚠️ **চারটা command এর output আলাদা আলাদা কোথাও save করো — নিচে paste করতে হবে!**

### Paste করো:
```env
PORT=5000
NODE_ENV=production

# ─── DATABASE ────────────────────────────────
MONGODB_URI=mongodb+srv://test:test@cluster0.sdyx3bs.mongodb.net/quickmeet?appName=Cluster0

# ─── JWT / AUTH (HARDENED) ───────────────────
# Access token: short-lived (15 minutes)
# Refresh token: long-lived (7 days), auto-rotated on each use
JWT_SECRET=উপরে_generate_করা_128_CHAR_HEX_STRING
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY_DAYS=7

# ─── SSL ─────────────────────────────────────
SSL_KEY_PATH=../ssl/server.key
SSL_CERT_PATH=../ssl/server.cert

# ─── FILE STORAGE ────────────────────────────
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads
FILE_MAX_AGE_DAYS=30

# ─── ENCRYPTION (MILITARY-GRADE) ─────────────
# ⭐ এটা হারালে সব encrypted messages আর পড়া যাবে না!
# অবশ্যই safely backup রাখো!
ENCRYPTION_MASTER_KEY=উপরে_generate_করা_64_HEX_CHARS

# HMAC key for security log integrity verification
LOG_HMAC_SECRET=উপরে_generate_করা_64_HEX_CHARS

# ─── CORS / ORIGINS ──────────────────────────
# শুধুমাত্র তোমার domain allow — বাকি সব block
ALLOWED_ORIGINS=https://quickmeet.genuinesoftmart.store

# ─── STUN / TURN ─────────────────────────────
STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302

# ─── RATE LIMITING ───────────────────────────
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

# ─── WEBHOOK (GitHub Auto-Deploy) ────────────
# GitHub Webhook Settings → Secret ফিল্ডে এই exact value দিতে হবে
WEBHOOK_SECRET=উপরে_generate_করা_WEBHOOK_SECRET

# ─── SERVER ──────────────────────────────────
SERVER_IP=0.0.0.0
```

Save: `Ctrl+X` → `Y` → `Enter`

### Security logs directory তৈরি করো:
```bash
mkdir -p /var/www/quick-meet/server/logs/security
chmod 750 /var/www/quick-meet/server/logs/security
```

### প্রতিটা value এর ব্যাখ্যা:

| Variable | Value | কেন |
|---|---|---|
| `PORT` | `5000` | Backend server port |
| `NODE_ENV` | `production` | ⚠️ VPS তে অবশ্যই production |
| `MONGODB_URI` | Atlas connection string | MongoDB Atlas database URL |
| `JWT_SECRET` | 128 char hex string | JWT token sign করার key (generate করো!) |
| `ACCESS_TOKEN_EXPIRY` | `15m` | 🔒 Access token মাত্র ১৫ মিনিট valid |
| `REFRESH_TOKEN_EXPIRY_DAYS` | `7` | 🔒 Refresh token ৭ দিন, auto-rotated |
| `SSL_KEY_PATH` | `../ssl/server.key` | Self-signed SSL key (auto-generated) |
| `SSL_CERT_PATH` | `../ssl/server.cert` | Self-signed SSL cert (auto-generated) |
| `MAX_FILE_SIZE` | `52428800` | সর্বোচ্চ file upload size (50MB) |
| `UPLOAD_DIR` | `./uploads` | Uploaded files save হবে এখানে |
| `FILE_MAX_AGE_DAYS` | `30` | 🔒 ৩০ দিনের পুরনো file auto-cleanup |
| `ENCRYPTION_MASTER_KEY` | 64 hex chars | 🔒⭐ AES-256-GCM encryption key — হারালে data lost! |
| `LOG_HMAC_SECRET` | 64 hex chars | 🔒 Security audit log tamper-proof করতে |
| `ALLOWED_ORIGINS` | তোমার domain | 🔒 CORS — শুধু এই domain থেকে request allow |
| `STUN_SERVERS` | Google STUN | NAT traversal এ public IP discover করতে |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 minutes) |
| `RATE_LIMIT_MAX` | `100` | 15 মিনিটে সর্বোচ্চ 100 requests |
| `WEBHOOK_SECRET` | Generated hex | 🔒 GitHub webhook HMAC-SHA256 signature verification |
| `SERVER_IP` | `0.0.0.0` | সব interface এ listen করো |

---

## 📌 Step 8: Client `.env` তৈরি

```bash
nano /var/www/quick-meet/client/.env
```

### Paste করো:
```env
VITE_SERVER_URL=https://quickmeet.genuinesoftmart.store
VITE_TURN_URL=turn:quickmeet.genuinesoftmart.store:3478
VITE_TURN_USERNAME=quickmeet
VITE_TURN_CREDENTIAL=QuickMeet@Turn2026Secure
```

Save: `Ctrl+X` → `Y` → `Enter`

### প্রতিটা value এর ব্যাখ্যা:

| Variable | Value | কেন |
|---|---|---|
| `VITE_SERVER_URL` | `https://quickmeet.genuinesoftmart.store` | Frontend থেকে Backend এর URL |
| `VITE_TURN_URL` | `turn:quickmeet.genuinesoftmart.store:3478` | TURN server address (call relay) |
| `VITE_TURN_USERNAME` | `quickmeet` | TURN auth username |
| `VITE_TURN_CREDENTIAL` | `QuickMeet@Turn2026Secure` | TURN auth password (coturn config এ match) |

> ⚠️ **Client `.env` change করলে অবশ্যই `npm run build` আবার করতে হবে!**  
> কারণ Vite build-time এ `.env` inject করে, runtime এ পড়ে না।

---

## 📌 Step 9: npm Install

```bash
cd /var/www/quick-meet/server && npm install
cd /var/www/quick-meet/client && npm install
```

---

## 📌 Step 10: Client Build

```bash
cd /var/www/quick-meet/client && npm run build
```

এটা `client/dist/` ফোল্ডারে production build তৈরি করে, যেটা Nginx serve করে।

---

## 📌 Step 11: PM2 দিয়ে Server চালু

### প্রথমবার:
```bash
cd /var/www/quick-meet/server
pm2 start server.js --name quickmeet
pm2 save
```

### পরে restart:
```bash
pm2 restart quickmeet
```

### Logs দেখা:
```bash
pm2 logs quickmeet --lines 30
```

### Status চেক:
```bash
pm2 status
```

---

## 📌 Step 12: coturn (TURN Server) — ⭐ CRITICAL

> **TURN server ছাড়া different network (WiFi ↔ Mobile Data) থেকে audio/video call কাজ করবে না!**

### Install:
```bash
apt-get update && apt-get install -y coturn
```

### Enable:
```bash
sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

### Config:
```bash
nano /etc/turnserver.conf
```

### Paste করো:
```
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
external-ip=167.71.235.56
relay-ip=167.71.235.56
realm=quickmeet.genuinesoftmart.store
server-name=quickmeet.genuinesoftmart.store
lt-cred-mech
user=quickmeet:QuickMeet@Turn2026Secure
total-quota=100
stale-nonce=600
no-multicast-peers
fingerprint
no-cli
```

Save: `Ctrl+X` → `Y` → `Enter`

### Config ব্যাখ্যা:

| Setting | কেন |
|---|---|
| `listening-port=3478` | TURN standard port |
| `tls-listening-port=5349` | TURNS (encrypted) port |
| `external-ip=167.71.235.56` | তোমার VPS এর public IP |
| `realm` | Domain name |
| `lt-cred-mech` | Long-term credential authentication |
| `user=quickmeet:QuickMeet@Turn2026Secure` | Username:Password (client `.env` এ match করতে হবে!) |
| `total-quota=100` | সর্বোচ্চ concurrent sessions |
| `no-multicast-peers` | Security: multicast block |

### Start:
```bash
systemctl enable coturn
systemctl restart coturn
```

### Verify:
```bash
systemctl status coturn
```
`Active: active (running)` দেখতে হবে ✅

---

## 📌 Step 13: Firewall (UFW)

```bash
ufw allow 22/tcp        # SSH
ufw allow 80/tcp        # HTTP
ufw allow 443/tcp       # HTTPS
ufw allow 3478/tcp      # TURN TCP
ufw allow 3478/udp      # TURN UDP
ufw allow 5349/tcp      # TURNS TCP
ufw allow 5349/udp      # TURNS UDP
ufw allow 49152:65535/udp  # TURN relay ports
ufw enable
ufw status
```

### Port ব্যাখ্যা:

| Port | কাজ |
|---|---|
| 22 | SSH access |
| 80 | HTTP → HTTPS redirect |
| 443 | HTTPS (Nginx + Let's Encrypt) |
| 5000 | Node.js server (Nginx proxy করে, external open না করলেও চলে) |
| 3478 | TURN server (UDP + TCP) |
| 5349 | TURNS (encrypted TURN) |
| 49152-65535 | TURN relay media ports |

---

## 📌 Step 14: GitHub Actions CI/CD Pipeline — ⭐ AUTO BUILD + DEPLOY

> **প্রতি `git push` এ GitHub Actions নিজে সব build করে, release তৈরি করে, এবং VPS তে deploy করে!**

### CI/CD Pipeline Flow:

```
git push main
    │
    ▼
┌──────────────────────────────────┐
│  1. VERSION (ubuntu-latest)       │
│  ├─ Auto-bump patch version       │
│  ├─ Update all package.json       │
│  ├─ Update versions.json          │
│  └─ Commit: "chore: bump v1.0.X   │
│      [skip ci]"                   │
└──────────┬────────┬───────────────┘
           │        │
    ┌──────▼──┐  ┌──▼────────────┐
    │ ANDROID  │  │   WINDOWS     │
    │ (ubuntu) │  │ (windows)     │
    │  APK     │  │  EXE          │
    │  build   │  │  build        │
    └────┬─────┘  └──────┬────────┘
         │               │
    ┌────▼───────────────▼────────┐
    │  3. RELEASE                  │
    │  ├─ Download all artifacts   │
    │  ├─ Create GitHub Release    │
    │  └─ Upload APK + EXE files   │
    └──────────────┬───────────────┘
                   │
    ┌──────────────▼───────────────┐
    │  4. DEPLOY TO VPS            │
    │  ├─ SSH to 167.71.235.56     │
    │  ├─ git pull origin main     │
    │  ├─ npm install + build      │
    │  ├─ Download latest APK      │
    │  ├─ Update versions.json     │
    │  └─ pm2 restart quickmeet    │
    └──────────────────────────────┘
```

### CI/CD File Location:
```
.github/workflows/build-apps.yml
```

### GitHub Actions Workflow (Full):

```yaml
name: Build, Release & Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: build-release
  cancel-in-progress: true

jobs:
  # ====================================================
  # AUTO-BUMP VERSION & DETERMINE VERSION
  # ====================================================
  version:
    name: Bump & Get Version
    runs-on: ubuntu-latest
    permissions:
      contents: write
    outputs:
      desktop_version: ${{ steps.versions.outputs.desktop }}
      android_version: ${{ steps.versions.outputs.android }}
      app_version: ${{ steps.versions.outputs.app }}
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Auto-bump patch version
        if: "!contains(github.event.head_commit.message, '[skip ci]')"
        run: |
          CURRENT=$(node -p "require('./mobile/package.json').version")
          echo "Current version: $CURRENT"
          IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
          PATCH=$((PATCH + 1))
          NEW_VERSION="$MAJOR.$MINOR.$PATCH"
          echo "New version: $NEW_VERSION"
          for PKG in package.json client/package.json server/package.json desktop/package.json mobile/package.json; do
            if [ -f "$PKG" ]; then
              node -e "
                const fs = require('fs');
                const pkg = JSON.parse(fs.readFileSync('$PKG','utf8'));
                pkg.version = '$NEW_VERSION';
                fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
              "
              echo "Updated $PKG -> $NEW_VERSION"
            fi
          done
          node -e "
            const fs = require('fs');
            const p = './server/updates/versions.json';
            let v = {};
            try { v = JSON.parse(fs.readFileSync(p,'utf8')); } catch(e) {}
            const now = new Date().toISOString();
              ['web','desktop'].forEach(k => {
              if (!v[k]) v[k] = {};
              v[k].version = '$NEW_VERSION';
              v[k].lastUpdated = now;
              if (!v[k].minVersion) v[k].minVersion = '1.0.0';
            });
            fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
          "
          echo "Updated versions.json -> $NEW_VERSION"
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add -A
          git diff --cached --quiet || {
            git commit -m "chore: bump version to v$NEW_VERSION [skip ci]"
            git push
            echo "Committed version bump to v$NEW_VERSION"
          }

      - name: Read versions
        id: versions
        run: |
          APP_VERSION=$(node -p "require('./mobile/package.json').version")
          echo "desktop=$APP_VERSION" >> $GITHUB_OUTPUT
          echo "android=$APP_VERSION" >> $GITHUB_OUTPUT
          echo "app=$APP_VERSION" >> $GITHUB_OUTPUT
          echo "App version: $APP_VERSION"

  # ====================================================
  # BUILD ANDROID APK
  # ====================================================
  build-android:
    name: Build Android APK
    runs-on: ubuntu-latest
    needs: version
    steps:
      - name: Checkout code (latest after version bump)
        uses: actions/checkout@v4
        with:
          ref: main
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: |
            client/package-lock.json
            mobile/package-lock.json
      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      - name: Install client dependencies
        run: cd client && npm ci
      - name: Build client web assets
        run: cd client && npm run build
        env:
          VITE_SERVER_URL: https://quickmeet.genuinesoftmart.store
      - name: Install mobile dependencies
        run: cd mobile && npm ci
      - name: Sync Capacitor
        run: cd mobile && npx cap sync android
      - name: Make Gradle wrapper executable
        run: chmod +x mobile/android/gradlew
      - name: Build debug APK
        run: |
          cd mobile/android
          ./gradlew assembleDebug --no-daemon
      - name: Build release APK (unsigned)
        run: |
          cd mobile/android
          ./gradlew assembleRelease --no-daemon
      - name: Upload Debug APK
        uses: actions/upload-artifact@v4
        with:
          name: quick-meet-debug-apk
          path: mobile/android/app/build/outputs/apk/debug/quick-meet-v*-debug.apk
          retention-days: 30
      - name: Upload Release APK
        uses: actions/upload-artifact@v4
        with:
          name: quick-meet-release-apk
          path: mobile/android/app/build/outputs/apk/release/quick-meet-v*-release.apk
          retention-days: 30

  # ====================================================
  # BUILD WINDOWS INSTALLER
  # ====================================================
  build-windows:
    name: Build Windows Installer
    runs-on: windows-latest
    needs: version
    steps:
      - name: Checkout code (latest after version bump)
        uses: actions/checkout@v4
        with:
          ref: main
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: desktop/package-lock.json
      - name: Install desktop dependencies
        run: cd desktop && npm ci
      - name: Build Windows installer (with publish config)
        run: cd desktop && npx electron-builder --win --x64 --publish never
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Upload Windows Installer
        uses: actions/upload-artifact@v4
        with:
          name: quick-meet-windows-installer
          path: |
            desktop/dist/quick-meet-v*-setup.exe
            desktop/dist/latest.yml
          retention-days: 30
      - name: Upload Windows Portable
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: quick-meet-windows-unpacked
          path: desktop/dist/win-unpacked/
          retention-days: 14

  # ====================================================
  # CREATE GITHUB RELEASE (after both builds succeed)
  # ====================================================
  release:
    name: Create Release
    runs-on: ubuntu-latest
    needs: [version, build-android, build-windows]
    permissions:
      contents: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Download Android Debug APK
        uses: actions/download-artifact@v4
        with:
          name: quick-meet-debug-apk
          path: release-assets/
      - name: Download Android Release APK
        uses: actions/download-artifact@v4
        with:
          name: quick-meet-release-apk
          path: release-assets/
      - name: Download Windows Installer
        uses: actions/download-artifact@v4
        with:
          name: quick-meet-windows-installer
          path: release-assets/
      - name: Rename artifacts for release
        run: |
          cd release-assets
          ls -la *.apk 2>/dev/null || echo "No APK files found"
          ls -la *.exe 2>/dev/null || echo "No EXE files found"
          ls -la
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v${{ needs.version.outputs.desktop_version }}
          name: Quick Meet v${{ needs.version.outputs.desktop_version }}
          body: |
            ## Quick Meet v${{ needs.version.outputs.desktop_version }}
            ### Downloads
            - **Windows**: Download the `.exe` installer and run it
            - **Android**: Download the `.apk` file and install on your device
            ### Features
            - Auto-update support for Desktop and Android
            - Bug fixes and performance improvements
            ---
            *Built from commit ${{ github.sha }}*
          draft: false
          prerelease: false
          files: release-assets/*
          fail_on_unmatched_files: false
          token: ${{ github.token }}
        env:
          GITHUB_TOKEN: ${{ github.token }}

  # ====================================================
  # DEPLOY TO VPS (after release is created)
  # ====================================================
  deploy:
    name: Deploy to VPS
    runs-on: ubuntu-latest
    needs: [version, build-android, release]
    if: always() && needs.build-android.result != 'cancelled'
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: 167.71.235.56
          username: root
          password: ${{ secrets.VPS_PASSWORD }}
          script: |
            cd /var/www/quick-meet
            git stash 2>/dev/null || true
            git pull origin main
            mkdir -p server/logs/security
            mkdir -p server/updates/builds
            cd server && npm install --production && cd ..
            cd client && npm install && npm run build && cd ..
            LATEST_APK_URL=$(curl -s https://api.github.com/repos/Tajbir23/quick-meet/releases/latest | node -e "
            const chunks = [];
            process.stdin.on('data', d => chunks.push(d));
            process.stdin.on('end', () => {
              try {
                const data = JSON.parse(Buffer.concat(chunks).toString());
                const apk = (data.assets || []).find(a => a.name.endsWith('.apk'));
                if (apk) console.log(apk.browser_download_url);
              } catch(e) {}
            });
            " 2>/dev/null || echo "")
            if [ -n "$LATEST_APK_URL" ]; then
              curl -L -o server/updates/builds/quick-meet.apk "$LATEST_APK_URL" 2>/dev/null || true
            fi
            CLIENT_VERSION=$(node -p "require('./client/package.json').version")
            node -e "
            const fs = require('fs');
            const p = './server/updates/versions.json';
            let v = {};
            try { v = JSON.parse(fs.readFileSync(p,'utf8')); } catch(e) {}
            const now = new Date().toISOString();
              ['web','desktop'].forEach(k => {
              if (!v[k]) v[k] = {};
              v[k].version = '$CLIENT_VERSION';
              v[k].lastUpdated = now;
              if (!v[k].minVersion) v[k].minVersion = '1.0.0';
            });
            fs.writeFileSync(p, JSON.stringify(v, null, 2));
            console.log('versions.json updated: ' + '$CLIENT_VERSION');
            "
            pm2 restart quickmeet
            echo "Deploy complete: $(date)"
```

### GitHub Settings যা লাগবে:

#### 1. Repository Secrets (Settings → Secrets and variables → Actions):

| Secret Name | Value | কেন |
|---|---|---|
| `VPS_PASSWORD` | VPS root password | SSH deploy job VPS তে login করতে |

> `GITHUB_TOKEN` আলাদা করে add করার দরকার নেই — GitHub Actions নিজেই provide করে।

#### 2. Permissions (Settings → Actions → General):
- **Workflow permissions**: "Read and write permissions" সিলেক্ট করো
- **Allow GitHub Actions to create and approve pull requests**: Enable করো

### কী কী auto হয়:

| কাজ | কখন | কে করে |
|---|---|---|
| Version bump (1.0.37 → 1.0.38) | প্রতি push এ | `version` job |
| Android Debug APK build | প্রতি push এ | `build-android` job |
| Android Release APK build | প্রতি push এ | `build-android` job |
| Windows EXE installer build | প্রতি push এ | `build-windows` job |
| GitHub Release তৈরি | APK + EXE build হলে | `release` job |
| VPS deploy (git pull + build + PM2 restart) | Release এর পর | `deploy` job |
| APK download to VPS `/server/updates/builds/` | Deploy এর সময় | `deploy` job |

### [skip ci] কিভাবে কাজ করে:
- Version bump commit এ `[skip ci]` tag থাকে → pipeline আবার trigger হয় না
- তুমি manually `[skip ci]` দিলেও pipeline skip হবে

### Manually Pipeline Run:
- GitHub repo → Actions tab → "Build, Release & Deploy" → Run workflow → Run

---

## 📌 Step 15: Webhook Auto-Deploy (Alternative to CI/CD) — ⭐

> **GitHub Actions CI/CD ছাড়াও webhook দিয়ে auto-deploy হয়!**  
> GitHub push event → webhook POST → server নিজেই git pull + build + restart করে।

### Webhook কিভাবে কাজ করে:

```
git push main
    │
    ▼
GitHub Webhook POST
    │  (with HMAC-SHA256 signature)
    ▼
https://quickmeet.genuinesoftmart.store/webhook
    │
    ▼
server/routes/webhook.js
    │
    ├─ HMAC-SHA256 signature verify
    ├─ Check: branch === main?
    ├─ git stash + git pull origin main
    ├─ npm install (server + client)
    ├─ npm run build (client)
    ├─ Update versions.json
    └─ pm2 restart quickmeet
```

### Webhook Endpoint:
- **Route:** `POST /webhook` (handled by `server/routes/webhook.js`)
- **GET /webhook** — deploy logs দেখায় (last 20 entries)
- **Signature:** HMAC-SHA256 (`X-Hub-Signature-256` header)
- **Secret:** `.env` এর `WEBHOOK_SECRET` value
- **Deploy log:** `server/logs/deploy.log`

### GitHub Webhook Setup:

1. **GitHub Repo → Settings → Webhooks → Add webhook**
2. **Payload URL:** `https://quickmeet.genuinesoftmart.store/webhook`
3. **Content type:** `application/json`
4. **Secret:** Server `.env` এর `WEBHOOK_SECRET` এ যে value দিয়েছো সেটা
5. **Events:** "Just the push event"
6. **Active:** ✅ চেক করো
7. **Add webhook**

### Webhook Features:
- ✅ HMAC-SHA256 signature verification (tamper-proof)
- ✅ Only main/master branch deploy করে
- ✅ Concurrent deploy protection (একবারে একটাই)
- ✅ Deploy log maintain করে (`server/logs/deploy.log`)
- ✅ `versions.json` auto-update
- ✅ 5 minute timeout (300s)
- ✅ GET endpoint দিয়ে deploy status + last 20 logs দেখা যায়

### Webhook vs CI/CD — কোনটা কখন:

| Feature | Webhook | GitHub Actions CI/CD |
|---|---|---|
| VPS deploy | ✅ | ✅ |
| Android APK build | ❌ | ✅ |
| Windows EXE build | ❌ | ✅ |
| GitHub Release | ❌ | ✅ |
| Version bump | ❌ | ✅ |
| Deploy speed | ~1-2 min | ~8-15 min |
| কখন দরকার | Server-only changes | Full release (APK + EXE + deploy) |

> 💡 **দুইটাই active রাখো!** CI/CD pipeline release তৈরি করবে → তারপর নিজেই SSH দিয়ে deploy করবে। Webhook শুধু backup — CI/CD এর deploy step fail হলে webhook catch করবে।

---

## 📌 Step 16: Desktop App Build (Windows/Linux/Mac) — Optional

> **Desktop app VPS তে build করার দরকার নেই — Local PC তে build করো!**  
> **অথবা — GitHub Actions auto build করে! (Step 14 দেখো)**

### Prerequisites:
- Node.js 20+ installed
- Project clone + `npm install` in `desktop/` folder

### Windows EXE Build:
```bash
# Project root থেকে:
npm run build:win

# অথবা desktop folder থেকে:
cd desktop && npx electron-builder --win
```

**Output:** `desktop/dist/quick-meet-v1.0.37-setup.exe` (NSIS installer, x64)

### Linux AppImage/Deb Build:
```bash
npm run build:linux
```

### Mac DMG Build:
```bash
npm run build:mac
```

### Desktop App Details:

| Setting | Value |
|---|---|
| App ID | `com.quickmeet.desktop` |
| Framework | Electron 28 + electron-builder 24.9.1 |
| Auto-updater | electron-updater 6.1.7 (GitHub Releases) |
| Window | Frameless, titlebar overlay, min 480×600 |
| Features | System tray, single instance, native file streaming (50GB+) |
| URL | Loads `https://quickmeet.genuinesoftmart.store` |
| Artifact Name | `quick-meet-v${version}-setup.exe` |
| Publish | GitHub Releases (`Tajbir23/quick-meet`) |

---

## 📌 Step 17: Android APK Build — Optional

> **Android Studio ছাড়াই APK build করা যায়!**  
> **অথবা — GitHub Actions auto build করে! (Step 14 দেখো)**

### Prerequisites (একবারই install):

#### 1. JDK 17 Install:
```bash
# Windows (winget):
winget install --id Microsoft.OpenJDK.17

# Ubuntu:
apt-get install -y openjdk-17-jdk
```

#### 2. Android SDK Command-Line Tools:
```bash
# Windows:
# Download: https://developer.android.com/studio#command-line-tools-only
# Extract to: %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\

# Ubuntu:
mkdir -p ~/Android/Sdk/cmdline-tools
cd ~/Android/Sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-11076708_latest.zip
mv cmdline-tools latest
```

#### 3. SDK Packages Install:
```bash
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

#### 4. SDK Licenses Accept:
```bash
sdkmanager --licenses
# সব prompt এ y দাও
```

#### 5. Environment Variables Set:
```bash
# Windows PowerShell (permanent):
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot", "User")

# Linux (.bashrc):
export ANDROID_HOME=~/Android/Sdk
export ANDROID_SDK_ROOT=~/Android/Sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

### APK Build Command:

```bash
# Step 1: Web build + Capacitor sync
npm run build:web
cd mobile && npx cap sync android

# Step 2: Debug APK build
cd android

# Windows:
gradlew.bat assembleDebug

# Linux/Mac:
./gradlew assembleDebug
```

**Output:** `mobile/android/app/build/outputs/apk/debug/quick-meet-v1.0.37-debug.apk`

### Release APK (signed):
```bash
# Windows:
gradlew.bat assembleRelease

# Linux/Mac:
./gradlew assembleRelease
```
> ⚠️ Release build এর জন্য keystore setup লাগবে — `mobile/android/app/build.gradle` এ signing config add করতে হবে।

### Mobile App Details:

| Setting | Value |
|---|---|
| App ID | `com.quickmeet.app` |
| Framework | Capacitor 5.6.0 |
| compileSdk | 34 |
| minSdk | 24 (Android 7.0+) |
| targetSdk | 34 |
| Java | 17 (source & target compatibility) |
| Server URL | `https://quickmeet.genuinesoftmart.store` |
| APK naming | `quick-meet-v${version}-${buildType}.apk` |
| Version Code | `major * 10000 + minor * 100 + patch` (e.g. 1.0.37 → 10037) |

### Capacitor Plugins:

| Plugin | Version | কাজ |
|---|---|---|
| `@capacitor/core` | 5.6.0 | Core framework |
| `@capacitor/android` | 5.6.0 | Android platform |
| `@capacitor/app` | 5.0.7 | App state, URL open events |
| `@capacitor/camera` | 5.0.8 | Camera access |
| `@capacitor/filesystem` | 5.2.1 | File system read/write |
| `@capacitor/haptics` | 5.0.7 | Vibration feedback |
| `@capacitor/keyboard` | 5.0.8 | Keyboard events |
| `@capacitor/local-notifications` | 5.0.7 | Local push notifications |
| `@capacitor/network` | 5.0.7 | Network status check |
| `@capacitor/splash-screen` | 5.0.7 | Splash screen |
| `@capacitor/status-bar` | 5.0.7 | Status bar customization |
| `@capacitor-community/file-opener` | 1.0.5 | File opener integration |

### Custom Native Java Plugins:

| File | কাজ |
|---|---|
| `BackgroundService.java` | Android foreground service — keeps WebView/socket alive, 4 notification channels (BG/Call/Transfer/Message), WakeLock 4h, notification action buttons, pending action queue |
| `BackgroundServicePlugin.java` | Capacitor bridge — 15+ methods: start/stop, call/transfer/message notifications, getPendingAction, requestBatteryOptimization |
| `BootReceiver.java` | Auto-start service on device boot/reboot/app update |
| `NotificationActionReceiver.java` | Handle notification button taps: Answer/Decline call, Accept/Reject file transfer |
| `ApkInstallerPlugin.java` | APK installer for in-app updates |
| `MainActivity.java` | Main Capacitor activity with all plugins registered |

### Android Permissions (AndroidManifest.xml):

| Permission | কেন |
|---|---|
| `INTERNET` | Network access |
| `ACCESS_NETWORK_STATE` | Network status check |
| `ACCESS_WIFI_STATE` | WiFi status |
| `CAMERA` | Video call |
| `RECORD_AUDIO` | Voice/video call |
| `MODIFY_AUDIO_SETTINGS` | Audio routing |
| `BLUETOOTH` / `BLUETOOTH_CONNECT` | Bluetooth audio |
| `READ/WRITE_EXTERNAL_STORAGE` | File access (legacy) |
| `READ_MEDIA_IMAGES/VIDEO/AUDIO` | Media access (Android 13+) |
| `MANAGE_EXTERNAL_STORAGE` | Full file access |
| `REQUEST_INSTALL_PACKAGES` | APK install for updates |
| `POST_NOTIFICATIONS` | Show notifications |
| `VIBRATE` | Vibration |
| `WAKE_LOCK` | Keep CPU active |
| `FOREGROUND_SERVICE` | Background service |
| `FOREGROUND_SERVICE_DATA_SYNC` | Data sync foreground type |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Battery optimization bypass |
| `RECEIVE_BOOT_COMPLETED` | Auto-start on boot |
| `USE_FULL_SCREEN_INTENT` | Full-screen call notification |

---

## 🔨 Unified Build Scripts (Root package.json)

Project root থেকে এক command এ সব build করা যায়:

| Command | কী করে |
|---|---|
| `npm run build:web` | Client build (Vite → `client/dist/`) |
| `npm run build:win` | Web build + Windows EXE |
| `npm run build:linux` | Web build + Linux AppImage/Deb |
| `npm run build:mac` | Web build + Mac DMG |
| `npm run build:all` | Web + Windows EXE + Android sync |
| `npm run build:android:sync` | Capacitor sync Android |
| `npm run build:android:debug` | Android debug APK |
| `npm run build:android:release` | Android release APK |
| `npm run build:android` | Web build + sync + open Android Studio |
| `npm run install:all` | Install all deps (server + client + desktop + mobile) |
| `npm run version:bump` | Bump patch version across all packages |
| `npm run version:bump:minor` | Bump minor version |
| `npm run version:bump:major` | Bump major version |

---

## 🔄 Deploy Process — 3 টা উপায়

### 1. Auto Deploy (CI/CD — Recommended ✅):
শুধু local PC থেকে:
```bash
git add -A && git commit -m "your message" && git push
```
GitHub Actions নিজে:
- Version bump করবে
- Android APK build করবে
- Windows EXE build করবে
- GitHub Release তৈরি করবে
- VPS তে SSH দিয়ে deploy করবে

### 2. Webhook Deploy (Backup):
`git push` করলে GitHub webhook trigger হয় → server নিজে build + restart করে।
- শুধু server-side deploy (APK/EXE build হয় না)
- CI/CD deploy step fail হলে backup হিসেবে কাজ করে

### 3. Manual Deploy:
```bash
ssh root@167.71.235.56
cd /var/www/quick-meet && ./deploy.sh
```

অথবা one-liner:
```bash
ssh root@167.71.235.56 "cd /var/www/quick-meet && git stash && git pull origin main && cd client && npm run build && cd .. && pm2 restart quickmeet && pm2 flush quickmeet && echo 'Deploy DONE'"
```

---

## 📁 Full Project Structure

### VPS File Structure:
```
/var/www/quick-meet/
├── package.json                ← monorepo root (v1.0.37+) with unified build scripts
├── generate-ssl.js             ← self-signed SSL generator
├── deploy.sh                   ← auto-deploy script (manual fallback)
├── .github/
│   └── workflows/
│       └── build-apps.yml      ← ⭐ CI/CD pipeline (auto-bump + build + release + deploy)
├── server/
│   ├── .env                    ← ⭐ manually created (Step 7)
│   ├── server.js               ← entry point (HTTPS + Express + Socket.io)
│   ├── config/
│   │   ├── db.js               ← MongoDB connection
│   │   ├── socket.js           ← Socket.io configuration
│   │   └── ssl.js              ← SSL certificate loader
│   ├── controllers/
│   │   ├── authController.js       ← login, signup, token refresh
│   │   ├── fileController.js       ← file upload/download
│   │   ├── fileTransferController.js ← P2P transfer management
│   │   ├── groupController.js      ← group CRUD
│   │   ├── messageController.js    ← message CRUD + encryption
│   │   ├── ownerController.js      ← admin dashboard
│   │   ├── updateController.js     ← app version check + APK download
│   │   └── userController.js       ← user profile management
│   ├── middleware/
│   │   ├── auth.js             ← JWT verification + token refresh
│   │   ├── ownerAuth.js        ← admin role check
│   │   ├── rateLimiter.js      ← request rate limiting
│   │   └── upload.js           ← multer file upload handler
│   ├── models/
│   │   ├── FileTransfer.js     ← P2P transfer tracking (MongoDB)
│   │   ├── Group.js            ← group chat model
│   │   ├── Message.js          ← encrypted message model
│   │   └── User.js             ← user model with refresh tokens
│   ├── routes/
│   │   ├── auth.js             ← /api/auth/*
│   │   ├── file.js             ← /api/files/*
│   │   ├── fileTransfer.js     ← /api/file-transfer/*
│   │   ├── group.js            ← /api/groups/*
│   │   ├── message.js          ← /api/messages/*
│   │   ├── owner.js            ← /api/owner/*
│   │   ├── update.js           ← /api/updates/*
│   │   ├── user.js             ← /api/users/*
│   │   └── webhook.js          ← ⭐ /webhook (GitHub auto-deploy)
│   ├── socket/
│   │   ├── index.js            ← socket handler registration
│   │   ├── chat.js             ← real-time messaging events
│   │   ├── fileTransfer.js     ← P2P file transfer signaling
│   │   ├── groupCall.js        ← multi-participant call signaling
│   │   ├── presence.js         ← online/offline/typing status
│   │   └── signaling.js        ← WebRTC offer/answer/ICE signaling
│   ├── security/               ← 🔒 security modules (8 files)
│   │   ├── index.js            ← module aggregation + init/shutdown
│   │   ├── CryptoService.js    ← AES-256-GCM, HMAC, ECDH, HKDF
│   │   ├── SecurityEventLogger.js ← tamper-proof audit logs
│   │   ├── IntrusionDetector.js   ← brute-force + IP ban + threat scoring
│   │   ├── SocketGuard.js      ← per-event auth + rate limiting
│   │   ├── CallTokenService.js ← one-time call tokens
│   │   ├── SDPSanitizer.js     ← SDP/ICE validation
│   │   └── FileScanner.js      ← magic-byte + content scanning
│   ├── updates/
│   │   ├── versions.json       ← ⭐ app version tracking (web/desktop/android)
│   │   └── builds/
│   │       └── quick-meet.apk  ← latest APK (downloaded by CI/CD)
│   ├── logs/
│   │   ├── deploy.log          ← ⭐ webhook deploy logs
│   │   └── security/           ← 🔒 security audit logs (auto-created)
│   │       └── security-YYYY-MM-DD.jsonl
│   ├── uploads/                ← user uploaded files (authenticated access only)
│   ├── utils/
│   │   └── helpers.js          ← server utility functions
│   ├── node_modules/
│   └── package.json
├── client/
│   ├── .env                    ← ⭐ manually created (Step 8)
│   ├── dist/                   ← ⭐ build output (Nginx serves this)
│   ├── src/
│   │   ├── App.jsx             ← root component + routing + notification action wiring
│   │   ├── main.jsx            ← React entry point
│   │   ├── index.css           ← Tailwind CSS base
│   │   ├── components/
│   │   │   ├── Auth/           ← ProtectedRoute
│   │   │   ├── Call/           ← AudioCall, VideoCall, CallControls, DeviceSelector,
│   │   │   │                     IncomingCall, IncomingGroupCall, MinimizedCall
│   │   │   ├── Chat/           ← ChatList, ChatWindow, MessageBubble, MessageInput
│   │   │   ├── Common/         ← FileUpload, ForwardMessageModal, ImagePreview,
│   │   │   │                     NetworkStatus, Notification, StatusBar,
│   │   │   │                     UpdateNotification, UserAvatar,
│   │   │   │                     UserProfileModal, UserSettings
│   │   │   ├── FileTransfer/   ← 📁 P2PFileSend, IncomingFileTransfer,
│   │   │   │                     FileTransferPanel, FileTransferIndicator
│   │   │   ├── Group/          ← CreateGroup, GroupCall, GroupChat, GroupList
│   │   │   ├── Layout/         ← Header, MainLayout, Sidebar
│   │   │   └── Users/          ← ActiveUsers
│   │   ├── hooks/
│   │   │   ├── useMediaDevices.js    ← camera/mic device enumeration
│   │   │   ├── useSocket.js          ← socket connection + background message notifications
│   │   │   └── useSpeakingDetector.js ← audio level detection
│   │   ├── pages/
│   │   │   ├── HomePage.jsx          ← main chat + call interface
│   │   │   ├── LoginPage.jsx         ← user login
│   │   │   ├── SignupPage.jsx        ← user registration
│   │   │   ├── OwnerDashboard.jsx    ← admin dashboard
│   │   │   └── FileTransferPage.jsx  ← 📁 P2P file transfer UI
│   │   ├── services/
│   │   │   ├── api.js                ← axios HTTP client
│   │   │   ├── backgroundService.js  ← ⭐ Android foreground service manager
│   │   │   ├── p2pFileTransfer.js    ← 📁 P2P DataChannel engine
│   │   │   ├── socket.js            ← socket.io client
│   │   │   └── webrtc.js            ← WebRTC peer connection
│   │   ├── store/
│   │   │   ├── useAuthStore.js       ← auth + JWT + refresh tokens
│   │   │   ├── useCallStore.js       ← call state management
│   │   │   ├── useChatStore.js       ← chat messages store
│   │   │   ├── useFileTransferStore.js ← 📁 P2P transfer UI state
│   │   │   ├── useGroupStore.js      ← group management
│   │   │   └── useOwnerStore.js      ← admin store
│   │   └── utils/
│   │       ├── constants.js          ← app constants
│   │       └── helpers.js            ← client utility functions
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── node_modules/
│   └── package.json
├── ssl/
│   ├── server.key              ← auto-generated (selfsigned)
│   └── server.cert             ← auto-generated (selfsigned)
├── README.md
├── SECURITY_HARDENING.md       ← 🔒 security documentation
├── VPS_SETUP_GUIDE.md          ← 📖 this file
└── .git/
```

### Desktop App Structure (Local PC only — VPS তে নেই):
```
desktop/
├── main.js                 ← Electron main process
│                             (frameless window, system tray, native file streaming,
│                              auto-updater, single instance, media permissions)
├── preload.js              ← context bridge (IPC APIs)
├── icon.ico / icon.png     ← app icons
├── package.json            ← electron-builder config
├── dist/                   ← ⭐ build output
│   ├── quick-meet-v1.0.37-setup.exe
│   └── latest.yml          ← auto-update manifest
└── node_modules/
```

### Mobile App Structure (Local PC only — VPS তে নেই):
```
mobile/
├── capacitor.config.json   ← Capacitor config (appId, server URL, plugins)
├── package.json            ← Capacitor dependencies
├── android/                ← Android native project
│   ├── app/
│   │   ├── build.gradle    ← auto version from package.json, APK naming
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml  ← permissions, receivers, services
│   │   │   └── java/com/quickmeet/app/
│   │   │       ├── MainActivity.java           ← main activity
│   │   │       ├── BackgroundService.java       ← foreground service (4 channels)
│   │   │       ├── BackgroundServicePlugin.java ← Capacitor bridge (15+ methods)
│   │   │       ├── BootReceiver.java            ← boot auto-start
│   │   │       ├── NotificationActionReceiver.java ← notification button handler
│   │   │       └── ApkInstallerPlugin.java      ← APK installer
│   │   └── build/outputs/apk/
│   │       ├── debug/
│   │       │   └── quick-meet-v1.0.37-debug.apk
│   │       └── release/
│   │           └── quick-meet-v1.0.37-release.apk
│   ├── build.gradle
│   ├── gradlew / gradlew.bat
│   ├── variables.gradle    ← SDK versions (compileSdk=34, minSdk=24, targetSdk=34)
│   └── gradle/
└── node_modules/
```

### System Config Files (VPS):
```
/etc/nginx/sites-available/quickmeet  ← Nginx config
/etc/turnserver.conf                   ← coturn TURN server config
/etc/default/coturn                    ← coturn enable flag
```

---

## 📦 Tech Stack Summary

| Component | Technology | Version |
|---|---|---|
| **Backend** | Express.js | 4.21 |
| **Database** | MongoDB Atlas (Mongoose) | 8.7 |
| **Real-time** | Socket.io | 4.8 |
| **Frontend** | React + Vite | 18.3 + 5.4 |
| **State** | Zustand | 5.0 |
| **Styling** | Tailwind CSS | 3.4 |
| **Desktop** | Electron + electron-builder | 28 + 24.9 |
| **Mobile** | Capacitor (Android) | 5.6 |
| **Auth** | JWT (access 15m + refresh 7d auto-rotate) | — |
| **Encryption** | AES-256-GCM + HMAC-SHA256 + ECDH + HKDF | — |
| **SSL** | Let's Encrypt (Nginx) + Self-signed (Node.js) | — |
| **TURN** | coturn | — |
| **Process** | PM2 (process name: `quickmeet`) | — |
| **Reverse Proxy** | Nginx | — |
| **CI/CD** | GitHub Actions (auto-bump + build + release + deploy) | — |
| **Webhook** | Express route with HMAC-SHA256 | — |
| **Java** | OpenJDK 17 (CI: Temurin) | 17 |
| **Android SDK** | compileSdk 34 / minSdk 24 / targetSdk 34 | — |

---

## 🔌 API Routes Overview

| Route | Method | কাজ |
|---|---|---|
| `/api/auth/signup` | POST | User registration |
| `/api/auth/login` | POST | User login (returns access + refresh token) |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/auth/logout` | POST | Logout (revoke refresh token) |
| `/api/users/me` | GET | Current user profile |
| `/api/users/:id` | GET | User profile by ID |
| `/api/users/search` | GET | Search users |
| `/api/messages/:userId` | GET | Get messages with user |
| `/api/messages/send` | POST | Send message (encrypted) |
| `/api/groups/` | GET/POST | List/create groups |
| `/api/groups/:id` | GET/PUT/DELETE | Group CRUD |
| `/api/files/upload` | POST | File upload (multer, 50MB max) |
| `/api/files/download/:filename` | GET | Authenticated file download |
| `/api/file-transfer/` | GET/POST | P2P transfer tracking |
| `/api/updates/check` | GET | App version check |
| `/api/updates/download/:platform` | GET | Download latest APK/EXE |
| `/api/owner/*` | Various | Admin dashboard endpoints |
| `/webhook` | POST | GitHub webhook auto-deploy |
| `/webhook` | GET | Deploy status + recent logs |

---

## 🔌 Socket Events Overview

| Event | Direction | কাজ |
|---|---|---|
| `message:send` | Client → Server | Send chat message |
| `message:receive` | Server → Client | Receive chat message |
| `message:group:receive` | Server → Client | Receive group chat message |
| `typing:start/stop` | Bidirectional | Typing indicator |
| `typing:group:start/stop` | Bidirectional | Group typing indicator |
| `user:online/offline` | Server → Client | Presence status |
| `users:online-list` | Server → Client | Full online users list |
| `call:offer` | Client → Server → Client | WebRTC call offer |
| `call:answer` | Client → Server → Client | WebRTC call answer |
| `call:ice-candidate` | Client → Server → Client | ICE candidate exchange |
| `call:reject/end` | Bidirectional | Call control |
| `group-call:*` | Bidirectional | Group call signaling |
| `file-transfer:request` | Client → Server → Client | P2P transfer request |
| `file-transfer:accepted` | Client → Server → Client | Transfer accepted |
| `file-transfer:signal` | Bidirectional | WebRTC DataChannel signaling |
| `file-transfer:cancel` | Bidirectional | Cancel transfer |
| `file-transfer:check-pending` | Client → Server | Check pending transfers |

---

## 🔍 Troubleshooting Commands

| সমস্যা | Command |
|---|---|
| Server logs দেখা | `pm2 logs quickmeet --lines 50` |
| Server restart | `pm2 restart quickmeet` |
| Server flush logs | `pm2 flush quickmeet` |
| Nginx error | `nginx -t && systemctl restart nginx` |
| Nginx logs | `tail -50 /var/log/nginx/error.log` |
| coturn status | `systemctl status coturn` |
| coturn restart | `systemctl restart coturn` |
| Port check | `ss -tlnp \| grep -E '5000\|3478\|443'` |
| Disk space | `df -h` |
| Memory | `free -m` |
| SSL renew | `certbot renew` |
| SSL expiry check | `certbot certificates` |
| Firewall status | `ufw status` |
| MongoDB check | `pm2 logs quickmeet --lines 5 \| grep -i mongo` |
| Deploy logs দেখা | `cat /var/www/quick-meet/server/logs/deploy.log` |
| Deploy status check | `curl https://quickmeet.genuinesoftmart.store/webhook` |
| 🔒 Security logs দেখা | `tail -100 /var/www/quick-meet/server/logs/security/security-$(date +%Y-%m-%d).jsonl` |
| 🔒 Security alerts খোঁজা | `grep -E 'CRITICAL\|ALERT' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 Banned IPs দেখা | `grep 'ip_banned' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 Failed logins | `grep 'login_failed' /var/www/quick-meet/server/logs/security/*.jsonl` |
| CI/CD status দেখা | GitHub repo → Actions tab |
| Latest release দেখা | GitHub repo → Releases |
| versions.json চেক | `cat /var/www/quick-meet/server/updates/versions.json` |
| APK file চেক | `ls -la /var/www/quick-meet/server/updates/builds/` |

---

## ⚠️ গুরুত্বপূর্ণ নোট

### General নোট

1. **`.env` ফাইল git এ push হয় না** — VPS তে manually তৈরি করতে হয়
2. **Client `.env` change = rebuild লাগবে** — Vite build-time এ inject করে
3. **Server `.env` change = PM2 restart লাগবে** — `pm2 restart quickmeet`
4. **coturn password = Client VITE_TURN_CREDENTIAL** — দুইটা MUST match হতে হবে
5. **SSL auto-renew** — Let's Encrypt 90 দিনে expire হয়, certbot auto-renew করে
6. **MongoDB Atlas** — Network Access এ 0.0.0.0/0 allow করো (সব IP থেকে access)
7. **VPS reboot হলে** — PM2 auto-start করবে (`pm2 startup` + `pm2 save` করা থাকলে)

### 🔒 Security-Specific নোট

8. **`ENCRYPTION_MASTER_KEY` হারালে সব encrypted messages আর পড়া যাবে না!** — অবশ্যই কোথাও safely backup রাখো (password manager, offline note)
9. **`/uploads/` directory আর Nginx দিয়ে public serve হয় না** — Files এখন authenticated endpoint `/api/files/download/:filename` দিয়ে serve হয়
10. **Security logs daily check করো** — `server/logs/security/` directory তে tamper-proof audit logs save হয়
11. **Access token মাত্র 15 মিনিট valid** — পুরনো `JWT_EXPIRES_IN=7d` আর কাজ করবে না
12. **JWT_SECRET প্রতি 90 দিনে rotate করো** — সব user কে re-login করতে হবে
13. **ENCRYPTION_MASTER_KEY শুধু তখনই change করো যখন compromised হয়** — change করলে সব পুরনো messages re-encrypt করতে হবে
14. **Brute force protection active** — 5 failed login = 15min lock, 10 = 1hr, 15+ = 24hr auto-lock
15. **CRITICAL security event দেখলে** — `SECURITY_HARDENING.md` এর Emergency Playbook দেখো

### 🚀 CI/CD & Webhook নোট

16. **CI/CD auto version bump** — প্রতি `git push` এ patch version auto-increment হয় (1.0.37 → 1.0.38)
17. **`[skip ci]` দিলে pipeline skip হয়** — commit message এ `[skip ci]` লেখো
18. **Webhook secret = `.env` WEBHOOK_SECRET** — GitHub webhook settings এ same value দিতে হবে
19. **Webhook deploy log** — `server/logs/deploy.log` এ সব deploy event log হয়
20. **CI/CD APK auto-download** — Deploy step GitHub Release থেকে latest APK ডাউনলোড করে `server/updates/builds/quick-meet.apk` এ save করে
21. **GitHub Actions minutes** — Free plan এ 2000 min/month, Pro তে 3000 min/month
22. **`workflow_dispatch` enabled** — GitHub Actions tab থেকে manually pipeline run করা যায়
23. **Concurrent deploy protection** — webhook.js এ `isDeploying` flag দিয়ে concurrent deploy block করে

### 📱 Desktop/Mobile নোট

24. **Desktop app URL hardcoded** — `desktop/main.js` এ `APP_URL = 'https://quickmeet.genuinesoftmart.store'`
25. **Mobile app URL** — `mobile/capacitor.config.json` এ `server.url` field
26. **Desktop auto-update** — GitHub Releases থেকে auto-update হয় (electron-updater)
27. **Android minSdk 24** — Android 7.0 (Nougat) বা তার উপরে চলবে
28. **APK build এ Android Studio লাগে না** — JDK 17 + Android SDK command-line tools দিয়েই হয়
29. **P2P file transfer** — WebRTC DataChannel দিয়ে direct transfer, server দিয়ে relay হয় না (50GB+ support)
30. **Background service auto-start on boot** — `BootReceiver.java` ← `RECEIVE_BOOT_COMPLETED` permission
31. **Battery optimization bypass** — App first launch এ system dialog দেখায়
32. **Notification actions** — Call এ Answer/Decline, File transfer এ Accept/Reject button notification এ দেখায়
33. **Message notifications** — App background এ থাকলে new message notification দেখায়

### 🔑 Key Rotation Schedule

| Secret | কত দিন পর পর | Rotation এর প্রভাব |
|---|---|---|
| `JWT_SECRET` | প্রতি 90 দিন | সব user force re-login |
| `ENCRYPTION_MASTER_KEY` | শুধু compromised হলে | ⚠️ সব messages re-encrypt লাগবে |
| `LOG_HMAC_SECRET` | প্রতি 90 দিন | পুরনো logs পুরনো key দিয়ে verify হবে |
| `WEBHOOK_SECRET` | প্রতি 90 দিন | GitHub webhook settings + `.env` দুইটাই update |
| Refresh Tokens | Auto-rotated | User দের কিছু করতে হয় না |
| coturn credentials | প্রতি 90 দিন | Server `.env` + Client `.env` + `/etc/turnserver.conf` তিনটাই update |

---

## 📊 Version Tracking

### versions.json Structure (`server/updates/versions.json`):
```json
{
  "desktop": {
    "version": "1.0.37",
    "minVersion": "1.0.0",
    "releaseNotes": "...",
    "forceUpdate": false,
    "downloadUrl": "https://quickmeet.genuinesoftmart.store/api/updates/download/desktop",
    "lastUpdated": "2026-02-16T05:43:36.788Z"
  },
  "android": {
    "version": "1.0.12",
    "minVersion": "1.0.0",
    "releaseNotes": "...",
    "forceUpdate": false,
    "downloadUrl": "https://quickmeet.genuinesoftmart.store/api/updates/download/android",
    "lastUpdated": "2026-02-15T12:33:42.948Z"
  },
  "web": {
    "version": "1.0.37",
    "minVersion": "1.0.0",
    "releaseNotes": "...",
    "forceUpdate": false,
    "lastUpdated": "2026-02-16T05:43:36.788Z"
  }
}
```

### Version Update কিভাবে হয়:

| Platform | কে update করে | কখন |
|---|---|---|
| `web` | CI/CD pipeline + webhook | প্রতি deploy এ |
| `desktop` | CI/CD pipeline | প্রতি push এ |
| `android` | Manually (or CI/CD) | APK build এর পর |

> **`android` version manually update করতে হয়** কারণ Android APK user কে manually install করতে হয়। CI/CD শুধু `web` + `desktop` auto-update করে।

---

*Last updated: February 16, 2026*  
*Security hardening: Zero-Trust / Military-Grade — see SECURITY_HARDENING.md*
