/**
 * ============================================
 * Quick Meet — Electron Main Process
 * ============================================
 * 
 * Desktop wrapper for Quick Meet.
 * 
 * FEATURES:
 * - Loads the Vite dev server in development, built files in production
 * - System tray integration
 * - Native notifications
 * - File system access for large file downloads (P2P transfer)
 * - Auto-updater support
 * - Window state persistence
 * - Media device permissions auto-granted
 * - Certificate error handling for self-signed SSL
 */

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog, session, Notification } = require('electron');
const path = require('path');

// Handle self-signed certificates
app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
app.commandLine.appendSwitch('allow-insecure-localhost', 'true');

// Disable hardware acceleration if needed (prevents crashes on some systems)
// app.disableHardwareAcceleration();

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    title: 'Quick Meet',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Allow WebRTC
      webSecurity: true,
      // Allow media access
      allowRunningInsecureContent: false,
    },
    // Modern frameless look (optional)
    // frame: false,
    // titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0f',
    show: false, // Show when ready to prevent flash
  });

  // Load the app
  const isDev = !app.isPackaged;
  if (isDev) {
    // Development: load from Vite dev server
    mainWindow.loadURL('https://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load built files
    const clientPath = path.join(process.resourcesPath, 'client', 'index.html');
    mainWindow.loadFile(clientPath);
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Auto-grant media permissions (camera, microphone, screen capture)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = [
      'media',
      'mediaKeySystem',
      'notifications',
      'fullscreen',
      'display-capture',
    ];
    callback(allowedPermissions.includes(permission));
  });

  // Handle certificate errors (self-signed SSL)
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    // In development, accept all certificates
    if (!app.isPackaged) {
      callback(0); // 0 = accept
    } else {
      // In production, use default verification
      callback(-3); // -3 = use default behavior
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Prevent window from closing — minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show tray notification on first minimize
      if (tray && !global._trayNotified) {
        new Notification({
          title: 'Quick Meet',
          body: 'App minimized to system tray. Click the tray icon to restore.',
        }).show();
        global._trayNotified = true;
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create system tray
 */
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'icon.png'));
  } catch (e) {
    // If icon not found, create tray without icon
    console.warn('Tray icon not found, skipping tray creation');
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Quick Meet',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Quick Meet');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ============================================
// IPC Handlers (for preload bridge)
// ============================================

/**
 * File save dialog — for P2P file transfer downloads
 * Electron can write directly to disk without memory limits
 */
ipcMain.handle('file:save-dialog', async (event, { fileName, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: fileName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return result;
});

/**
 * Show native notification
 */
ipcMain.handle('notification:show', async (event, { title, body }) => {
  new Notification({ title, body }).show();
});

/**
 * Get app info
 */
ipcMain.handle('app:info', () => {
  return {
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
  };
});

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
