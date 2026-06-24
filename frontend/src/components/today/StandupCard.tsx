/**
 * StandupCard — daily-standup submission (2026-05-28b).
 *
 * Backend (DailyUpdate model + submit endpoint + today-status endpoint)
 * has existed for a while; this card is the missing employee entry
 * point. Once the user submits, the card flips to "Submitted at X"
 * with a stat strip and stays that way until the next calendar day.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Loader2 } from 'lucide-react';
import { getTodayStatus, submitDailyUpdate } from '@/api/dailyUpdates';

export function StandupCard() {
  const qc = useQueryClient();
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [plans, setPlans] = useState('');

  const { data: status, isLoading } = useQuery<{ submitted: boolean; submittedAt: string | null }>({
    queryKey: ['daily-update', 'mine', 'today'],
    queryFn: getTodayStatus,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      submitDailyUpdate({
        summary,
        blockers: blockers || undefined,
        plans: plans || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['daily-update'] });
    },
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-2">
          <ClipboardList size={16} className="text-brand-600" />
          Today's standup
        </h2>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      ) : status?.submitted ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex items-start gap-3">
          <CheckCircle2 size={20} className="text-emerald-600 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-emerald-900">Submitted</p>
            {status.submittedAt && (
              <p className="text-xs text-emerald-700">
                {new Date(status.submittedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What did you ship today? Required."
            rows={3}
            maxLength={5000}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
          />
          <textarea
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            placeholder="Any blockers? (optional)"
            rows={2}
            maxLength={5000}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
          />
          <textarea
            value={plans}
            onChange={(e) => setPlans(e.target.value)}
            placeholder="Tomorrow's plan? (optional)"
            rows={2}
            maxLength={5000}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-y"
          />
          {submitMutation.error && (
            <p className="text-xs text-rose-600">
              {(submitMutation.error as Error).message || 'Submit failed'}
            </p>
          )}
          <button
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || !summary.trim()}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {submitMutation.isPending ? 'Submitting…' : 'Submit today’s standup'}
          </button>
        </div>
      )}
    </div>
  );
}
