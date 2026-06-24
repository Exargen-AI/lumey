import { create } from 'zustand';
import type { User } from '@exargen/shared';

interface AuthState {
  user: User | null;
  /** Held in memory only. Never persisted to localStorage — XSS exposure (QA finding #5). */
  accessToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  setAuth: (user: User, accessToken: string, permissions: string[]) => void;
  setAccessToken: (token: string) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

// Cross-tab sync — when one tab logs in or out, the others should react. We
// use a BroadcastChannel rather than the legacy `storage` event because the
// access token no longer touches localStorage. Falls back to no-op in older
// browsers / SSR.
const channel = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('exargen-auth')
  : null;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  permissions: [],
  isAuthenticated: false,
  // Start in loading=true so app shells don't briefly render a logged-out
  // skeleton while we /auth/refresh on boot. App.useInitAuth flips this once.
  isLoading: true,

  setAuth: (user, accessToken, permissions) => {
    set({
      user,
      accessToken,
      permissions,
      isAuthenticated: true,
      isLoading: false,
    });
    channel?.postMessage({ type: 'login' });
  },

  setAccessToken: (token) => set({ accessToken: token }),

  clearAuth: () => {
    set({
      user: null,
      accessToken: null,
      permissions: [],
      isAuthenticated: false,
      isLoading: false,
    });
    channel?.postMessage({ type: 'logout' });
  },

  setLoading: (loading) => set({ isLoading: loading }),
}));

// Listen for sign-in/out events from sibling tabs.
if (channel) {
  channel.onmessage = (e) => {
    const state = useAuthStore.getState();
    if (e.data?.type === 'logout' && state.isAuthenticated) {
      // Another tab signed out — drop our session locally. Don't broadcast
      // again; the tab that originated already did.
      useAuthStore.setState({
        user: null,
        accessToken: null,
        permissions: [],
        isAuthenticated: false,
      });
    }
    if (e.data?.type === 'login' && !state.isAuthenticated) {
      // A sibling logged in. We don't have their access token (memory-only,
      // not shareable), but we do have the cookie — kick a /refresh on next
      // request and the response interceptor will pull a fresh token.
      // Reload is the simplest correct option — the user just signed in
      // somewhere; their state on this tab was stale anyway.
      window.location.reload();
    }
  };
}
