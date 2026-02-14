/**
 * ============================================
 * Electron Preload Script
 * ============================================
 * 
 * Bridge between the renderer (web app) and Node.js.
 * Exposes safe IPC methods to the web app via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform info
  platform: process.platform,
  isElectron: true,

  // App info
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // File operations for P2P transfer
  showSaveDialog: (options) => ipcRenderer.invoke('file:save-dialog', options),

  // Native notifications
  showNotification: (data) => ipcRenderer.invoke('notification:show', data),

  // Window controls (if using frameless)
  // minimize: () => ipcRenderer.send('window:minimize'),
  // maximize: () => ipcRenderer.send('window:maximize'),
  // close: () => ipcRenderer.send('window:close'),
});
