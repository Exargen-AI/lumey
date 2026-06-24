import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthStore } from '@/stores/authStore';
import { usePermission, useHasAnyPermission, useHasAllPermissions } from './usePermission';

/**
 * Phase 0 of the baseline hardening plan: proves Vitest can drive
 * React hooks via `renderHook` and read from a Zustand store.
 *
 * The permission hooks are the read-side of the RBAC system — Phase 4
 * promotes this file to a 95% coverage target. For now, three cases
 * are enough to verify the runner picks up `renderHook` correctly.
 */
function seedPermissions(perms: string[]) {
  useAuthStore.setState({
    user: { id: 'u1', name: 'Test', email: 't@x.in', role: 'ADMIN' } as any,
    accessToken: 'fake',
    permissions: perms,
    pendingMandatoryEnrollments: [],
    isAuthenticated: true,
    isLoading: false,
  });
}

describe('permission hooks', () => {
  beforeEach(() => {
    useAuthStore.setState({ permissions: [] });
  });

  describe('usePermission', () => {
    it('returns true when the permission is in the user\'s set', () => {
      seedPermissions(['task.edit_any']);
      const { result } = renderHook(() => usePermission('task.edit_any'));
      expect(result.current).toBe(true);
    });

    it('returns false when the permission is missing', () => {
      seedPermissions(['task.view']);
      const { result } = renderHook(() => usePermission('task.edit_any'));
      expect(result.current).toBe(false);
    });
  });

  describe('useHasAnyPermission', () => {
    it('returns true when at least one matches', () => {
      seedPermissions(['task.edit_own']);
      const { result } = renderHook(() =>
        useHasAnyPermission(['task.edit_any', 'task.edit_own']),
      );
      expect(result.current).toBe(true);
    });

    it('returns false when none match', () => {
      seedPermissions(['task.view']);
      const { result } = renderHook(() =>
        useHasAnyPermission(['task.edit_any', 'task.edit_own']),
      );
      expect(result.current).toBe(false);
    });
  });

  describe('useHasAllPermissions', () => {
    it('returns true only when every permission matches', () => {
      seedPermissions(['task.edit_any', 'task.edit_own']);
      const { result } = renderHook(() =>
        useHasAllPermissions(['task.edit_any', 'task.edit_own']),
      );
      expect(result.current).toBe(true);
    });

    it('returns false when only some match', () => {
      seedPermissions(['task.edit_any']);
      const { result } = renderHook(() =>
        useHasAllPermissions(['task.edit_any', 'task.edit_own']),
      );
      expect(result.current).toBe(false);
    });
  });
});
