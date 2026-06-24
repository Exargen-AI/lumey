import { useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Plus, Settings2, ListChecks, ListTodo, Diamond } from 'lucide-react';
import { useProject, useProjectMembers } from '@/hooks/useProjects';
import { useCreateTask } from '@/hooks/useTasks';
import { useProjectSprints, useProjectEpics } from '@/hooks/useSprints';
import { useCustomFieldDefinitions } from '@/hooks/useCustomFields';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';
import { CustomFieldInput } from '@/components/customFields/CustomFieldRenderer';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { ChecklistList } from '@/components/tasks/ChecklistList';
import { getMilestones } from '@/api/milestones';
import { formatDate } from '@/lib/formatters';
import type { ChecklistItem } from '@/api/tasks';
import type { CustomFieldValue, CustomFieldValues } from '@/api/customFields';
import {
  TASK_STATUS_ORDER, TASK_STATUS_LABELS,
  PRIORITY_LABELS, TASK_TYPE_LABELS, TASK_TYPE_COLORS,
  STORY_POINT_OPTIONS, getProjectRoute,
} from '@/lib/constants';

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const TASK_TYPES = ['FEATURE', 'BUG', 'CHORE', 'SPIKE'];

export function CreateTaskPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);

  // ─── All hooks first (Rules of Hooks) ──────────────────────────────────
  // Pass the projectId through unchanged when present, fall back to an
  // empty string when absent — each data hook has its own `enabled: !!id`
  // guard so the query won't fire. The early return for the missing-param
  // case is below, after every hook has been declared.
  const safeProjectId = projectId ?? '';
  const { data: project } = useProject(safeProjectId);
  const { data: members, isLoading: membersLoading, error: membersError } = useProjectMembers(safeProjectId);
  const { data: sprints } = useProjectSprints(safeProjectId);
  const { data: epics } = useProjectEpics(safeProjectId);
  const { data: customFieldDefs } = useCustomFieldDefinitions(safeProjectId);
  const createTask = useCreateTask(safeProjectId);

  // Milestone picker is admin/PM-only — engineers and clients can't reassign
  // tasks across milestones. Mirrors the gating on TaskDetailModal.
  const canEditAny = usePermission('task.edit_any');
  const { data: milestones } = useQuery({
    queryKey: ['milestones', safeProjectId],
    queryFn: () => getMilestones(safeProjectId),
    enabled: !!safeProjectId && canEditAny,
    staleTime: 60_000,
  });

  const searchParams = new URLSearchParams(location.search);
  const [form, setForm] = useState({
    title: searchParams.get('title') || '',
    description: searchParams.get('description') || '',
    taskType: 'FEATURE',
    status: 'BACKLOG',
    priority: 'P2',
    storyPoints: null as number | null,
    assigneeId: '',
    sprintId: '',
    epicId: '',
    milestoneId: '',
    dueDate: '',
    labels: '',
    clientVisible: false,
  });
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValues>({});
  const [customFieldErrors, setCustomFieldErrors] = useState<Record<string, string>>({});
  // AC + subtasks captured locally and sent with the create call. Team
  // feedback #4: the team wanted these editable on the create form, not
  // just on the post-create detail page.
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<ChecklistItem[]>([]);
  const [subtasks, setSubtasks] = useState<ChecklistItem[]>([]);
  const [error, setError] = useState('');

  // Now that every hook has been declared, it's safe to early-return.
  if (!projectId) return <div className="text-center py-12 text-gray-500">Invalid URL.</div>;

  const getBackPath = () => getProjectRoute(user?.role || 'ADMIN', projectId, permissions);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setError('Title is required'); return; }
    setError('');

    try {
      // Strip empty custom-field values so the wire payload stays minimal and
      // the server treats them as "not set" rather than "explicitly empty".
      const cleanedCustomFields: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(customFieldValues)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        cleanedCustomFields[k] = v;
      }

      // Strip checklist items with empty text — same hygiene the dedicated
      // update endpoint applies. Keeps the wire payload clean and avoids
      // empty rows landing in the persisted JSON.
      const cleanedAC = acceptanceCriteria.filter((i) => i.text?.trim());
      const cleanedSubtasks = subtasks.filter((i) => i.text?.trim());

      const data: any = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        taskType: form.taskType,
        status: form.status,
        priority: form.priority,
        storyPoints: form.storyPoints || undefined,
        assigneeId: form.assigneeId || undefined,
        sprintId: form.sprintId || undefined,
        epicId: form.epicId || undefined,
        milestoneId: form.milestoneId || undefined,
        dueDate: form.dueDate || undefined,
        labels: form.labels ? form.labels.split(',').map((l) => l.trim()).filter(Boolean) : [],
        clientVisible: form.clientVisible,
        ...(cleanedAC.length ? { acceptanceCriteria: cleanedAC } : {}),
        ...(cleanedSubtasks.length ? { subtasks: cleanedSubtasks } : {}),
        ...(Object.keys(cleanedCustomFields).length ? { customFields: cleanedCustomFields } : {}),
      };
      await createTask.mutateAsync(data);
      navigate(getBackPath());
    } catch (err: any) {
      // Surface per-field validation errors when the server flags them.
      const fieldErrs = err?.response?.data?.error?.details?.customFields;
      if (fieldErrs && typeof fieldErrs === 'object') {
        setCustomFieldErrors(fieldErrs as Record<string, string>);
      }
      setError(err?.response?.data?.error?.message || 'Failed to create task');
    }
  };

  const setCustomFieldValue = (key: string, next: CustomFieldValue) => {
    setCustomFieldValues((prev) => ({ ...prev, [key]: next }));
    setCustomFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  };

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate(getBackPath())} className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 mb-6">
        <ArrowLeft size={16} /> Back to {project?.name || 'project'}
      </button>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">Create Task</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Title *</label>
          <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus
            placeholder="What needs to be done?"
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Description — rich-text editor matching the detail page so the
            create flow has the same toolbar (B/I/headings/lists/links/code/
            quote) and supports / commands and @ mentions. Team feedback #4. */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Description</label>
          <RichTextEditor
            value={form.description}
            onChange={(html) => setForm({ ...form, description: html })}
            placeholder="Add details, context, links… type / for commands or @ to mention."
            projectId={projectId}
            liveUpdate
          />
        </div>

        {/* Acceptance Criteria — same component used on the detail view, so
            the wire shape is identical to what the dedicated AC endpoint
            expects. Local state only; flushed to the server with the create
            call. */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
            <ListChecks size={14} className="text-emerald-500" />
            Acceptance Criteria
            <span className="text-[11px] font-normal text-gray-400 dark:text-obsidian-faded">— what does "done" look like?</span>
            {/* Soft warning at 45+ items so users see the cap before
                they hit the server's hard 50 (QA K-M4: previously you
                could type 60 ACs then get a generic backend error). */}
            {acceptanceCriteria.length >= 45 && (
              <span className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                acceptanceCriteria.length >= 50
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
              )}>
                {acceptanceCriteria.length}/50 — split into smaller tasks?
              </span>
            )}
          </label>
          <ChecklistList
            identityKey="create-ac"
            items={acceptanceCriteria}
            canEdit
            onChange={setAcceptanceCriteria}
            addPlaceholder="Add a criterion (e.g. Given X, When Y, Then Z)…"
            tone="success"
            showProgress={false}
          />
        </div>

        {/* Subtasks — local state, sent inline with the create call. */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-2">
            <ListTodo size={14} className="text-brand-500" />
            Subtasks
            {subtasks.length >= 45 && (
              <span className={cn(
                'text-[10px] font-medium px-1.5 py-0.5 rounded',
                subtasks.length >= 50
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
              )}>
                {subtasks.length}/50 — split into smaller tasks?
              </span>
            )}
            <span className="text-[11px] font-normal text-gray-400 dark:text-obsidian-faded">— optional breakdown</span>
          </label>
          <ChecklistList
            identityKey="create-subtasks"
            items={subtasks}
            canEdit
            onChange={setSubtasks}
            addPlaceholder="Add a subtask…"
            tone="brand"
            showProgress={false}
          />
        </div>

        {/* Type + Priority + Status */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Type</label>
            <select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {TASK_TYPES.map((t) => <option key={t} value={t}>{TASK_TYPE_LABELS[t as keyof typeof TASK_TYPE_LABELS]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Priority</label>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p as keyof typeof PRIORITY_LABELS]}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
        </div>

        {/* Story Points */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">Story Points</label>
          <div className="flex gap-2">
            {STORY_POINT_OPTIONS.map((pt) => (
              <button key={pt} type="button" onClick={() => setForm({ ...form, storyPoints: form.storyPoints === pt ? null : pt })}
                className={cn('w-10 h-10 rounded-lg text-sm font-bold transition-colors',
                  form.storyPoints === pt ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-brand-50')}>
                {pt}
              </button>
            ))}
          </div>
        </div>

        {/* Assignee + Due Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Assignee</label>
            <select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Unassigned</option>
              {membersLoading && <option value="" disabled>Loading project members...</option>}
              {members?.map((m: any) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
            </select>
            {membersError ? (
              <p className="mt-1 text-xs text-red-500">Could not load project members for assignment.</p>
            ) : (members?.length ?? 0) === 0 ? (
              <p className="mt-1 text-xs text-gray-400">No project members yet. Add members to this project to assign tasks.</p>
            ) : null}
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Due Date</label>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>

        {/* Sprint + Epic */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Sprint</label>
            <select value={form.sprintId} onChange={(e) => setForm({ ...form, sprintId: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">Backlog</option>
              {sprints?.filter((s: any) => s.status !== 'COMPLETED').map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Epic</label>
            <select value={form.epicId} onChange={(e) => setForm({ ...form, epicId: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">No epic</option>
              {epics?.map((e: any) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
          </div>
        </div>

        {/* Milestone — admin/PM only. Self-hides if the project has no
            milestones yet so engineers see one fewer empty dropdown. Lets
            new tasks land in the right roadmap bucket at creation time,
            instead of needing a follow-up edit (PR #93 only wired this on
            the detail panel). */}
        {canEditAny && (milestones?.length ?? 0) > 0 && (
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-1">
              <Diamond size={12} className="text-gray-400 dark:text-obsidian-faded" fill="currentColor" />
              Milestone
            </label>
            <select value={form.milestoneId} onChange={(e) => setForm({ ...form, milestoneId: e.target.value })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
              <option value="">No milestone</option>
              {milestones?.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.title}{m.date ? ` · ${formatDate(m.date)}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Labels */}
        <div>
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">Labels <span className="text-gray-400 font-normal">(comma-separated)</span></label>
          <input type="text" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })}
            placeholder="backend, payments, api"
            className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>

        {/* Custom Fields — project-scoped per the project's settings */}
        {customFieldDefs && customFieldDefs.length > 0 && (
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5 mb-2">
              <Settings2 size={13} />
              Custom Fields
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {customFieldDefs.map((def) => (
                <CustomFieldInput
                  key={def.id}
                  definition={def}
                  value={customFieldValues[def.key]}
                  onChange={(v) => setCustomFieldValue(def.key, v)}
                  error={customFieldErrors[def.key] ?? null}
                />
              ))}
            </div>
          </div>
        )}

        {/* Client Visible */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.clientVisible} onChange={(e) => setForm({ ...form, clientVisible: e.target.checked })}
            className="w-4 h-4 rounded text-brand-600 accent-brand-600" />
          <span className="text-sm text-gray-700 dark:text-gray-300">Visible to client</span>
        </label>

        {/* Error */}
        {error && <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">{error}</div>}

        {/* Submit */}
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <button type="button" onClick={() => navigate(getBackPath())} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900">
            Cancel
          </button>
          <button type="submit" disabled={createTask.isPending || !form.title.trim()}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-600 text-white text-sm rounded-lg font-medium hover:bg-brand-700 disabled:opacity-50">
            <Plus size={16} /> {createTask.isPending ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  );
}
