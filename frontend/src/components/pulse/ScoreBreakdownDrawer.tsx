/**
 * Pulse productivity score — audit-trail breakdown drawer (Wave 6).
 *
 * Opens from the Reports tab when a SUPER_ADMIN clicks an employee row.
 * Answers "why is this score what it is?" by showing:
 *
 *   1. Composite score + band + computed-at timestamp.
 *   2. The seven sub-scores with their applied (renormalised) weight
 *      and the gaming flags that fired in this window.
 *   3. Raw signal breakdown (the metric counts that fed each scorer).
 *   4. The contributing `productivity_events` rows (up to 500).
 *
 * Implementation notes:
 *   - One React Query keyed by (userId, cadence, windowStart) so
 *     switching cadences inside the drawer just refetches.
 *   - Recompute button below the composite — fires the ad-hoc
 *     `POST /admin/pulse/scores/:userId/recompute` and invalidates
 *     the breakdown query on success.
 *   - SUPER_ADMIN-only at the route level + handler level — this
 *     component assumes the caller is already gated.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import {
  getPulseScoreBreakdown,
  recomputeScoresForUser,
} from '@/api/pulseScore';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  PRODUCTIVITY_SIGNALS,
  type ProductivityCadence,
  type ProductivitySignal,
  type ScoreBand,
} from '@exargen/shared';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
  /** Drives the initial cadence shown; user can flip inside the drawer. */
  initialCadence?: ProductivityCadence;
}

const SIGNAL_LABELS: Record<ProductivitySignal, string> = {
  STANDUP: 'Standup',
  EXECUTION: 'Execution',
  CODE: 'Code',
  COMMUNICATION: 'Communication',
  PRESENCE: 'Presence',
  DEEP_WORK: 'Deep work',
  DEVICE_HYGIENE: 'Device hygiene',
};

const BAND_TONE: Record<ScoreBand, 'success' | 'warning' | 'danger'> = {
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'danger',
};

const CADENCES: ProductivityCadence[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export function ScoreBreakdownDrawer({
  open,
  onClose,
  userId,
  userName,
  initialCadence = 'WEEKLY',
}: Props) {
  const [cadence, setCadence] = useState<ProductivityCadence>(initialCadence);
  const qc = useQueryClient();

  const breakdownQuery = useQuery({
    queryKey: ['pulse', 'breakdown', userId, cadence],
    queryFn: () => getPulseScoreBreakdown(userId, { cadence }),
    enabled: open,
    // No refetch on focus — this is an audit drill-down, not a live view.
    refetchOnWindowFocus: false,
  });

  const recomputeMutation = useMutation({
    mutationFn: () => recomputeScoresForUser(userId),
    onSuccess: async () => {
      // Worker is async (debounce-skip path runs in background). Wait a
      // beat then refetch the breakdown + the parent list. The 60s
      // debounce is bypassed but the actual recompute still takes
      // however long computeForUser takes.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['pulse', 'breakdown', userId] });
        qc.invalidateQueries({ queryKey: ['pulse', 'scores'] });
      }, 1500);
    },
  });

  if (!open) return null;

  const data = breakdownQuery.data;

  const drawer = (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-gray-900/70 dark:bg-black/75 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="presentation"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex h-full w-full max-w-2xl flex-col overflow-hidden',
          'bg-white dark:bg-obsidian-panel border-l border-gray-200 dark:border-obsidian-border',
          'shadow-pop dark:shadow-pop-dark',
        )}
        aria-label="Productivity score breakdown"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 dark:border-obsidian-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
              {userName}
            </h2>
            <p className="text-[13px] text-gray-500 dark:text-obsidian-muted mt-0.5">
              Productivity breakdown · {cadence.toLowerCase()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 inline-flex items-center justify-center rounded-md text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Cadence segmented control */}
        <div className="px-6 pt-4">
          <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-obsidian-sunken p-1">
            {CADENCES.map((c) => (
              <button
                key={c}
                onClick={() => setCadence(c)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded-md transition-colors',
                  cadence === c
                    ? 'bg-white dark:bg-obsidian-panel text-gray-900 dark:text-obsidian-fg shadow-soft'
                    : 'text-gray-600 dark:text-obsidian-muted hover:text-gray-900',
                )}
              >
                {c.charAt(0) + c.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {breakdownQuery.isLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-obsidian-muted">
              <Loader2 size={16} className="animate-spin" /> Loading breakdown…
            </div>
          )}

          {breakdownQuery.isError && (
            <div className="rounded-lg border border-danger-200 bg-danger-50 dark:bg-danger-500/10 dark:border-danger-700/40 p-4 text-sm text-danger-700 dark:text-danger-300">
              <div className="flex items-start gap-2">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Could not load breakdown</p>
                  <p className="text-xs opacity-80 mt-1">
                    {(breakdownQuery.error as Error)?.message ??
                      'No score row exists for this window yet.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {data && (
            <>
              <CompositeSummary
                composite={data.compositeScore}
                band={data.band}
                computedAt={data.computedAt}
                eventsCount={data.computedFromEventCount}
                windowStart={data.windowStart}
                windowEnd={data.windowEnd}
                inactiveSignals={data.flags.inactiveSignals ?? []}
                onRecompute={() => recomputeMutation.mutate()}
                recomputing={recomputeMutation.isPending}
                recomputed={recomputeMutation.isSuccess}
              />

              <SignalSubscores
                signals={data.signalScores}
                weightsApplied={data.weightsApplied}
              />

              <EventsList events={data.events} />
            </>
          )}
        </div>
      </aside>
    </div>
  );

  return createPortal(drawer, document.body);
}

// ────────────────────────────────────────────────────────────────────
// Composite summary card
// ────────────────────────────────────────────────────────────────────

function CompositeSummary({
  composite,
  band,
  computedAt,
  eventsCount,
  windowStart,
  windowEnd,
  inactiveSignals,
  onRecompute,
  recomputing,
  recomputed,
}: {
  composite: number;
  band: ScoreBand;
  computedAt: string;
  eventsCount: number;
  windowStart: string;
  windowEnd: string;
  inactiveSignals: ProductivitySignal[];
  onRecompute: () => void;
  recomputing: boolean;
  recomputed: boolean;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border p-5',
        'bg-gradient-to-br from-brand-50 to-brand-50/40 dark:from-brand-950/30 dark:to-brand-950/10',
        'border-brand-100 dark:border-brand-900/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-300">
            Composite
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg tabular-nums">
              {Math.round(composite)}
            </span>
            <Badge tone={BAND_TONE[band]} dot>
              {band}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-2">
            Window {windowStart} → {windowEnd} ·{' '}
            <span className="tabular-nums">{eventsCount}</span> events ·{' '}
            computed {new Date(computedAt).toLocaleString()}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onRecompute}
          disabled={recomputing}
        >
          {recomputing ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Triggered
            </>
          ) : recomputed ? (
            <>
              <RefreshCw size={14} />
              Recompute again
            </>
          ) : (
            <>
              <RefreshCw size={14} />
              Recompute now
            </>
          )}
        </Button>
      </div>

      {inactiveSignals.length > 0 && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert size={12} />
          {7 - inactiveSignals.length} of 7 signals active — weights
          renormalised over the live subset
        </div>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Seven sub-scores with applied weight + gaming flags + raw breakdown
// ────────────────────────────────────────────────────────────────────

function SignalSubscores({
  signals,
  weightsApplied,
}: {
  signals: Array<{
    signal: ProductivitySignal;
    score: number;
    rawBreakdown: Record<
      string,
      | number
      | string
      | boolean
      | null
      | Record<string, number | string | boolean | null>
    >;
    gamingFlags: string[];
  }>;
  weightsApplied: Record<ProductivitySignal, number>;
}) {
  // Order signals canonically so the drawer is stable across re-renders.
  const byKey = new Map(signals.map((s) => [s.signal, s]));

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-obsidian-muted mb-3">
        Signals
      </h3>
      <ul className="space-y-3">
        {PRODUCTIVITY_SIGNALS.map((sig) => {
          const s = byKey.get(sig);
          const weight = weightsApplied[sig] ?? 0;
          if (!s) return null;
          return (
            <li
              key={sig}
              className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-sunken p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">
                    {SIGNAL_LABELS[sig]}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-obsidian-muted">
                    weight {(weight * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xl font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg">
                    {Math.round(s.score)}
                  </span>
                  <span className="text-[11px] text-gray-400 ml-1">/100</span>
                </div>
              </div>

              {s.gamingFlags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {s.gamingFlags.map((f) => (
                    <Badge key={f} tone="warning" size="xs">
                      {f}
                    </Badge>
                  ))}
                </div>
              )}

              {hasBreakdown(s.rawBreakdown) && (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  {flattenBreakdown(s.rawBreakdown)
                    .slice(0, 8)
                    .map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-center justify-between gap-2 border-b border-gray-100 dark:border-obsidian-border/60 py-1"
                      >
                        <dt className="text-gray-500 dark:text-obsidian-muted truncate">
                          {k}
                        </dt>
                        <dd className="text-gray-800 dark:text-obsidian-fg tabular-nums shrink-0">
                          {String(v)}
                        </dd>
                      </div>
                    ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function hasBreakdown(b: Record<string, unknown>): boolean {
  return Object.keys(b).length > 0;
}

function flattenBreakdown(
  b: Record<string, unknown>,
  prefix = '',
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(
        ...flattenBreakdown(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k),
      );
    } else {
      out.push([prefix ? `${prefix}.${k}` : k, v]);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Contributing events list (audit trail)
// ────────────────────────────────────────────────────────────────────

function EventsList({
  events,
}: {
  events: Array<{
    id: string;
    signal: ProductivitySignal;
    eventType: string;
    occurredAt: string;
    source: string;
    gamingFlag: string | null;
    scoreDelta: number | null;
  }>;
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-obsidian-muted mb-3">
        Events ({events.length})
      </h3>
      {events.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-obsidian-muted">
          No contributing events for this window.
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start gap-3 rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-sunken px-3 py-2 text-[12px]"
            >
              <Badge tone="neutral" size="xs">
                {ev.signal}
              </Badge>
              <div className="min-w-0 flex-1">
                <p className="text-gray-900 dark:text-obsidian-fg truncate">
                  {ev.eventType}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-obsidian-muted">
                  {new Date(ev.occurredAt).toLocaleString()} · {ev.source}
                  {ev.scoreDelta != null && (
                    <span className="ml-2 tabular-nums">Δ {ev.scoreDelta}</span>
                  )}
                </p>
              </div>
              {ev.gamingFlag && (
                <Badge tone="warning" size="xs">
                  {ev.gamingFlag}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
