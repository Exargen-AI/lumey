import axios from 'axios';
import { useAuthStore } from '@/stores/authStore';
import { reportApiError } from '@/lib/errorReporter';

const api = axios.create({
  baseURL: (import.meta.env.VITE_API_URL || '') + '/api/v1',
  // withCredentials so the httpOnly refresh cookie rides along on /auth/* calls.
  withCredentials: true,
});

// Attach access token from in-memory store. localStorage is intentionally
// no longer touched (QA finding #5 — XSS-readable session).
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single-flight refresh: if many requests 401 at once, only one /auth/refresh
// fires; the rest queue on its promise and retry with the new token.
let refreshPromise: Promise<string | null> | null = null;

async function refreshOnce(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const { data } = await axios.post(
        (import.meta.env.VITE_API_URL || '') + '/api/v1/auth/refresh',
        {},
        { withCredentials: true },
      );
      const newToken = data.data.accessToken as string;
      useAuthStore.getState().setAccessToken(newToken);
      return newToken;
    } catch {
      // Refresh failed — clear local session so the UI redirects to /login.
      useAuthStore.getState().clearAuth();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const url = (originalRequest?.url || '') as string;

    // Don't try to refresh on auth endpoints — would loop. /auth/refresh's own
    // 401 should bubble up so the caller (useInitAuth) can clear state.
    const isAuthRoute = url.includes('/auth/refresh') || url.includes('/auth/login');

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;
      const newToken = await refreshOnce();
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }
    }

    // Surface server-side (5xx) + network failures to the error reporter.
    // No-op unless VITE_ERROR_REPORTING_DSN is configured; 4xx are
    // expected client conditions and are intentionally not reported.
    reportApiError(error);

    return Promise.reject(error);
  },
);

export default api;
