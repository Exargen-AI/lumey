import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Play, CheckCircle2, Calendar, Target, ChevronDown, ChevronRight, TrendingUp, Pencil, Check, X } from 'lucide-react';
import { useProjectSprints, useBacklog, useCreateSprint, useStartSprint, useUpdateSprint, useSprintDetail } from '@/hooks/useSprints';
import { usePermission } from '@/hooks/usePermission';
import { Can } from '@/components/auth/Can';
import { UnifiedTaskCard } from '@/components/tasks/UnifiedTaskCard';
import { CompleteSprintDialog } from './CompleteSprintDialog';
import { cn } from '@/lib/cn';
import { formatDate, toLocalDateString } from '@/lib/formatters';
import { SPRINT_STATUS_LABELS } from '@/lib/constants';
import { pluralize } from '@/lib/plural';

interface SprintBoardProps {
  projectId: string;
  /**
   * If provided, task clicks bubble up to the host (typically the project
   * detail page) so the host can render a slide-over modal. If omitted, we
   * fall back to navigating to the full task page (legacy behavior).
   */
  onTaskClick?: (taskId: string) => void;
}

export function SprintBoard({ projectId, onTaskClick }: SprintBoardProps) {
  const navigate = useNavigate();
  const handleTaskClick = (taskId: string) => {
    if (onTaskClick) onTaskClick(taskId);
    else navigate(`/projects/${projectId}/tasks/${taskId}`);
  };
  const { data: sprints, isLoading } = useProjectSprints(projectId);
  const { data: backlog } = useBacklog(projectId);
  const startSprint = useStartSprint(projectId);
  const updateSprint = useUpdateSprint(projectId);
  const canEditProject = usePermission('project.edit');

  const [showCreate, setShowCreate] = useState(false);
  const [expandedSprints, setExpandedSprints] = useState<Set<string>>(new Set());
  // Which sprint is being closed via the new retro dialog (null = none).
  const [completingSprint, setCompletingSprint] = useState<any | null>(null);

  const onUpdateGoal = (sprintId: string, goal: string) => {
    updateSprint.mutate({ id: sprintId, data: { goal: goal.trim() || null } });
  };

  const activeSprint = sprints?.find((s: any) => s.status === 'ACTIVE');
  const planningSprints = sprints?.filter((s: any) => s.status === 'PLANNING') || [];
  const completedSprints = sprints?.filter((s: any) => s.status === 'COMPLETED') || [];

  const toggleExpand = (id: string) => {
    const next = new Set(expandedSprints);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedSprints(next);
  };

  if (isLoading) return <div className="space-y-3 animate-pulse">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl" />)}</div>;

  return (
    <div className="space-y-6">
      {/* Active Sprint */}
      {activeSprint && (
        <SprintCard
          sprint={activeSprint}
          isActive
          canEditProject={canEditProject}
          onComplete={canEditProject ? () => setCompletingSprint(activeSprint) : undefined}
          onUpdateGoal={canEditProject ? (g) => onUpdateGoal(activeSprint.id, g) : undefined}
          onClickTask={handleTaskClick}
          expanded
        />
      )}

      {/* Planning Sprints */}
      {planningSprints.map((sprint: any) => (
        <SprintCard
          key={sprint.id}
          sprint={sprint}
          canEditProject={canEditProject}
          onStart={canEditProject ? () => startSprint.mutate(sprint.id) : undefined}
          onUpdateGoal={canEditProject ? (g) => onUpdateGoal(sprint.id, g) : undefined}
          onClickTask={handleTaskClick}
          expanded={expandedSprints.has(sprint.id)}
          onToggle={() => toggleExpand(sprint.id)}
        />
      ))}

      {/* Backlog */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            Backlog <span className="text-xs font-normal text-gray-400">({pluralize(backlog?.length || 0, 'task')})</span>
          </h3>
          <Can permission="project.edit">
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium">
              <Plus size={14} /> New Sprint
            </button>
          </Can>
        </div>
        {backlog?.length ? (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {backlog.map((task: any) => (
              <div key={task.id} onClick={() => handleTaskClick(task.id)} className="cursor-pointer">
                <UnifiedTaskCard task={task} variant="list" showProject={false} />
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-gray-400">No tasks in backlog</div>
        )}
      </div>

      {/* Completed Sprints */}
      {completedSprints.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Completed Sprints</h3>
          <div className="space-y-2">
            {completedSprints.map((sprint: any) => (
              <SprintCard
                key={sprint.id}
                sprint={sprint}
                onClickTask={handleTaskClick}
                expanded={expandedSprints.has(sprint.id)}
                onToggle={() => toggleExpand(sprint.id)}
                isCompleted
              />
            ))}
          </div>
        </div>
      )}

      {/* Create Sprint Modal */}
      {showCreate && <CreateSprintForm projectId={projectId} onClose={() => setShowCreate(false)} />}

      {/* Complete Sprint Dialog (replaces the old confirm). Renders only when
          a sprint is being closed; the dialog itself fetches the sprint detail
          for the carry-over picker. */}
      {completingSprint && (
        <CompleteSprintDialog
          open
          sprint={completingSprint}
          projectId={projectId}
          onClose={() => setCompletingSprint(null)}
        />
      )}
    </div>
  );
}

function SprintCard({ sprint, isActive, isCompleted, onStart, onComplete, onUpdateGoal, onClickTask, expanded = false, onToggle, canEditProject }: {
  sprint: any; isActive?: boolean; isCompleted?: boolean;
  onStart?: () => void; onComplete?: () => void; onUpdateGoal?: (goal: string) => void;
  onClickTask: (taskId: string) => void; expanded?: boolean; onToggle?: () => void;
  canEditProject?: boolean;
}) {
  const progressPct = sprint.totalTasks > 0 ? Math.round((sprint.doneTasks / sprint.totalTasks) * 100) : 0;
  const scopeCreepTasks = sprint.scopeCreepTasks ?? 0;
  const scopeCreepPoints = sprint.scopeCreepPoints ?? 0;

  return (
    <div className={cn('rounded-xl border overflow-hidden',
      isActive ? 'border-brand-200 dark:border-brand-800 bg-brand-50/30 dark:bg-brand-950/20' :
      isCompleted ? 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50' :
      'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900')}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 cursor-pointer" onClick={onToggle}>
        {onToggle && (expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{sprint.name}</h3>
            <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5',
              isActive ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400' :
              isCompleted ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' :
              'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
              {SPRINT_STATUS_LABELS[sprint.status]}
            </span>
            {/* Scope creep — only meaningful for active/completed sprints, and only worth showing if it's >0 */}
            {(isActive || isCompleted) && scopeCreepTasks > 0 && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25"
                title={`${pluralize(scopeCreepTasks, 'task')} added after sprint start (${scopeCreepPoints} pts)`}
              >
                <TrendingUp size={10} />
                Scope +{scopeCreepPoints}pt
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span className="flex items-center gap-1"><Calendar size={11} /> {formatDate(sprint.startDate)} — {formatDate(sprint.endDate)}</span>
            <span>{pluralize(sprint.totalTasks, 'task')} · {sprint.totalPoints || 0} pts</span>
          </div>
        </div>

        {/* Progress */}
        <div className="w-32 shrink-0">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">{sprint.doneTasks}/{sprint.totalTasks}</span>
            <span className={cn('font-semibold', progressPct === 100 ? 'text-green-600' : 'text-gray-900 dark:text-gray-100')}>{progressPct}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div className={cn('rounded-full h-1.5 transition-all', isCompleted ? 'bg-green-500' : 'bg-brand-500')} style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
          {sprint.status === 'PLANNING' && onStart && (
            <button onClick={onStart} className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 text-white text-xs rounded-lg hover:bg-brand-700">
              <Play size={12} /> Start
            </button>
          )}
          {isActive && onComplete && (
            <button onClick={onComplete} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700">
              <CheckCircle2 size={12} /> Complete
            </button>
          )}
        </div>
      </div>

      {/* Sprint goal — editable for non-completed sprints when caller supplies onUpdateGoal */}
      {expanded && (sprint.goal || onUpdateGoal) && !isCompleted && (
        <div className="px-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <SprintGoal goal={sprint.goal} canEdit={!!onUpdateGoal && !!canEditProject} onSave={onUpdateGoal} />
        </div>
      )}
      {expanded && isCompleted && sprint.goal && (
        <div className="px-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500 flex items-center gap-1"><Target size={11} /> {sprint.goal}</p>
        </div>
      )}

      {/* Tasks in this sprint — replaces the previous burnup chart. */}
      {expanded && (
        <SprintTasks sprintId={sprint.id} onClickTask={onClickTask} />
      )}
    </div>
  );
}

function SprintTasks({ sprintId, onClickTask }: { sprintId: string; onClickTask: (taskId: string) => void }) {
  const { data: detail, isLoading } = useSprintDetail(sprintId);
  const tasks = detail?.tasks ?? [];
  return (
    <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
      <div className="text-[10px] uppercase tracking-[0.1em] font-semibold text-gray-500 dark:text-obsidian-muted mb-2">
        Tasks ({tasks.length})
      </div>
      {isLoading ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : tasks.length === 0 ? (
        <div className="text-xs text-gray-400">No tasks in this sprint.</div>
      ) : (
        <div className="divide-y divide-gray-50 dark:divide-gray-800 -mx-5">
          {tasks.map((task: any) => (
            <div key={task.id} onClick={() => onClickTask(task.id)} className="cursor-pointer">
              <UnifiedTaskCard task={task} variant="list" showProject={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Inline editable sprint goal. Click pencil → input. Enter saves, Esc cancels.
 * Read-only if `canEdit` is false. Empty goal renders a "Set goal" placeholder
 * (still keyboard-activatable when edit is allowed).
 */
function SprintGoal({ goal, canEdit, onSave }: { goal: string | null; canEdit: boolean; onSave?: (g: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal ?? '');

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed !== (goal ?? '')) onSave?.(trimmed);
    setEditing(false);
  };
  const cancel = () => { setDraft(goal ?? ''); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-start gap-2">
        <Target size={11} className="text-gray-400 mt-1.5 shrink-0" />
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); save(); }
            if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          }}
          maxLength={1000}
          placeholder="What does this sprint deliver?"
          className="flex-1 bg-white dark:bg-obsidian-bg border border-gray-300 dark:border-obsidian-border rounded px-2 py-1 text-xs text-gray-700 dark:text-obsidian-fg focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={save}
          className="p-1 rounded text-success-500 hover:bg-success-500/10"
          aria-label="Save sprint goal"
          title="Save (Enter)"
        >
          <Check size={11} />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          className="p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-obsidian-border"
          aria-label="Cancel"
          title="Cancel (Esc)"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5">
      <Target size={11} className="text-gray-400 shrink-0" />
      {goal ? (
        <p className="text-xs text-gray-500 flex-1 min-w-0">{goal}</p>
      ) : (
        <p className="text-xs italic text-gray-400 dark:text-obsidian-faded flex-1 min-w-0">No goal set.</p>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="p-1 rounded text-gray-400 dark:text-obsidian-faded hover:bg-gray-200 dark:hover:bg-obsidian-border hover:text-gray-700 dark:hover:text-obsidian-fg opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 transition-opacity"
          aria-label="Edit sprint goal"
          title="Edit goal"
        >
          <Pencil size={10} />
        </button>
      )}
    </div>
  );
}

function CreateSprintForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const createSprint = useCreateSprint(projectId);

  // Compute default dates at init time (not during render)
  const [form, setForm] = useState(() => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
    const friday = new Date(monday);
    friday.setDate(friday.getDate() + 11);
    return {
      name: '',
      goal: '',
      startDate: toLocalDateString(monday),
      endDate: toLocalDateString(friday),
    };
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.startDate || !form.endDate) return;
    await createSprint.mutateAsync(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Create Sprint</h2>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sprint name (e.g., Sprint 14)"
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" autoFocus />
        <input type="text" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} placeholder="Sprint goal (optional)"
          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Start date</label>
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">End date</label>
            <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</button>
          <button type="submit" disabled={createSprint.isPending || !form.name}
            className="px-5 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50">
            {createSprint.isPending ? 'Creating...' : 'Create Sprint'}
          </button>
        </div>
      </form>
    </div>
  );
}
