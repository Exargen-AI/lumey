import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock,
  Flame, Sparkles, TrendingUp, Target, Timer,
} from 'lucide-react';
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ComposedChart,
} from 'recharts';
import { useProject } from '@/hooks/useProjects';
import { useTasks } from '@/hooks/useTasks';
import { getMilestones } from '@/api/milestones';
import { getDeliverables } from '@/api/deliverables';
import { HEALTH_COLORS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

/**
 * Insights — the analytics depth surface for the client portal.
 *
 * The Overview's `<PulsePanel>` answers "is the project on track?" with
 * forecasts and a burn-up. Insights is the next layer down: HOW the
 * team is actually working — throughput rhythm, cycle-time distribution,
 * and the qualitative risks that matter this week. No duplicated
 * scorecards; if a metric appears in Pulse, it does not appear here.
 *
 * Every metric is derived client-side from tasks/milestones/deliverables
 * that Overview already warmed in react-query. No new endpoints.
 *
 * Layout (top → bottom):
 *   1. Health pulse strip — single line summary
 *   2. Throughput chart — weekly tasks shipped + 4-week moving avg
 *   3. Cycle-time panel — avg/p50 days from creation → DONE + histogram
 *   4. Risk register + Upcoming milestones (2-col)
 *
 * Every panel self-handles the "not enough data yet" case so the page
 * never goes empty on a brand-new project.
 */
export function ClientInsightsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const { data: tasks } = useTasks(id!);
  const { data: milestones } = useQuery({
    queryKey: ['milestones', id],
    queryFn: () => getMilestones(id!),
    enabled: !!id,
  });
  const { data: deliverables } = useQuery({
    queryKey: ['deliverables', id],
    queryFn: () => getDeliverables(id!),
    enabled: !!id,
  });

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-20 rounded-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
        <div className="skeleton h-56 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  // ─── Derive metrics ──────────────────────────────────────────────────
  // Trust the backend's per-project visibility gate (client-visible-only for
  // a regular client, full backlog for staff + full-access client members)
  // rather than re-filtering by `clientVisible`, which would understate the
  // metrics for a full-access client.
  const clientTasks: any[] = tasks ?? [];
  const done = clientTasks.filter((t: any) => t.status === 'DONE');
  const active = clientTasks.filter((t: any) => t.status === 'IN_PROGRESS' || t.status === 'IN_REVIEW');
  const totalCount = clientTasks.length;
  const doneCount = done.length;
  const completionPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Velocity buckets — 8 weeks of "tasks shipped this week".
  // Use `updatedAt` as a proxy for "moved to DONE" (the backend bumps
  // updatedAt on status transitions; close enough for a client-facing
  // sparkline). Bucketing is week-rounded to local Monday.
  const WEEKS = 8;
  const now = new Date();
  const weekBuckets: { label: string; iso: string; count: number }[] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const start = mondayOfWeek(addDays(now, -w * 7));
    const end = addDays(start, 7);
    const count = done.filter((t: any) => {
      const d = new Date(t.updatedAt);
      return d >= start && d < end;
    }).length;
    weekBuckets.push({
      label: w === 0 ? 'This week' : w === 1 ? 'Last week' : `${w}w ago`,
      iso: start.toISOString().slice(0, 10),
      count,
    });
  }
  const peakWeek = Math.max(1, ...weekBuckets.map((b) => b.count));
  const weeklyAvg = weekBuckets.reduce((s, b) => s + b.count, 0) / WEEKS;

  // Risk register.
  const blocked = active.filter((t: any) => t.isBlocked);
  const stale = active.filter((t: any) => (t.currentStatusAgeDays ?? 0) >= 5);
  const overdueTasks = active.filter((t: any) =>
    t.dueDate && new Date(t.dueDate).getTime() < Date.now(),
  );
  // Backend gates milestone visibility per project access; no client-side
  // `clientVisible` re-filter (it would hide internal milestones from a
  // full-access client).
  const sortedMilestones = (milestones ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const missedMilestones = sortedMilestones.filter((m: any) =>
    m.status !== 'COMPLETED' && new Date(m.date).getTime() < Date.now(),
  );
  const nearMilestones = sortedMilestones.filter((m: any) => {
    if (m.status === 'COMPLETED') return false;
    const days = (new Date(m.date).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 14;
  });

  // Deliverables waiting on client.
  const awaitingSignoff = (deliverables ?? []).filter((d: any) =>
    d.status === 'DELIVERED' && !d.clientSignedOffAt,
  );

  const projectAgeDays = project.startDate
    ? Math.max(0, Math.floor((Date.now() - new Date(project.startDate).getTime()) / 86_400_000))
    : null;
  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const healthLabel =
    project.healthStatus === 'GREEN' ? 'Healthy'
    : project.healthStatus === 'YELLOW' ? 'At risk'
    : 'Critical';
  const riskCount = blocked.length + stale.length + overdueTasks.length + missedMilestones.length;

  return (
    <div className="space-y-7 animate-fade-in-down">
      {/* ─── Page header ─── */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Insights
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          The pulse of your project — completion, velocity, communication
          rhythm, and the risks worth watching this week.
        </p>
      </header>

      {/* ─── Health pulse strip ─── */}
      <section
        className={cn(
          'rounded-2xl border p-5 flex items-center gap-5 flex-wrap',
          'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
          'shadow-soft dark:shadow-soft-dark',
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center shrink-0',
              project.healthStatus === 'RED' && 'animate-pulse',
            )}
            style={{
              backgroundColor: healthColor + '15',
              boxShadow: `inset 0 0 0 1px ${healthColor}30`,
            }}
          >
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: healthColor }} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
              Pulse
            </p>
            <p className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg">
              {healthLabel} · {PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]} phase
            </p>
          </div>
        </div>
        <span className="hidden md:block h-8 w-px bg-gray-100 dark:bg-obsidian-border" />
        <PulseFact
          icon={<CalendarClock size={14} className="text-gray-400 dark:text-obsidian-faded" />}
          label={projectAgeDays != null ? `${projectAgeDays} days in flight` : 'Just kicked off'}
          sub={project.startDate ? `Started ${formatDate(project.startDate)}` : '—'}
        />
        <PulseFact
          icon={<Target size={14} className="text-gray-400 dark:text-obsidian-faded" />}
          label={project.targetDate ? formatDate(project.targetDate) : 'Target TBD'}
          sub="Delivery target"
        />
        <PulseFact
          icon={<TrendingUp size={14} className="text-gray-400 dark:text-obsidian-faded" />}
          label={`${doneCount}/${totalCount || '—'} tasks done`}
          sub={`${completionPct}% complete`}
        />
      </section>

      {/* Headline tiles (Completion / Velocity / Cadence / Risks) used to
          live here — moved to the Overview PulsePanel. Insights goes
          straight from the pulse strip to the analytical charts. */}

      {/* ─── Throughput chart ─── Recharts area chart of weekly throughput
          with a 4-week moving-average overlay so the team's real cadence
          is legible past week-to-week noise. */}
      <Panel
        title="Throughput"
        eyebrow="Tasks shipped per week, last 8 weeks"
        icon={<TrendingUp size={14} className="text-brand-500 dark:text-brand-400" />}
      >
        {weekBuckets.every((b) => b.count === 0) ? (
          <EmptyState
            line="No tasks have shipped in the last 8 weeks."
            sub="The chart fills in as the team marks work done."
          />
        ) : (
          <ThroughputChart buckets={weekBuckets} weeklyAvg={weeklyAvg} peak={peakWeek} />
        )}
      </Panel>

      {/* ─── Cycle time ─── Distribution of days from task creation →
          DONE for the last 30 shipped tasks. A long tail (one or two tasks
          dragging the average up) is the signal worth catching. */}
      <CycleTimePanel doneTasks={done} />


      {/* ─── Risk register + Upcoming milestones, side-by-side ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel
          title="Risk register"
          eyebrow="Things worth watching"
          icon={<AlertTriangle size={14} className="text-amber-500 dark:text-amber-400" />}
        >
          {riskCount === 0 && awaitingSignoff.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={18} className="text-emerald-500" />}
              line="Nothing flagged right now."
              sub="No blocked tasks, no missed milestones, no items waiting on you."
            />
          ) : (
            <ul className="space-y-2.5">
              {blocked.length > 0 && (
                <RiskRow
                  icon={<Flame size={13} className="text-rose-600 dark:text-rose-400" />}
                  label={`${blocked.length} blocked ${blocked.length === 1 ? 'task' : 'tasks'}`}
                  sub={blocked.slice(0, 2).map((t: any) => t.title).join(' · ') + (blocked.length > 2 ? ` · +${blocked.length - 2} more` : '')}
                  tone="rose"
                />
              )}
              {stale.length > 0 && (
                <RiskRow
                  icon={<Clock size={13} className="text-amber-600 dark:text-amber-400" />}
                  label={`${stale.length} in progress >5 days`}
                  sub="Stale work-in-flight; ask the team for a status if you haven't seen movement."
                  tone="amber"
                />
              )}
              {overdueTasks.length > 0 && (
                <RiskRow
                  icon={<Clock size={13} className="text-rose-600 dark:text-rose-400" />}
                  label={`${overdueTasks.length} overdue ${overdueTasks.length === 1 ? 'task' : 'tasks'}`}
                  sub={overdueTasks.slice(0, 2).map((t: any) => t.title).join(' · ') + (overdueTasks.length > 2 ? ` · +${overdueTasks.length - 2} more` : '')}
                  tone="rose"
                />
              )}
              {missedMilestones.length > 0 && (
                <RiskRow
                  icon={<AlertTriangle size={13} className="text-rose-600 dark:text-rose-400" />}
                  label={`${missedMilestones.length} milestone${missedMilestones.length === 1 ? '' : 's'} past due`}
                  sub={missedMilestones.slice(0, 2).map((m: any) => m.title).join(' · ')}
                  tone="rose"
                />
              )}
              {awaitingSignoff.length > 0 && (
                <RiskRow
                  icon={<Sparkles size={13} className="text-brand-600 dark:text-brand-400" />}
                  label={`${awaitingSignoff.length} deliverable${awaitingSignoff.length === 1 ? '' : 's'} waiting on you`}
                  sub="Open the Deliverables tab to review and sign off."
                  tone="brand"
                />
              )}
            </ul>
          )}
        </Panel>

        <Panel
          title="Upcoming milestones"
          eyebrow="Next 14 days"
          icon={<CalendarClock size={14} className="text-indigo-500 dark:text-indigo-400" />}
        >
          {nearMilestones.length === 0 ? (
            <EmptyState
              line="No milestones in the next two weeks."
              sub={sortedMilestones.length > 0 ? 'Open Roadmap to see the full list.' : 'Milestones will appear here once the team sets them.'}
            />
          ) : (
            <ul className="space-y-3">
              {nearMilestones.map((m: any) => {
                const daysOut = Math.ceil((new Date(m.date).getTime() - Date.now()) / 86_400_000);
                const tone = daysOut <= 3 ? 'rose' : daysOut <= 7 ? 'amber' : 'neutral';
                return (
                  <li key={m.id} className="flex items-start gap-3">
                    <span
                      className={cn(
                        'mt-1 w-2.5 h-2.5 rounded-full shrink-0',
                        tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-indigo-400 dark:bg-indigo-500',
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">
                        {m.title}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5">
                        {formatDate(m.date)} ·{' '}
                        <span className={cn(
                          tone === 'rose' && 'text-rose-600 dark:text-rose-400 font-medium',
                          tone === 'amber' && 'text-amber-600 dark:text-amber-400 font-medium',
                        )}>
                          {daysOut <= 0 ? 'Today' : daysOut === 1 ? 'Tomorrow' : `in ${daysOut} days`}
                        </span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* The "Coming next" placeholder footer is gone — the Overview
          Pulse panel now ships the schedule-confidence forecast and the
          burn-up chart it was promising. */}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Charts
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Throughput chart — weekly tasks shipped as an area, with a 4-week
 * trailing moving average drawn as a line on top. The moving average is
 * the actual signal; the raw bars are noisy and individually misleading.
 * Recharts dedupes the bundle (already loaded for PulsePanel).
 */
function ThroughputChart({
  buckets, weeklyAvg, peak,
}: {
  buckets: { label: string; iso: string; count: number }[];
  weeklyAvg: number;
  peak: number;
}) {
  // 4-week trailing moving average (NaN until we have 4 points so the
  // line doesn't lie about early-history smoothing).
  const data = buckets.map((b, i) => {
    if (i < 3) return { ...b, avg: null as number | null };
    const window = buckets.slice(i - 3, i + 1).map((x) => x.count);
    return { ...b, avg: window.reduce((s, n) => s + n, 0) / 4 };
  });
  const yMax = Math.max(peak, Math.ceil(weeklyAvg) + 1, 3);

  return (
    <div className="space-y-3">
      <div className="h-44 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="insights-throughput-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgb(243 244 246 / 0.6)" className="dark:stroke-obsidian-border/40" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'currentColor' }}
              tickLine={false}
              axisLine={false}
              className="text-gray-400 dark:text-obsidian-faded"
            />
            <YAxis
              domain={[0, yMax]}
              allowDecimals={false}
              tick={{ fontSize: 10, fill: 'currentColor' }}
              tickLine={false}
              axisLine={false}
              width={28}
              className="text-gray-400 dark:text-obsidian-faded"
            />
            <Tooltip
              cursor={{ stroke: 'rgba(139, 92, 246, 0.25)', strokeWidth: 1 }}
              contentStyle={{
                background: 'rgba(17, 24, 39, 0.92)',
                border: 'none',
                borderRadius: 8,
                color: '#f9fafb',
                fontSize: 11,
                padding: '6px 10px',
              }}
              labelStyle={{ color: '#d1d5db', marginBottom: 2 }}
              formatter={(v: any, name: string) =>
                name === 'avg'
                  ? [v == null ? '—' : (v as number).toFixed(1), '4-wk avg']
                  : [v, 'Shipped']
              }
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#8b5cf6"
              strokeWidth={2}
              fill="url(#insights-throughput-area)"
              activeDot={{ r: 4, stroke: '#fff', strokeWidth: 1.5 }}
            />
            <Line
              type="monotone"
              dataKey="avg"
              stroke="#10b981"
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-gray-500 dark:text-obsidian-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-brand-500/60" />
          Tasks shipped
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-[2px] bg-emerald-500" style={{ backgroundImage: 'repeating-linear-gradient(to right, #10b981 0 4px, transparent 4px 7px)' }} />
          4-week moving avg
        </span>
        <span className="ml-auto">
          Avg <span className="font-medium text-gray-700 dark:text-obsidian-fg tabular-nums">{weeklyAvg.toFixed(1)}</span> / wk
        </span>
      </div>
    </div>
  );
}

/**
 * Cycle-time panel — stats + distribution histogram.
 *
 * Cycle time = days from task `createdAt` → `updatedAt` for tasks now in
 * DONE (the backend bumps `updatedAt` on status transitions; close
 * enough for a client-facing view without a dedicated `enteredDoneAt`
 * column). Filtered to the last 30 shipped tasks so a year-old project
 * doesn't get its current rhythm swamped by ancient data.
 *
 * Histogram bands are calibrated for typical web/product work — most
 * tickets land in <3d, multi-week tasks deserve a separate column to
 * make the long tail visible.
 */
function CycleTimePanel({ doneTasks }: { doneTasks: any[] }) {
  // Most recent 30 shipped tasks, sorted by ship date descending.
  const recent = doneTasks
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 30);

  const days = recent
    .map((t) => {
      const created = new Date(t.createdAt).getTime();
      const shipped = new Date(t.updatedAt).getTime();
      return Math.max(0, (shipped - created) / 86_400_000);
    })
    .filter((d) => Number.isFinite(d));

  if (days.length === 0) {
    return (
      <Panel
        title="Cycle time"
        eyebrow="Days from start to done"
        icon={<Timer size={14} className="text-indigo-500 dark:text-indigo-400" />}
      >
        <EmptyState
          line="Not enough shipped tasks to compute cycle time yet."
          sub="Once the team has shipped a handful, this panel shows the typical turnaround and the long-tail outliers."
        />
      </Panel>
    );
  }

  const avg = days.reduce((s, d) => s + d, 0) / days.length;
  const sorted = days.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];

  // Histogram bands (inclusive lower, exclusive upper).
  const bands = [
    { label: '< 1 day',  test: (d: number) => d < 1,                tone: 'emerald' as const },
    { label: '1–3 days', test: (d: number) => d >= 1 && d < 3,      tone: 'emerald' as const },
    { label: '3–7 days', test: (d: number) => d >= 3 && d < 7,      tone: 'amber'   as const },
    { label: '1–2 wks',  test: (d: number) => d >= 7 && d < 14,     tone: 'amber'   as const },
    { label: '2+ wks',   test: (d: number) => d >= 14,              tone: 'rose'    as const },
  ];
  const histogram = bands.map((b) => ({ ...b, count: days.filter(b.test).length }));
  const histMax = Math.max(1, ...histogram.map((h) => h.count));

  const longTailCount = histogram[3].count + histogram[4].count;
  const subhead =
    longTailCount === 0
      ? 'Tight distribution — no tasks stuck in flight.'
      : longTailCount === 1
      ? '1 task took more than a week — likely an outlier.'
      : `${longTailCount} tasks took more than a week — worth a closer look.`;

  return (
    <Panel
      title="Cycle time"
      eyebrow={`Last ${days.length} shipped task${days.length === 1 ? '' : 's'}`}
      icon={<Timer size={14} className="text-indigo-500 dark:text-indigo-400" />}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Stats column */}
        <div className="md:col-span-1 space-y-3">
          <CycleStat label="Median" value={fmtDays(p50)} accent="indigo" />
          <CycleStat label="Average" value={fmtDays(avg)} accent="brand" />
          <CycleStat label="90th percentile" value={fmtDays(p90)} accent="amber" />
          <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted leading-snug pt-1">
            {subhead}
          </p>
        </div>

        {/* Histogram column */}
        <div className="md:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-3">
            Distribution
          </p>
          <ul className="space-y-2">
            {histogram.map((row) => {
              const barPct = (row.count / histMax) * 100;
              const barColor: Record<string, string> = {
                emerald: 'bg-emerald-400 dark:bg-emerald-500',
                amber:   'bg-amber-400 dark:bg-amber-500',
                rose:    'bg-rose-400 dark:bg-rose-500',
              };
              return (
                <li key={row.label} className="flex items-center gap-3">
                  <span className="text-[11.5px] tabular-nums text-gray-500 dark:text-obsidian-muted w-16 shrink-0">
                    {row.label}
                  </span>
                  <div className="flex-1 h-2 bg-gray-100 dark:bg-obsidian-raised rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all', barColor[row.tone])}
                      style={{ width: `${Math.max(row.count > 0 ? 4 : 0, barPct)}%` }}
                    />
                  </div>
                  <span className="text-[11.5px] tabular-nums font-medium text-gray-700 dark:text-obsidian-fg w-6 text-right">
                    {row.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function CycleStat({
  label, value, accent,
}: {
  label: string;
  value: string;
  accent: 'brand' | 'indigo' | 'amber';
}) {
  const accentText: Record<string, string> = {
    brand:  'text-brand-700 dark:text-brand-300',
    indigo: 'text-indigo-700 dark:text-indigo-300',
    amber:  'text-amber-700 dark:text-amber-300',
  };
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
        {label}
      </p>
      <p className={cn('text-[22px] font-semibold tabular-nums leading-tight mt-0.5', accentText[accent])}>
        {value}
      </p>
    </div>
  );
}

function fmtDays(d: number): string {
  if (d < 1) {
    const hours = Math.max(1, Math.round(d * 24));
    return `${hours}h`;
  }
  if (d < 10) return `${d.toFixed(1)}d`;
  return `${Math.round(d)}d`;
}

/* ─── Shells & little parts ──────────────────────────────────────────── */

function Panel({
  title, eyebrow, icon, children,
}: {
  title: string;
  eyebrow?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-5',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted">
          {title}
        </h2>
        {eyebrow && (
          <>
            <span className="text-[11px] text-gray-300 dark:text-obsidian-faded">·</span>
            <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">{eyebrow}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

function PulseFact({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{label}</p>
        <p className="text-[11px] text-gray-400 dark:text-obsidian-faded truncate">{sub}</p>
      </div>
    </div>
  );
}

function RiskRow({
  icon, label, sub, tone,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  tone: 'brand' | 'emerald' | 'amber' | 'rose';
}) {
  const bg: Record<string, string> = {
    brand:   'bg-brand-50 dark:bg-brand-500/10',
    emerald: 'bg-emerald-50 dark:bg-emerald-500/10',
    amber:   'bg-amber-50 dark:bg-amber-500/10',
    rose:    'bg-rose-50 dark:bg-rose-500/10',
  };
  return (
    <li className={cn('flex items-start gap-3 p-3 rounded-xl', bg[tone])}>
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">{label}</p>
        <p className="text-[11.5px] text-gray-600 dark:text-obsidian-muted mt-0.5 leading-snug">{sub}</p>
      </div>
    </li>
  );
}

function EmptyState({ icon, line, sub }: { icon?: React.ReactNode; line: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center text-center py-6 gap-2">
      {icon}
      <p className="text-[13px] text-gray-600 dark:text-obsidian-fg">{line}</p>
      {sub && <p className="text-[11.5px] text-gray-400 dark:text-obsidian-faded max-w-sm">{sub}</p>}
    </div>
  );
}

/* ─── tiny helpers ───────────────────────────────────────────────────── */

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function mondayOfWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = (day + 6) % 7; // distance back to Monday
  out.setDate(out.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}
