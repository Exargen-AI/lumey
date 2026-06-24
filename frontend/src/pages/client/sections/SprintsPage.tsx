import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, Circle, CalendarRange, ChevronDown, ChevronRight } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useTasks } from '@/hooks/useTasks';
import { useProjectSprints } from '@/hooks/useSprints';
import { TASK_STATUS_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { CurrentSprintCard } from '@/components/projects/CurrentSprintCard';
import { SprintBurnupChart } from '@/components/sprints/SprintBurnupChart';

/**
 * Client portal — Sprints tab. Split out of the old combined "Sprint &
 * Roadmap" page so the client nav mirrors the engineer board's dedicated
 * Sprints / Timeline tabs. This page is the sprint-focused half:
 *
 *   1. Current sprint snapshot (self-hides when none is ACTIVE)
 *   2. All sprints — full history, full-access viewers only
 *      (`project.canViewInternal`); a regular client sees just the active
 *      sprint above
 *   3. Task progress — completion doughnut + recent items
 *
 * The milestone timeline + project-phase rail moved to the Timeline tab.
 */
export function ClientSprintsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const { data: tasks } = useTasks(id!);

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-20 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  // Backend already returns the right task set per project access (client-
  // visible-only for a regular client, full backlog for staff + full-access
  // members), so we trust it rather than re-filter by `clientVisible`.
  const clientTasks = tasks ?? [];
  const taskSummary = {
    total: clientTasks.length,
    done: clientTasks.filter((t: any) => t.status === 'DONE').length,
    inProgress: clientTasks.filter((t: any) => t.status === 'IN_PROGRESS' || t.status === 'IN_REVIEW').length,
    pending: clientTasks.filter((t: any) => t.status === 'BACKLOG' || t.status === 'TODO').length,
  };
  const completionPct = taskSummary.total > 0 ? Math.round((taskSummary.done / taskSummary.total) * 100) : 0;

  return (
    <div className="space-y-7 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Sprints
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          What the team is working on this sprint, the full sprint history, and how the work is tracking overall.
        </p>
      </header>

      {/* ─── Current sprint ─── Self-hides when no sprint is ACTIVE. */}
      <CurrentSprintCard projectId={id!} />

      {/* ─── All sprints ─── Full history, internal-access viewers only. */}
      {project.canViewInternal && <AllSprintsPanel projectId={id!} tasks={clientTasks} />}

      {/* ─── Task progress ─── */}
      <Panel title="Task Progress">
        <div className="flex items-center gap-5 mb-6">
          <div className="relative w-20 h-20 shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-obsidian-raised" />
              <circle
                cx="18" cy="18" r="15.9" fill="none"
                stroke="url(#task-grad-sprints)" strokeWidth="3"
                strokeDasharray={`${completionPct} ${100 - completionPct}`}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
              <defs>
                <linearGradient id="task-grad-sprints" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">{completionPct}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-2 text-[13px]">
            <SummaryRow label="Completed" value={taskSummary.done} tone="emerald" />
            <SummaryRow label="In Progress" value={taskSummary.inProgress} tone="brand" />
            <SummaryRow label="Upcoming" value={taskSummary.pending} tone="neutral" />
          </div>
        </div>

        {clientTasks.length > 0 ? (
          <div className="border-t border-gray-100 dark:border-obsidian-border pt-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-3">Recent Items</h3>
            <div className="space-y-0.5">
              {clientTasks.slice(0, 8).map((task: any) => (
                <Link
                  key={task.id}
                  to={`/client/projects/${id}/tasks/${task.id}`}
                  className="flex items-center gap-2 text-[13px] py-1.5 px-2 -mx-2 rounded-md hover:bg-gray-50 dark:hover:bg-obsidian-raised transition-colors"
                >
                  {task.status === 'DONE' ? (
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                  ) : (
                    <Circle size={14} className="text-gray-300 dark:text-obsidian-faded shrink-0" />
                  )}
                  <span className={cn(
                    'truncate',
                    task.status === 'DONE'
                      ? 'text-gray-400 dark:text-obsidian-faded line-through'
                      : 'text-gray-700 dark:text-obsidian-fg',
                  )}>{task.title}</span>
                  <span className="ml-auto text-[10px] text-gray-400 dark:text-obsidian-faded shrink-0">{TASK_STATUS_LABELS[task.status]}</span>
                </Link>
              ))}
            </div>
            {clientTasks.length > 8 && (
              <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-2.5">Showing 8 of {clientTasks.length} tasks</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400 dark:text-obsidian-faded py-4 text-center">No client-visible tasks yet.</p>
        )}
      </Panel>
    </div>
  );
}

/* ─── Local primitives (intentionally duplicated per section page, same as
   ProjectStatusPage / TimelinePage — each tunes its chrome slightly). */

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-6 bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border shadow-soft dark:shadow-soft-dark">
      {title && (
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted mb-4">{title}</h2>
      )}
      {children}
    </div>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: number; tone: 'brand' | 'emerald' | 'neutral' }) {
  const valueColor: Record<string, string> = {
    brand:   'text-brand-600 dark:text-brand-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    neutral: 'text-gray-700 dark:text-obsidian-fg',
  };
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500 dark:text-obsidian-muted">{label}</span>
      <span className={cn('font-semibold tabular-nums', valueColor[tone])}>{value}</span>
    </div>
  );
}

/* ─── All sprints ───
   Full sprint history — past, active, and upcoming — for viewers with
   internal access on this project (staff, or a CLIENT member granted full
   access). The backend gates the per-sprint task/point counts to the
   viewer's visible set, so this never leaks internal counts. Rendered only
   when `project.canViewInternal` is true (the caller gates it). */
function AllSprintsPanel({ projectId, tasks }: { projectId: string; tasks: any[] }) {
  const { data: sprints, isLoading, isError } = useProjectSprints(projectId);

  if (isLoading) {
    return (
      <Panel title="All sprints">
        <div className="space-y-2">
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-20 rounded-xl" />
        </div>
      </Panel>
    );
  }
  // A failure here shouldn't blow up the page — just hide the panel.
  if (isError) return null;

  const list = sprints ?? [];
  if (list.length === 0) {
    return (
      <Panel title="All sprints">
        <p className="text-sm text-gray-400 dark:text-obsidian-faded py-2">No sprints created yet.</p>
      </Panel>
    );
  }

  return (
    <Panel title="All sprints">
      {/* Backend returns sprints ordered by number desc (newest first). */}
      <div className="space-y-3">
        {list.map((s: any) => <SprintRow key={s.id} sprint={s} tasks={tasks} />)}
      </div>
    </Panel>
  );
}

const SPRINT_STATUS: Record<string, { label: string; badge: string; bar: string }> = {
  ACTIVE:    { label: 'Active',    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', bar: 'bg-emerald-500 dark:bg-emerald-400' },
  PLANNING:  { label: 'Planned',   badge: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',            bar: 'bg-blue-500 dark:bg-blue-400' },
  COMPLETED: { label: 'Completed', badge: 'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted',  bar: 'bg-gray-400 dark:bg-obsidian-faded' },
  CANCELLED: { label: 'Cancelled', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',            bar: 'bg-rose-400 dark:bg-rose-400' },
};

function SprintRow({ sprint, tasks }: { sprint: any; tasks: any[] }) {
  const [open, setOpen] = useState(false);
  const cfg = SPRINT_STATUS[sprint.status] ?? SPRINT_STATUS.PLANNING;
  // Prefer story-point completion (the planning unit); fall back to task count.
  const usePoints = (sprint.totalPoints ?? 0) > 0;
  const total = usePoints ? sprint.totalPoints : sprint.totalTasks;
  const done = usePoints ? sprint.donePoints : sprint.doneTasks;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const unit = usePoints ? 'pts' : 'tasks';
  const isActive = sprint.status === 'ACTIVE';

  // The tasks IN this sprint, taken from the already per-project-gated task
  // list (no extra fetch, no internal-task leak for a non-full-access viewer —
  // and this panel only renders for full-access viewers anyway).
  const sprintTasks = tasks.filter((t: any) => (t.sprintId ?? t.sprint?.id) === sprint.id);

  return (
    <div className="rounded-xl border border-gray-100 dark:border-obsidian-border p-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left"
        aria-expanded={open}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {open
                ? <ChevronDown size={14} className="text-gray-400 dark:text-obsidian-faded shrink-0" />
                : <ChevronRight size={14} className="text-gray-400 dark:text-obsidian-faded shrink-0" />}
              <span className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg truncate">{sprint.name}</span>
              <span className={cn('shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cfg.badge)}>
                {cfg.label}
              </span>
            </div>
            <div className="mt-0.5 ml-[22px] flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-obsidian-faded">
              <CalendarRange size={11} className="shrink-0" />
              <span className="tabular-nums">{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>
            </div>
          </div>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-gray-700 dark:text-obsidian-fg">{pct}%</span>
        </div>
      </button>

      {sprint.goal && (
        <p className="mt-2 text-[12px] text-gray-500 dark:text-obsidian-muted leading-relaxed line-clamp-2">{sprint.goal}</p>
      )}

      <div className="mt-3 w-full h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised">
        <div className={cn('h-full rounded-full transition-all duration-500', cfg.bar)} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-gray-400 dark:text-obsidian-faded tabular-nums">
        {done}/{total} {unit} · {sprint.doneTasks}/{sprint.totalTasks} tasks
      </div>

      {open && (
        <div className="mt-3 border-t border-gray-100 dark:border-obsidian-border pt-3 space-y-3">
          {/* Burnup — same chart the team sees, active sprint only. */}
          {isActive && (
            <div>
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">Burnup</h4>
              <SprintBurnupChart sprintId={sprint.id} height={120} compact />
            </div>
          )}
          <div>
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">
              Tasks ({sprintTasks.length})
            </h4>
            {sprintTasks.length === 0 ? (
              <p className="text-[12px] text-gray-400 dark:text-obsidian-faded">No tasks in this sprint.</p>
            ) : (
              <div className="space-y-0.5">
                {sprintTasks.map((t: any) => (
                  <Link
                    key={t.id}
                    to={`/client/projects/${sprint.projectId}/tasks/${t.id}`}
                    className="flex items-center gap-2 text-[12px] py-1 px-2 -mx-2 rounded-md hover:bg-gray-50 dark:hover:bg-obsidian-raised transition-colors"
                  >
                    {t.status === 'DONE'
                      ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                      : <Circle size={13} className="text-gray-300 dark:text-obsidian-faded shrink-0" />}
                    <span className={cn(
                      'truncate',
                      t.status === 'DONE'
                        ? 'text-gray-400 dark:text-obsidian-faded line-through'
                        : 'text-gray-700 dark:text-obsidian-fg',
                    )}>{t.title}</span>
                    <span className="ml-auto text-[10px] text-gray-400 dark:text-obsidian-faded shrink-0">{TASK_STATUS_LABELS[t.status]}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
