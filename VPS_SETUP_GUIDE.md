# 🚀 Quick Meet — VPS Full Setup Guide
> **Domain:** quickmeet.genuinesoftmart.store  
> **VPS IP:** 167.71.235.56  
> **VPS Provider:** DigitalOcean (Ubuntu)  
> **VPS Path:** /var/www/quick-meet/  
> **GitHub:** https://github.com/Tajbir23/quick-meet.git

---

## 🏗️ Project Architecture Overview

```
Quick Meet — Self-hosted Real-time Communication Ecosystem
├── Server  (Express 4 + MongoDB + Socket.io 4.8 + HTTPS)
├── Client  (React 18 + Vite 5 + Zustand + Tailwind CSS)
├── Desktop (Electron 28 — Windows/Linux/Mac native app)
└── Mobile  (Capacitor 5.6 — Android/iOS native app)
```

### Core Features
- **Real-time Chat** — 1-to-1 and group messaging with AES-256-GCM encryption
- **Audio/Video Calls** — WebRTC P2P with STUN/TURN support
- **Group Calls** — Multi-participant audio/video conferencing
- **P2P File Transfer** — Direct WebRTC DataChannel large file transfers (50GB+)
- **Desktop App** — Electron with system tray, native notifications, frameless window
- **Mobile App** — Capacitor Android/iOS with push notifications, status bar integration
- **Security** — Military-grade encryption, intrusion detection, rate limiting, brute-force protection
- **Owner Dashboard** — Admin panel for user/system management

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
| 14 | Auto-deploy webhook (optional) | নিচে দেখো | একবারই |
| 15 | Desktop app build (optional) | নিচে দেখো | release এর সময় |
| 16 | Android APK build (optional) | নিচে দেখো | release এর সময় |

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

    # ⛔ File uploads — DISABLED (security hardening)
    # Files এখন authenticated endpoint দিয়ে serve হয়: /api/files/download/:filename
    # Direct static access বন্ধ — unauthorized access প্রতিরোধ
    # location /uploads/ { ... }  ← মুছে দেওয়া হয়েছে

    # Webhook (auto-deploy, optional)
    location /webhook {
        proxy_pass http://127.0.0.1:9000/hooks/deploy;
        proxy_http_version 1.1;
    }

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
git clone https://github.com/YOUR_USERNAME/quick-meet.git
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
```
> ⚠️ **তিনটা command এর output আলাদা আলাদা কোথাও save করো — নিচে paste করতে হবে!**

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
| `SERVER_IP` | `0.0.0.0` | সব interface এ listen করো |

> 🚨 **পুরনো `JWT_EXPIRES_IN=7d` আর নেই!** এখন `ACCESS_TOKEN_EXPIRY` + `REFRESH_TOKEN_EXPIRY_DAYS` দিয়ে handle হয়।

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
pm2 start server.js --name quick-meet
pm2 save
```

### পরে restart:
```bash
pm2 restart quick-meet
```

### Logs দেখা:
```bash
pm2 logs quick-meet --lines 30
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

## 📌 Step 14: Auto-Deploy Webhook (Optional)

### Install:
```bash
apt-get install -y webhook
```

### Deploy script:
```bash
nano /var/www/quick-meet/deploy.sh
```

```bash
#!/bin/bash
cd /var/www/quick-meet
git stash
git pull origin main

# Ensure security logs directory exists
mkdir -p /var/www/quick-meet/server/logs/security

cd server && npm install
cd ../client && npm install && npm run build
pm2 restart quick-meet
echo "Deploy complete: $(date)"
```

```bash
chmod +x /var/www/quick-meet/deploy.sh
```

### Webhook config:
```bash
nano /etc/webhook.conf
```

```json
[
  {
    "id": "deploy",
    "execute-command": "/var/www/quick-meet/deploy.sh",
    "command-working-directory": "/var/www/quick-meet",
    "trigger-rule": {
      "match": {
        "type": "payload-hmac-sha1",
        "secret": "quickmeet-secret-2026",
        "parameter": {
          "source": "header",
          "name": "X-Hub-Signature"
        }
      }
    }
  }
]
```

### Systemd service:
```bash
nano /etc/systemd/system/webhook.service
```

```ini
[Unit]
Description=Webhook Deploy Service
After=network.target

[Service]
ExecStart=/usr/bin/webhook -hooks /etc/webhook.conf -port 9000 -verbose
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable webhook
systemctl start webhook
```

### GitHub Webhook Settings:
- GitHub Repo → Settings → Webhooks → Add webhook
- **Payload URL:** `https://quickmeet.genuinesoftmart.store/webhook`
- **Content type:** `application/json`
- **Secret:** `quickmeet-secret-2026`
- **Events:** Just the push event

---

## 🔄 প্রতিদিনের Deploy Process

### Manual Deploy:
```bash
ssh root@167.71.235.56
cd /var/www/quick-meet && git stash && git pull
mkdir -p server/logs/security
cd client && npm install && npm run build
cd ../server && npm install
pm2 restart quick-meet
pm2 logs quick-meet --lines 20
```

### Auto Deploy (webhook setup থাকলে):
শুধু local PC থেকে:
```bash
git add -A && git commit -m "your message" && git push
```
VPS আপনা আপনি update হবে!

---

## � Step 15: Desktop App Build (Windows/Linux/Mac) — Optional

> **Desktop app VPS তে build করার দরকার নেই — Local PC তে build করো!**

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

**Output:** `desktop/dist/Quick Meet Setup 1.0.0.exe` (NSIS installer, x64 + ia32)

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

---

## 📌 Step 16: Android APK Build — Optional

> **Android Studio ছাড়াই APK build করা যায়!**

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

**Output:** `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (~6 MB)

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
| Server URL | `https://quickmeet.genuinesoftmart.store` |
| Plugins | Camera, Filesystem, Haptics, Keyboard, LocalNotifications, Network, SplashScreen, StatusBar |

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
| `npm run install:all` | Install all deps (server + client + desktop + mobile) |

---

## 🔍 Troubleshooting Commands

| সমস্যা | Command |
|---|---|
| Server logs দেখা | `pm2 logs quick-meet --lines 50` |
| Server restart | `pm2 restart quick-meet` |
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
| MongoDB check | `pm2 logs quick-meet --lines 5 \| grep -i mongo` |
| 🔒 Security logs দেখা | `tail -100 /var/www/quick-meet/server/logs/security/security-$(date +%Y-%m-%d).jsonl` |
| 🔒 Security alerts খোঁজা | `grep -E 'CRITICAL\|ALERT' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 Banned IPs দেখা | `grep 'ip_banned' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 Failed logins | `grep 'login_failed' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 P2P transfer stuck | MongoDB তে: `db.filetransfers.updateMany({status:{$in:['pending','paused']},updatedAt:{$lt:new Date(Date.now()-86400000)}},{$set:{status:'expired'}})` |

---

## 📁 Full Project Structure

### VPS File Structure:
```
/var/www/quick-meet/
├── package.json                ← monorepo root with unified build scripts
├── generate-ssl.js             ← self-signed SSL generator
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
│   │   ├── updateController.js     ← app version check
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
│   │   ├── update.js           ← /api/update/*
│   │   └── user.js             ← /api/users/*
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
│   ├── logs/
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
│   │   ├── App.jsx             ← root component + routing
│   │   ├── main.jsx            ← React entry point
│   │   ├── index.css           ← Tailwind CSS base
│   │   ├── components/
│   │   │   ├── Auth/           ← ProtectedRoute
│   │   │   ├── Call/           ← AudioCall, VideoCall, CallControls, DeviceSelector,
│   │   │   │                     IncomingCall, IncomingGroupCall, MinimizedCall
│   │   │   ├── Chat/           ← ChatList, ChatWindow, MessageBubble, MessageInput
│   │   │   ├── Common/         ← FileUpload, ForwardMessageModal, ImagePreview,
│   │   │   │                     NetworkStatus, Notification, UserAvatar,
│   │   │   │                     UserProfileModal, UserSettings
│   │   │   ├── FileTransfer/   ← 📁 P2PFileSend, IncomingFileTransfer,
│   │   │   │                     FileTransferPanel, FileTransferIndicator
│   │   │   ├── Group/          ← CreateGroup, GroupCall, GroupChat, GroupList
│   │   │   ├── Layout/         ← Header, MainLayout, Sidebar
│   │   │   └── Users/          ← ActiveUsers
│   │   ├── hooks/
│   │   │   ├── useMediaDevices.js    ← camera/mic device enumeration
│   │   │   ├── useSocket.js          ← socket connection hook
│   │   │   └── useSpeakingDetector.js ← audio level detection
│   │   ├── pages/
│   │   │   ├── HomePage.jsx          ← main chat + call interface
│   │   │   ├── LoginPage.jsx         ← user login
│   │   │   ├── SignupPage.jsx        ← user registration
│   │   │   ├── OwnerDashboard.jsx    ← admin dashboard
│   │   │   └── FileTransferPage.jsx  ← 📁 P2P file transfer UI
│   │   ├── services/
│   │   │   ├── api.js                ← axios HTTP client
│   │   │   ├── socket.js            ← socket.io client
│   │   │   ├── webrtc.js            ← WebRTC peer connection
│   │   │   └── p2pFileTransfer.js   ← 📁 P2P DataChannel engine
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
├── deploy.sh                   ← auto-deploy script (optional)
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
│   └── Quick Meet Setup 1.0.0.exe
└── node_modules/
```

### Mobile App Structure (Local PC only — VPS তে নেই):
```
mobile/
├── capacitor.config.json   ← Capacitor config (appId, server URL, plugins)
├── package.json            ← Capacitor dependencies
├── android/                ← Android native project (auto-generated)
│   ├── app/
│   │   ├── build.gradle
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml
│   │   │   └── java/com/quickmeet/app/
│   │   └── build/outputs/apk/
│   │       └── debug/
│   │           └── app-debug.apk  ← ⭐ build output
│   ├── build.gradle
│   ├── gradlew / gradlew.bat
│   ├── variables.gradle    ← SDK versions (compileSdk=34, minSdk=24)
│   └── gradle/
└── node_modules/
```

### System Config Files (VPS):
```
/etc/nginx/sites-available/quickmeet  ← Nginx config
/etc/turnserver.conf                   ← coturn TURN server config
/etc/default/coturn                    ← coturn enable flag
/etc/webhook.conf                      ← webhook config (optional)
/etc/systemd/system/webhook.service    ← webhook service (optional)
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
| **Process** | PM2 | — |
| **Reverse Proxy** | Nginx | — |

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
| `/api/owner/*` | Various | Admin dashboard endpoints |
| `/api/update/check` | GET | App version check |

---

## 🔌 Socket Events Overview

| Event | Direction | কাজ |
|---|---|---|
| `message:send` | Client → Server | Send chat message |
| `message:received` | Server → Client | Receive chat message |
| `typing:start/stop` | Bidirectional | Typing indicator |
| `user:online/offline` | Server → Client | Presence status |
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

## ⚠️ গুরুত্বপূর্ণ নোট

### General নোট

1. **`.env` ফাইল git এ push হয় না** — VPS তে manually তৈরি করতে হয়
2. **Client `.env` change = rebuild লাগবে** — Vite build-time এ inject করে
3. **Server `.env` change = PM2 restart লাগবে** — `pm2 restart quick-meet`
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

### 📱 Desktop/Mobile নোট

16. **Desktop app URL hardcoded** — `desktop/main.js` এ `APP_URL = 'https://quickmeet.genuinesoftmart.store'`
17. **Mobile app URL** — `mobile/capacitor.config.json` এ `server.url` field
18. **Desktop auto-update** — GitHub Releases থেকে auto-update হয় (electron-updater)
19. **Android minSdk 24** — Android 7.0 (Nougat) বা তার উপরে চলবে
20. **APK build এ Android Studio লাগে না** — JDK 17 + Android SDK command-line tools দিয়েই হয়
21. **P2P file transfer** — WebRTC DataChannel দিয়ে direct transfer, server দিয়ে relay হয় না (50GB+ support)

### 🔑 Key Rotation Schedule

| Secret | কত দিন পর পর | Rotation এর প্রভাব |
|---|---|---|
| `JWT_SECRET` | প্রতি 90 দিন | সব user force re-login |
| `ENCRYPTION_MASTER_KEY` | শুধু compromised হলে | ⚠️ সব messages re-encrypt লাগবে |
| `LOG_HMAC_SECRET` | প্রতি 90 দিন | পুরনো logs পুরনো key দিয়ে verify হবে |
| Refresh Tokens | Auto-rotated | User দের কিছু করতে হয় না |
| coturn credentials | প্রতি 90 দিন | Server `.env` + Client `.env` + `/etc/turnserver.conf` তিনটাই update করতে হবে |

---

*Last updated: February 15, 2026*
*Security hardening: Zero-Trust / Military-Grade — see SECURITY_HARDENING.md*
