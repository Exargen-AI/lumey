import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Calendar, AlertTriangle, ChevronRight, ListChecks, ListTodo, AlertCircle } from 'lucide-react';
import { useTask, useUpdateTask, useMoveTask, useDeleteTask, useUpdateSubtasks, useUpdateAcceptanceCriteria } from '@/hooks/useTasks';
import { useProject, useProjectMembers } from '@/hooks/useProjects';
import { useProjectSprints, useProjectEpics } from '@/hooks/useSprints';
import { useHasAnyPermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { Can } from '@/components/auth/Can';
import { useConfirm } from '@/components/ui';
import { TaskComments } from '@/components/tasks/TaskComments';
import { ReviewSection } from '@/components/tasks/ReviewSection';
import { ChecklistList } from '@/components/tasks/ChecklistList';
import { CopyLinkButton } from '@/components/tasks/CopyLinkButton';
import { LinkedIssuesSection } from '@/components/tasks/LinkedIssuesSection';
import { LinkedPRsSection } from '@/components/tasks/LinkedPRsSection';
import { RunsSection } from '@/components/tasks/RunsSection';
import { TaskCustomFieldsSection } from '@/components/customFields/TaskCustomFieldsSection';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { MarkdownView } from '@/components/editor/MarkdownView';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative, isOverdue, toDateInputValue } from '@/lib/formatters';
import type { ChecklistItem } from '@/api/tasks';
import {
  TASK_STATUS_ORDER,
  TASK_STATUS_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  TASK_TYPE_LABELS,
  TASK_TYPE_COLORS,
  STORY_POINT_OPTIONS,
  getDefaultRoute,
  getProjectRoute,
  getProjectWorkspaceRoute,
  getTaskRoute,
} from '@/lib/constants';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TASK_TYPES = ['FEATURE', 'BUG', 'CHORE', 'SPIKE'];

export function TaskDetailPage() {
  const { projectId, taskId } = useParams<{ projectId: string; taskId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  // ─── All hooks first (Rules of Hooks) ──────────────────────────────────
  // Each data hook has its own `enabled: !!id` guard, so passing empty
  // fallbacks when params are missing is safe — no API call fires. The
  // early return for the missing-param case is below.
  const safeProjectId = projectId ?? '';
  const safeTaskId = taskId ?? '';
  const { data: task, isLoading, error: taskError } = useTask(safeTaskId);
  const { data: project } = useProject(safeProjectId);
  const { data: members } = useProjectMembers(safeProjectId);
  const { data: sprints } = useProjectSprints(safeProjectId);
  const { data: epics } = useProjectEpics(safeProjectId);
  const updateTask = useUpdateTask();
  const moveTask = useMoveTask();
  const deleteTask = useDeleteTask();
  const updateSubtasks = useUpdateSubtasks();
  const updateAC = useUpdateAcceptanceCriteria();
  const canEditTask = useHasAnyPermission(['task.edit_any', 'task.edit_own']);
  const [statusError, setStatusError] = useState<string | null>(null);
  const confirm = useConfirm();

  // Now that every hook has been declared, it's safe to early-return.
  if (!projectId || !taskId) return <div className="text-center py-12 text-gray-500">Invalid task URL.</div>;

  // Role-aware back navigation
  const getBackPath = () => getProjectRoute(user?.role || 'ADMIN', projectId, permissions);
  const getProjectsPath = () => (user ? getProjectWorkspaceRoute(user.role, permissions) : '/projects');
  const projectsLabel = getProjectsPath() === '/projects' ? 'Projects' : user?.role === 'ENGINEER' ? 'Dashboard' : 'Projects';

  const handleStatusChange = async (newStatus: string) => {
    if (!task || newStatus === task.status) return;
    setStatusError(null);
    try {
      await moveTask.mutateAsync({ id: taskId, status: newStatus });
    } catch (err: any) {
      setStatusError(err?.response?.data?.error?.message ?? 'Failed to change status. Please try again.');
    }
  };

  const handleUpdateSubtasks = (items: ChecklistItem[]) => {
    updateSubtasks.mutate({ taskId, items });
  };
  const handleUpdateAC = (items: ChecklistItem[]) => {
    updateAC.mutate({ taskId, items });
  };

  const handleUpdate = (data: Record<string, any>) => {
    updateTask.mutate({ id: taskId, data });
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this task?',
      body: 'This cannot be undone. Comments and history attached to the task will also be removed.',
      tone: 'danger',
      confirmLabel: 'Delete task',
    });
    if (ok) deleteTask.mutate(taskId, { onSuccess: () => navigate(getBackPath()) });
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto animate-pulse space-y-6">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-8 bg-gray-200 rounded w-2/3" />
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 space-y-4">
            <div className="h-32 bg-gray-200 rounded" />
            <div className="h-48 bg-gray-200 rounded" />
          </div>
          <div className="space-y-4">
            <div className="h-12 bg-gray-200 rounded" />
            <div className="h-12 bg-gray-200 rounded" />
            <div className="h-12 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    // Distinguish the actual failure mode rather than blanket "Task not
    // found" (team feedback #8: an engineer assigned to a task in a
    // project they're not a member of would hit 403, but the page lied
    // and said the task didn't exist). The backend's getMyTasks now
    // pre-filters by membership so this should be rare, but we keep the
    // accurate message for the long tail of edge cases (link shared by
    // colleague, project membership changed mid-session, etc.).
    const status = (taskError as any)?.response?.status;
    let title = 'Task not found';
    let detail: string | null = null;
    if (status === 403) {
      title = "You don't have access to this task";
      detail = "You're not a member of the project this task belongs to. Ask an admin to add you, or open a task from a project you're already on.";
    } else if (status === 401) {
      title = 'Session expired';
      detail = 'Sign in again to view this task.';
    } else if (status === 404) {
      detail = 'It may have been deleted, or the link is wrong.';
    } else if (taskError) {
      title = "Couldn't load this task";
      detail = 'Try again in a moment. If it keeps happening, ping an admin.';
    }
    return (
      <div className="max-w-md mx-auto text-center py-16 px-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-obsidian-fg">{title}</h2>
        {detail && <p className="mt-2 text-sm text-gray-500 dark:text-obsidian-muted leading-relaxed">{detail}</p>}
        <button
          onClick={() => navigate(getBackPath())}
          className="mt-6 inline-flex items-center gap-2 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          <ArrowLeft size={14} /> Back
        </button>
      </div>
    );
  }

  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <button onClick={() => navigate(getProjectsPath())} className="hover:text-brand-600">{projectsLabel}</button>
        <ChevronRight size={14} />
        <button onClick={() => navigate(getBackPath())} className="hover:text-brand-600">{project?.name || 'Project'}</button>
        <ChevronRight size={14} />
        <span className="text-gray-900 font-medium truncate max-w-[200px]">{task.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate(getBackPath())} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-obsidian-muted dark:hover:text-obsidian-fg">
          <ArrowLeft size={16} /> Back to board
        </button>
        <div className="flex items-center gap-2">
          {/* Role-aware link — a CLIENT must get their /client/... path,
              not the internal /projects/... one they can't open. */}
          <CopyLinkButton url={`${window.location.origin}${getTaskRoute(user?.role || 'ADMIN', projectId, taskId, permissions)}`} size="md" />
          <Can permission="task.delete">
            <button onClick={handleDelete} className="flex items-center gap-1 text-sm text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 px-3 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-500/10">
              <Trash2 size={14} /> Delete task
            </button>
          </Can>
        </div>
      </div>

      <div key={task.updatedAt} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Title */}
          <div>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
            }>
              <input
                type="text"
                defaultValue={task.title}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val && val !== task.title) handleUpdate({ title: val });
                }}
                className="text-2xl font-bold text-gray-900 w-full border-0 focus:ring-2 focus:ring-brand-500 rounded px-1 -ml-1"
              />
            </Can>
          </div>

          {/* Description — rich-text via TipTap. Saves on blur. */}
          <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
            <label className="text-xs font-medium text-gray-500 dark:text-obsidian-muted uppercase tracking-wide block mb-3">Description</label>
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
          </div>

          {/* Acceptance Criteria — gates Done */}
          {(canEditTask || (task.acceptanceCriteria?.length ?? 0) > 0) && (
            <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-obsidian-muted flex items-center gap-1.5">
                  <ListChecks size={12} />
                  Acceptance Criteria
                </label>
                {(task.acceptanceCriteria?.length ?? 0) > 0 && task.status !== 'DONE' && (
                  <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">
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
            <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-obsidian-muted flex items-center gap-1.5 mb-3">
                <ListTodo size={12} />
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

          {/* Per-product custom fields */}
          <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
            <TaskCustomFieldsSection
              taskId={taskId}
              projectId={projectId}
              values={(task.customFields ?? {}) as Record<string, any>}
              canEdit={canEditTask}
            />
          </div>

          {/* Linked Issues */}
          <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
            <LinkedIssuesSection
              taskId={taskId}
              projectId={projectId}
              taskHref={(otherId) => `/projects/${projectId}/tasks/${otherId}`}
            />
          </div>

          {/* Linked PRs (GitHub) — only renders when at least one PR is linked */}
          <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6 empty:hidden">
            <LinkedPRsSection taskId={taskId} />
          </div>

          {/* Agent runs — dispatch an agent and watch its run trace */}
          <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
            <RunsSection taskId={taskId} />
          </div>

          {/* Comments */}
          <div className="bg-white dark:bg-obsidian-panel rounded-xl border border-gray-200 dark:border-obsidian-border p-6">
            <TaskComments taskId={taskId} projectId={projectId} members={members || []} />
          </div>
        </div>

        {/* Right column - Sidebar */}
        <div className="space-y-4">
          {/* Task ID */}
          {task.taskNumber > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <span className="text-lg font-mono font-bold text-brand-600 dark:text-brand-400">
                {task.project?.slug?.toUpperCase()}-{task.taskNumber}
              </span>
            </div>
          )}

          {/* Task Type */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Type</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="px-3 py-2 text-sm font-medium rounded-lg"
                style={{ backgroundColor: (TASK_TYPE_COLORS[task.taskType as keyof typeof TASK_TYPE_COLORS] || '#6b7280') + '15', color: TASK_TYPE_COLORS[task.taskType as keyof typeof TASK_TYPE_COLORS] }}>
                {TASK_TYPE_LABELS[task.taskType as keyof typeof TASK_TYPE_LABELS] || 'Feature'}
              </div>
            }>
              <select value={task.taskType || 'FEATURE'} onChange={(e) => handleUpdate({ taskType: e.target.value })}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500">
                {TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t as keyof typeof TASK_TYPE_LABELS]}</option>)}
              </select>
            </Can>
          </div>

          {/* Story Points */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Story Points</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="text-sm font-bold text-brand-600">{task.storyPoints || '—'}</div>
            }>
              <div className="flex gap-1.5">
                {STORY_POINT_OPTIONS.map((pt) => (
                  <button key={pt} onClick={() => handleUpdate({ storyPoints: task.storyPoints === pt ? null : pt })}
                    className={cn('w-9 h-9 rounded-lg text-sm font-bold transition-colors',
                      task.storyPoints === pt ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-brand-50')}>
                    {pt}
                  </button>
                ))}
              </div>
            </Can>
          </div>

          {/* Sprint */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Sprint</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="text-sm text-gray-700 dark:text-gray-300">{task.sprint?.name || 'Backlog'}</div>
            }>
              <select value={task.sprintId || ''} onChange={(e) => handleUpdate({ sprintId: e.target.value || null })}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">Backlog (no sprint)</option>
                {sprints?.filter((s: any) => s.status !== 'COMPLETED').map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Can>
          </div>

          {/* Epic */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Epic</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="text-sm text-gray-700 dark:text-gray-300">{task.epic?.title || 'None'}</div>
            }>
              <select value={task.epicId || ''} onChange={(e) => handleUpdate({ epicId: e.target.value || null })}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="">No epic</option>
                {epics?.map((e: any) => (
                  <option key={e.id} value={e.id}>{e.title}</option>
                ))}
              </select>
            </Can>
          </div>

          {/* Status */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Status</label>
            <Can permission="task.move_status" fallback={
              <div className="px-3 py-2 bg-brand-50 text-brand-700 text-sm font-medium rounded-lg">
                {TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}
              </div>
            }>
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {TASK_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </Can>
            {statusError && (
              <div role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{statusError}</span>
              </div>
            )}
          </div>

          {/* Priority */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Priority</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="px-3 py-2 text-sm font-medium rounded-lg"
                style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
                {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
              </div>
            }>
              <select
                value={task.priority}
                onChange={(e) => handleUpdate({ priority: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p as keyof typeof PRIORITY_LABELS]}</option>
                ))}
              </select>
            </Can>
          </div>

          {/* Review workflow — shows the active review state OR a
              "Request review" CTA. Sits above Assignee because when
              present it's the most actionable item. */}
          <ReviewSection task={task} members={members ?? []} />

          {/* Assignee */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Assignee</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="flex items-center gap-2">
                {task.assignee ? (
                  <>
                    <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-xs font-semibold text-brand-600">
                      {task.assignee.name.charAt(0)}
                    </div>
                    <span className="text-sm text-gray-700">{task.assignee.name}</span>
                  </>
                ) : (
                  <span className="text-sm text-gray-400">Unassigned</span>
                )}
              </div>
            }>
              <select
                value={task.assigneeId || ''}
                onChange={(e) => handleUpdate({ assigneeId: e.target.value || null })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Unassigned</option>
                {members?.map((m: any) => (
                  <option key={m.userId} value={m.userId}>{m.user.name}</option>
                ))}
              </select>
            </Can>
          </div>

          {/* Due Date */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Due Date</label>
            <Can permissions={['task.edit_any', 'task.edit_own']} fallback={
              <div className="flex items-center gap-2 text-sm">
                <Calendar size={14} className="text-gray-400" />
                <span className={cn(task.dueDate && isOverdue(task.dueDate) && task.status !== 'DONE' ? 'text-red-600 font-medium' : 'text-gray-700')}>
                  {task.dueDate ? formatDate(task.dueDate) : 'No due date'}
                </span>
              </div>
            }>
              <input
                type="date"
                value={toDateInputValue(task.dueDate)}
                onChange={(e) => handleUpdate({ dueDate: e.target.value || null })}
                className={cn('w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500',
                  task.dueDate && isOverdue(task.dueDate) && task.status !== 'DONE' ? 'text-red-600' : '')}
              />
            </Can>
          </div>

          {/* Blocked */}
          <Can permission="task.mark_blocked">
            <div className={cn('rounded-xl border p-4', task.isBlocked ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200')}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={task.isBlocked}
                  onChange={(e) => handleUpdate({
                    isBlocked: e.target.checked,
                    blockerNote: e.target.checked ? task.blockerNote || '' : null,
                  })}
                  className="w-4 h-4 rounded text-red-500 accent-red-500"
                />
                <span className={cn('text-sm font-medium', task.isBlocked ? 'text-red-700' : 'text-gray-600')}>
                  <AlertTriangle size={14} className="inline mr-1" />
                  Blocked
                </span>
              </label>
              {task.isBlocked && (
                <input
                  type="text"
                  defaultValue={task.blockerNote || ''}
                  onBlur={(e) => handleUpdate({ blockerNote: e.target.value })}
                  placeholder="What's blocking this task?"
                  className="mt-3 w-full text-sm border border-red-200 rounded-lg px-3 py-2 bg-white text-red-600 placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              )}
            </div>
          </Can>

          {/* Labels */}
          {task.labels?.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Labels</label>
              <div className="flex gap-2 flex-wrap">
                {task.labels.map((label: string) => (
                  <span key={label} className="bg-brand-50 text-brand-700 text-xs px-2.5 py-1 rounded-full">{label}</span>
                ))}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="text-xs text-gray-400 px-4 space-y-1">
            <p>Created {formatRelative(task.createdAt)}</p>
            <p>Updated {formatRelative(task.updatedAt)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
