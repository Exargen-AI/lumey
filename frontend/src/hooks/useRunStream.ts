import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requestRunStreamTicket, type RunStatus } from '@/api/agentRuns';

/**
 * Live run trace over SSE. While `enabled`, this opens an `EventSource` to the
 * run's stream and, on every fact, **invalidates the React Query caches** so the
 * authoritative run detail + summary refetch — the stream is a *signal*, REST is
 * the source of truth (no second copy to drift, no run data trusted off the SSE
 * wire). It also tracks the latest status for an instant pill update.
 *
 * Reconnect nuance: the stream is gated by a **single-use** ticket, so the
 * browser's built-in EventSource auto-reconnect (which replays the same URL)
 * would hit a dead ticket. We therefore disable that path — on any error we
 * close, **mint a fresh ticket**, and reconnect ourselves with a small backoff,
 * until the caller disables the hook (e.g. once the run is terminal).
 */
export function useRunStream(
  taskId: string,
  runId: string | null,
  opts: { enabled: boolean },
): { connected: boolean; liveStatus: RunStatus | null } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [liveStatus, setLiveStatus] = useState<RunStatus | null>(null);

  useEffect(() => {
    if (!opts.enabled || !runId) return;

    let source: EventSource | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const invalidate = (): void => {
      void qc.invalidateQueries({ queryKey: ['task-run', taskId, runId] });
      void qc.invalidateQueries({ queryKey: ['task-runs', taskId] });
      // A run may have just raised (or resolved) a clarification or approval —
      // refetch so the question/answer + approval UI track the live trace.
      void qc.invalidateQueries({ queryKey: ['run-clarifications', taskId, runId] });
      void qc.invalidateQueries({ queryKey: ['run-approvals', taskId, runId] });
    };

    const connect = async (): Promise<void> => {
      try {
        const { ticket } = await requestRunStreamTicket(taskId, runId);
        if (stopped) return;
        const base = (import.meta.env.VITE_API_URL || '') + '/api/v1';
        const es = new EventSource(`${base}/tasks/${taskId}/runs/${runId}/stream?ticket=${encodeURIComponent(ticket)}`);
        source = es;

        es.addEventListener('connected', () => setConnected(true));
        es.addEventListener('run.step.recorded', invalidate);
        es.addEventListener('run.created', invalidate);
        es.addEventListener('run.transitioned', (ev) => {
          try {
            const data = JSON.parse((ev as MessageEvent).data) as { to?: RunStatus };
            if (data.to) setLiveStatus(data.to);
          } catch {
            /* malformed frame — the invalidate below still refetches the truth */
          }
          invalidate();
        });
        // The browser auto-reconnect can't be reused (single-use ticket); take over.
        es.onerror = () => {
          es.close();
          setConnected(false);
          if (!stopped) reconnectTimer = setTimeout(() => void connect(), 1500);
        };
      } catch {
        if (!stopped) reconnectTimer = setTimeout(() => void connect(), 3000);
      }
    };

    void connect();

    return () => {
      stopped = true;
      clearTimeout(reconnectTimer);
      source?.close();
      setConnected(false);
    };
  }, [taskId, runId, opts.enabled, qc]);

  return { connected, liveStatus };
}
