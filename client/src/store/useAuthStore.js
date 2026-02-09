/**
 * ============================================
 * Auth Store (Zustand)
 * ============================================
 * 
 * Manages: User authentication state, login, signup, logout
 * 
 * WHY Zustand over Redux:
 * - Zero boilerplate (no actions, reducers, dispatchers)
 * - No Provider wrapper needed
 * - Built-in subscriptions
 * - Tiny bundle size (~1KB)
 * - Works perfectly with React hooks
 */

import { create } from 'zustand';
import api from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';

const useAuthStore = create((set, get) => ({
  // State
  user: null,
  token: localStorage.getItem('token') || null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Check if user is authenticated (on app load)
   */
  checkAuth: async () => {
    const token = localStorage.getItem('token');

    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }

    try {
      const res = await api.get('/auth/me');
      const user = res.data.data.user;

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
      });

      // Connect socket with token
      connectSocket(token);
    } catch (error) {
      // Token is invalid/expired
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  /**
   * Sign up a new user
   */
  signup: async (username, email, password) => {
    set({ error: null, isLoading: true });

    try {
      const res = await api.post('/auth/signup', { username, email, password });
      const { user, token } = res.data.data;

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      // Connect socket
      connectSocket(token);

      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Signup failed';
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  /**
   * Log in existing user
   */
  login: async (email, password) => {
    set({ error: null, isLoading: true });

    try {
      const res = await api.post('/auth/login', { email, password });
      const { user, token } = res.data.data;

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });

      // Connect socket
      connectSocket(token);

      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Login failed';
      set({ error: message, isLoading: false });
      return { success: false, message };
    }
  },

  /**
   * Log out
   */
  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // Ignore — we're logging out anyway
    }

    // Disconnect socket
    disconnectSocket();

    // Clear storage
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    set({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
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
