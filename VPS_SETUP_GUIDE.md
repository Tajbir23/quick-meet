# 🚀 Quick Meet — VPS Full Setup Guide
> **Domain:** quickmeet.genuinesoftmart.store  
> **VPS IP:** 167.71.235.56  
> **VPS Provider:** DigitalOcean (Ubuntu)  
> **VPS Path:** /var/www/quick-meet/

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
| 🔒 Security logs দেখা | `tail -100 /var/www/quick-meet/server/logs/security/security-$(date +%Y-%m-%d).jsonl` |
| 🔒 Security alerts খোঁজা | `grep -E 'CRITICAL\|ALERT' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 Banned IPs দেখা | `grep 'ip_banned' /var/www/quick-meet/server/logs/security/*.jsonl` |
| 🔒 Failed logins | `grep 'login_failed' /var/www/quick-meet/server/logs/security/*.jsonl` |

---

## 📁 VPS File Structure

```
/var/www/quick-meet/
├── server/
│   ├── .env                    ← ⭐ manually created (Step 7)
│   ├── server.js               ← entry point
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
│   ├── uploads/                ← user uploaded files
│   ├── node_modules/
│   └── package.json
├── client/
│   ├── .env                    ← ⭐ manually created (Step 8)
│   ├── dist/                   ← ⭐ build output (Nginx serves this)
│   ├── node_modules/
│   └── package.json
├── ssl/
│   ├── server.key              ← auto-generated (selfsigned)
│   └── server.cert             ← auto-generated (selfsigned)
├── deploy.sh                   ← auto-deploy script (optional)
├── SECURITY_HARDENING.md       ← 🔒 security documentation
└── .git/

/etc/nginx/sites-available/quickmeet  ← Nginx config
/etc/turnserver.conf                   ← coturn config
/etc/default/coturn                    ← coturn enable flag
/etc/webhook.conf                      ← webhook config (optional)
/etc/systemd/system/webhook.service    ← webhook service (optional)
```

---

## ⚠️ গুরুত্বপূর্ণ নোট

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

### 🔑 Key Rotation Schedule

| Secret | কত দিন পর পর | Rotation এর প্রভাব |
|---|---|---|
| `JWT_SECRET` | প্রতি 90 দিন | সব user force re-login |
| `ENCRYPTION_MASTER_KEY` | শুধু compromised হলে | ⚠️ সব messages re-encrypt লাগবে |
| `LOG_HMAC_SECRET` | প্রতি 90 দিন | পুরনো logs পুরনো key দিয়ে verify হবে |
| Refresh Tokens | Auto-rotated | User দের কিছু করতে হয় না |

---

*Last updated: February 10, 2026*
*Security hardening: Zero-Trust / Military-Grade — see SECURITY_HARDENING.md*
