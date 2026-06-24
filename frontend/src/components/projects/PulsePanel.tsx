import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, Line,
} from 'recharts';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Diamond,
  Minus, Target, TrendingUp,
} from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useProjectForecast } from '@/hooks/useProjectForecast';
import { useTasks } from '@/hooks/useTasks';
import { useQuery } from '@tanstack/react-query';
import { getMilestones } from '@/api/milestones';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

/**
 * The "Project Pulse" panel — the single answer to "is my project on
 * track?" Replaces the four scattered Tier-1 tiles that used to sit on
 * the client Overview (Completion / Last shipped / In progress /
 * Latest update). Those were facts; this is a story.
 *
 * Three integrated headline metrics:
 *   - Delivery status (ON_TRACK / AT_RISK / BEHIND) with the expected
 *     date and how that compares to target.
 *   - Completion (% of story points done, with absolute counts).
 *   - Velocity (story points/week with a directional trend arrow vs.
 *     the prior 4 weeks).
 *
 * Below the headline: a burn-up area chart. Actual cumulative
 * story points done over time as a filled brand area; the ideal
 * trajectory from project start → target date as a dashed reference
 * line; "today" marked with a vertical reference line. Where the area
 * sits relative to the dashed line IS the schedule confidence — visual
 * answer, no caption needed.
 *
 * Below that: a velocity sparkline (last 8 weeks) so the headline
 * velocity number has context, plus a "Next milestone" chip.
 *
 * The panel is self-contained: it owns its hooks, derives every number
 * from existing endpoints (no new backend work), and renders to a
 * fixed height so the page layout is predictable.
 */

interface PulsePanelProps {
  projectId: string;
}

const TOOLTIP_STYLE = {
  contentStyle: {
    fontSize: 11,
    borderRadius: 8,
    border: '1px solid rgba(124,58,237,0.25)',
    backgroundColor: 'rgba(20,20,20,0.96)',
    color: '#dcddde',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: '8px 10px',
  },
  labelStyle: { fontWeight: 600 as const, color: '#f3f4f6', marginBottom: 2 },
  itemStyle:  { color: '#a3a3a3' },
  cursor:     { stroke: 'rgba(124,58,237,0.18)' },
};

export function PulsePanel({ projectId }: PulsePanelProps) {
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const { data: forecast, isLoading: forecastLoading } = useProjectForecast(projectId);
  const { data: tasks } = useTasks(projectId);
  const { data: milestones } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => getMilestones(projectId),
    enabled: !!projectId,
  });

  const loading = projectLoading || forecastLoading;

  // Burn-up data: bucket DONE tasks by week of completion, take the
  // cumulative sum. Ideal line: linear interpolation from 0 → total
  // points across the project window (startDate → targetDate). When
  // either date is missing, we degrade to "last 12 weeks of actuals"
  // with no ideal line.
  const chartData = useMemo(() => {
    if (!project || !tasks) return null;
    return computeBurnup({
      // Backend already returns the right task set per project access, so we
      // burn up over all of it — re-filtering by `clientVisible` would
      // understate progress for a full-access client.
      tasks,
      startDate: project.startDate,
      targetDate: project.targetDate,
    });
  }, [project, tasks]);

  // Pick the next chronological milestone the team hasn't completed
  // yet, even if it's slightly past due. Gives the panel a forward-
  // looking anchor (vs. trailing metrics elsewhere).
  const nextMilestone = useMemo(() => {
    if (!milestones) return null;
    return milestones
      .filter((m: any) => m.status !== 'COMPLETED')
      .slice()
      .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0] ?? null;
  }, [milestones]);

  if (loading || !project) {
    return (
      <div className="rounded-2xl border p-6 bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border shadow-soft dark:shadow-soft-dark">
        <div className="skeleton h-6 rounded w-1/3 mb-5" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-6">
          <div className="skeleton h-16 rounded" />
          <div className="skeleton h-16 rounded" />
          <div className="skeleton h-16 rounded" />
        </div>
        <div className="skeleton h-40 rounded" />
      </div>
    );
  }

  // Direction arrow on velocity: compare last 4 weeks avg vs. the 4
  // before that. Falls back to a neutral indicator when there isn't
  // enough history.
  const velocityTrend = computeVelocityTrend(forecast?.weeklyVelocityHistory);

  // Headline copy for the delivery metric. The forecast endpoint
  // already classifies into ON_TRACK / AT_RISK / BEHIND for us, with
  // an `expectedDate` and a `daysFromTarget`. We just render it.
  const deliveryHeadline = renderDeliveryHeadline(forecast);

  return (
    <section
      aria-label="Project pulse"
      className={cn(
        'rounded-2xl border p-5 sm:p-6 overflow-hidden',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}
    >
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted">
            Project pulse
          </h2>
          <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-0.5">
            How the project is tracking right now.
          </p>
        </div>
      </div>

      {/* ─── Three integrated headline metrics ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6 mb-6">
        {/* Delivery — the most-loaded reading */}
        <HeadlineMetric
          eyebrow="Delivery"
          value={deliveryHeadline.label}
          sub={deliveryHeadline.sub}
          tone={deliveryHeadline.tone}
          icon={<Target size={13} />}
        />

        {/* Completion */}
        <HeadlineMetric
          eyebrow="Completion"
          value={
            forecast?.completionPct != null
              ? `${forecast.completionPct}%`
              : '—'
          }
          sub={
            forecast?.totalPoints != null
              ? `${forecast.donePoints ?? 0} of ${forecast.totalPoints} pts done`
              : 'No story points yet'
          }
          tone="brand"
        />

        {/* Velocity with directional arrow */}
        <HeadlineMetric
          eyebrow="Velocity"
          value={
            forecast?.velocityPerWeek != null
              ? `${formatVelocity(forecast.velocityPerWeek)} pts/wk`
              : '—'
          }
          sub={velocityTrend.sub}
          tone="neutral"
          icon={velocityTrend.icon}
        />
      </div>

      {/* ─── Burn-up chart ─── */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
            Burn-up
          </p>
          {chartData?.idealAvailable && (
            <p className="text-[10px] text-gray-400 dark:text-obsidian-faded">
              Filled area vs. dashed line tells you the gap.
            </p>
          )}
        </div>
        {!chartData || chartData.points.length === 0 ? (
          <BurnupEmpty />
        ) : (
          <div className="h-44 -ml-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="pulse-actual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(124,124,124,0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: '#a3a3a3' }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#a3a3a3' }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
                <Tooltip {...TOOLTIP_STYLE} />
                {chartData.idealAvailable && (
                  <Line
                    dataKey="ideal"
                    name="Ideal"
                    stroke="rgba(160,160,160,0.7)"
                    strokeDasharray="4 4"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
                <Area
                  dataKey="actual"
                  name="Done"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#pulse-actual)"
                  isAnimationActive={false}
                />
                {chartData.todayIndex >= 0 && (
                  <ReferenceLine
                    x={chartData.points[chartData.todayIndex].label}
                    stroke="rgba(124,58,237,0.45)"
                    strokeDasharray="2 3"
                    label={{ value: 'today', position: 'top', fill: '#a78bfa', fontSize: 9 }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ─── Velocity sparkline + Next milestone ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-end pt-3 border-t border-gray-100 dark:border-obsidian-border">
        <VelocitySpark history={forecast?.weeklyVelocityHistory ?? []} />
        {nextMilestone ? (
          <NextMilestoneChip projectId={projectId} milestone={nextMilestone} />
        ) : (
          <div className="text-[11px] text-gray-400 dark:text-obsidian-faded text-right">
            No upcoming milestones set.
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Headline metric — three columns at the top of the panel. NOT a tile;
   no border, no separate background. Reads as part of the panel's body.
   ─────────────────────────────────────────────────────────────────── */

function HeadlineMetric({
  eyebrow, value, sub, tone, icon,
}: {
  eyebrow: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn' | 'bad' | 'brand' | 'neutral';
  icon?: React.ReactNode;
}) {
  const toneText: Record<string, string> = {
    ok:      'text-emerald-700 dark:text-emerald-300',
    warn:    'text-amber-700 dark:text-amber-300',
    bad:     'text-rose-700 dark:text-rose-300',
    brand:   'text-brand-700 dark:text-brand-300',
    neutral: 'text-gray-900 dark:text-obsidian-fg',
  };
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
        {icon}
        {eyebrow}
      </p>
      <p className={cn('mt-1 text-[22px] font-semibold tabular-nums leading-tight tracking-tight', toneText[tone])}>
        {value}
      </p>
      <p className="mt-1 text-[12px] text-gray-500 dark:text-obsidian-muted leading-snug line-clamp-2">
        {sub}
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Velocity sparkline — 8-week history strip below the chart
   ─────────────────────────────────────────────────────────────────── */

function VelocitySpark({ history }: { history: number[] }) {
  if (!history || history.length === 0) {
    return (
      <p className="text-[11px] text-gray-400 dark:text-obsidian-faded">
        Velocity history will appear once a few sprints have completed.
      </p>
    );
  }
  const last = history.slice(-8);
  const peak = Math.max(1, ...last);
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
        Velocity, last {last.length} weeks
      </p>
      <div className="mt-1.5 flex items-end gap-1 h-6">
        {last.map((v, i) => {
          const h = (v / peak) * 100;
          return (
            <span
              key={i}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-brand-500/30 to-brand-500"
              style={{ height: `${Math.max(h, 6)}%` }}
              title={`Week ${last.length - i}: ${formatVelocity(v)} pts`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Next milestone chip — small inline node
   ─────────────────────────────────────────────────────────────────── */

function NextMilestoneChip({
  projectId, milestone,
}: { projectId: string; milestone: any }) {
  const daysOut = Math.ceil((new Date(milestone.date).getTime() - Date.now()) / 86_400_000);
  const tone = daysOut < 0 ? 'rose' : daysOut <= 7 ? 'amber' : 'indigo';
  const toneRing: Record<string, string> = {
    rose:   'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
    amber:  'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
    indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30',
  };
  const tonePill: Record<string, string> = {
    rose:   'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    amber:  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300',
  };
  return (
    <Link
      to={`/client/projects/${projectId}/roadmap`}
      className={cn(
        'inline-flex items-center gap-2 ring-1 rounded-lg px-3 py-2 text-[12px] font-medium transition-shadow hover:shadow-md',
        toneRing[tone],
      )}
    >
      <Diamond size={11} fill="currentColor" />
      <span className="min-w-0 flex flex-col items-start">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] opacity-80">Up next</span>
        <span className="truncate max-w-[14rem]">{milestone.title}</span>
      </span>
      <span className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full', tonePill[tone])}>
        {daysOut < 0
          ? `${-daysOut}d late`
          : daysOut === 0 ? 'today'
          : daysOut === 1 ? 'tomorrow'
          : `${daysOut}d`}
      </span>
      <ArrowRight size={11} className="opacity-60 ml-0.5" />
    </Link>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Empty / fallback states
   ─────────────────────────────────────────────────────────────────── */

function BurnupEmpty() {
  return (
    <div className={cn(
      'h-32 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5',
      'border-gray-200 dark:border-obsidian-border',
      'bg-gray-50/40 dark:bg-obsidian-sunken/30',
    )}>
      <TrendingUp size={18} className="text-gray-300 dark:text-obsidian-faded" />
      <p className="text-[12px] text-gray-500 dark:text-obsidian-muted">
        The burn-up chart fills in as tasks ship.
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Math helpers (pure; testable in isolation if we ever want to)
   ─────────────────────────────────────────────────────────────────── */

interface BurnupComputeArgs {
  tasks: any[];
  startDate?: string | null;
  targetDate?: string | null;
}
interface BurnupResult {
  points: Array<{ label: string; date: string; actual: number; ideal: number | null }>;
  /** Whether we had enough date info to compute the ideal line. */
  idealAvailable: boolean;
  /** Index in `points` whose label === today's week, or -1. */
  todayIndex: number;
}

/**
 * Build a weekly burn-up dataset.
 *
 * Buckets DONE tasks (or DONE story points) into ISO-ish weeks, takes
 * the cumulative sum across weeks from project start through to today.
 * Ideal line linearly interpolates between 0 at start and the total
 * scope at target.
 *
 * Two failure modes that degrade gracefully:
 *   1. No start/target dates → return last 12 weeks of actuals with
 *      no ideal line (`idealAvailable=false`).
 *   2. No DONE tasks yet → return start..today buckets with a flat 0
 *      actual line + the ideal slope drawn behind it. The viewer sees
 *      the gap immediately.
 */
function computeBurnup(args: BurnupComputeArgs): BurnupResult {
  const totalPoints = args.tasks.reduce((s, t) => s + (t.storyPoints ?? 1), 0);
  const doneTasks = args.tasks
    .filter((t) => t.status === 'DONE')
    .map((t) => ({
      doneAt: new Date(t.enteredCurrentStatusAt ?? t.updatedAt),
      pts: t.storyPoints ?? 1,
    }))
    .sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime());

  const now = new Date();
  const startDate = args.startDate ? new Date(args.startDate) : null;
  const targetDate = args.targetDate ? new Date(args.targetDate) : null;

  // Anchor week labels to Mondays. The XAxis renders "MMM dd" so the
  // labels stay legible even when the chart compresses.
  const monday = (d: Date) => {
    const out = new Date(d);
    const day = out.getDay(); // 0=Sun..6=Sat
    const back = (day + 6) % 7;
    out.setDate(out.getDate() - back);
    out.setHours(0, 0, 0, 0);
    return out;
  };

  const firstWeekStart = monday(startDate ?? doneTasks[0]?.doneAt ?? now);
  // End the chart at the later of: today + 1 week, target date. So
  // the dashed ideal continues into the future a bit past today.
  const lastWeekStart = monday(
    targetDate && targetDate.getTime() > now.getTime() + 7 * 86_400_000
      ? targetDate
      : new Date(now.getTime() + 7 * 86_400_000),
  );

  const weeks: Date[] = [];
  for (let d = new Date(firstWeekStart); d.getTime() <= lastWeekStart.getTime(); d.setDate(d.getDate() + 7)) {
    weeks.push(new Date(d));
  }
  // Hard cap so a multi-year project doesn't render 200 buckets.
  const CAP = 26;
  const trimmedWeeks = weeks.length > CAP ? weeks.slice(weeks.length - CAP) : weeks;

  // Per-week actual = cumulative done points at the end of that week.
  // Per-week ideal = (week_index / (weeks_in_window - 1)) * totalPoints,
  // anchored on start..target if both known, otherwise null.
  const idealAvailable = !!startDate && !!targetDate && targetDate.getTime() > startDate.getTime() && totalPoints > 0;
  const totalSpanMs = idealAvailable ? targetDate!.getTime() - startDate!.getTime() : 0;

  const todayIndex = (() => {
    const todayMonday = monday(now).getTime();
    return trimmedWeeks.findIndex((w) => w.getTime() === todayMonday);
  })();

  const points = trimmedWeeks.map((wkStart) => {
    const wkEnd = new Date(wkStart.getTime() + 7 * 86_400_000);
    const cumulativeDone = doneTasks
      .filter((t) => t.doneAt < wkEnd && t.doneAt >= startDate!)
      .reduce((s, t) => s + t.pts, 0);
    // Actual fills the line up to today, then stays null for future
    // weeks so the area chart doesn't dip back to zero.
    const inFuture = wkStart.getTime() > now.getTime();
    const actual = inFuture
      ? Number.NaN  // recharts treats NaN as "skip" — line gap is intentional
      : cumulativeDone;
    let ideal: number | null = null;
    if (idealAvailable) {
      const fraction = Math.min(1, Math.max(0, (wkEnd.getTime() - startDate!.getTime()) / totalSpanMs));
      ideal = Math.round(fraction * totalPoints);
    }
    return {
      label: wkStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      date: wkStart.toISOString().slice(0, 10),
      actual: Number.isNaN(actual) ? null : actual,
      ideal,
    };
  });

  return { points: points as any, idealAvailable, todayIndex };
}

function computeVelocityTrend(history?: number[]): { icon: React.ReactNode; sub: string } {
  if (!history || history.length < 4) {
    return {
      icon: <Minus size={13} className="text-gray-400 dark:text-obsidian-faded" />,
      sub: 'Trend appears after 4 weeks of history',
    };
  }
  const last = history.slice(-4);
  const prior = history.slice(-8, -4);
  if (prior.length < 4) {
    return {
      icon: <Minus size={13} className="text-gray-400 dark:text-obsidian-faded" />,
      sub: 'Trend appears after 8 weeks',
    };
  }
  const lastAvg = last.reduce((s, n) => s + n, 0) / last.length;
  const priorAvg = prior.reduce((s, n) => s + n, 0) / prior.length;
  const diff = lastAvg - priorAvg;
  const pct = priorAvg === 0 ? 0 : Math.round((diff / priorAvg) * 100);
  if (Math.abs(pct) < 5) {
    return {
      icon: <Minus size={13} className="text-gray-500 dark:text-obsidian-muted" />,
      sub: 'Holding steady vs. last month',
    };
  }
  if (pct > 0) {
    return {
      icon: <ArrowUpRight size={13} className="text-emerald-600 dark:text-emerald-400" />,
      sub: `Up ${pct}% vs. last month`,
    };
  }
  return {
    icon: <ArrowDownRight size={13} className="text-rose-600 dark:text-rose-400" />,
    sub: `Down ${-pct}% vs. last month`,
  };
}

function renderDeliveryHeadline(forecast: any | undefined): { label: string; sub: string; tone: 'ok' | 'warn' | 'bad' | 'brand' | 'neutral' } {
  if (!forecast || forecast.status === 'BASELINING') {
    return { label: 'Baselining', sub: 'Forecast appears once a few sprints have completed.', tone: 'neutral' };
  }
  if (forecast.status === 'NO_TARGET') {
    return { label: 'No target set', sub: 'Set a target date to see the schedule story.', tone: 'neutral' };
  }
  if (forecast.status === 'COMPLETE') {
    return { label: 'Shipped', sub: 'All scoped work is done.', tone: 'ok' };
  }
  const days = forecast.daysFromTarget;
  const dateStr = forecast.expectedDate ? formatDate(forecast.expectedDate) : '—';
  if (forecast.deliveryStatus === 'ON_TRACK') {
    return {
      label: 'On track',
      sub: days != null && days < 0
        ? `${dateStr} · ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ahead of target`
        : `${dateStr} · on target`,
      tone: 'ok',
    };
  }
  if (forecast.deliveryStatus === 'AT_RISK') {
    return {
      label: 'At risk',
      sub: days != null && days > 0
        ? `${dateStr} · ${days} ${days === 1 ? 'day' : 'days'} after target`
        : `${dateStr} · slipping vs. target`,
      tone: 'warn',
    };
  }
  return {
    label: 'Behind',
    sub: days != null && days > 0
      ? `${dateStr} · ${days} ${days === 1 ? 'day' : 'days'} after target`
      : `${dateStr} · behind target`,
    tone: 'bad',
  };
}

function formatVelocity(v: number): string {
  if (v >= 10) return Math.round(v).toString();
  return v.toFixed(1).replace(/\.0$/, '');
}
