# Quick Meet — Electron Desktop App Setup

## Prerequisites
- Node.js 18+
- npm or yarn
- Windows/macOS/Linux

## Quick Start (Development)

```bash
# 1. Install client dependencies
cd client
npm install

# 2. Install desktop dependencies
cd ../desktop
npm install

# 3. Start in development mode (launches Vite + Electron)
npm run dev
```

This will:
- Start the Vite dev server at `https://localhost:3000`
- Wait for it to be ready
- Launch Electron pointing to the dev server

## Build for Production

### Build the web app first:
```bash
cd client
npm run build
```

### Build the Electron app:
```bash
cd desktop

# Windows installer (.exe)
npm run build:win

# Linux (AppImage + .deb)
npm run build:linux

# macOS (.dmg)
npm run build:mac
```

The built app will be in `desktop/dist/`.

## Features in Desktop Mode
- **System tray**: App minimizes to tray instead of closing
- **Native notifications**: OS-level notifications for messages and calls
- **Auto-grant permissions**: Camera/microphone permissions auto-accepted
- **File save dialog**: Native OS file picker for P2P received files
- **Single instance**: Only one app window allowed
- **Self-signed SSL**: Certificate errors automatically handled

## P2P File Transfer on Desktop
The Electron version has full support for large file transfers (50-100GB):
- Files are streamed chunk-by-chunk via WebRTC DataChannel
- Backpressure management prevents memory overflow
- Resume capability if connection drops
- Native save dialog for received files

## Adding an App Icon
Place your icon files in the `desktop/` folder:
- `icon.png` — 512x512 PNG (Linux, tray)
- `icon.ico` — Windows icon
- `icon.icns` — macOS icon

## Environment Variables
Create a `.env` file in `client/` to configure the server URL:
```
VITE_SERVER_URL=https://your-server:5000
```
