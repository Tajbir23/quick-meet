/**
 * ============================================
 * Owner Store (Zustand) — Admin Dashboard State
 * ============================================
 * 
 * Manages all owner-only features:
 * - Security logs viewing
 * - User management (block/unblock)
 * - File management (list/delete/download)
 * - Security alerts / hacking attempts
 * - System status
 * - Owner mode toggle
 */

import { create } from 'zustand';
import api from '../services/api';
import { API_URL } from '../utils/constants';

const useOwnerStore = create((set, get) => ({
  // ─── State ────────────────────────────────────────
  
  // Security Logs
  logFiles: [],
  logEntries: [],
  logTotal: 0,
  logsLoading: false,

  // Security Alerts
  alerts: [],
  alertsTotal: 0,
  alertsLoading: false,

  // Users
  allUsers: [],
  usersLoading: false,

  // Files
  allFiles: [],
  filesTotal: 0,
  filesLoading: false,

  // System Status
  systemStatus: null,
  statusLoading: false,

  // Owner mode
  ownerModeVisible: false,

  // General
  error: null,

  // ─── Security Logs ────────────────────────────────

  fetchLogFiles: async () => {
    set({ logsLoading: true, error: null });
    try {
      const res = await api.get('/owner/logs');
      set({ logFiles: res.data.data.files, logsLoading: false });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch log files', logsLoading: false });
    }
  },

  fetchLogsByDate: async (date, options = {}) => {
    set({ logsLoading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', options.limit);
      if (options.offset) params.set('offset', options.offset);
      if (options.severity) params.set('severity', options.severity);
      if (options.category) params.set('category', options.category);
      if (options.search) params.set('search', options.search);

      const res = await api.get(`/owner/logs/${date}?${params.toString()}`);
      set({
        logEntries: res.data.data.entries,
        logTotal: res.data.data.total,
        logsLoading: false,
      });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch logs', logsLoading: false });
    }
  },

  fetchRecentLogs: async (options = {}) => {
    set({ logsLoading: true, error: null });
    try {
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', options.limit);
      if (options.severity) params.set('severity', options.severity);
      if (options.category) params.set('category', options.category);
      if (options.search) params.set('search', options.search);

      const res = await api.get(`/owner/logs/recent?${params.toString()}`);
      set({
        logEntries: res.data.data.entries,
        logTotal: res.data.data.total,
        logsLoading: false,
      });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch recent logs', logsLoading: false });
    }
  },

  downloadLogFile: async (filename) => {
    try {
      const token = localStorage.getItem('accessToken');
      // Open download in new window with auth
      const link = document.createElement('a');
      link.href = `${API_URL}/owner/logs/download/${filename}`;
      // Use fetch to download with auth header
      const res = await fetch(`${API_URL}/owner/logs/download/${filename}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      set({ error: 'Failed to download log file' });
    }
  },

  // ─── Security Alerts ─────────────────────────────

  fetchAlerts: async (days = 7) => {
    set({ alertsLoading: true, error: null });
    try {
      const res = await api.get(`/owner/security/alerts?days=${days}`);
      set({
        alerts: res.data.data.alerts,
        alertsTotal: res.data.data.total,
        alertsLoading: false,
      });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch alerts', alertsLoading: false });
    }
  },

  // ─── System Status ───────────────────────────────

  fetchSystemStatus: async () => {
    set({ statusLoading: true, error: null });
    try {
      const res = await api.get('/owner/security/status');
      set({ systemStatus: res.data.data, statusLoading: false });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch status', statusLoading: false });
    }
  },

  // ─── User Management ─────────────────────────────

  fetchAllUsers: async () => {
    set({ usersLoading: true, error: null });
    try {
      const res = await api.get('/owner/users');
      set({ allUsers: res.data.data.users, usersLoading: false });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch users', usersLoading: false });
    }
  },

  blockUser: async (userId, reason) => {
    try {
      const res = await api.post(`/owner/users/${userId}/block`, { reason });
      // Update local state
      set(state => ({
        allUsers: state.allUsers.map(u =>
          u._id === userId ? { ...u, isBlocked: true, blockedAt: new Date(), blockedReason: reason } : u
        ),
      }));
      return { success: true, message: res.data.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Failed to block user' };
    }
  },

  unblockUser: async (userId) => {
    try {
      const res = await api.post(`/owner/users/${userId}/unblock`);
      set(state => ({
        allUsers: state.allUsers.map(u =>
          u._id === userId ? { ...u, isBlocked: false, blockedAt: null, blockedReason: null } : u
        ),
      }));
      return { success: true, message: res.data.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Failed to unblock user' };
    }
  },

  // ─── File Management ──────────────────────────────

  fetchAllFiles: async () => {
    set({ filesLoading: true, error: null });
    try {
      const res = await api.get('/owner/files');
      set({
        allFiles: res.data.data.files,
        filesTotal: res.data.data.total,
        filesLoading: false,
      });
    } catch (error) {
      set({ error: error.response?.data?.message || 'Failed to fetch files', filesLoading: false });
    }
  },

  deleteFile: async (filename) => {
    try {
      await api.delete(`/owner/files/${filename}`);
      set(state => ({
        allFiles: state.allFiles.filter(f => f.storedName !== filename),
        filesTotal: state.filesTotal - 1,
      }));
      return { success: true };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Failed to delete file' };
    }
  },

  downloadFile: async (filename, originalName) => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/owner/files/download/${filename}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = originalName || filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      set({ error: 'Failed to download file' });
    }
  },

  downloadAllFilesZip: async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/owner/files/download-all`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Download failed' }));
        return { success: false, message: err.message };
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'backup-files.zip';
      link.click();
      URL.revokeObjectURL(url);
      return { success: true };
    } catch (error) {
      return { success: false, message: 'Failed to download ZIP' };
    }
  },

  uploadZipFile: async (file) => {
    try {
      const token = localStorage.getItem('accessToken');
      const formData = new FormData();
      formData.append('zipFile', file);
      const res = await fetch(`${API_URL}/owner/files/upload-zip`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.message || 'Upload failed' };
      }
      return { success: true, data: data.data, message: data.message };
    } catch (error) {
      return { success: false, message: 'Failed to upload ZIP' };
    }
  },

  // ─── Owner Mode Toggle ───────────────────────────

  toggleOwnerVisibility: async () => {
    try {
      const res = await api.post('/owner/toggle-visibility');
      set({ ownerModeVisible: res.data.data.ownerModeVisible });
      return { success: true, visible: res.data.data.ownerModeVisible };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || 'Failed to toggle visibility' };
    }
  },

  setOwnerModeVisible: (visible) => set({ ownerModeVisible: visible }),

  // ─── Utils ────────────────────────────────────────
  clearError: () => set({ error: null }),
}));

export default useOwnerStore;
