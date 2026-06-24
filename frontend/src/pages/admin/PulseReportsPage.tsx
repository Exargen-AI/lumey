/**
 * Pulse Reports — SUPER_ADMIN composite-score dashboard.
 *
 * Wave 6 shipped the page skeleton. Wave 7 polish (this file) makes
 * it actually feel like an enterprise reports surface:
 *
 *   - Top-of-page **system status strip**: worker enabled? outbox
 *     depth? last cycle? — so a SUPER_ADMIN spots a stuck pipeline
 *     before doom-scrolling the scores tab and assuming "no data."
 *
 *   - **Team summary hero**: total scored / avg composite / band
 *     distribution / gaming flags — read from a single rollup
 *     endpoint so the FE doesn't compute 5 reducers over a 200-row
 *     payload.
 *
 *   - Scores tab gets **search**, **skeleton loaders**, an
 *     **actionable empty state** (link to flip the feature flag),
 *     a **Recompute-all team** button, and a **CSV export** (computed
 *     client-side from already-fetched rows — no extra endpoint).
 *
 *   - The breakdown drawer (`ScoreBreakdownDrawer.tsx`) handles
 *     per-employee drill-down. Recompute-one fires from there.
 *
 *   - Worker-health tab gains a `last-cycle` freshness pill so a
 *     stale snapshot is visually obvious.
 *
 * Access policy reminder (R5 lockdown — founder directive 2026-05-29):
 *
 *   > "remember only super admin has access to all these metrics
 *      right?, make sure only super admin is allowed"
 *
 * Route-gated to roles={['SUPER_ADMIN']} in App.tsx; every backend
 * endpoint is triple-gated in `pulseScore.routes.ts`. A UI bypass
 * hits a 403 with code `PRODUCTIVITY_SCORE_FORBIDDEN`.
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Download,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Sparkles,
  WifiOff,
} from 'lucide-react';
import {
  getPulseObservability,
  getPulseScoresSummary,
  getPulseWeights,
  listPulseScores,
  recomputeAllScores,
  type PulseObservabilitySnapshot,
} from '@/api/pulseScore';
import { Badge, Button, Card, Skeleton, Tabs } from '@/components/ui';
import type { TabItem } from '@/components/ui';
import { ScoreBreakdownDrawer } from '@/components/pulse/ScoreBreakdownDrawer';
import {
  PRODUCTIVITY_SIGNALS,
  type CompositeScoreDTO,
  type ProductivityCadence,
  type ProductivitySignal,
  type ScoreBand,
} from '@exargen/shared';
import { getUsers } from '@/api/users';
import { cn } from '@/lib/cn';
import { csvRow, downloadCsv } from '@/lib/csvExport';

type Tab = 'scores' | 'weights' | 'health';

const TAB_ITEMS: TabItem<Tab>[] = [
  { id: 'scores', label: 'Scores', icon: Sparkles },
  { id: 'weights', label: 'Weights', icon: Sliders },
  { id: 'health', label: 'Worker health', icon: Gauge },
];

const CADENCES: ProductivityCadence[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

const BAND_TONE: Record<ScoreBand, 'success' | 'warning' | 'danger'> = {
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'danger',
};

const BAND_FILL: Record<ScoreBand, string> = {
  HIGH: 'bg-success-500',
  MEDIUM: 'bg-warning-500',
  LOW: 'bg-danger-500',
};

export function PulseReportsPage() {
  const [tab, setTab] = useState<Tab>('scores');

  // One observability query at the page level so the status strip and
  // the Worker-health tab share the cache. 30s refresh keeps it live
  // without hammering the endpoint.
  const observabilityQuery = useQuery({
    queryKey: ['pulse', 'observability'],
    queryFn: getPulseObservability,
    refetchInterval: 30_000,
  });

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg flex items-center gap-2">
            <Activity size={22} className="text-brand-600" />
            Productivity reports
          </h1>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1 max-w-2xl">
            Multi-signal composite scores across all employees, with full
            audit-trail drill-down. SUPER_ADMIN-only — composite scores,
            sub-scores, raw events and weight sets are never visible to
            other roles.
          </p>
        </div>
      </header>

      <SystemStatusStrip
        snapshot={observabilityQuery.data ?? null}
        loading={observabilityQuery.isLoading}
        onJumpToHealth={() => setTab('health')}
      />

      <Tabs items={TAB_ITEMS} active={tab} onChange={setTab} />

      {tab === 'scores' && (
        <ScoresTab
          workerEnabled={observabilityQuery.data?.workerEnabled ?? false}
        />
      )}
      {tab === 'weights' && <WeightsTab />}
      {tab === 'health' && (
        <HealthTab
          snapshot={observabilityQuery.data ?? null}
          loading={observabilityQuery.isLoading}
          isError={observabilityQuery.isError}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// System status strip — always visible at the top of the page.
// Tells a SUPER_ADMIN at a glance whether the pipeline is healthy.
// ────────────────────────────────────────────────────────────────────

function SystemStatusStrip({
  snapshot,
  loading,
  onJumpToHealth,
}: {
  snapshot: PulseObservabilitySnapshot | null;
  loading: boolean;
  onJumpToHealth: () => void;
}) {
  if (loading) {
    return <Skeleton className="h-12 w-full" />;
  }
  if (!snapshot) return null;

  const workerOk = snapshot.workerEnabled;
  const lagOk = snapshot.workerLagSeconds < 300;
  const depthOk = snapshot.outboxDepth < 1000;
  const overall = workerOk && lagOk && depthOk;

  const tone: 'success' | 'warning' | 'danger' = !workerOk
    ? 'danger'
    : !lagOk || !depthOk
      ? 'warning'
      : 'success';

  const TONE_CLASSES: Record<typeof tone, string> = {
    success:
      'border-success-200 dark:border-success-700/40 bg-success-50/60 dark:bg-success-500/5 text-success-800 dark:text-success-300',
    warning:
      'border-warning-200 dark:border-warning-700/40 bg-warning-50/60 dark:bg-warning-500/5 text-warning-800 dark:text-warning-300',
    danger:
      'border-danger-200 dark:border-danger-700/40 bg-danger-50/60 dark:bg-danger-500/5 text-danger-800 dark:text-danger-300',
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5',
        TONE_CLASSES[tone],
      )}
    >
      <div className="flex items-center gap-4 flex-wrap text-xs font-medium">
        <div className="flex items-center gap-1.5">
          {overall ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          <span>
            {!workerOk
              ? 'Worker disabled'
              : overall
                ? 'Pipeline healthy'
                : 'Pipeline degraded'}
          </span>
        </div>
        <span className="opacity-60">·</span>
        <span className="tabular-nums">
          Outbox <strong>{snapshot.outboxDepth.toLocaleString()}</strong>
        </span>
        <span className="opacity-60">·</span>
        <span className="tabular-nums">
          Lag <strong>{snapshot.workerLagSeconds}s</strong>
        </span>
        <span className="opacity-60">·</span>
        <span>
          Last cycle{' '}
          <strong>
            {snapshot.lastCycleAt
              ? formatRelative(snapshot.lastCycleAt)
              : 'never'}
          </strong>
        </span>
      </div>
      <button
        onClick={onJumpToHealth}
        className="text-xs underline underline-offset-2 hover:no-underline opacity-80 hover:opacity-100"
      >
        View worker health →
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tab 1: Scores — hero summary + search + sortable list + drawer
// ────────────────────────────────────────────────────────────────────

interface DrawerState {
  userId: string;
  userName: string;
  cadence: ProductivityCadence;
}

function ScoresTab({ workerEnabled }: { workerEnabled: boolean }) {
  const qc = useQueryClient();
  const [cadence, setCadence] = useState<ProductivityCadence>('WEEKLY');
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [sort, setSort] = useState<'score-desc' | 'score-asc' | 'name'>(
    'score-desc',
  );
  const [search, setSearch] = useState('');

  const scoresQuery = useQuery({
    queryKey: ['pulse', 'scores', cadence],
    queryFn: () => listPulseScores(cadence),
    refetchInterval: 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['pulse', 'scores', 'summary', cadence],
    queryFn: () => getPulseScoresSummary(cadence),
    refetchInterval: 60_000,
  });

  const { data: users } = useQuery({
    queryKey: ['users', 'active'],
    queryFn: () => getUsers({ isActive: 'true' }),
    staleTime: 60_000,
  });

  const usersById = useMemo(() => {
    const m = new Map<string, { name: string; email: string }>();
    for (const u of (users ?? []) as Array<{ id: string; name: string; email: string }>) {
      m.set(u.id, { name: u.name, email: u.email });
    }
    return m;
  }, [users]);

  const recomputeAll = useMutation({
    mutationFn: recomputeAllScores,
    onSuccess: () => {
      // Worker is async. Refresh after a beat — most teams finish in
      // <30s, but we give it a small head start.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['pulse', 'scores'] });
        qc.invalidateQueries({ queryKey: ['pulse', 'observability'] });
      }, 2_000);
    },
  });

  const rows = useMemo(() => {
    const data = scoresQuery.data ?? [];
    const filtered = search.trim()
      ? data.filter((r) => {
          const name = usersById.get(r.userId)?.name?.toLowerCase() ?? '';
          const email = usersById.get(r.userId)?.email?.toLowerCase() ?? '';
          const q = search.trim().toLowerCase();
          return name.includes(q) || email.includes(q) || r.userId.includes(q);
        })
      : data;
    const sorted = [...filtered];
    if (sort === 'score-desc') sorted.sort((a, b) => b.compositeScore - a.compositeScore);
    else if (sort === 'score-asc') sorted.sort((a, b) => a.compositeScore - b.compositeScore);
    else
      sorted.sort((a, b) => {
        const an = usersById.get(a.userId)?.name ?? a.userId;
        const bn = usersById.get(b.userId)?.name ?? b.userId;
        return an.localeCompare(bn);
      });
    return sorted;
  }, [scoresQuery.data, sort, search, usersById]);

  const hasData = (scoresQuery.data?.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      <SummaryHero
        cadence={cadence}
        summary={summaryQuery.data ?? null}
        loading={summaryQuery.isLoading}
        onCadenceChange={setCadence}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="pl-9 pr-3 h-9 w-72 text-sm border border-gray-200 dark:border-obsidian-border rounded-md bg-white dark:bg-obsidian-sunken text-gray-900 dark:text-obsidian-fg placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-obsidian-muted">Sort</label>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="text-xs border border-gray-200 dark:border-obsidian-border rounded-md px-2 py-1 bg-white dark:bg-obsidian-sunken text-gray-900 dark:text-obsidian-fg"
          >
            <option value="score-desc">Highest score</option>
            <option value="score-asc">Lowest score</option>
            <option value="name">Name (A–Z)</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => exportCsv(rows, usersById, cadence)}
            disabled={!hasData}
            leadingIcon={<Download size={14} />}
          >
            Export CSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => recomputeAll.mutate()}
            disabled={recomputeAll.isPending || !workerEnabled}
            leadingIcon={
              recomputeAll.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )
            }
          >
            {recomputeAll.isPending
              ? 'Triggered'
              : recomputeAll.isError
                ? // Wave 10 — surface the 429-throttle message inline
                  // on the button so SUPER_ADMIN sees "wait 28s" instead
                  // of a silent failure.
                  recomputeThrottleMessage(recomputeAll.error)
                : recomputeAll.isSuccess
                  ? `Triggered for ${recomputeAll.data?.userCount} users`
                  : 'Recompute all'}
          </Button>
        </div>
      </div>

      {scoresQuery.isLoading && <ScoresTableSkeleton />}

      {scoresQuery.isError && (
        <Card accent="danger">
          <div className="flex items-start gap-2 text-sm text-danger-700 dark:text-danger-300">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Could not load scores</p>
              <p className="text-xs opacity-80 mt-1">
                {(scoresQuery.error as Error)?.message ??
                  'The worker may not have produced any rows yet. Check the worker-health tab.'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {!scoresQuery.isLoading && !scoresQuery.isError && !hasData && (
        <EmptyScoresState workerEnabled={workerEnabled} />
      )}

      {hasData && rows.length === 0 && search.trim() && (
        <Card>
          <div className="text-sm text-gray-600 dark:text-obsidian-muted text-center py-6">
            No employees match <strong>“{search}”</strong>.
          </div>
        </Card>
      )}

      {rows.length > 0 && (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-obsidian-sunken text-left text-xs font-semibold text-gray-600 dark:text-obsidian-muted uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">
                    <button
                      onClick={() =>
                        setSort(sort === 'score-desc' ? 'score-asc' : 'score-desc')
                      }
                      className="inline-flex items-center gap-1 hover:text-gray-900 dark:hover:text-obsidian-fg"
                    >
                      Composite
                      <ArrowUpDown size={11} />
                    </button>
                  </th>
                  <th className="px-4 py-3">Band</th>
                  <th className="px-4 py-3">Window</th>
                  <th className="px-4 py-3">Events</th>
                  <th className="px-4 py-3">Flags</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-obsidian-border">
                {rows.map((row) => {
                  const u = usersById.get(row.userId);
                  return (
                    <tr
                      key={`${row.userId}-${row.windowStart}-${row.cadence}`}
                      className="hover:bg-gray-50 dark:hover:bg-obsidian-sunken/50 cursor-pointer transition-colors"
                      onClick={() =>
                        setDrawer({
                          userId: row.userId,
                          userName: u?.name ?? row.userId,
                          cadence: row.cadence,
                        })
                      }
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-obsidian-fg">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u?.name ?? row.userId} />
                          <div className="min-w-0">
                            <div className="truncate">{u?.name ?? row.userId}</div>
                            {u?.email && (
                              <div className="text-[11px] text-gray-500 dark:text-obsidian-muted truncate">
                                {u.email}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <CompositeMeter score={row.compositeScore} band={row.band} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={BAND_TONE[row.band]} dot>
                          {row.band}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-obsidian-muted text-xs whitespace-nowrap">
                        {row.windowStart} → {row.windowEnd}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-obsidian-muted tabular-nums">
                        {row.computedFromEventCount}
                      </td>
                      <td className="px-4 py-3">
                        <RowFlags
                          gamingFlagsCount={row.flags.gamingFlagsCount ?? 0}
                          inactiveSignals={row.flags.inactiveSignals ?? []}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight
                          size={14}
                          className="inline text-gray-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {drawer && (
        <ScoreBreakdownDrawer
          open
          onClose={() => setDrawer(null)}
          userId={drawer.userId}
          userName={drawer.userName}
          initialCadence={drawer.cadence}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Summary hero: average composite + distribution bar + cadence picker
// ────────────────────────────────────────────────────────────────────

function SummaryHero({
  cadence,
  summary,
  loading,
  onCadenceChange,
}: {
  cadence: ProductivityCadence;
  summary: {
    totalEmployees: number;
    averageComposite: number;
    bandDistribution: { HIGH: number; MEDIUM: number; LOW: number };
    gamingFlagsTotal: number;
    lastComputedAt: string | null;
  } | null;
  loading: boolean;
  onCadenceChange: (c: ProductivityCadence) => void;
}) {
  if (loading) return <Skeleton className="h-36 w-full" />;
  const total =
    (summary?.bandDistribution.HIGH ?? 0) +
    (summary?.bandDistribution.MEDIUM ?? 0) +
    (summary?.bandDistribution.LOW ?? 0);
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  return (
    <Card accent="brand" padding="lg">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 flex-1 min-w-0">
          <SummaryStat
            label="Tracked"
            value={summary?.totalEmployees.toString() ?? '0'}
            sublabel="employees"
          />
          <SummaryStat
            label="Avg composite"
            value={(summary?.averageComposite ?? 0).toFixed(1)}
            sublabel={`/ 100 (${cadence.toLowerCase()})`}
          />
          <SummaryStat
            label="Gaming flags"
            value={(summary?.gamingFlagsTotal ?? 0).toString()}
            sublabel="this window"
            tone={summary && summary.gamingFlagsTotal > 0 ? 'warning' : 'neutral'}
          />
          <SummaryStat
            label="Last refresh"
            value={
              summary?.lastComputedAt
                ? formatRelative(summary.lastComputedAt)
                : '—'
            }
            sublabel={summary?.lastComputedAt ?? 'never'}
          />
        </div>
        <CadencePicker value={cadence} onChange={onCadenceChange} />
      </div>

      {total > 0 && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-wide text-brand-700 dark:text-brand-300 mb-2">
            <span>Band distribution</span>
            <span className="tabular-nums">
              {summary?.bandDistribution.HIGH ?? 0} high ·{' '}
              {summary?.bandDistribution.MEDIUM ?? 0} medium ·{' '}
              {summary?.bandDistribution.LOW ?? 0} low
            </span>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-border">
            <div
              className={BAND_FILL.HIGH}
              style={{ width: `${pct(summary?.bandDistribution.HIGH ?? 0)}%` }}
            />
            <div
              className={BAND_FILL.MEDIUM}
              style={{ width: `${pct(summary?.bandDistribution.MEDIUM ?? 0)}%` }}
            />
            <div
              className={BAND_FILL.LOW}
              style={{ width: `${pct(summary?.bandDistribution.LOW ?? 0)}%` }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function SummaryStat({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-brand-700 dark:text-brand-300">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-3xl font-semibold tabular-nums tracking-tight',
          tone === 'warning'
            ? 'text-warning-700 dark:text-warning-400'
            : 'text-gray-900 dark:text-obsidian-fg',
        )}
      >
        {value}
      </p>
      {sublabel && (
        <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-0.5 truncate">
          {sublabel}
        </p>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Empty / loading helpers
// ────────────────────────────────────────────────────────────────────

function EmptyScoresState({ workerEnabled }: { workerEnabled: boolean }) {
  return (
    <Card accent={workerEnabled ? 'brand' : 'warning'} padding="lg">
      <div className="flex flex-col items-center text-center max-w-md mx-auto py-6">
        {workerEnabled ? (
          <Sparkles size={28} className="text-brand-600" />
        ) : (
          <WifiOff size={28} className="text-warning-600" />
        )}
        <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-obsidian-fg">
          {workerEnabled
            ? 'No scores in this window yet'
            : 'Productivity scoring is off'}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-obsidian-muted">
          {workerEnabled ? (
            <>
              The worker is running but hasn’t produced any rows for the
              chosen cadence. Trigger a backfill below — the scorer reads
              the last 30 days of events for every active employee.
            </>
          ) : (
            <>
              Set <code className="font-mono text-xs">FEATURE_PULSE_COMPOSITE_SCORE_BETA=true</code>{' '}
              on the backend service (Railway → Variables) and redeploy.
              Then come back here and run “Recompute all” to backfill
              scores from the existing event log.
            </>
          )}
        </p>
      </div>
    </Card>
  );
}

function ScoresTableSkeleton() {
  return (
    <Card padding="none">
      <div className="p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-48" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-md" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </div>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Small visual primitives
// ────────────────────────────────────────────────────────────────────

function CadencePicker({
  value,
  onChange,
}: {
  value: ProductivityCadence;
  onChange: (c: ProductivityCadence) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-white/70 dark:bg-obsidian-sunken/80 p-1 border border-brand-100 dark:border-brand-900/40">
      {CADENCES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
            value === c
              ? 'bg-brand-600 text-white shadow-soft'
              : 'text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg',
          )}
        >
          {c.charAt(0) + c.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  );
}

function CompositeMeter({
  score,
  band,
}: {
  score: number;
  band: ScoreBand;
}) {
  const rounded = Math.round(score);
  return (
    <div className="flex items-center gap-2">
      <span className="text-base font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg w-9 text-right">
        {rounded}
      </span>
      <div className="h-1.5 w-28 rounded-full bg-gray-100 dark:bg-obsidian-border overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', BAND_FILL[band])}
          style={{ width: `${Math.max(0, Math.min(100, rounded))}%` }}
        />
      </div>
    </div>
  );
}

function RowFlags({
  gamingFlagsCount,
  inactiveSignals,
}: {
  gamingFlagsCount: number;
  inactiveSignals: ProductivitySignal[];
}) {
  if (gamingFlagsCount === 0 && inactiveSignals.length === 0) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {gamingFlagsCount > 0 && (
        <Badge tone="warning" size="xs">
          {gamingFlagsCount} gaming
        </Badge>
      )}
      {inactiveSignals.length > 0 && (
        <Badge tone="neutral" size="xs">
          {7 - inactiveSignals.length}/7 signals
        </Badge>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="shrink-0 h-8 w-8 rounded-full bg-gradient-to-br from-brand-500 to-fuchsia-500 text-white text-xs font-semibold grid place-items-center">
      {initials || '?'}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tab 2: Weights (active + history) — unchanged behaviour, polished
// ────────────────────────────────────────────────────────────────────

function WeightsTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pulse', 'weights'],
    queryFn: getPulseWeights,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (isError || !data)
    return (
      <Card accent="danger">
        <div className="text-sm text-danger-700 dark:text-danger-300">
          Could not load weights.
        </div>
      </Card>
    );

  if (!data.active) {
    return (
      <Card>
        <div className="text-sm text-gray-600 dark:text-obsidian-muted text-center py-6">
          No active weight set yet. A row will be seeded on the next boot once a
          SUPER_ADMIN user exists.
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-obsidian-fg">
              Active universal weights
            </h3>
            <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-0.5">
              Effective from{' '}
              {new Date(data.active.effectiveFrom).toLocaleDateString()} ·
              updated by {data.active.updatedBy?.name ?? 'system'}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-obsidian-muted">
            <Badge tone="info" size="xs">
              HIGH ≥ {data.active.thresholdHigh}
            </Badge>
            <Badge tone="neutral" size="xs">
              LOW &lt; {data.active.thresholdLow}
            </Badge>
          </div>
        </div>
        {data.active.changeNote && (
          <p className="mt-3 text-xs text-gray-600 dark:text-obsidian-muted italic">
            “{data.active.changeNote}”
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {PRODUCTIVITY_SIGNALS.map((sig) => {
            const w = data.active!.weights[sig] ?? 0;
            return (
              <div
                key={sig}
                className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-gray-50 dark:bg-obsidian-sunken px-3 py-2"
              >
                <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-obsidian-muted">
                  {sig.replace('_', ' ')}
                </p>
                <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg">
                  {(w * 100).toFixed(0)}%
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-obsidian-fg">
          History
        </h3>
        <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-0.5">
          Last 20 changes. Weights are edited via DB seed in v1; PATCH endpoint
          ships in a follow-up.
        </p>
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-obsidian-border">
          {data.history.map((h) => (
            <li
              key={h.id}
              className="py-2 flex items-start justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <p className="text-gray-800 dark:text-obsidian-fg">
                  {h.changeNote ?? 'No note provided'}
                </p>
                <p className="text-gray-500 dark:text-obsidian-muted">
                  {h.updatedBy?.name ?? 'system'} ·{' '}
                  {new Date(h.effectiveFrom).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tab 3: Worker health (observability snapshot)
// ────────────────────────────────────────────────────────────────────

function HealthTab({
  snapshot,
  loading,
  isError,
}: {
  snapshot: PulseObservabilitySnapshot | null;
  loading: boolean;
  isError: boolean;
}) {
  if (loading) return <Skeleton className="h-48 w-full" />;
  if (isError || !snapshot)
    return (
      <Card accent="danger">
        <div className="text-sm text-danger-700 dark:text-danger-300">
          Could not load observability snapshot.
        </div>
      </Card>
    );

  const lagOk = snapshot.workerLagSeconds < 300;
  const depthOk = snapshot.outboxDepth < 1000;
  const malformedOk = snapshot.malformedWeightsCount === 0;
  const enabled = snapshot.workerEnabled;

  return (
    <div className="space-y-4">
      {!enabled && (
        <Card accent="warning">
          <div className="flex items-start gap-2 text-sm text-warning-700 dark:text-warning-300">
            <WifiOff size={16} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Worker is disabled</p>
              <p className="text-xs opacity-80 mt-1">
                Set{' '}
                <code className="font-mono">
                  FEATURE_PULSE_COMPOSITE_SCORE_BETA=true
                </code>{' '}
                on the backend service (Railway → Variables) and redeploy. The
                worker boots automatically on startup.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={<BarChart3 size={16} />}
          label="Outbox depth"
          value={snapshot.outboxDepth.toLocaleString()}
          ok={depthOk}
          help="Unprocessed productivity_events. > 1000 = worker not keeping up."
        />
        <MetricCard
          icon={<Activity size={16} />}
          label="Worker lag"
          value={`${snapshot.workerLagSeconds}s`}
          ok={lagOk}
          help="Now − oldest unprocessed event. > 5 min for > 10 min = alert."
        />
        <MetricCard
          icon={<Gauge size={16} />}
          label="Compute p95"
          value={`${snapshot.computeDurations.p95Ms}ms`}
          ok={snapshot.computeDurations.p95Ms < 2000}
          help="p95 of one recompute. > 2s for > 30 min = scorer regression."
        />
        <MetricCard
          icon={<AlertTriangle size={16} />}
          label="Malformed weights"
          value={snapshot.malformedWeightsCount.toString()}
          ok={malformedOk}
          help="Cycles where the active weight row failed validation."
        />
      </div>

      <Card>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-obsidian-fg">
            Compute duration histogram
          </h3>
          <span className="text-xs text-gray-500 dark:text-obsidian-muted">
            Last cycle:{' '}
            {snapshot.lastCycleAt
              ? `${formatRelative(snapshot.lastCycleAt)} (${new Date(snapshot.lastCycleAt).toLocaleString()})`
              : 'never (worker not booted)'}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-obsidian-muted">
              Samples
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {snapshot.computeDurations.count}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-obsidian-muted">
              Mean
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {snapshot.computeDurations.meanMs}ms
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-obsidian-muted">
              p95
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {snapshot.computeDurations.p95Ms}ms
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-obsidian-muted">
              Max
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {snapshot.computeDurations.maxMs}ms
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  ok,
  help,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  ok: boolean;
  help: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div className="text-gray-400">{icon}</div>
        {ok ? (
          <CheckCircle2 size={14} className="text-success-500" />
        ) : (
          <AlertTriangle size={14} className="text-warning-500" />
        )}
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-gray-500 dark:text-obsidian-muted">
        {label}
      </p>
      <p className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg">
        {value}
      </p>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-obsidian-muted leading-snug">
        {help}
      </p>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────

/**
 * Wave 10 — pull the retry-in-seconds hint out of a backend
 * RECOMPUTE_THROTTLED 429 so the Recompute-all button can show
 * "Wait 28s" instead of a generic error toast. Falls back to
 * "Failed — retry" for any other shape (network drop, 500, etc).
 */
function recomputeThrottleMessage(err: unknown): string {
  const e = err as { response?: { data?: { error?: { code?: string; retryInSeconds?: number } } } };
  const code = e?.response?.data?.error?.code;
  const retry = e?.response?.data?.error?.retryInSeconds;
  if (code === 'RECOMPUTE_THROTTLED' && typeof retry === 'number') {
    return `Wait ${retry}s`;
  }
  return 'Failed — retry';
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/**
 * Client-side CSV export. We deliberately do not add a backend endpoint
 * for this — the rows are already in memory from the list query, and a
 * SUPER_ADMIN downloading their team's scores doesn't need a server
 * round-trip. The file omits the `signalScores` array (long, would
 * blow out a CSV row) — the breakdown drawer is the right surface for
 * per-signal data, not a spreadsheet column.
 */
function exportCsv(
  rows: CompositeScoreDTO[],
  usersById: Map<string, { name: string; email: string }>,
  cadence: ProductivityCadence,
) {
  // Header + body rows shipped as raw values; csvRow / downloadCsv
  // handle the formula-injection guard + RFC 4180 quoting per cell.
  const header = [
    'name',
    'email',
    'userId',
    'cadence',
    'windowStart',
    'windowEnd',
    'compositeScore',
    'band',
    'eventsCount',
    'gamingFlags',
    'inactiveSignals',
    'computedAt',
  ];
  const body = rows.map((r) => {
    const u = usersById.get(r.userId);
    return [
      u?.name ?? '',
      u?.email ?? '',
      r.userId,
      r.cadence,
      r.windowStart,
      r.windowEnd,
      r.compositeScore.toString(),
      r.band,
      r.computedFromEventCount.toString(),
      (r.flags.gamingFlagsCount ?? 0).toString(),
      (r.flags.inactiveSignals ?? []).join('|'),
      r.computedAt,
    ];
  });
  const filename = `pulse-scores-${cadence.toLowerCase()}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  // Header cells aren't user-controlled but go through csvRow for
  // consistency (and so the unit tests cover one code path).
  downloadCsv(filename, [header, ...body]);
  // Reference csvRow so an accidental tree-shake or refactor of the
  // header-only path doesn't drop the import.
  void csvRow;
}
