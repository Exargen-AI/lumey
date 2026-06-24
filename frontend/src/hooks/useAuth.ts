import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { loginApi, logoutApi, getMeApi, refreshApi } from '@/api/auth';
import { getDefaultRoute } from '@/lib/constants';

export function useAuth() {
  const { user, isAuthenticated, isLoading, setAuth, setAccessToken, clearAuth, setLoading } = useAuthStore();
  const navigate = useNavigate();

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginApi(email, password);
    setAccessToken(result.accessToken);
    // Fetch permissions via /me
    const meResult = await getMeApi();
    setAuth(
      result.user,
      result.accessToken,
      meResult.permissions,
    );
    const dashboardPath = getDefaultRoute(result.user.role, meResult.permissions);
    navigate(dashboardPath);
  }, [setAccessToken, setAuth, navigate]);

  const logout = useCallback(async () => {
    // Logout failures shouldn't block the local clear-and-redirect — the
    // user can always click sign out again. We still try the server so it
    // can revoke the refresh token row.
    try {
      await logoutApi();
    } catch (err: any) {
      console.warn('[logout] backend logout failed (clearing local session anyway):', err?.response?.status, err?.message);
    }
    clearAuth();
    navigate('/login');
  }, [clearAuth, navigate]);

  const refreshAuth = useCallback(async () => {
    try {
      setLoading(true);
      const meResult = await getMeApi();
      setAuth(
        meResult.user,
        useAuthStore.getState().accessToken || '',
        meResult.permissions,
      );
    } catch {
      clearAuth();
    }
  }, [setAuth, clearAuth, setLoading]);

  return { user, isAuthenticated, isLoading, login, logout, refreshAuth };
}

/**
 * Boot path: try /auth/refresh once. If the httpOnly cookie is valid, we get
 * a fresh access token and call /me; otherwise we settle as logged-out. This
 * is the only place the app considers "no token in memory" during cold start.
 */
export function useInitAuth() {
  const setAuth = useAuthStore((s) => s.setAuth);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const setLoading = useAuthStore((s) => s.setLoading);
  // StrictMode mounts effects twice in dev; ref guards a duplicate /refresh.
  const ranOnce = useRef(false);

  useEffect(() => {
    if (ranOnce.current) return;
    ranOnce.current = true;

    setLoading(true);
    refreshApi()
      .then(({ accessToken }) => {
        setAccessToken(accessToken);
        return getMeApi();
      })
      .then((meResult) => {
        setAuth(
          meResult.user,
          useAuthStore.getState().accessToken || '',
          meResult.permissions,
        );
      })
      .catch((err) => {
        // No valid refresh cookie → user is anonymous. This is the expected
        // path for first-time visitors; only log unexpected statuses.
        if (err?.response?.status && err.response.status !== 401) {
          console.error('[useInitAuth] bootstrap failed:', err?.response?.status, err?.message);
        }
        clearAuth();
      });
  }, [setAuth, setAccessToken, clearAuth, setLoading]);
}
