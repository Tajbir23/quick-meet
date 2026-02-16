/**
 * ============================================
 * Axios API Service — HARDENED
 * ============================================
 * 
 * SECURITY UPGRADES:
 * - Dual-token support (accessToken + refreshToken)
 * - Automatic silent token refresh on 401 TOKEN_EXPIRED
 * - Request queue during refresh (prevents race conditions)
 * - Device fingerprint header for binding
 * - No token leakage in error logs
 */

import axios from 'axios';
import { API_URL } from '../utils/constants';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── TOKEN REFRESH STATE ─────────────────────
let isRefreshing = false;
let failedQueue = []; // Queue of requests waiting for token refresh

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

/**
 * Generate a simple device fingerprint for token binding
 * WHY: Prevents stolen tokens from being used on different devices
 */
const getDeviceFingerprint = () => {
  const nav = window.navigator;
  const screen = window.screen;
  const raw = [
    nav.userAgent,
    nav.language,
    screen.colorDepth,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    nav.hardwareConcurrency || 'unknown',
  ].join('|');
  return raw;
};

/**
 * Request interceptor — inject access token + device fingerprint
 */
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Send device fingerprint on auth-related requests
    if (config.url?.includes('/auth/')) {
      config.headers['X-Device-Fingerprint'] = getDeviceFingerprint();
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Response interceptor — handle 401 with automatic token refresh
 * 
 * FLOW:
 * 1. Request fails with 401 + TOKEN_EXPIRED code
 * 2. Queue the failed request
 * 3. Call /auth/refresh with refreshToken
 * 4. On success: update tokens, retry all queued requests
 * 5. On failure: clear tokens, redirect to login
 */
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only handle 401s with TOKEN_EXPIRED code (not invalid credentials etc.)
    if (error.response?.status === 401 &&
        error.response?.data?.code === 'TOKEN_EXPIRED' &&
        !originalRequest._retry) {

      // If already refreshing, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        }).catch(err => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');

      if (!refreshToken) {
        // No refresh token — force logout
        forceLogout();
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refreshToken,
          deviceFingerprint: getDeviceFingerprint(),
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data.data;

        // Store new tokens
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', newRefreshToken);

        // Update default header
        api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;

        // Pass new tokens to native BackgroundService for polling
        try {
          const { passAuthTokenToNative } = await import('./backgroundService.js');
          await passAuthTokenToNative();
        } catch (e) {
          // Non-fatal — native service may not be available
        }

        // Process queued requests with new token
        processQueue(null, accessToken);

        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);

      } catch (refreshError) {
        // Refresh failed — token stolen or expired
        processQueue(refreshError, null);
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // For other 401s (invalid credentials, account locked, etc.) — don't auto-refresh
    if (error.response?.status === 401 &&
        error.response?.data?.code !== 'TOKEN_EXPIRED') {
      // Check if we should force logout (force-logout flag, etc.)
      if (error.response?.data?.code === 'FORCE_LOGOUT' ||
          error.response?.data?.code === 'ACCOUNT_LOCKED') {
        forceLogout();
      }
    }

    // Handle blocked account (403)
    if (error.response?.status === 403 &&
        error.response?.data?.code === 'ACCOUNT_BLOCKED') {
      forceLogout();
    }

    return Promise.reject(error);
  }
);

/**
 * Force logout — clear all tokens and redirect
 */
function forceLogout() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  // Also remove legacy 'token' key if it exists
  localStorage.removeItem('token');

  if (!window.location.pathname.includes('/login') &&
      !window.location.pathname.includes('/signup')) {
    window.location.href = '/login';
  }
}

export { getDeviceFingerprint };
export default api;
