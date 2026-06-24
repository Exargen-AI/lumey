/**
 * ClockCard — clock-in / clock-out + today's summary (2026-05-28b).
 *
 * Anyone authenticated sees this card. Optimistic UX: button enabled
 * only when the action is valid (clock-in shown when no open session,
 * clock-out shown when one exists). The "today total" updates live
 * by the React Query refetch on every mutation success.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, LogIn, LogOut, Loader2 } from 'lucide-react';
import { clockIn, clockOut, getMyClockStatus } from '@/api/clock';

function formatHHMM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

export function ClockCard() {
  const qc = useQueryClient();
  const [note, setNote] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['clock', 'me', 'today'],
    queryFn: getMyClockStatus,
    refetchInterval: 60_000,
  });

  const inMutation = useMutation({
    mutationFn: (n: string) => clockIn(n || undefined),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['clock', 'me'] });
    },
  });
  const outMutation = useMutation({
    mutationFn: (n: string) => clockOut(n || undefined),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['clock', 'me'] });
    },
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          <Clock size={16} className="text-brand-600" />
          Clock
        </h2>
        {data && (
          <div className="text-xs text-gray-500">
            Today total{' '}
            <span className="font-semibold text-gray-900">
              {formatHHMM(data.totalSecondsToday)}
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : error ? (
        <p className="text-sm text-rose-600">Failed to load clock status.</p>
      ) : !data ? null : data.openSession ? (
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            Clocked in at{' '}
            <span className="font-medium">
              {new Date(data.openSession.clockedInAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {data.openSession.noteIn && (
              <div className="text-xs text-gray-500 mt-1 italic">
                "{data.openSession.noteIn}"
              </div>
            )}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you wrap up? (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            maxLength={255}
          />
          <button
            onClick={() => outMutation.mutate(note)}
            disabled={outMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <LogOut size={14} />
            {outMutation.isPending ? 'Clocking out…' : 'Clock out'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">You're not clocked in.</p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What are you working on? (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            maxLength={255}
          />
          <button
            onClick={() => inMutation.mutate(note)}
            disabled={inMutation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            <LogIn size={14} />
            {inMutation.isPending ? 'Clocking in…' : 'Clock in'}
          </button>
        </div>
      )}

      {data && data.todaySessions.length > 1 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer hover:text-gray-700">
            {data.todaySessions.length} sessions today
          </summary>
          <ul className="mt-2 space-y-1">
            {data.todaySessions.map((s) => {
              const end = s.clockedOutAt ?? s.autoClosedAt;
              return (
                <li key={s.id} className="flex justify-between">
                  <span>
                    {new Date(s.clockedInAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' → '}
                    {end
                      ? new Date(end).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'now'}
                  </span>
                  {s.autoClosedAt && (
                    <span className="text-amber-600">auto-closed</span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
