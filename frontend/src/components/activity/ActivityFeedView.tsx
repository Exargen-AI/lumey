import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, ChevronLeft, ChevronRight, Clock, Filter, MessageSquare,
  Sparkles, User as UserIcon, Eye, Loader2, Calendar, Activity as ActivityIcon,
  TrendingUp, Bot,
} from 'lucide-react';
import { useActivityFeed } from '@/hooks/useToday';
import { useAuthStore } from '@/stores/authStore';
import { PRIORITY_COLORS, PRIORITY_LABELS, TASK_TYPE_LABELS, TASK_TYPE_COLORS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';
import type { ActivityEvent, ActivityFeedGroup, ActivityFeedTask } from '@/api/today';

/**
 * Combined "what's happening" view.
 *
 * Two sections in one page:
 *   1. **Today** — split into:
 *        - "Done today" callout strip (tasks that closed today)
 *        - "Activity" chronological feed (every event today —
 *          comments, status changes, blockers, reviews, sign-offs,
 *          edits, you-name-it)
 *      The activity feed is the primary "what's happening" surface;
 *      Done is a highlight within it because closing work is the
 *      moment worth celebrating.
 *   2. **This week** — split into:
 *        - "In focus" (currently in-progress / in-review)
 *        - "Shipped earlier this week" (last 6 days, project-grouped)
 *
 * Mounted by both `/today` (internal, cross-project) and
 * `/client/projects/:id/activity` (client, project-scoped). The
 * `projectId` prop drives the scope and tweaks copy.
 *
 * Mobile-friendly out of the box — every horizontal layout is gated by
 * Tailwind's `sm:` / `lg:` prefixes; on phones every panel stacks. The
 * Mine toggle is hidden in client mode (clients always see everything
 * visible to them on the project).
 */

interface ActivityFeedViewProps {
  /** Optional project scope. When set, results are filtered server-side
   *  to that one project — the client portal uses this. */
  projectId?: string;
  /** Title rendered above the page. Defaults to "What's happening"; the
   *  client view passes "Activity" to match the existing sidebar label. */
  title?: string;
}

export function ActivityFeedView({ projectId, title }: ActivityFeedViewProps) {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  // Clients always use the stripped portal feed. Per-project full access
  // surfaces as richer DATA from the backend (it returns the granted
  // project's internal activity), not a different feed layout.
  const isClient = role === 'CLIENT';

  // Date stepper state. dayOffset=0 is today, 1 = yesterday, …
  const [dayOffset, setDayOffset] = useState(0);
  const [mine, setMine] = useState(false);

  const dateIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return d.toISOString().slice(0, 10);
  }, [dayOffset]);

  const { data, isLoading } = useActivityFeed({ date: dateIso, mine, projectId });

  // Pre-compute counts + sections.
  const doneGroups = data?.today.doneTasks ?? [];
  const events = data?.today.events ?? [];
  const inFocus = data?.thisWeek.inFocus ?? [];
  const shippedGroups = data?.thisWeek.shippedGroups ?? [];

  const doneCount = doneGroups.reduce((s, g) => s + g.tasks.length, 0);
  const todayPoints = doneGroups.reduce(
    (s, g) => s + g.tasks.reduce((ss, t) => ss + (t.storyPoints ?? 0), 0), 0,
  );
  const weekShippedCount = shippedGroups.reduce((s, g) => s + g.tasks.length, 0);

  // 7-day throughput buckets (today on the right). Today's count comes
  // from `doneGroups`; the prior 6 days are bucketed from
  // `shippedGroups[*].tasks[*].timestamp`. The hook fetches both, so this
  // is essentially free — no extra round trip.
  const throughputBuckets = useMemo(() => {
    const buckets: { iso: string; weekdayShort: string; count: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      buckets.push({
        iso: d.toISOString().slice(0, 10),
        weekdayShort: d.toLocaleDateString(undefined, { weekday: 'short' }),
        count: 0,
        isToday: i === 0,
      });
    }
    buckets[6].count = doneCount;
    for (const g of shippedGroups) {
      for (const t of g.tasks) {
        const d = new Date(t.timestamp);
        d.setHours(0, 0, 0, 0);
        const iso = d.toISOString().slice(0, 10);
        const idx = buckets.findIndex((b) => b.iso === iso);
        if (idx >= 0 && idx < 6) buckets[idx].count++;
      }
    }
    return buckets;
  }, [doneCount, shippedGroups]);
  const sevenDayTotal = throughputBuckets.reduce((s, b) => s + b.count, 0);

  const subtitle = projectId
    ? "Every comment, status change, and sign-off on your project today, plus what's in motion this week."
    : "Every comment, status change, and sign-off today across your projects, plus the team's working set this week.";

  return (
    <div className="space-y-7 animate-fade-in-down">
      {/* ─── Header + stepper + Mine toggle ─── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
            {projectId ? 'Project activity' : 'Daily wrap-up'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            {title ?? "What's happening"}
            <span className="ml-2 text-[15px] font-normal text-gray-500 dark:text-obsidian-muted">
              {dayOffset === 0 ? 'today' : dayOffset === 1 ? 'yesterday' : prettyDate(dateIso)}
            </span>
          </h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Mine toggle — internal users scoping to themselves. Hidden
              for clients (the API treats clients as "always me" anyway). */}
          {!isClient && (
            <button
              type="button"
              onClick={() => setMine((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                'border min-h-[36px]',
                mine
                  ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-500/40 dark:bg-brand-500/10 dark:text-brand-300'
                  : 'border-gray-200 bg-white text-gray-600 dark:border-obsidian-border dark:bg-obsidian-raised dark:text-obsidian-muted hover:border-gray-300 dark:hover:border-obsidian-border-strong',
              )}
              aria-pressed={mine}
              title={mine ? 'Showing only tasks you completed' : 'Show only tasks you completed'}
            >
              <Filter size={12} />
              {mine ? 'Just mine' : 'Everyone'}
            </button>
          )}

          {/* Date stepper. Forward arrow disables on offset=0 (no future days). */}
          <div className="inline-flex items-center rounded-md border border-gray-200 dark:border-obsidian-border overflow-hidden bg-white dark:bg-obsidian-raised">
            <button
              type="button"
              onClick={() => setDayOffset((v) => v + 1)}
              className="px-2 py-1.5 text-gray-500 dark:text-obsidian-muted hover:bg-gray-50 dark:hover:bg-obsidian-panel transition-colors min-h-[36px]"
              aria-label="Previous day"
              title="Previous day"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              onClick={() => setDayOffset(0)}
              disabled={dayOffset === 0}
              className={cn(
                'px-3 py-1.5 text-[12px] font-medium border-x border-gray-200 dark:border-obsidian-border min-h-[36px]',
                'text-gray-700 dark:text-obsidian-fg',
                dayOffset === 0 ? 'opacity-60 cursor-default' : 'hover:bg-gray-50 dark:hover:bg-obsidian-panel transition-colors',
              )}
              title="Jump to today"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setDayOffset((v) => Math.max(0, v - 1))}
              disabled={dayOffset === 0}
              className={cn(
                'px-2 py-1.5 text-gray-500 dark:text-obsidian-muted transition-colors min-h-[36px]',
                dayOffset === 0
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-gray-50 dark:hover:bg-obsidian-panel',
              )}
              aria-label="Next day"
              title="Next day"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Throughput strip ─── A 7-day mini bar chart. The earlier
          three-stat tile strip (Events / Closed / In focus) duplicated
          numbers that already render inline in each subsection header;
          this replaces that with a single piece of new information —
          shipping cadence over the last week. */}
      <ThroughputStrip buckets={throughputBuckets} total={sevenDayTotal} isLoading={isLoading} />

      {/* Inline counts now live on each subsection header (e.g.
          "Activity · 23"), so the standalone tile strip is gone. */}

      {/* ─── Section 1 — TODAY ───
          Two sub-sections inside:
            (a) Done today — compact callout strip with the tasks that
                closed. Surfaces the celebrate-this-now moment first.
            (b) Activity — chronological feed of every event today
                (comments, status changes, blockers, reviews, etc.).
                This is the primary "what's happening" surface; Done is
                just a highlight of one outcome inside it. */}
      <Section
        title="Today"
        eyebrow={dayOffset === 0 ? 'Live' : prettyDate(dateIso)}
        icon={<ActivityIcon size={14} className="text-brand-500 dark:text-brand-400" />}
      >
        <div className="space-y-5">
          {/* (a) Done-today callout */}
          <Subsection
            title="Done today"
            count={doneCount}
            hint={doneCount === 0 ? undefined : (todayPoints > 0 ? `${todayPoints} story points shipped.` : undefined)}
          >
            {isLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-20 rounded-xl" />
              </div>
            ) : doneGroups.length === 0 ? (
              <EmptyHint
                line={
                  mine
                    ? 'Nothing closed by you on this day.'
                    : dayOffset === 0
                      ? 'No tasks shipped yet today.'
                      : 'No tasks shipped this day.'
                }
              />
            ) : (
              <div className="space-y-4">
                {doneGroups.map((g) => (
                  <ProjectGroup key={`done-${g.project.id}`} group={g} role={role} hideProjectHeader={!!projectId} compact />
                ))}
              </div>
            )}
          </Subsection>

          {/* (b) Activity feed — every event today */}
          <Subsection
            title="Activity"
            count={events.length}
            hint="Every comment, status change, blocker, review, and sign-off. Newest first."
          >
            {isLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-12 rounded-lg" />
                <div className="skeleton h-12 rounded-lg" />
                <div className="skeleton h-12 rounded-lg" />
              </div>
            ) : events.length === 0 ? (
              <EmptyHint
                line={
                  mine
                    ? 'Nothing from you on this day.'
                    : dayOffset === 0
                      ? 'No activity yet today.'
                      : 'No activity captured on this day.'
                }
                sub="Events flow in the moment someone comments, moves a card, or signs off."
              />
            ) : (
              <ul className="space-y-1.5">
                {events.map((ev) => (
                  <ActivityEventRow key={ev.id} event={ev} role={role} hideProjectChip={!!projectId} />
                ))}
              </ul>
            )}
          </Subsection>
        </div>
      </Section>

      {/* ─── Section 2 — THIS WEEK ─── */}
      <Section
        title="This week"
        eyebrow={data ? prettyRange(data.thisWeek.startDate, data.thisWeek.endDate) : 'Last 7 days'}
        icon={<Calendar size={14} className="text-brand-500 dark:text-brand-400" />}
      >
        <div className="space-y-6">
          {/* In focus */}
          <Subsection
            title="In focus"
            count={inFocus.length}
            hint="What the team is actively working on or reviewing right now."
          >
            {isLoading ? (
              <div className="space-y-2">
                <div className="skeleton h-16 rounded-lg" />
                <div className="skeleton h-16 rounded-lg" />
              </div>
            ) : inFocus.length === 0 ? (
              <EmptyHint line="Nothing in motion right now." sub="When work moves to In Progress or In Review it'll show up here." />
            ) : (
              <ul className="space-y-2">
                {inFocus.slice(0, 20).map((task) => (
                  <InFocusRow key={`focus-${task.id}`} task={task} role={role} hideProjectChip={!!projectId} />
                ))}
                {inFocus.length > 20 && (
                  <li className="text-[11px] text-gray-400 dark:text-obsidian-faded pl-2">
                    Showing 20 of {inFocus.length}. The rest live on the project board.
                  </li>
                )}
              </ul>
            )}
          </Subsection>

          {/* Shipped earlier this week */}
          <Subsection
            title="Shipped earlier this week"
            count={weekShippedCount}
            hint="Tasks that closed in the prior 6 days."
          >
            {isLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-20 rounded-xl" />
                <div className="skeleton h-20 rounded-xl" />
              </div>
            ) : shippedGroups.length === 0 ? (
              <EmptyHint line="Nothing shipped earlier this week." />
            ) : (
              <div className="space-y-4">
                {shippedGroups.map((g) => (
                  <ProjectGroup
                    key={`week-${g.project.id}`}
                    group={g}
                    role={role}
                    hideProjectHeader={!!projectId}
                    compact
                  />
                ))}
              </div>
            )}
          </Subsection>
        </div>
      </Section>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Project group + task rows
   ─────────────────────────────────────────────────────────────────── */

function ProjectGroup({
  group, role, hideProjectHeader, compact,
}: {
  group: ActivityFeedGroup;
  role?: string;
  hideProjectHeader?: boolean;
  /** Compact mode: smaller row chrome, no inline comment thread. Used
   *  by the "shipped earlier this week" sub-section where density
   *  matters more than reading every comment. */
  compact?: boolean;
}) {
  const isClient = role === 'CLIENT';
  const projectHref = isClient
    ? `/client/projects/${group.project.id}`
    : `/projects/${group.project.id}`;
  return (
    <section className={cn(
      'rounded-2xl border overflow-hidden',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      {!hideProjectHeader && (
        <header className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-obsidian-border bg-gray-50/60 dark:bg-obsidian-sunken/40">
          <div className="min-w-0">
            <Link
              to={projectHref}
              className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg hover:text-brand-700 dark:hover:text-brand-300 transition-colors truncate"
            >
              {group.project.name}
            </Link>
            <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-0.5">
              {group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'} closed
            </p>
          </div>
        </header>
      )}
      <ul className="divide-y divide-gray-100 dark:divide-obsidian-border">
        {group.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            projectId={group.project.id}
            role={role}
            compact={compact}
          />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({
  task, projectId, role, compact,
}: {
  task: ActivityFeedTask;
  projectId: string;
  role?: string;
  compact?: boolean;
}) {
  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] ?? '#6b7280';
  const typeColor = TASK_TYPE_COLORS[task.taskType as keyof typeof TASK_TYPE_COLORS] ?? '#6b7280';
  const isClient = role === 'CLIENT';
  const taskHref = isClient
    ? `/client/projects/${projectId}/tasks/${task.id}`
    : `/projects/${projectId}/tasks/${task.id}`;

  return (
    <li className={cn('px-4 sm:px-5 transition-colors hover:bg-gray-50/60 dark:hover:bg-obsidian-raised/40', compact ? 'py-3' : 'py-4')}>
      <div className="flex items-start gap-3">
        <CheckCircle2 size={15} className="mt-0.5 text-emerald-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Link
              to={taskHref}
              className="text-[13.5px] font-medium text-gray-900 dark:text-obsidian-fg hover:text-brand-700 dark:hover:text-brand-300 transition-colors line-clamp-2"
            >
              {task.title}
            </Link>
            <span className="text-[11px] text-gray-400 dark:text-obsidian-faded shrink-0 tabular-nums">
              {formatRelative(task.timestamp)}
            </span>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
              {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
            </span>
            {task.taskType && task.taskType !== 'FEATURE' && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ backgroundColor: typeColor + '15', color: typeColor }}>
                {TASK_TYPE_LABELS[task.taskType as keyof typeof TASK_TYPE_LABELS]}
              </span>
            )}
            {task.storyPoints != null && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-brand-50 dark:bg-brand-500/15 text-brand-600 dark:text-brand-300">
                {task.storyPoints}pt
              </span>
            )}
            {task.actor && (
              <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-obsidian-muted">
                <UserIcon size={11} />
                {task.actor.name}
              </span>
            )}
          </div>

          {/* Inline comments — daily-standup substance. Skipped in
              compact mode where the row needs to stay terse. */}
          {!compact && task.comments && task.comments.length > 0 && (
            <ul className="mt-3 space-y-2 border-l-2 border-gray-100 dark:border-obsidian-border pl-3">
              {task.comments.map((c) => (
                <li key={c.id} className="text-[12.5px] text-gray-700 dark:text-obsidian-muted leading-relaxed">
                  <p className="whitespace-pre-wrap line-clamp-3">{c.content}</p>
                  <p className="mt-0.5 text-[10.5px] text-gray-400 dark:text-obsidian-faded inline-flex items-center gap-1">
                    <MessageSquare size={10} />
                    {c.author?.name ?? 'Someone'}
                    <span aria-hidden>·</span>
                    <Clock size={10} />
                    {formatRelative(c.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   In-focus row — denser than a TaskRow, status-aware
   ─────────────────────────────────────────────────────────────────── */

function InFocusRow({
  task, role, hideProjectChip,
}: {
  task: ActivityFeedTask;
  role?: string;
  hideProjectChip?: boolean;
}) {
  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] ?? '#6b7280';
  const isClient = role === 'CLIENT';
  const taskHref = isClient
    ? `/client/projects/${task.project.id}/tasks/${task.id}`
    : `/projects/${task.project.id}/tasks/${task.id}`;
  const projectHref = isClient
    ? `/client/projects/${task.project.id}`
    : `/projects/${task.project.id}`;

  // Status visual: amber dot for IN_REVIEW (waiting on review), brand
  // spinner-like icon for IN_PROGRESS. Different tones so the eye can
  // scan the list and group by status.
  const isReview = task.status === 'IN_REVIEW';
  const statusChip = isReview
    ? { label: 'In review', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' }
    : { label: 'In progress', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' };

  return (
    <li className={cn(
      'flex items-start gap-3 p-3 rounded-xl border',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors',
    )}>
      {isReview
        ? <Eye size={14} className="mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
        : <Loader2 size={14} className="mt-0.5 text-brand-600 dark:text-brand-400 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <Link
            to={taskHref}
            className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg hover:text-brand-700 dark:hover:text-brand-300 transition-colors line-clamp-2"
          >
            {task.title}
          </Link>
          <span className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded', statusChip.cls)}>
            {statusChip.label}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-gray-500 dark:text-obsidian-muted">
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded" style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
            {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
          </span>
          {!hideProjectChip && (
            <Link
              to={projectHref}
              className="hover:text-brand-700 dark:hover:text-brand-300 transition-colors truncate"
            >
              {task.project.name}
            </Link>
          )}
          {task.actor && (
            <span className="inline-flex items-center gap-1">
              <UserIcon size={10} />
              {isReview ? 'reviewing:' : 'assignee:'} {task.actor.name}
            </span>
          )}
          <span className="inline-flex items-center gap-1 ml-auto">
            <Clock size={10} /> {formatRelative(task.timestamp)}
          </span>
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Activity event row — chronological feed entry

   One row per Activity log entry. Action drives the icon + label;
   task-targeted events deep-link into the task; everything carries a
   relative timestamp. Comments + status changes get specialised
   rendering so the row actually says something useful (vs. a generic
   "updated task").
   ─────────────────────────────────────────────────────────────────── */

type ActionTone = 'positive' | 'neutral' | 'destructive' | 'info' | 'brand';
interface ActionConfig {
  /** Short verb fragment, lowercase. The row reads as
   *  "<Actor> <verb> <target>". */
  verb: string;
  tone: ActionTone;
  emoji: string;
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  // Tasks
  created_task:                { verb: 'created',              tone: 'positive',    emoji: '➕' },
  updated_task:                { verb: 'updated',              tone: 'info',        emoji: '✏️' },
  moved_task:                  { verb: 'moved',                tone: 'neutral',     emoji: '➡️' },
  deleted_task:                { verb: 'deleted',              tone: 'destructive', emoji: '🗑️' },
  blocked_task:                { verb: 'blocked',              tone: 'destructive', emoji: '🚨' },
  unblocked_task:              { verb: 'unblocked',            tone: 'positive',    emoji: '✅' },
  submitted_client_request:    { verb: 'submitted request',    tone: 'brand',       emoji: '📩' },
  review_requested:            { verb: 'requested review on',  tone: 'info',        emoji: '👀' },
  review_approved:             { verb: 'approved',             tone: 'positive',    emoji: '✓' },
  review_changes_requested:    { verb: 'requested changes on', tone: 'info',        emoji: '↺' },
  spawned_subtask:             { verb: 'spawned subtask from', tone: 'brand',       emoji: '🔱' },
  // Projects
  created_project:             { verb: 'created project',      tone: 'neutral',     emoji: '📁' },
  updated_project:             { verb: 'updated project',      tone: 'info',        emoji: '📝' },
  deleted_project:             { verb: 'deleted project',      tone: 'destructive', emoji: '🗑️' },
  changed_phase:               { verb: 'changed phase',        tone: 'info',        emoji: '🔄' },
  set_health:                  { verb: 'set health',           tone: 'info',        emoji: '🏥' },
  added_member:                { verb: 'added member',         tone: 'positive',    emoji: '👥' },
  removed_member:              { verb: 'removed member',       tone: 'destructive', emoji: '👥' },
  // Milestones
  created_milestone:           { verb: 'created milestone',    tone: 'neutral',     emoji: '🎯' },
  updated_milestone:           { verb: 'updated milestone',    tone: 'info',        emoji: '✏️' },
  completed_milestone:         { verb: 'completed milestone',  tone: 'positive',    emoji: '🏁' },
  deleted_milestone:           { verb: 'deleted milestone',    tone: 'destructive', emoji: '🗑️' },
  // Decisions
  created_decision:            { verb: 'recorded decision',    tone: 'neutral',     emoji: '🧭' },
  updated_decision:            { verb: 'updated decision',     tone: 'info',        emoji: '✏️' },
  deleted_decision:            { verb: 'deleted decision',     tone: 'destructive', emoji: '🗑️' },
  // Comments
  created_comment:             { verb: 'commented on',         tone: 'info',        emoji: '💬' },
  edited_comment:              { verb: 'edited a comment on',  tone: 'info',        emoji: '✏️' },
  // Status updates
  created_status_update:       { verb: 'posted status update', tone: 'neutral',     emoji: '📊' },
  // Deliverables
  created_deliverable:         { verb: 'added deliverable',    tone: 'neutral',     emoji: '📦' },
  marked_deliverable_delivered:{ verb: 'delivered',            tone: 'positive',    emoji: '🚀' },
  signed_off_deliverable:      { verb: 'signed off on',        tone: 'positive',    emoji: '✅' },
  rejected_deliverable:        { verb: 'requested revisions on', tone: 'destructive', emoji: '↺' },
  // Products
  created_product:             { verb: 'created product',      tone: 'neutral',     emoji: '🧩' },
  updated_product:             { verb: 'updated product',      tone: 'info',        emoji: '✏️' },
  deleted_product:             { verb: 'deleted product',      tone: 'destructive', emoji: '🗑️' },
  // Documents
  uploaded_document:           { verb: 'uploaded a document',  tone: 'neutral',     emoji: '📎' },
  deleted_document:            { verb: 'deleted a document',   tone: 'destructive', emoji: '🗑️' },
};

const FALLBACK_ACTION: ActionConfig = { verb: 'updated', tone: 'neutral', emoji: '🔔' };

const TONE_RING: Record<ActionTone, string> = {
  positive:    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  neutral:     'bg-gray-50 text-gray-700 ring-gray-200 dark:bg-obsidian-raised dark:text-obsidian-fg dark:ring-obsidian-border',
  info:        'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30',
  destructive: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
  brand:       'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30',
};

function ActivityEventRow({
  event, role, hideProjectChip,
}: {
  event: ActivityEvent;
  role?: string;
  hideProjectChip?: boolean;
}) {
  const cfg = ACTION_CONFIG[event.action] ?? FALLBACK_ACTION;
  const isClient = role === 'CLIENT';
  const taskHref = event.task && event.project
    ? (isClient
        ? `/client/projects/${event.project.id}/tasks/${event.task.id}`
        : `/projects/${event.project.id}/tasks/${event.task.id}`)
    : null;
  const projectHref = event.project
    ? (isClient ? `/client/projects/${event.project.id}` : `/projects/${event.project.id}`)
    : null;

  // Pull a status transition out of details when relevant ("from X to Y").
  const details = event.details ?? {};
  const fromStatus = typeof details.from === 'string' ? details.from : null;
  const toStatus = typeof details.to === 'string' ? details.to : null;
  const transitionSuffix = (event.action === 'moved_task' && fromStatus && toStatus)
    ? `(${fromStatus.toLowerCase().replace('_', ' ')} → ${toStatus.toLowerCase().replace('_', ' ')})`
    : null;

  return (
    <li className={cn(
      'flex items-start gap-3 px-3 py-2.5 rounded-lg',
      'hover:bg-gray-50 dark:hover:bg-obsidian-raised/40 transition-colors',
    )}>
      {/* Action chip — small badge with emoji on a tone-tinted ring */}
      <span
        aria-hidden
        className={cn(
          'shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-[12px] ring-1',
          TONE_RING[cfg.tone],
        )}
      >
        {cfg.emoji}
      </span>

      <div className="min-w-0 flex-1">
        {/* Top line — actor + verb + target */}
        <p className="text-[13px] text-gray-800 dark:text-obsidian-fg leading-snug">
          <span className="font-semibold">{event.actor?.name ?? 'Someone'}</span>
          {/* Immutable audit attribution — an agent-driven action is flagged. */}
          {event.actorType === 'AGENT' && (
            <span
              className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-px align-middle text-[10px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
              title="Performed by an AI agent"
            >
              <Bot size={10} /> agent
            </span>
          )}{' '}
          <span className="text-gray-600 dark:text-obsidian-muted">{cfg.verb}</span>{' '}
          {event.task && taskHref ? (
            <Link
              to={taskHref}
              className="font-medium text-gray-900 dark:text-obsidian-fg hover:text-brand-700 dark:hover:text-brand-300 transition-colors underline-offset-2 hover:underline"
            >
              {event.task.title}
            </Link>
          ) : event.task ? (
            <span className="font-medium text-gray-900 dark:text-obsidian-fg">{event.task.title}</span>
          ) : (
            <span className="italic text-gray-400 dark:text-obsidian-faded">a project resource</span>
          )}
          {transitionSuffix && (
            <span className="text-[11.5px] text-gray-500 dark:text-obsidian-muted ml-1">{transitionSuffix}</span>
          )}
        </p>

        {/* Bottom line — meta: project, timestamp */}
        <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[11px] text-gray-500 dark:text-obsidian-muted">
          {!hideProjectChip && projectHref && event.project && (
            <Link
              to={projectHref}
              className="hover:text-brand-700 dark:hover:text-brand-300 transition-colors truncate max-w-[12rem]"
            >
              {event.project.name}
            </Link>
          )}
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Clock size={10} /> {formatRelative(event.createdAt)}
          </span>
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────────────────────────────────────────────────────
   Section shells + small bits
   ─────────────────────────────────────────────────────────────────── */

function Section({
  title, eyebrow, icon, children,
}: { title: string; eyebrow?: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
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
    </section>
  );
}

function Subsection({
  title, count, hint, children,
}: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg">
            {title}
            {count != null && (
              <span className="ml-2 text-[11px] font-normal text-gray-400 dark:text-obsidian-faded tabular-nums">
                {count}
              </span>
            )}
          </h3>
          {hint && (
            <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted mt-0.5">{hint}</p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * 7-day throughput strip — single-row mini bar chart of tasks shipped
 * per day, today on the right. Hand-rolled (no recharts) so this stays
 * out of the recharts bundle on a page that otherwise has no charts.
 *
 * Today's bar is brand-saturated, prior days are tinted lighter, so the
 * eye lands on "what's happened so far today" without reading any text.
 */
function ThroughputStrip({
  buckets, total, isLoading,
}: {
  buckets: { iso: string; weekdayShort: string; count: number; isToday: boolean }[];
  total: number;
  isLoading: boolean;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const todayCount = buckets[buckets.length - 1]?.count ?? 0;
  const trailing6 = buckets.slice(0, 6).reduce((s, b) => s + b.count, 0);
  const dailyAvg = trailing6 / 6;
  // Intelligence line — one sentence summarising the trend without a tile.
  const trendLine =
    isLoading ? 'Loading shipping cadence…'
    : total === 0 ? "No tasks shipped in the last 7 days yet."
    : todayCount === 0 ? `Quiet so far today · ${trailing6} shipped in the prior 6 days.`
    : todayCount > dailyAvg * 1.5 ? `Strong day — ${todayCount} shipped, well above the ${dailyAvg.toFixed(1)}/day pace.`
    : todayCount < dailyAvg * 0.5 ? `Slower day — ${todayCount} shipped vs ${dailyAvg.toFixed(1)}/day pace.`
    : `Steady pace · ${dailyAvg.toFixed(1)} tasks/day across the prior 6 days.`;

  return (
    <div
      className={cn(
        'rounded-xl border p-4 sm:p-5',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-gray-500 dark:text-obsidian-muted">
            <TrendingUp size={13} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">Last 7 days</span>
          </div>
          <p className="mt-1 text-[18px] font-semibold tabular-nums text-gray-900 dark:text-obsidian-fg leading-tight">
            {isLoading ? '—' : total} <span className="text-[12px] font-normal text-gray-500 dark:text-obsidian-muted">task{total === 1 ? '' : 's'} shipped</span>
          </p>
        </div>
        <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted max-w-md text-right">
          {trendLine}
        </p>
      </div>
      <div className="flex items-end gap-1.5 sm:gap-2 h-14">
        {buckets.map((b) => {
          const pct = (b.count / max) * 100;
          return (
            <div key={b.iso} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="w-full bg-gray-100 dark:bg-obsidian-raised rounded-sm flex-1 flex items-end overflow-hidden">
                <div
                  className={cn(
                    'w-full rounded-sm transition-all duration-500',
                    b.isToday ? 'bg-brand-500 dark:bg-brand-400' : 'bg-brand-200 dark:bg-brand-500/40',
                  )}
                  style={{ height: `${b.count === 0 ? 0 : Math.max(8, pct)}%` }}
                  title={`${b.count} shipped on ${b.iso}`}
                />
              </div>
              <span
                className={cn(
                  'text-[10px] tabular-nums',
                  b.isToday ? 'font-semibold text-brand-600 dark:text-brand-300' : 'text-gray-400 dark:text-obsidian-faded',
                )}
              >
                {b.isToday ? 'Today' : b.weekdayShort}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyHint({ line, sub }: { line: string; sub?: string }) {
  return (
    <div className={cn(
      'rounded-xl border-2 border-dashed py-8 text-center',
      'border-gray-200 dark:border-obsidian-border',
      'bg-white/40 dark:bg-obsidian-panel/30',
    )}>
      <p className="text-sm text-gray-500 dark:text-obsidian-muted">{line}</p>
      {sub && (
        <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1 max-w-md mx-auto px-4">
          {sub}
        </p>
      )}
    </div>
  );
}

function prettyDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function prettyRange(startIso: string, endIso: string): string {
  const start = new Date(startIso + 'T00:00:00');
  // endIso is exclusive; show inclusive end (one day earlier).
  const end = new Date(endIso + 'T00:00:00');
  end.setDate(end.getDate() - 1);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startFmt = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
  const endFmt = end.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startFmt} – ${endFmt}`;
}
