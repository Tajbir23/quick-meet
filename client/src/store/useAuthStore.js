/**
 * ============================================
 * Auth Store (Zustand) — HARDENED
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - Dual-token support (accessToken + refreshToken)
 * - Device fingerprint binding
 * - Backward-compatible with legacy 'token' key
 * - Security event handling from server (force logout, session revoked)
 * - Token expiry awareness
 */

import { create } from 'zustand';
import api from '../services/api';
import { getDeviceFingerprint } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';

const useAuthStore = create((set, get) => ({
  // State
  user: null,
  accessToken: localStorage.getItem('accessToken') || localStorage.getItem('token') || null,
  refreshToken: localStorage.getItem('refreshToken') || null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  tokenExpiresAt: null,
  isOwner: false,

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Check if user is authenticated (on app load)
   * Supports both new dual-token and legacy single-token format
   */
  checkAuth: async () => {
    const accessToken = localStorage.getItem('accessToken') || localStorage.getItem('token');

    if (!accessToken) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const res = await api.get('/auth/me');
      const user = res.data.data.user;

      // Read the LATEST token from localStorage — the API interceptor may
      // have silently refreshed it during the /auth/me call above
      const latestToken = localStorage.getItem('accessToken') || accessToken;

      set({
        user,
        accessToken: latestToken,
        isAuthenticated: true,
        isLoading: false,
        isOwner: user.role === 'owner',
      });

      // Connect socket with the latest (possibly refreshed) access token
      connectSocket(latestToken);
    } catch (error) {
      // Token is invalid/expired — the API interceptor will try to refresh
      // If refresh also fails, the interceptor calls forceLogout
      // Only clear here if there's no refresh token at all
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
        });
      } else {
        // Let the interceptor handle refresh, just mark as not loading
        set({ isLoading: false });
      }
    }
  },

  /**
   * Sign up a new user — now receives accessToken + refreshToken
   */
  signup: async (username, email, password) => {
    set({ error: null, isLoading: true });

    try {
      const res = await api.post('/auth/signup', {
        username,
        email,
        password,
        deviceFingerprint: getDeviceFingerprint(),
      });
      const { user, accessToken, refreshToken } = res.data.data;

      // Store dual tokens
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
      // Remove legacy key
      localStorage.removeItem('token');

      set({
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        isOwner: user.role === 'owner',
      });

      connectSocket(accessToken);
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Signup failed';
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  /**
   * Log in existing user — now receives accessToken + refreshToken
   */
  login: async (email, password) => {
    set({ error: null, isLoading: true });

    try {
      const res = await api.post('/auth/login', {
        email,
        password,
        deviceFingerprint: getDeviceFingerprint(),
      });
      const { user, accessToken, refreshToken, warning } = res.data.data;

      // Store dual tokens
      localStorage.setItem('accessToken', accessToken);
      localStorage.setItem('refreshToken', refreshToken);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.removeItem('token');

      set({
        user,
        accessToken,
        refreshToken,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        isOwner: user.role === 'owner',
      });

      connectSocket(accessToken);

      // Return warning if there were failed login attempts
      return { success: true, warning };
    } catch (error) {
      const message = error.response?.data?.message || 'Login failed';
      const attemptsRemaining = error.response?.data?.attemptsRemaining;
      const lockUntil = error.response?.data?.lockUntil;
      set({ error: message, isLoading: false });
      return { success: false, message, attemptsRemaining, lockUntil };
    }
  },

  /**
   * Log out — revokes refresh token on server
   */
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // Ignore — we're logging out anyway
    }

    disconnectSocket();

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      isOwner: false,
    });
  },

  /**
   * Revoke all sessions (panic button)
   * Forces logout on ALL devices
   */
  revokeAllSessions: async () => {
    try {
      await api.post('/auth/revoke-all-sessions');
    } catch (error) {
      // Continue with local logout regardless
    }

    // Logout locally
    get().logout();
  },

  /**
   * Handle force logout from server (called by socket event)
   */
  handleForceLogout: (reason) => {
    disconnectSocket();

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,
      error: reason || 'You have been logged out by the server.',
      isOwner: false,
    });

    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login';
    }
  },

  /**
   * Clear error
   */
  clearError: () => set({ error: null }),

  /**
   * Update user profile in store
   */
  updateUser: (updates) => {
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    }));
  },
}));

export default useAuthStore;
