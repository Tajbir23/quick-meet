/**
 * ============================================
 * Quick Meet — Electron Main Process (Native App)
 * ============================================
 * 
 * Full native desktop app — NOT a browser wrapper.
 * 
 * FEATURES:
 * - Custom frameless window with native titlebar overlay
 * - System tray integration with minimize-to-tray
 * - Native file system streaming for P2P large file transfers (50-100GB)
 * - Auto-granted media permissions (camera, mic, screen share)
 * - Single instance lock
 * - Native notifications
 */

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog, session, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── App Configuration ──────────────────────────────────
const APP_URL = 'https://quickmeet.genuinesoftmart.store';
const APP_NAME = 'Quick Meet';

// Handle SSL certificates
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

// Enable WebRTC features
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Active file write streams (for large P2P transfers — 50-100GB)
const activeWriteStreams = new Map();

// ─── Single Instance Lock ────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Window Creation ─────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    title: APP_NAME,
    icon: getIconPath(),
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0f',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
    backgroundColor: '#0a0a0f',
    show: false,
    autoHideMenuBar: true,
  });

  // Remove menu bar completely — not a browser!
  mainWindow.setMenu(null);

  // Load the app
  mainWindow.loadURL(APP_URL);

  // Inject native-app CSS after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS(`
      /* Drag region — top area acts as native titlebar */
      body::before {
        content: '';
        display: block;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 36px;
        -webkit-app-region: drag;
        z-index: 99999;
        pointer-events: none;
      }

      /* Interactive elements must not be draggable */
      header, nav, button, a, input, select, textarea, [role="button"], .no-drag {
        -webkit-app-region: no-drag;
      }

      /* Custom scrollbar for native look */
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }

      /* Prevent text selection on drag areas */
      [style*="app-region: drag"] { user-select: none; }
    `);
  });

  // Show when ready (prevent white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // ─── Permissions ──────────────────────────────────────
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'fullscreen', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ['media', 'mediaKeySystem', 'notifications', 'fullscreen', 'display-capture'];
    return allowed.includes(permission);
  });

  // Accept SSL certificates
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(0);
  });

  // Block popups — open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block navigation away from app
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // ─── Close → Tray ────────────────────────────────────
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray && !global._trayNotified) {
        new Notification({ title: APP_NAME, body: 'Minimized to system tray.' }).show();
        global._trayNotified = true;
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── System Tray ─────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath();
  if (!iconPath || !fs.existsSync(iconPath)) return;

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
  } catch (e) {
    return;
  }

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Show ${APP_NAME}`, click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.isMinimized()) mainWindow.restore();
}

function getIconPath() {
  for (const f of ['icon.ico', 'icon.png']) {
    const p = path.join(__dirname, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ============================================
// IPC — File System Streaming (P2P Large Files)
// ============================================
// Key: chunks are written DIRECTLY to disk via Node.js fs.
// The renderer never accumulates data in memory.
// This enables 50-100GB file transfers without crashes.

/**
 * Show save dialog
 */
ipcMain.handle('file:save-dialog', async (event, { fileName, fileSize }) => {
  if (!mainWindow) return { canceled: true };
  const sizeStr = fileSize > 1073741824
    ? `${(fileSize / 1073741824).toFixed(1)} GB`
    : `${(fileSize / 1048576).toFixed(1)} MB`;

  return dialog.showSaveDialog(mainWindow, {
    defaultPath: fileName,
    title: `Save file (${sizeStr})`,
    filters: [{ name: 'All Files', extensions: ['*'] }],
  });
});

/**
 * Create a write stream — streaming to disk, zero memory accumulation
 */
ipcMain.handle('file:create-stream', async (event, { streamId, filePath }) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const stream = fs.createWriteStream(filePath, { highWaterMark: 1024 * 1024 });
    activeWriteStreams.set(streamId, { stream, filePath, bytesWritten: 0 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Write a chunk directly to disk — the heart of large file support
 */
ipcMain.handle('file:write-chunk', async (event, { streamId, chunk }) => {
  const entry = activeWriteStreams.get(streamId);
  if (!entry) return { success: false, error: 'Stream not found' };

  return new Promise((resolve) => {
    const buffer = Buffer.from(chunk);
    entry.stream.write(buffer, (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        entry.bytesWritten += buffer.length;
        resolve({ success: true, bytesWritten: entry.bytesWritten });
      }
    });
  });
});

/**
 * Close stream — finalize file
 */
ipcMain.handle('file:close-stream', async (event, { streamId }) => {
  const entry = activeWriteStreams.get(streamId);
  if (!entry) return { success: false };

  return new Promise((resolve) => {
    entry.stream.end(() => {
      activeWriteStreams.delete(streamId);
      resolve({ success: true, bytesWritten: entry.bytesWritten, filePath: entry.filePath });
    });
  });
});

/**
 * Abort stream and delete partial file
 */
ipcMain.handle('file:abort-stream', async (event, { streamId }) => {
  const entry = activeWriteStreams.get(streamId);
  if (!entry) return { success: false };

  entry.stream.destroy();
  activeWriteStreams.delete(streamId);
  try { fs.unlinkSync(entry.filePath); } catch (e) {}
  return { success: true };
});

/**
 * Check file size (for resume support)
 */
ipcMain.handle('file:get-size', async (event, { filePath }) => {
  try {
    return { exists: true, size: fs.statSync(filePath).size };
  } catch (e) {
    return { exists: false, size: 0 };
  }
});

// ─── Other IPC ───────────────────────────────────────────

ipcMain.handle('notification:show', async (event, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  isPackaged: app.isPackaged,
  name: APP_NAME,
}));

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  BrowserWindow.getAllWindows().length === 0 ? createWindow() : showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  for (const [, entry] of activeWriteStreams) {
    try { entry.stream.destroy(); } catch (e) {}
  }
  activeWriteStreams.clear();
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
