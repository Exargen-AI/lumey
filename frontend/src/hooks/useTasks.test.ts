/**
 * 2026-05-23 PR #147 audit: end-to-end contract test for the mutation
 * hook that the kanban silent-rollback bug exploited.
 *
 * The kanban (and every other surface) calls `useMoveTask().mutateAsync()`
 * inside a try/catch. The catch is the seam where errors become user-
 * visible toasts. PR #147's whole premise is "mutateAsync rejects so the
 * caller can catch and surface the message." If react-query is configured
 * to swallow the error (e.g. by retrying indefinitely or by an over-eager
 * `throwOnError: false`), the caller's catch never fires and we're back
 * to silent rollback.
 *
 * These tests pin:
 *   (a) on a server rejection, mutateAsync's returned promise REJECTS
 *       with the original axios error (so the caller's catch fires).
 *   (b) the optimistic update is rolled back to the snapshot state, so
 *       the card returns to its source column rather than getting stuck.
 *   (c) on success, mutateAsync RESOLVES with the server payload (no
 *       false negatives from over-strict error detection).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// Mock the API module BEFORE importing the hook so vi.mock hoists
// correctly and our stub is in place.
vi.mock('@/api/tasks', () => ({
  moveTask: vi.fn(),
}));

import * as taskApi from '@/api/tasks';
import { useMoveTask } from './useTasks';

function withQueryClient() {
  // No retries — a real production QueryClient retries 3x by default,
  // which would make a rejected mutation eventually succeed in the test
  // (or just take longer to fail). For this contract test we want a
  // deterministic single rejection.
  const qc = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useMoveTask — error-propagation contract (PR #147 regression pin)', () => {
  it('mutateAsync REJECTS with the original axios error when the server returns 400/403/etc., so the caller can catch and toast', async () => {
    const serverError = {
      response: {
        status: 400,
        data: {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot mark this task Done — 3 acceptance criteria are still unchecked.',
          },
        },
      },
      message: 'Request failed with status code 400',
    };
    (taskApi.moveTask as any).mockRejectedValueOnce(serverError);

    const { wrapper } = withQueryClient();
    const { result } = renderHook(() => useMoveTask(), { wrapper });

    // The whole bug pattern lives in this seam: kanban calls
    // `await moveTask.mutateAsync(...)` inside a try/catch. If the
    // promise resolves silently the catch never fires; if it rejects
    // with the original error the catch fires and the toast renders.
    await expect(
      result.current.mutateAsync({ id: 'task-1', status: 'DONE' }),
    ).rejects.toBe(serverError);

    // Sanity: the hook called through to the API exactly once with the
    // right shape — no double-fire, no swallowed-then-retried scenario.
    expect(taskApi.moveTask).toHaveBeenCalledTimes(1);
    // 4th arg = expectedUpdatedAt (optimistic-lock guard, PR #215) — undefined
    // here because this call doesn't pass it.
    expect(taskApi.moveTask).toHaveBeenCalledWith('task-1', 'DONE', undefined, undefined);
  });

  it('mutateAsync REJECTS for network-level failures too (Error subclass, no axios response)', async () => {
    const networkErr = new Error('Network Error');
    (taskApi.moveTask as any).mockRejectedValueOnce(networkErr);

    const { wrapper } = withQueryClient();
    const { result } = renderHook(() => useMoveTask(), { wrapper });

    await expect(
      result.current.mutateAsync({ id: 'task-2', status: 'IN_PROGRESS' }),
    ).rejects.toBe(networkErr);
  });

  it('on rejection, rolls back the optimistic cache patch (card returns to source column instead of being stranded in target)', async () => {
    const { qc, wrapper } = withQueryClient();

    // Seed a tasks query cache so we can assert rollback restores it.
    const before = [
      { id: 'task-1', status: 'IN_REVIEW', sortOrder: 10, title: 'Build login' },
      { id: 'task-2', status: 'IN_PROGRESS', sortOrder: 5, title: 'Wire up DB' },
    ];
    qc.setQueryData(['tasks', 'project-A'], before);

    (taskApi.moveTask as any).mockRejectedValueOnce({
      response: { data: { error: { message: 'Permission denied' } } },
    });

    const { result } = renderHook(() => useMoveTask(), { wrapper });

    // Caller awaits, server rejects, mutateAsync rejects, caller catches.
    await expect(
      result.current.mutateAsync({ id: 'task-1', status: 'DONE' }),
    ).rejects.toBeTruthy();

    // The hook's onError rolls back the snapshot — wait for the
    // post-mutation invalidate + rollback to settle.
    await waitFor(() => {
      const after = qc.getQueryData(['tasks', 'project-A']) as any[] | undefined;
      // task-1 must be back in IN_REVIEW (i.e. status was NOT left as
      // DONE from the optimistic patch). Without the rollback this
      // would read "DONE" and the kanban would look stuck in limbo.
      const t1 = (after ?? []).find((t) => t?.id === 'task-1');
      expect(t1?.status).toBe('IN_REVIEW');
    });
  });

  it('on success, mutateAsync RESOLVES with the server payload (no false-positive rejections)', async () => {
    const serverResponse = { id: 'task-1', status: 'DONE', sortOrder: 99 };
    (taskApi.moveTask as any).mockResolvedValueOnce(serverResponse);

    const { wrapper } = withQueryClient();
    const { result } = renderHook(() => useMoveTask(), { wrapper });

    const out = await result.current.mutateAsync({ id: 'task-1', status: 'DONE' });
    expect(out).toEqual(serverResponse);
  });
});
