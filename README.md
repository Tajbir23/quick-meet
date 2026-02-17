# 🚀 Quick Meet — Self-Hosted Real-Time Communication Platform

A **self-hosted**, **cross-platform** messaging & calling app built with MERN + **pure WebRTC** — no Firebase, no Agora, no Twilio. Everything runs on YOUR server.

**Web** · **Windows Desktop** · **Android** · One codebase, fully self-managed.

---

## ✨ Features

### 💬 Messaging
- **1-to-1 Chat** — Real-time private messaging with typing indicators
- **Group Chat** — Create/join groups (up to 20 members), send messages to all
- **File Sharing** — Upload images, documents, audio, video (scanned & validated)
- **Message Forwarding** — Forward messages to any user or group
- **Read Receipts** — Know when your messages are read
- **AES-256-GCM Encryption** — Messages encrypted at rest in the database
- **XSS Sanitization** — All message content sanitized before storage
- **Message Deletion** — Delete your own messages

### 📞 Voice & Video Calls
- **1-to-1 Audio/Video** — Direct P2P via WebRTC
- **Group Calls (Mesh)** — Up to 6 participants with full mesh topology
- **Screen Sharing** — Works on Web, Windows Desktop, and Android
  - Browser: native `getDisplayMedia()`
  - Electron: `desktopCapturer` + `setDisplayMediaRequestHandler`
  - Android: MediaProjection → WebSocket binary streaming → Canvas → WebRTC
- **Call Controls** — Mute/unmute, camera toggle, screen share, device selector
- **Call Reconnection** — Automatic reconnect on network disruption
- **Speaker Detection** — Visual indicator for active speaker
- **Minimized Call** — Continue chatting with a floating minimized call window
- **SDP Sanitization** — WebRTC offers/answers validated and sanitized

### 📁 P2P File Transfer
- **Direct Device-to-Device** — Files never touch the server
- **WebRTC DataChannel** — 64KB chunked streaming
- **Supports 100GB+** — Native file system streaming (Electron), File System Access API (Browser), Capacitor Filesystem (Android)
- **Resume Support** — Pause/resume interrupted transfers
- **SHA-256 Verification** — File integrity validated after transfer
- **Accept/Reject UI** — Recipients choose before receiving

### 👥 Presence & Users
- **Online/Offline Status** — Real-time with heartbeat
- **Active Users List** — See who's online
- **User Search** — Find users by name or email
- **User Profiles** — Avatar, privacy settings, security settings
- **User Settings** — Configure privacy (hide email/profile) and security options

### 🔒 Security (7 Modules — Zero-Trust Architecture)
- **CryptoService** — AES-256-GCM encryption, HMAC-SHA256 signing, ECDH key exchange, HKDF key derivation
- **SecurityEventLogger** — Tamper-proof audit trail with HMAC-signed, chain-hashed log entries (JSONL, daily rotation)
- **IntrusionDetector** — Brute-force detection, credential stuffing defense, IP auto-ban, progressive account lockout, threat scoring
- **SocketGuard** — Per-event JWT re-validation, anti-replay nonces, per-socket rate limiting, auto-disconnect after violations
- **CallTokenService** — One-time call tokens (60s TTL), caller↔callee binding, mutual verification
- **SDPSanitizer** — SDP structure validation, DTLS fingerprint verification, ICE candidate sanitization
- **FileScanner** — Magic byte validation, MIME mismatch detection, SVG XSS scanning, ZIP bomb detection, path traversal prevention

### 🛡️ Owner Dashboard
- **Overview** — System status, quick stats (users, files, active connections, IDS status)
- **Security Alerts** — Real-time alerts for hacking attempts, brute-force, credential stuffing
- **User Management** — View all users, block/unblock with reason
- **File Management** — View/delete any file, download-all as ZIP, upload ZIP
- **Security Logs** — Full log viewer with date picker, severity/category filters, search, pagination
- **Visibility Toggle** — Show/hide owner badge to other users

### 🔄 Auto-Update System
- **Desktop** — `electron-updater` checks GitHub Releases every 4 hours, downloads & prompts restart
- **Android** — In-app update check via `/api/updates/check`, native APK installer
- **Web** — Auto-deployed via GitHub webhook, reload picks up new build
- **Version API** — `GET /api/updates/check?platform=X&version=Y` returns update info

### 📱 Self-Hosted Push Notifications
- **No Firebase** — Server-side in-memory notification queue
- **Android Polling** — Native foreground service polls every 5 seconds
- **Action Buttons** — Answer/Decline calls, Accept/Reject transfers directly from notification
- **4 Channels** — Background, Calls, Transfers, Messages

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Quick Meet Platform                       │
├──────────────┬──────────────┬──────────────┬────────────────────┤
│  Web Client  │   Desktop    │   Android    │   Server (VPS)     │
│  React+Vite  │   Electron   │  Capacitor   │   Express+MongoDB  │
│  Tailwind    │   Auto-Update│  Foreground  │   Socket.io        │
│  Zustand     │   Tray Icon  │  Service     │   7 Security Mods  │
│              │   Native FS  │  Push Notif  │   Auto-Deploy      │
├──────────────┴──────┬───────┴──────┬───────┴────────────────────┤
│     HTTPS REST API  │  WSS Signaling  │  WebRTC P2P             │
│     (Auth, CRUD)    │  (Socket.io)    │  (Audio/Video/Files)    │
└─────────────────────┴────────────────┴──────────────────────────┘
```

### WebRTC Signaling Flow

```
Caller                    Server                    Callee
  │                         │                         │
  ├── call:request-token ──►│                         │
  │◄── token ───────────────┤                         │
  ├── call:offer ──────────►│── SDP sanitized ───────►│
  │                         │◄── call:answer ─────────┤
  │◄── call:answer ─────────┤                         │
  │◄══════════ ICE candidates (bidirectional) ═══════►│
  │                         │                         │
  │◄═══════════ P2P Media Stream (DTLS-SRTP) ═══════►│
```

### Mesh Topology (Group Calls)

```
For N participants: N×(N-1)/2 peer connections

  User A ◄────► User B
    ▲  \         / ▲
    │   \       /  │
    │    \     /   │
    │     \   /    │
    ▼      ▼ ▼     ▼
  User D ◄────► User C

Max 6 users = 15 connections
```

### Android Screen Share Architecture

```
MediaProjection → VirtualDisplay → ImageReader
       ↓
   Bitmap → JPEG (30% quality, 480p, 50fps)
       ↓
   ScreenShareServer (local WebSocket, binary frames)
       ↓
   WebView JS → createImageBitmap() (off-thread decode)
       ↓
   Canvas → captureStream(0) → requestFrame() → WebRTC
```

---

## 📁 Project Structure

```
quick-meet/
├── .github/workflows/build-apps.yml   # CI/CD: version bump → build → release → deploy
├── package.json                        # Root workspace (v1.0.x)
├── generate-ssl.js                     # SSL certificate generator
├── deploy.sh                           # VPS auto-deploy script
│
├── client/                             # React SPA
│   └── src/
│       ├── pages/                      # Login, Signup, Home, OwnerDashboard, FileTransfer
│       ├── components/                 # 42 components (Auth, Call, Chat, Common, FileTransfer, Group, Layout, Users)
│       ├── services/                   # api.js, socket.js, webrtc.js, p2pFileTransfer.js, backgroundService.js
│       ├── store/                      # 6 Zustand stores (Auth, Call, Chat, Group, FileTransfer, Owner)
│       ├── hooks/                      # useSocket, useMediaDevices, useSpeakingDetector
│       └── utils/                      # constants, helpers
│
├── server/                             # Express + MongoDB + Socket.io
│   ├── server.js                       # HTTPS entry point
│   ├── config/                         # db.js, socket.js, ssl.js
│   ├── models/                         # User, Message, Group, FileTransfer
│   ├── controllers/                    # 9 controllers (auth, user, message, group, file, fileTransfer, owner, update, push)
│   ├── routes/                         # 10 route files + webhook
│   ├── middleware/                     # auth (JWT), ownerAuth, rateLimiter, upload
│   ├── security/                       # 7 modules (Crypto, Logger, IDS, SocketGuard, CallToken, SDP, FileScanner)
│   ├── socket/                         # 5 handlers (presence, chat, signaling, groupCall, fileTransfer)
│   ├── updates/                        # versions.json + build artifacts
│   └── uploads/                        # User-uploaded files
│
├── desktop/                            # Electron app
│   ├── main.js                         # Frameless window, tray, auto-updater, screen share, native FS
│   └── preload.js                      # IPC bridge (file streaming, notifications)
│
├── mobile/                             # Capacitor + Android
│   ├── capacitor.config.json
│   └── android/app/src/main/java/com/quickmeet/app/
│       ├── MainActivity.java           # Plugin registration
│       ├── BackgroundService.java      # Push notification polling
│       ├── ScreenCaptureService.java   # MediaProjection → JPEG → WebSocket
│       ├── ScreenShareServer.java      # Local binary WebSocket server
│       ├── ScreenCapturePlugin.java    # Capacitor bridge
│       ├── ApkInstallerPlugin.java     # Native APK install
│       ├── NotificationActionReceiver.java  # Notification action handling
│       └── BootReceiver.java           # Auto-start on boot
│
├── scripts/bump-version.js             # Version management
└── ssl/                                # SSL certificates
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+ (LTS)
- **MongoDB** 6+
- **OpenSSL** (for SSL certificate generation)
- Modern browser with WebRTC support

### 1. Clone & Install

```bash
git clone https://github.com/Tajbir23/quick-meet.git
cd quick-meet

# Install all dependencies (root + server + client)
npm run install:all
```

### 2. Environment Setup

Create a `.env` file in the project root:

```env
# MongoDB
MONGO_URI=mongodb://127.0.0.1:27017/quickmeet

# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this

# Server
PORT=5000
NODE_ENV=development

# Security (generate random 64-char hex strings)
ENCRYPTION_MASTER_KEY=your-256-bit-hex-key
LOG_HMAC_SECRET=your-log-signing-secret

# SSL
SSL_KEY_PATH=./ssl/key.pem
SSL_CERT_PATH=./ssl/cert.pem

# Webhook (for auto-deploy)
WEBHOOK_SECRET=your-github-webhook-secret
```

### 3. Generate SSL Certificates

```bash
node generate-ssl.js
```

> ⚠️ **First-time browser access**: Accept the self-signed certificate warning at `https://localhost:5000`.

### 4. Run the Application

```bash
# Development mode (both server & client with hot reload)
npm run dev

# Or run separately:
npm run server    # Backend on https://localhost:5000
npm run client    # Frontend on http://localhost:3000
```

---

## 🔑 API Endpoints (59+ routes)

### Authentication — `/api/auth`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/signup` | Register (rate-limited) |
| POST | `/login` | Login, get JWT + refresh token |
| POST | `/refresh` | Refresh access token |
| POST | `/logout` | Logout |
| GET | `/me` | Get current user |
| POST | `/revoke-all-sessions` | Kill all sessions |
| GET | `/security-status` | Security info |

### Users — `/api/users`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | All users |
| GET | `/active` | Online users |
| GET | `/search?q=` | Search users |
| PUT | `/profile` | Update profile |
| PUT | `/security` | Update security settings |
| PUT | `/privacy` | Update privacy settings |

### Messages — `/api/messages`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Send 1-to-1 message (encrypted) |
| POST | `/group` | Send group message |
| GET | `/:userId` | Get conversation (decrypted) |
| GET | `/group/:groupId` | Get group messages |
| PUT | `/read/:userId` | Mark as read |
| GET | `/unread/count` | Unread counts |
| DELETE | `/:messageId` | Delete message |

### Groups — `/api/groups`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create group |
| GET | `/` | My groups |
| GET | `/all` | All groups |
| POST | `/:id/join` | Join group |
| POST | `/:id/leave` | Leave group |
| POST | `/:id/add-member` | Add member |

### Files — `/api/files`
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload (scanned & validated) |
| POST | `/upload-multiple` | Upload multiple |
| GET | `/download/:filename` | Download (token auth) |
| GET | `/access-token/:filename` | Time-limited access token |
| DELETE | `/:filename` | Delete file |

### P2P Transfers — `/api/transfers`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/turn-credentials` | TURN server credentials |
| GET | `/active` | Active transfers |
| GET | `/history/:userId` | Transfer history |

### Updates — `/api/updates`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/check` | Check for update |
| GET | `/versions` | All version info |
| GET | `/download/:platform` | Download build |
| POST | `/bump` | Bump version (owner) |

### Owner — `/api/owner` (15 endpoints)
Security logs, alerts, user block/unblock, file management, system status, ZIP upload/download.

### Push — `/api/push`
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/pending` | Poll pending notifications |
| GET | `/health` | Push system health |

### Webhook — `/webhook`
GitHub webhook endpoint (HMAC-SHA256 verified) for auto-deploy on push.

---

## 🔌 Socket Events

### Presence
`typing:start` · `typing:stop` · `typing:group:start` · `typing:group:stop` · `heartbeat` · `user:online` · `user:offline` · `users:online-list`

### Chat
`message:send` · `message:receive` · `message:group:send` · `message:group:receive` · `message:read` · `message:read:ack`

### 1-to-1 Calls
`call:request-token` · `call:offer` · `call:answer` · `call:ice-candidate` · `call:reject` · `call:end` · `call:toggle-media` · `call:screen-share` · `call:reconnect-offer` · `call:reconnect-answer`

### Group Calls
`group-call:join` · `group-call:leave` · `group-call:offer` · `group-call:answer` · `group-call:ice-candidate` · `group-call:toggle-media` · `group-call:screen-share` · `group-call:existing-peers` · `group-call:peer-joined` · `group-call:peer-left`

### File Transfer
`file-transfer:request` · `file-transfer:accept` · `file-transfer:reject` · `file-transfer:cancel` · `file-transfer:progress` · `file-transfer:complete` · `file-transfer:resume` · `file-transfer:pause` · `ft:offer` · `ft:answer` · `ft:ice-candidate`

---

## 🔧 CI/CD Pipeline

```
Push to main
    │
    ▼
  Auto-bump patch version (all 5 package.json + versions.json)
    │
    ├──► Build Android APK (signed)
    │
    ├──► Build Windows Installer (NSIS, x64)
    │
    ▼
  Create GitHub Release (tag: v{version})
    │     ├── quick-meet-v{version}-release.apk
    │     └── quick-meet-v{version}-setup.exe
    ▼
  Deploy to VPS via SSH
    ├── git pull
    ├── npm install + build
    ├── Download APK from release
    └── pm2 restart quickmeet
```

---

## 🧰 Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 20+ |
| **Framework** | Express.js | 4.21 |
| **Database** | MongoDB + Mongoose | 6+ / 8.7 |
| **Real-time** | Socket.io | 4.8 |
| **Frontend** | React | 18.3 |
| **Bundler** | Vite | 5.4 |
| **Styling** | Tailwind CSS | 3.4 |
| **State** | Zustand | 5.0 |
| **Media** | Pure WebRTC | — |
| **Auth** | JWT + bcryptjs | 9.0 / 2.4 |
| **Encryption** | AES-256-GCM (Node crypto) | — |
| **Desktop** | Electron | 28.1 |
| **Mobile** | Capacitor (Android) | 5.6 |
| **CI/CD** | GitHub Actions | — |
| **Deploy** | PM2 + Nginx | — |

---

## ⚠️ Known Limitations

| Limitation | Reason | Workaround |
|-----------|--------|------------|
| Max 6 in group call | Mesh topology: N×(N-1)/2 connections | Use SFU (mediasoup) for larger calls |
| Symmetric NAT fails | STUN-only by default | Deploy coturn TURN server |
| Android screen share quality | JPEG encoding at 480p/30% quality | Trade-off for 50fps real-time streaming |
| No E2E encryption (yet) | Messages encrypted at rest, not in transit between peers | Implement Signal Protocol |
| iOS not supported | Capacitor Android only | Add `@capacitor/ios` + Swift implementation |

---

## 📄 License

MIT — Use it, modify it, deploy it.

---

Built with ❤️ — pure WebRTC, zero third-party APIs, fully self-hosted.
