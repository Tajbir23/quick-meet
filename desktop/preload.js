/**
 * ============================================
 * Electron Preload Script — Native App Bridge
 * ============================================
 * 
 * Exposes safe IPC methods to the web app via contextBridge.
 * 
 * KEY: File streaming APIs for P2P large file transfers (50-100GB).
 * Chunks go directly from WebRTC DataChannel → IPC → Node.js fs → disk.
 * Zero memory accumulation in the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Platform Info ────────────────────────
  platform: process.platform,
  isElectron: true,

  // ─── App Info ─────────────────────────────
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // ─── File Save Dialog ─────────────────────
  showSaveDialog: (options) => ipcRenderer.invoke('file:save-dialog', options),

  // ─── Streaming File Write (P2P Large Files) ──
  // These enable 50-100GB file transfers by writing chunks directly to disk
  createFileStream: (streamId, filePath) =>
    ipcRenderer.invoke('file:create-stream', { streamId, filePath }),

  writeFileChunk: (streamId, chunk) =>
    ipcRenderer.invoke('file:write-chunk', { streamId, chunk }),

  closeFileStream: (streamId) =>
    ipcRenderer.invoke('file:close-stream', { streamId }),

  abortFileStream: (streamId) =>
    ipcRenderer.invoke('file:abort-stream', { streamId }),

  getFileSize: (filePath) =>
    ipcRenderer.invoke('file:get-size', { filePath }),

  // ─── Native Notifications ─────────────────
  showNotification: (data) => ipcRenderer.invoke('notification:show', data),

  // ─── Window Controls (frameless) ──────────
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
});
