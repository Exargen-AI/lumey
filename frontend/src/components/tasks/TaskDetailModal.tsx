import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Trash2, Calendar, AlertTriangle, Maximize2, ListChecks, ListTodo, AlertCircle, GitFork, Eye, EyeOff, Diamond } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTask, useUpdateTask, useMoveTask, useDeleteTask, useUpdateSubtasks, useUpdateAcceptanceCriteria } from '@/hooks/useTasks';
import { useProjectMembers } from '@/hooks/useProjects';
import { useProjectSprints } from '@/hooks/useSprints';
import { useHasAnyPermission } from '@/hooks/usePermission';
import { useViewport } from '@/hooks/useViewport';
import { useAuth } from '@/hooks/useAuth';
import { TaskFollowSection } from './TaskFollowSection';
import { getMilestones } from '@/api/milestones';
import { Can } from '@/components/auth/Can';
import { Field, Input, Select, useConfirm } from '@/components/ui';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { MarkdownView } from '@/components/editor/MarkdownView';
import { TaskComments } from './TaskComments';
import { ChecklistList } from './ChecklistList';
import { ReviewSection } from './ReviewSection';
import { SpawnSubtaskModal } from './SpawnSubtaskModal';
import { CopyLinkButton } from './CopyLinkButton';
import { LinkedIssuesSection } from './LinkedIssuesSection';
import { LinkedPRsSection } from './LinkedPRsSection';
import { TaskCustomFieldsSection } from '@/components/customFields/TaskCustomFieldsSection';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, isOverdue, toDateInputValue } from '@/lib/formatters';
import type { ChecklistItem } from '@/api/tasks';
import {
  TASK_STATUS_ORDER,
  TASK_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
} from '@/lib/constants';

interface TaskDetailModalProps {
  taskId: string;
  projectId: string;
  onClose: () => void;
  /**
   * Sibling task IDs in the surrounding view (kanban column, sprint, search
   * results). When supplied, the J/K keys cycle through them via `onNavigate`.
   */
  siblings?: string[];
  /**
   * Called when the user presses J/K to move to a different task. The parent
   * keeps the slide-over open and just swaps the taskId.
   */
  onNavigate?: (newTaskId: string) => void;
}

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

// Minimal shape we read off the project's sprint list for the picker. The
// sprints API is currently untyped, so annotating just the fields this
// control touches keeps it off the no-explicit-any warning list.
type SprintOption = { id: string; name: string; status: string };

/**
 * Slide-in side-panel for task detail. Intentionally NOT the centered Modal
 * primitive — keeping the board visible behind the panel is part of the UX.
 */
export function TaskDetailModal({ taskId, projectId, onClose, siblings, onNavigate }: TaskDetailModalProps) {
  const navigate = useNavigate();
  const { data: task, isLoading } = useTask(taskId);
  const { data: members } = useProjectMembers(projectId);
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? null;
  // Pull milestones for the project so the Milestone picker has options.
  // Gated to project members via the backend service; client/admin both
  // get the list they should see (clientVisible-filtered for clients).
  const { data: milestones } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => getMilestones(projectId),
    enabled: !!projectId,
  });
  // Sprints for the Sprint picker — the same project-scoped list the
  // full-page task view and the backlog use. Lets you re-sprint a task (or
  // send it back to the backlog) without leaving the board's quick-edit panel.
  const { data: sprints } = useProjectSprints(projectId);
  const updateTask = useUpdateTask();
  const moveTask = useMoveTask();
  const deleteTask = useDeleteTask();
  const updateSubtasks = useUpdateSubtasks();
  const updateAC = useUpdateAcceptanceCriteria();
  const panelRef = useRef<HTMLDivElement>(null);
  const canEditTask = useHasAnyPermission(['task.edit_any', 'task.edit_own']);
  // Surface server-side validation failures (e.g. Done-gate) inline near the
  // status picker. Cleared on every successful change.
  const [statusError, setStatusError] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  // Mobile mode: pin the panel to the bottom (sheet) instead of the right
  // (slide-over). Same content, same handlers — only the chrome changes.
  const { isMobile } = useViewport();

  // Close on Escape + J/K next/prev sibling navigation. Skip the J/K shortcut
  // when a text input or contenteditable has focus — otherwise typing the
  // letter J in a description would yank you to the next task.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

      if ((e.key === 'j' || e.key === 'k') && siblings && onNavigate) {
        const idx = siblings.indexOf(taskId);
        if (idx === -1) return;
        const nextIdx = e.key === 'j'
          ? Math.min(idx + 1, siblings.length - 1)
          : Math.max(idx - 1, 0);
        if (nextIdx !== idx) {
          e.preventDefault();
          onNavigate(siblings[nextIdx]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, siblings, onNavigate, taskId]);

  // Close on click outside the panel — but ignore clicks inside any portaled
  // child (e.g. a centered <Modal> opened from a button in this panel). Without
  // this guard, opening a child modal would immediately close us.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const target = e.target as Element | null;
      if (panelRef.current.contains(target as Node)) return;
      // Ignore clicks inside any other dialog or portal-mounted overlay.
      if (target?.closest('[role="dialog"]')) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleStatusChange = async (newStatus: string) => {
    if (!task || newStatus === task.status) return;
    setStatusError(null);
    try {
      await moveTask.mutateAsync({ id: taskId, status: newStatus });
    } catch (err: any) {
      // Common case: Done-gate rejection because acceptance criteria are
      // unchecked. The server returns a clear message; surface it inline.
      const msg = err?.response?.data?.error?.message ?? 'Failed to change status. Please try again.';
      setStatusError(msg);
    }
  };

  const handleUpdateSubtasks = (items: ChecklistItem[]) => {
    updateSubtasks.mutate({ taskId, items });
  };
  const handleUpdateAC = (items: ChecklistItem[]) => {
    updateAC.mutate({ taskId, items });
  };

  // 409-conflict banner state for optimistic locking (backend PR #128).
  // Cleared on successful update; populated when the server rejects
  // because someone else's edit landed between the user's read and
  // write.
  const [conflictError, setConflictError] = useState<string | null>(null);

  const handleUpdate = (data: Record<string, any>) => {
    setConflictError(null);
    // Optimistic locking: include the task's `updatedAt` we read on
    // load. Backend PR #128 refuses the write when the server has
    // moved on, returning 409 with a "refresh and reapply" message.
    // Passing the field is opt-in for older clients; we're opting
    // in here for every task save.
    const payload = task?.updatedAt
      ? { ...data, expectedUpdatedAt: task.updatedAt }
      : data;
    updateTask.mutate(
      { id: taskId, data: payload },
      {
        onError: (err: any) => {
          if (err?.response?.status === 409) {
            // Surface the backend message verbatim — it already
            // includes the "refresh" guidance + server timestamp.
            const msg = err?.response?.data?.error?.message
              ?? 'This task was edited by someone else. Refresh and reapply your changes.';
            setConflictError(msg);
          }
        },
      },
    );
  };

  const confirm = useConfirm();
  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this task?',
      body: 'This cannot be undone. Comments and history attached to the task will also be removed.',
      tone: 'danger',
      confirmLabel: 'Delete task',
    });
    if (ok) deleteTask.mutate(taskId, { onSuccess: onClose });
  };

  return (
    <div className={cn(
      'fixed inset-0 z-50 animate-fade-in flex',
      // Mobile: anchor to bottom (sheet). Desktop: anchor to right
      // (slide-over). Both flex against the same backdrop.
      isMobile ? 'items-end' : 'justify-end',
    )}>
      {/* Backdrop — slightly stronger than before so the side panel reads as the focal point */}
      <div className="absolute inset-0 bg-gray-900/40 dark:bg-black/60 backdrop-blur-[2px]" />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'relative overflow-y-auto',
          'bg-white dark:bg-obsidian-panel',
          'shadow-pop dark:shadow-pop-dark',
          isMobile
            // Bottom-sheet: full width, capped at ~92dvh so a sliver of
            // the page underneath stays visible (helps orient the user
            // + tap-to-dismiss target). Safe-area padding keeps the
            // bottom of the content above the iPhone home indicator.
            ? cn(
                'w-full max-h-[92dvh] rounded-t-2xl',
                'border-t border-gray-200 dark:border-obsidian-border',
                'pb-[env(safe-area-inset-bottom)]',
              )
            // Right slide-over (desktop)
            : 'w-full max-w-lg border-l border-gray-200 dark:border-obsidian-border',
        )}
        style={{
          animation: isMobile
            ? 'sheetSlideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'slideIn 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Mobile-only grabber — a Material-style indicator that the
            sheet can be dismissed. Tap-to-dismiss via the backdrop is
            still the primary close path; this is a visual affordance. */}
        {isMobile && (
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <span className="w-10 h-1 rounded-full bg-gray-200 dark:bg-obsidian-border" aria-hidden />
          </div>
        )}
        {isLoading ? (
          <div className="p-6 space-y-4">
            <div className="skeleton h-6 rounded w-2/3" />
            <div className="skeleton h-4 rounded w-1/3" />
            <div className="grid grid-cols-2 gap-4">
              <div className="skeleton h-10 rounded" />
              <div className="skeleton h-10 rounded" />
            </div>
            <div className="skeleton h-24 rounded" />
          </div>
        ) : !task ? (
          <div className="p-12 text-center text-gray-500 dark:text-obsidian-muted">Task not found.</div>
        ) : (
          <>
            {/* Sticky header */}
            <div className={cn(
              'sticky top-0 z-10 flex items-center justify-between px-6 py-3',
              'bg-white/95 dark:bg-obsidian-panel/95 backdrop-blur',
              'border-b border-gray-200 dark:border-obsidian-border',
            )}>
              <button
                onClick={onClose}
                className="flex items-center gap-1 text-[13px] text-gray-500 hover:text-gray-900 dark:text-obsidian-muted dark:hover:text-obsidian-fg transition-colors"
              >
                <X size={15} /> Close
              </button>
              <div className="flex items-center gap-1">
                <CopyLinkButton
                  url={`${window.location.origin}/projects/${projectId}/tasks/${taskId}`}
                  size="sm"
                />
                <button
                  onClick={() => { onClose(); navigate(`/projects/${projectId}/tasks/${taskId}`); }}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 dark:text-obsidian-muted hover:bg-gray-100 dark:hover:bg-obsidian-raised hover:text-gray-900 dark:hover:text-obsidian-fg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                  aria-label="Open in full page"
                  title="Open full page"
                >
                  <Maximize2 size={12} />
                </button>
                <Can permission="task.delete">
                  <button
                    onClick={handleDelete}
                    className="ml-1 flex items-center gap-1 text-[13px] text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 transition-colors"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                </Can>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Optimistic-locking 409 banner (backend PR #128). Sits
                  above everything else so the user can't miss it after
                  a save that lost the race against someone else's edit.
                  The "refresh" CTA invalidates the cached task — it'll
                  re-fetch with the freshest `updatedAt` so the next
                  save lands cleanly. */}
              {conflictError && (
                <div
                  role="alert"
                  className={cn(
                    'flex items-start gap-3 px-3 py-2.5 rounded-lg border',
                    'bg-amber-50 border-amber-200 text-amber-900',
                    'dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-200',
                  )}
                >
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0 text-[12px] leading-snug">
                    <p className="font-semibold">Edit conflict</p>
                    <p className="mt-0.5">{conflictError}</p>
                  </div>
                  <button
                    onClick={() => {
                      setConflictError(null);
                      // Soft refresh: the parent's `useTask(taskId)`
                      // query is keyed on ['task', taskId] — let the
                      // user pull-to-refresh by clicking. The hook
                      // already has staleTime semantics from the
                      // surrounding TanQuery setup.
                      window.location.reload();
                    }}
                    className={cn(
                      'text-[11px] font-semibold px-2 py-1 rounded',
                      'bg-amber-500 text-white hover:bg-amber-600',
                    )}
                  >
                    Refresh
                  </button>
                </div>
              )}

              {/* Title */}
              <div>
                <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
                  <h2 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">{task.title}</h2>
                }>
                  <input
                    type="text"
                    defaultValue={task.title}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && val !== task.title) handleUpdate({ title: val });
                    }}
                    className={cn(
                      'text-xl font-semibold tracking-tight w-full rounded p-0 -ml-1 pl-1',
                      'bg-transparent border-0 outline-none',
                      'text-gray-900 dark:text-obsidian-fg',
                      'focus:ring-2 focus:ring-brand-500/40',
                    )}
                    style={{ boxShadow: 'none' }}
                  />
                </Can>
                <p className="text-[12px] text-gray-400 dark:text-obsidian-faded mt-1.5">
                  {(() => {
                    // Mirror UnifiedTaskCard:92 — show the human-readable key so
                    // the panel header matches what the user sees on the card.
                    const slug = task.project?.slug || '';
                    const num = (task as any).taskNumber;
                    const key = num > 0 && slug ? `${slug.toUpperCase()}-${num}` : null;
                    return (
                      <>
                        {key && (
                          <>
                            <span className="font-mono text-gray-500 dark:text-obsidian-muted">{key}</span>
                            <span> · </span>
                          </>
                        )}
                        {task.project?.name} · Created {formatDate(task.createdAt)}
                      </>
                    );
                  })()}
                </p>
              </div>

              {/* Status & Priority */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Status">
                  <Can permission="task.move_status" fallback={
                    <div className="px-3 py-2 bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-sm font-medium rounded-lg">
                      {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}
                    </div>
                  }>
                    <Select value={task.status} onChange={(e) => handleStatusChange(e.target.value)}>
                      {TASK_STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                      ))}
                    </Select>
                  </Can>
                  {statusError && (
                    <div role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <span>{statusError}</span>
                    </div>
                  )}
                </Field>
                <Field label="Priority">
                  <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
                    <div className="px-3 py-2 text-sm font-medium rounded-lg"
                      style={{ backgroundColor: (PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] || '#6b7280') + '15', color: PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS] }}>
                      {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
                    </div>
                  }>
                    <Select value={task.priority} onChange={(e) => handleUpdate({ priority: e.target.value })}>
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>{PRIORITY_LABELS[p as keyof typeof PRIORITY_LABELS]}</option>
                      ))}
                    </Select>
                  </Can>
                </Field>
              </div>

              {/* Review workflow — handles idle ("Request review" CTA),
                  active-review ("waiting on X" + Approve / Request-changes
                  buttons for the reviewer), and the locked Done state.
                  Sits above Assignee/Due Date because the review state is
                  the most actionable thing on the page when present. */}
              <ReviewSection task={task} members={members ?? []} />

              {/* Bug spin-off (PR C feature #7). Only surfaces on bugs —
                  the right semantic is "this bug has been triaged, here
                  are the concrete fix/test/docs tasks". The child task
                  inherits productId + clientVisible from this parent. */}
              {task.taskType === 'BUG' && task.status !== 'DONE' && (
                <div className={cn(
                  'rounded-xl border border-dashed p-3 flex items-center justify-between gap-3',
                  'border-rose-200 dark:border-rose-500/30',
                  'bg-rose-50/30 dark:bg-rose-500/[0.05]',
                )}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center shrink-0">
                      <GitFork size={13} className="text-rose-700 dark:text-rose-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-gray-900 dark:text-obsidian-fg">
                        Spin off a task
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-obsidian-muted">
                        Triaged this bug? Create a linked fix / test / docs task.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSpawnOpen(true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium bg-rose-600 hover:bg-rose-700 text-white shadow-soft transition-colors shrink-0"
                  >
                    <GitFork size={12} /> Spawn
                  </button>
                </div>
              )}

              {/* Assignee & Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Assignee">
                  <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
                    <div className={cn(
                      'flex items-center gap-2 px-3 h-10 rounded-lg',
                      'border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised',
                    )}>
                      {task.assignee ? (
                        <>
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-[10px] font-semibold text-white">
                            {task.assignee.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-gray-700 dark:text-obsidian-fg">{task.assignee.name}</span>
                        </>
                      ) : (
                        <span className="text-sm text-gray-400 dark:text-obsidian-faded">Unassigned</span>
                      )}
                    </div>
                  }>
                    <Select
                      value={task.assigneeId || ''}
                      onChange={(e) => handleUpdate({ assigneeId: e.target.value || null })}
                    >
                      <option value="">Unassigned</option>
                      {members?.map((m: any) => (
                        <option key={m.userId} value={m.userId}>{m.user.name}</option>
                      ))}
                    </Select>
                  </Can>
                </Field>
                <Field label="Due Date">
                  <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
                    <div className={cn(
                      'flex items-center gap-2 px-3 h-10 rounded-lg text-sm',
                      'border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised',
                    )}>
                      <Calendar size={14} className="text-gray-400 dark:text-obsidian-faded" />
                      <span className={cn(
                        task.dueDate && isOverdue(task.dueDate) && task.status !== 'DONE'
                          ? 'text-rose-600 dark:text-rose-400 font-medium'
                          : 'text-gray-700 dark:text-obsidian-fg',
                      )}>
                        {task.dueDate ? formatDate(task.dueDate) : 'No due date'}
                      </span>
                    </div>
                  }>
                    <Input
                      type="date"
                      value={toDateInputValue(task.dueDate)}
                      onChange={(e) => handleUpdate({ dueDate: e.target.value || null })}
                      className={cn(
                        task.dueDate && isOverdue(task.dueDate) && task.status !== 'DONE'
                          ? 'text-rose-600 dark:text-rose-400 font-medium'
                          : '',
                      )}
                    />
                  </Can>
                </Field>
              </div>

              {/* Sprint — assign this task to a sprint or send it to the
                  backlog. Mirrors the full-page TaskDetailPage control so
                  re-sprinting no longer means leaving the board's quick-edit
                  panel. Gated to task editors (edit_any OR edit_own — same as
                  the PUT /tasks/:id backend gate); everyone else sees the
                  current sprint name read-only, matching the full-page view. */}
              <Field label="Sprint">
                <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
                  <div className={cn(
                    'flex items-center gap-2 px-3 h-10 rounded-lg text-sm',
                    'border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised',
                  )}>
                    <span className="text-gray-700 dark:text-obsidian-fg truncate">
                      {task.sprint?.name || 'Backlog'}
                    </span>
                  </div>
                }>
                  <Select
                    value={task.sprintId || ''}
                    onChange={(e) => handleUpdate({ sprintId: e.target.value || null })}
                  >
                    <option value="">Backlog (no sprint)</option>
                    {/* Hide COMPLETED sprints from the options, but keep the
                        task's current sprint listed even if it's completed —
                        otherwise the control would silently misrepresent the
                        live value. */}
                    {sprints
                      ?.filter((s: SprintOption) => s.status !== 'COMPLETED' || s.id === task.sprintId)
                      .map((s: SprintOption) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                  </Select>
                </Can>
              </Field>

              {/* Milestone scoping — roll this task up under a project
                  milestone so it counts toward the milestone's progress
                  bar. Gated to task.edit_any: engineers editing their own
                  work shouldn't be deciding milestone alignment (that's a
                  PM-level call). Clients never see this control because
                  they don't have task.edit_any. Empty when no milestones
                  exist yet on the project. */}
              <Can permission="task.edit_any">
                {(milestones?.length ?? 0) > 0 && (
                  <Field label="Milestone">
                    <Select
                      value={(task as any).milestoneId || ''}
                      onChange={(e) => handleUpdate({ milestoneId: e.target.value || null })}
                    >
                      <option value="">No milestone</option>
                      {milestones?.map((m: any) => (
                        <option key={m.id} value={m.id}>
                          {m.title}{m.date ? ` · ${formatDate(m.date)}` : ''}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </Can>

              {/* Read-only milestone display for roles WITHOUT edit_any
                  (engineers viewing tasks they own, clients viewing their
                  visible tasks). Shown only when the task is actually
                  linked to a milestone — no point rendering an empty row. */}
              {(task as any).milestoneId && (
                <Can permission="task.edit_any" fallback={
                  <Field label="Milestone">
                    <div className={cn(
                      'flex items-center gap-2 px-3 h-10 rounded-lg text-sm',
                      'border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised',
                    )}>
                      <Diamond size={12} className="text-gray-400 dark:text-obsidian-faded shrink-0" fill="currentColor" />
                      <span className="text-gray-700 dark:text-obsidian-fg truncate">
                        {milestones?.find((m: any) => m.id === (task as any).milestoneId)?.title ?? 'Linked to milestone'}
                      </span>
                    </div>
                  </Field>
                }>
                  {null}
                </Can>
              )}

              {/* Description — rich-text via TipTap. Saves on blur. Existing
                  plain-text descriptions render as-is (text nodes are valid HTML). */}
              <Field label="Description">
                <Can
                  permissions={['task.edit_any', 'task.edit_own']}
                  fallback={<MarkdownView content={task.description || ''} />}
                >
                  <RichTextEditor
                    value={task.description || ''}
                    onChange={(html) => {
                      if (html !== (task.description || '')) handleUpdate({ description: html });
                    }}
                    projectId={projectId}
                    placeholder="Add a description… type / for commands or @ to mention."
                  />
                </Can>
              </Field>

              {/* Visible to client — gated by task.edit_any (only roles that can
                  edit any task should be flipping visibility, not engineers
                  editing their own). Clients shouldn't see this control at
                  all — they don't have task.edit_any and the Can wrapper
                  short-circuits. Mirrors the same affordance from
                  CreateTaskPage but exposes it post-creation as well — fixes
                  the gap where a task created without the box ticked had no
                  way to become client-visible after the fact. */}
              <Can permission="task.edit_any">
                <div className={cn(
                  'rounded-lg p-4',
                  task.clientVisible
                    ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/[0.06] dark:border-emerald-500/30'
                    : 'bg-gray-50 border border-gray-200 dark:bg-obsidian-sunken dark:border-obsidian-border',
                )}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!task.clientVisible}
                      onChange={(e) => handleUpdate({ clientVisible: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-500 accent-emerald-500"
                    />
                    <span className={cn(
                      'text-sm font-medium inline-flex items-center gap-1.5',
                      task.clientVisible ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-600 dark:text-obsidian-muted',
                    )}>
                      {task.clientVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                      Visible to client
                    </span>
                  </label>
                  <p className={cn(
                    'text-[11.5px] mt-1.5 ml-6',
                    task.clientVisible ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-gray-500 dark:text-obsidian-muted',
                  )}>
                    {task.clientVisible
                      ? 'This task shows up on the client status page and counts toward client-facing metrics.'
                      : 'Internal only. The client never sees this task.'}
                  </p>
                </div>
              </Can>

              {/* Blocked */}
              <Can permission="task.mark_blocked">
                <div className={cn(
                  'rounded-lg p-4',
                  task.isBlocked
                    ? 'bg-rose-50 border border-rose-200 dark:bg-rose-500/[0.06] dark:border-rose-500/30'
                    : 'bg-gray-50 border border-gray-200 dark:bg-obsidian-sunken dark:border-obsidian-border',
                )}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={task.isBlocked}
                      onChange={(e) => handleUpdate({
                        isBlocked: e.target.checked,
                        blockerNote: e.target.checked ? task.blockerNote || '' : null,
                      })}
                      className="w-4 h-4 rounded text-rose-500 accent-rose-500"
                    />
                    <span className={cn(
                      'text-sm font-medium inline-flex items-center gap-1',
                      task.isBlocked ? 'text-rose-700 dark:text-rose-300' : 'text-gray-600 dark:text-obsidian-muted',
                    )}>
                      <AlertTriangle size={14} />
                      Blocked
                    </span>
                  </label>
                  {task.isBlocked && (
                    <input
                      type="text"
                      defaultValue={task.blockerNote || ''}
                      onBlur={(e) => handleUpdate({ blockerNote: e.target.value })}
                      placeholder="What's blocking this task?"
                      className={cn(
                        'mt-2.5 w-full text-sm rounded-md px-3 h-9',
                        'bg-white border border-rose-200 text-rose-700 placeholder:text-rose-300',
                        'dark:bg-obsidian-raised dark:border-rose-500/30 dark:text-rose-300 dark:placeholder:text-rose-500/40',
                        'focus:outline-none focus:border-rose-500 dark:focus:border-rose-400',
                      )}
                    />
                  )}
                </div>
              </Can>

              {/* Labels */}
              {task.labels?.length > 0 && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted block mb-2">Labels</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {task.labels.map((label: string) => (
                      <span key={label} className="bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-[11px] px-2 py-0.5 rounded-full">{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Acceptance Criteria — gates Done */}
              {(canEditTask || (task.acceptanceCriteria?.length ?? 0) > 0) && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted flex items-center gap-1.5">
                      <ListChecks size={11} />
                      Acceptance Criteria
                    </label>
                    {(task.acceptanceCriteria?.length ?? 0) > 0 && task.status !== 'DONE' && (
                      <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">
                        Required to mark Done
                      </span>
                    )}
                  </div>
                  <ChecklistList
                    identityKey={`ac-${taskId}`}
                    items={(task.acceptanceCriteria ?? []) as ChecklistItem[]}
                    canEdit={canEditTask}
                    isPending={updateAC.isPending}
                    onChange={handleUpdateAC}
                    addPlaceholder="Add a criterion (e.g. Given X, When Y, Then Z)"
                    tone="success"
                  />
                </div>
              )}

              {/* Subtasks */}
              {(canEditTask || (task.subtasks?.length ?? 0) > 0) && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted block mb-2 flex items-center gap-1.5">
                    <ListTodo size={11} />
                    Subtasks
                  </label>
                  <ChecklistList
                    identityKey={`sub-${taskId}`}
                    items={(task.subtasks ?? []) as ChecklistItem[]}
                    canEdit={canEditTask}
                    isPending={updateSubtasks.isPending}
                    onChange={handleUpdateSubtasks}
                    addPlaceholder="Add a subtask"
                    tone="brand"
                  />
                </div>
              )}

              {/* Per-product custom fields — schema-flexible domain data
                  (Furix CVE/CVSS, RozCar KYC, ManaCalendar Tithi, …). */}
              <TaskCustomFieldsSection
                taskId={taskId}
                projectId={projectId}
                values={(task.customFields ?? {}) as Record<string, any>}
                canEdit={canEditTask}
              />

              {/* Linked Issues */}
              <LinkedIssuesSection
                taskId={taskId}
                projectId={projectId}
                taskHref={(otherId) => `/projects/${projectId}/tasks/${otherId}`}
                onLinkedTaskClick={onNavigate}
              />

              {/* Linked PRs (GitHub) */}
              <LinkedPRsSection taskId={taskId} />

              {/* Follow + nudge (CC feature 2026-05-20, backend PR #130).
                  Sits just above comments because following a task is
                  conceptually about "do I want to be in the conversation
                  on this task?" — adjacent to the comments themselves. */}
              {currentUserId && (
                <TaskFollowSection
                  taskId={taskId}
                  currentUserId={currentUserId}
                  assigneeId={task.assigneeId ?? null}
                />
              )}

              {/* Comments */}
              <div className="border-t border-gray-200 dark:border-obsidian-border pt-6">
                <TaskComments taskId={taskId} projectId={projectId} members={members || []} />
              </div>

              {/* Timestamps + nav hint */}
              <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-obsidian-faded pt-2 border-t border-gray-100 dark:border-obsidian-border">
                <span>Created {formatRelative(task.createdAt)} · Updated {formatRelative(task.updatedAt)}</span>
                {siblings && siblings.length > 1 && onNavigate && (
                  <span className="hidden sm:inline-flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-fg font-mono text-[10px] border border-gray-200 dark:border-obsidian-border">J</kbd>
                    <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-fg font-mono text-[10px] border border-gray-200 dark:border-obsidian-border">K</kbd>
                    next/prev
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Spin-off subtask dialog — only mounted when the user clicks
          the Spawn button. Carries enough parent context for the hook
          to compose the right invalidation set on success. */}
      {task && (
        <SpawnSubtaskModal
          open={spawnOpen}
          onClose={() => setSpawnOpen(false)}
          parentTask={{ id: task.id, title: task.title, projectId }}
        />
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes sheetSlideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
