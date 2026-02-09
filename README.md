# 🚀 Quick Meet — MERN + Pure WebRTC Messaging Ecosystem

A **self-hosted**, **real-time communication platform** built entirely with the MERN stack and **pure WebRTC** — no third-party APIs, no Firebase, no Agora, no Twilio. Everything runs on YOUR server.

---

## ✨ Features

### 💬 Messaging
- **1-to-1 Chat** — Real-time private messaging with typing indicators
- **Group Chat** — Create/join groups, send messages to all members
- **File Sharing** — Upload & download images, documents, audio, video (up to 50MB)
- **Read Receipts** — Know when your messages are read
- **Message Persistence** — All messages stored in MongoDB with pagination

### 📞 Voice & Video Calls
- **1-to-1 Audio Calls** — Direct P2P audio via WebRTC
- **1-to-1 Video Calls** — Face-to-face video calls with camera toggle
- **Group Calls (Mesh)** — Up to 6 participants with full mesh topology
- **Screen Sharing** — Share your screen during any call
- **Call Controls** — Mute/unmute, camera on/off, screen share toggle

### 👥 Presence & Users
- **Online/Offline Status** — Real-time user presence with heartbeat
- **Active Users List** — See who's online right now
- **User Search** — Find users to start conversations

### 🔒 Security
- **HTTPS Mandatory** — Self-signed SSL for secure WebRTC (requires secure context)
- **JWT Authentication** — Token-based auth for HTTP and WebSocket
- **Rate Limiting** — Tiered limits for API, auth, and file uploads
- **File Validation** — MIME type whitelist, UUID filenames, size limits

---

## 🏗️ Architecture

```
┌─────────────────┐         ┌──────────────────┐
│   React Client  │◄──────► │  Express Server   │
│   (Vite + TW)   │  HTTPS  │  (Node.js)       │
│                 │         │                  │
│  Zustand Stores │◄──────► │  Socket.io       │
│  WebRTC Service │  WSS    │  (Signaling)     │
│                 │         │                  │
│  RTCPeerConn    │◄──────► │  MongoDB         │
│  (P2P Media)    │  P2P    │  (Persistence)   │
└─────────────────┘         └──────────────────┘
```

### Why This Architecture?

| Component | Technology | Reason |
|-----------|-----------|--------|
| **Frontend** | React + Vite + Tailwind | Fast dev, modern tooling, utility-first CSS |
| **State** | Zustand | Lightweight, no boilerplate, works outside React |
| **Backend** | Express + HTTPS | WebRTC requires secure context |
| **Real-time** | Socket.io | Signaling only — NOT for media transport |
| **Media** | Pure WebRTC | P2P audio/video/screen, no media server |
| **Database** | MongoDB/Mongoose | Flexible schema, great for chat data |
| **Auth** | JWT + bcrypt | Stateless auth, secure password hashing |

### WebRTC Flow

```
Caller                    Server                    Callee
  │                         │                         │
  ├── call:offer ──────────►│                         │
  │                         ├── call:offer ──────────►│
  │                         │                         │
  │                         │◄── call:answer ─────────┤
  │◄── call:answer ─────────┤                         │
  │                         │                         │
  ├── ice-candidate ───────►│                         │
  │                         ├── ice-candidate ───────►│
  │                         │◄── ice-candidate ───────┤
  │◄── ice-candidate ───────┤                         │
  │                         │                         │
  │◄═══════════ P2P Media Stream (DTLS-SRTP) ═══════►│
```

> **Socket.io handles SIGNALING only** — the actual audio/video flows directly between peers via WebRTC.

### Mesh Topology (Group Calls)

```
For N participants: N*(N-1)/2 peer connections

  User A ◄────► User B
    ▲  \         / ▲
    │   \       /  │
    │    \     /   │
    │     \   /    │
    ▼      ▼ ▼     ▼
  User D ◄────► User C

Max 6 users = 15 connections
```

---

## 📁 Project Structure

```
quick-meet-project/
├── package.json              # Root workspace
├── generate-ssl.js           # SSL certificate generator
├── .env                      # Environment variables
│
├── server/                   # Backend
│   ├── server.js             # Entry point (HTTPS + Express + Socket.io)
│   ├── config/
│   │   ├── db.js             # MongoDB connection
│   │   ├── ssl.js            # SSL cert loader
│   │   └── socket.js         # Socket.io initialization
│   ├── models/
│   │   ├── User.js           # User schema (bcrypt hooks)
│   │   ├── Message.js        # Message schema (1-to-1 + group)
│   │   └── Group.js          # Group schema (members, admin)
│   ├── middleware/
│   │   ├── auth.js           # JWT verification + token generation
│   │   ├── rateLimiter.js    # 3-tier rate limiting
│   │   └── upload.js         # Multer file upload
│   ├── controllers/
│   │   ├── authController.js # Signup, login, logout
│   │   ├── userController.js # User CRUD, search, active list
│   │   ├── messageController.js # Send, fetch, read, unread
│   │   ├── groupController.js   # Group CRUD, join/leave
│   │   └── fileController.js    # Upload, download, delete
│   ├── routes/
│   │   ├── auth.js
│   │   ├── user.js
│   │   ├── message.js
│   │   ├── group.js
│   │   └── file.js
│   ├── socket/
│   │   ├── index.js          # Main socket handler + online users
│   │   ├── presence.js       # Typing, heartbeat, room management
│   │   ├── chat.js           # Message delivery + read receipts
│   │   ├── signaling.js      # 1-to-1 WebRTC signaling
│   │   └── groupCall.js      # Mesh group call signaling
│   ├── utils/
│   │   └── helpers.js
│   └── uploads/              # File storage directory
│
├── client/                   # Frontend
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── src/
│   │   ├── main.jsx          # React root + Router + Toaster
│   │   ├── App.jsx           # Routes + global overlays
│   │   ├── index.css         # Tailwind + custom component styles
│   │   ├── services/
│   │   │   ├── api.js        # Axios instance + JWT interceptor
│   │   │   ├── socket.js     # Socket.io singleton
│   │   │   └── webrtc.js     # WebRTC service (peer connections, streams)
│   │   ├── store/
│   │   │   ├── useAuthStore.js
│   │   │   ├── useChatStore.js
│   │   │   ├── useCallStore.js
│   │   │   └── useGroupStore.js
│   │   ├── hooks/
│   │   │   ├── useSocket.js      # Centralizes all socket event listeners
│   │   │   └── useMediaDevices.js # Device enumeration + selection
│   │   ├── utils/
│   │   │   ├── constants.js  # URLs, ICE servers, constraints, events
│   │   │   └── helpers.js    # Format, initials, colors, sound
│   │   ├── pages/
│   │   │   ├── LoginPage.jsx
│   │   │   ├── SignupPage.jsx
│   │   │   └── HomePage.jsx
│   │   └── components/
│   │       ├── Auth/
│   │       │   └── ProtectedRoute.jsx
│   │       ├── Layout/
│   │       │   ├── Sidebar.jsx
│   │       │   ├── Header.jsx
│   │       │   └── MainLayout.jsx
│   │       ├── Chat/
│   │       │   ├── ChatList.jsx
│   │       │   ├── ChatWindow.jsx
│   │       │   ├── MessageBubble.jsx
│   │       │   └── MessageInput.jsx
│   │       ├── Call/
│   │       │   ├── IncomingCall.jsx
│   │       │   ├── VideoCall.jsx
│   │       │   ├── AudioCall.jsx
│   │       │   └── CallControls.jsx
│   │       ├── Group/
│   │       │   ├── GroupList.jsx
│   │       │   ├── GroupChat.jsx
│   │       │   ├── CreateGroup.jsx
│   │       │   └── GroupCall.jsx
│   │       ├── Users/
│   │       │   └── ActiveUsers.jsx
│   │       └── Common/
│   │           ├── UserAvatar.jsx
│   │           ├── FileUpload.jsx
│   │           ├── NetworkStatus.jsx
│   │           └── Notification.jsx
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **MongoDB** 6+ (local or Atlas)
- **OpenSSL** (for SSL certificate generation)
- Modern browser with WebRTC support (Chrome, Firefox, Edge, Safari 15+)

### 1. Clone & Install

```bash
# Clone the repository
cd "quick meet project"

# Install all dependencies (root + server + client)
npm run install:all
```

### 2. Environment Setup

Edit the `.env` file in the project root:

```env
# MongoDB
MONGO_URI=mongodb://127.0.0.1:27017/quickmeet

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this

# Server
PORT=5000
NODE_ENV=development

# SSL (paths to your certificates)
SSL_KEY_PATH=./ssl/key.pem
SSL_CERT_PATH=./ssl/cert.pem
```

### 3. Generate SSL Certificates

WebRTC **requires** a secure context (HTTPS). Generate self-signed certificates:

```bash
node generate-ssl.js
```

This creates `ssl/key.pem` and `ssl/cert.pem` using OpenSSL.

> ⚠️ **First-time browser access**: You'll need to accept the self-signed certificate warning. Navigate to `https://localhost:5000` and click "Advanced → Proceed" to trust it.

### 4. Start MongoDB

```bash
# If using local MongoDB
mongod

# Or use MongoDB Atlas connection string in .env
```

### 5. Run the Application

```bash
# Development mode (both server & client with hot reload)
npm run dev

# Or run separately:
npm run server    # Backend on https://localhost:5000
npm run client    # Frontend on http://localhost:3000
```

### 6. Access the App

- **Frontend**: `http://localhost:3000` (Vite dev server, proxies API to backend)
- **Backend API**: `https://localhost:5000/api`
- **For LAN access**: Replace `localhost` with your machine's IP address

---

## 🌐 LAN / IP-Based Access

To use Quick Meet across your local network:

1. **Find your IP**: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. **Update `.env`**: No changes needed — the server binds to `0.0.0.0`
3. **Update client**: Edit `client/src/utils/constants.js`:
   ```js
   export const SERVER_URL = 'https://YOUR_IP:5000';
   ```
   Or set `VITE_SERVER_URL=https://YOUR_IP:5000` in client environment
4. **Trust the certificate**: On each device, navigate to `https://YOUR_IP:5000` and accept the self-signed cert
5. **Open the app**: Navigate to `http://YOUR_IP:3000`

---

## 🔑 API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register new user |
| POST | `/api/auth/login` | Login, get JWT |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Get current user |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | Get all users |
| GET | `/api/users/active` | Get online users |
| GET | `/api/users/search?q=` | Search users |
| GET | `/api/users/:id` | Get user by ID |
| PUT | `/api/users/profile` | Update profile |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/messages` | Send 1-to-1 message |
| POST | `/api/messages/group` | Send group message |
| GET | `/api/messages/:userId` | Get conversation |
| GET | `/api/messages/group/:groupId` | Get group messages |
| PUT | `/api/messages/read/:userId` | Mark as read |
| GET | `/api/messages/unread/count` | Get unread counts |

### Groups
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/groups` | Create group |
| GET | `/api/groups` | Get my groups |
| GET | `/api/groups/all` | Get all groups |
| GET | `/api/groups/:id` | Get group by ID |
| POST | `/api/groups/:id/join` | Join group |
| POST | `/api/groups/:id/leave` | Leave group |
| POST | `/api/groups/:id/add-member` | Add member (admin) |

### Files
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files/upload` | Upload single file |
| POST | `/api/files/upload-multiple` | Upload multiple files |
| GET | `/api/files/download/:filename` | Download file |
| DELETE | `/api/files/:filename` | Delete file |

---

## 🔌 Socket Events

### Presence
| Event | Direction | Description |
|-------|-----------|-------------|
| `user:online` | Server → Client | User came online |
| `user:offline` | Server → Client | User went offline |
| `users:online-list` | Server → Client | Full online users list |

### Typing
| Event | Direction | Description |
|-------|-----------|-------------|
| `typing:start` | Client → Server | Start typing indicator |
| `typing:stop` | Client → Server | Stop typing indicator |

### Chat
| Event | Direction | Description |
|-------|-----------|-------------|
| `message:send` | Client → Server | Send 1-to-1 message |
| `message:receive` | Server → Client | Receive message |
| `message:group:send` | Client → Server | Send group message |
| `message:group:receive` | Server → Client | Receive group message |

### 1-to-1 Calls
| Event | Direction | Description |
|-------|-----------|-------------|
| `call:offer` | Bidirectional | WebRTC offer (SDP) |
| `call:answer` | Bidirectional | WebRTC answer (SDP) |
| `call:ice-candidate` | Bidirectional | ICE candidate exchange |
| `call:reject` | Client → Server | Reject incoming call |
| `call:end` | Bidirectional | End the call |

### Group Calls
| Event | Direction | Description |
|-------|-----------|-------------|
| `group-call:join` | Client → Server | Join group call room |
| `group-call:leave` | Client → Server | Leave group call |
| `group-call:offer` | Bidirectional | Peer offer in mesh |
| `group-call:answer` | Bidirectional | Peer answer in mesh |
| `group-call:ice-candidate` | Bidirectional | ICE for mesh peers |
| `group-call:existing-peers` | Server → Client | Peers already in call |
| `group-call:peer-joined` | Server → Client | New peer joined |
| `group-call:peer-left` | Server → Client | Peer left call |

---

## 🛡️ Security Considerations

1. **Change `JWT_SECRET`** in production — use a long random string
2. **Use proper SSL certificates** (Let's Encrypt) for production deployments
3. **Rate limiting** is configured but tune values for your needs
4. **File uploads** are whitelisted by MIME type — review allowed types in `server/middleware/upload.js`
5. **CORS** is configured for development — restrict origins in production
6. **MongoDB** — enable auth and use a strong password in production
7. **No TURN server** included — connections between symmetric NATs will fail. Add a TURN server (coturn) for production

---

## ⚠️ Known Limitations

| Limitation | Reason | Workaround |
|-----------|--------|------------|
| Max 6 in group call | Mesh topology: N*(N-1)/2 connections | Use SFU (mediasoup) for larger calls |
| Symmetric NAT fails | STUN-only, no TURN relay | Deploy coturn TURN server |
| Self-signed SSL warnings | Development certificates | Use Let's Encrypt for production |
| No message encryption (E2E) | Messages stored in plaintext | Implement Signal Protocol |
| No push notifications | Requires service worker + VAPID | Add web-push package |

---

## 🧰 Tech Stack Summary

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 18+ |
| Framework | Express.js | 4.x |
| Database | MongoDB + Mongoose | 6+ / 8.x |
| Real-time | Socket.io | 4.8.x |
| Frontend | React | 18.x |
| Bundler | Vite | 5.x |
| Styling | Tailwind CSS | 3.x |
| State | Zustand | 5.x |
| Media | WebRTC (native) | — |
| Auth | JWT + bcrypt | — |
| File Upload | Multer | — |
| HTTP Client | Axios | — |
| Icons | Lucide React | — |
| Toasts | React Hot Toast | — |

---

## 📄 License

MIT — Use it, modify it, deploy it. Just don't blame us if your self-signed certs scare your users. 😄

---

Built with ❤️ using pure WebRTC — no media servers, no third-party APIs, just browsers talking to each other.
