import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bug as BugIcon, SendHorizonal } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useTaskCounts, useTasks } from '@/hooks/useTasks';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { BugSubmissionModal } from '@/components/bugs/BugSubmissionModal';
import { Button } from '@/components/ui';
import { TASK_STATUS_ORDER, TASK_STATUS_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';

/**
 * Client-facing Project Board.
 *
 * Mirrors the engineer / admin kanban, but:
 *   - **Request mode**, not read-only: clients can submit task requests
 *     from the BACKLOG column via the inline quick-add. The KanbanBoard's
 *     `clientCreateMode` prop limits the + button to BACKLOG, swaps the
 *     tooltip/placeholder to a "request" tone, and tags every created
 *     task with `clientRequested: true` so the server's safe-shape
 *     rewriter forces clientVisible=true, status=BACKLOG, no assignee,
 *     no sprint. The team triages from there.
 *   - Drag-to-move is disabled — clients propose work, they don't move
 *     work through the team's workflow. Internal columns (TODO,
 *     IN_PROGRESS, IN_REVIEW, DONE) have no + button at all.
 *   - Same visual language: sticky-note view by default, fits-to-viewport
 *     columns by default, F-to-focus and Esc behaviour unchanged. So a
 *     client and an engineer talking through the board on a call see
 *     the same thing.
 *   - Header strip with status counts above the board — clients tend to
 *     be less keyboard-driven, so the at-a-glance read matters more.
 *
 * Tasks the team marks `clientVisible=false` never make it into the
 * client's task list (filtered in task.service.listTasks); the columns
 * just won't include them. We don't surface a "hidden N internal tasks"
 * count — that would imply the client should be curious about them.
 */
export function ClientBoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  // Status strip uses the server-side counts endpoint — a single groupBy
  // that returns the real per-status totals across all pages. The kanban
  // paginates the task list (200 per page, no hard cap), so counting off
  // a loaded slice would under-report on big projects. We still pull the
  // task list itself for the "open requests" badge (which needs the
  // clientRequested flag) — that one's bounded by clientVisible filtering
  // so the payload stays small on client portals.
  const { data: statusTotals } = useTaskCounts(id!);
  const { data: tasks } = useTasks(id!);
  const [bugOpen, setBugOpen] = useState(false);

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-10 rounded-xl w-full" />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  // ─── Status distribution strip ───
  // Order matches the board so the strip reads left-to-right like the
  // columns underneath. We display zeros explicitly — "0 in review" is
  // a real signal, not noise.
  const counts: Record<string, number> = {};
  TASK_STATUS_ORDER.forEach((s) => { counts[s] = statusTotals?.[s] ?? 0; });
  const openRequests = (tasks ?? []).filter((t: any) => t.clientRequested && t.status === 'BACKLOG').length;

  return (
    <div className="space-y-6 animate-fade-in-down">
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Project Board
          </h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
            A live view of work the team is doing on your project. Cards move
            across columns as the team makes progress. Click any card to read
            its full description.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setBugOpen(true)}>
          <BugIcon size={14} /> Submit a bug
        </Button>
      </header>

      {/* Request-mode banner — tells clients exactly what happens when they
          submit something, so the + button on Backlog doesn't look magical. */}
      <div className={cn(
        'rounded-xl border p-4 flex items-start gap-3',
        'bg-indigo-50/60 border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/30',
      )}>
        <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center shrink-0">
          <SendHorizonal size={15} className="text-indigo-700 dark:text-indigo-300" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-indigo-900 dark:text-indigo-200">
            Submit a request from the Backlog column
          </p>
          <p className="mt-0.5 text-[12px] text-indigo-800/80 dark:text-indigo-200/80 leading-relaxed">
            Click the <span className="font-medium">+</span> on the Backlog column to ask the team for something.
            Your request lands in their triage queue and shows up on every card with a “Client request” badge.
            {openRequests > 0 && (
              <>
                {' '}You currently have <span className="font-semibold">{openRequests}</span>{' '}
                {openRequests === 1 ? 'request' : 'requests'} waiting on triage.
              </>
            )}
          </p>
        </div>
      </div>

      {/* At-a-glance status counts. Cheap to render, high info density. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {TASK_STATUS_ORDER.map((status) => (
          <StatusTile
            key={status}
            label={TASK_STATUS_LABELS[status]}
            count={counts[status]}
            tone={status}
          />
        ))}
      </div>

      {/* The board itself. clientCreateMode allows quick-add on BACKLOG only;
          drag is disabled. Backend safe-shape rewriter enforces the same. */}
      <KanbanBoard
        projectId={id!}
        clientCreateMode
        onTaskClick={(taskId) => navigate(`/client/projects/${id}/tasks/${taskId}`)}
      />

      <BugSubmissionModal
        open={bugOpen}
        onClose={() => setBugOpen(false)}
        projectId={id!}
      />
    </div>
  );
}

/**
 * A single column-summary tile. Uses the same column accent colours as
 * KanbanColumn so the strip and the board read as a single composition.
 */
function StatusTile({ label, count, tone }: { label: string; count: number; tone: string }) {
  // Mirrors the column dot palette so the strip and board harmonise.
  // Tailwind classes are static strings so they survive the JIT scan.
  const accent = ({
    BACKLOG:     { bar: 'bg-gray-400 dark:bg-obsidian-faded', text: 'text-gray-500 dark:text-obsidian-muted' },
    TODO:        { bar: 'bg-blue-500',                          text: 'text-blue-600 dark:text-blue-300' },
    IN_PROGRESS: { bar: 'bg-brand-500',                         text: 'text-brand-600 dark:text-brand-300' },
    IN_REVIEW:   { bar: 'bg-amber-500',                         text: 'text-amber-600 dark:text-amber-300' },
    DONE:        { bar: 'bg-emerald-500',                       text: 'text-emerald-600 dark:text-emerald-400' },
  } as Record<string, { bar: string; text: string }>)[tone] ?? { bar: 'bg-gray-300', text: 'text-gray-500' };

  return (
    <div className={cn(
      'rounded-xl border p-3 flex items-center gap-3',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <span className={cn('w-1 rounded-full self-stretch shrink-0', accent.bar)} />
      <div className="min-w-0">
        <p className={cn('text-[10px] font-semibold uppercase tracking-[0.1em] truncate', accent.text)}>
          {label}
        </p>
        <p className="text-xl font-semibold text-gray-900 dark:text-obsidian-fg leading-tight tabular-nums">
          {count}
        </p>
      </div>
    </div>
  );
}
