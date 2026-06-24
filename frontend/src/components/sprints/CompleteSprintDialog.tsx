import { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, ArrowRight, AlertCircle } from 'lucide-react';
import { Modal, Button, Field, Textarea } from '@/components/ui';
import { useCompleteSprint, useProjectSprints, useSprintDetail } from '@/hooks/useSprints';
import type { CompleteSprintInput } from '@/api/sprints';
import { cn } from '@/lib/cn';
import { pluralize } from '@/lib/plural';

interface CompleteSprintDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * The sprint being completed. Pass the full sprint detail object — we read
   * its tasks, points totals, and projectId.
   */
  sprint: any;
  projectId: string;
}

interface IncompleteTask {
  id: string;
  taskNumber: number;
  title: string;
  status: string;
  storyPoints: number | null;
}

/**
 * Replaces the old `confirm()` for completing a sprint. Captures retro notes
 * and lets the user pick which incomplete tasks (if any) carry over to the
 * backlog or to the next sprint.
 *
 *   wentWell     — what went well — keep doing
 *   didntGoWell  — what didn't — stop / change
 *   actionItems  — concrete commitments for next sprint
 *
 * The form accepts empty retro fields (the sprint can still be closed
 * silently), but encourages capture by displaying placeholder examples.
 */
export function CompleteSprintDialog({ open, onClose, sprint, projectId }: CompleteSprintDialogProps) {
  const completeSprint = useCompleteSprint(projectId);
  const { data: sprints } = useProjectSprints(projectId);
  // The list endpoint returns aggregates (counts/points) but not full task
  // rows. Pull detail when the dialog opens so we can render the carry-over
  // checkboxes with task IDs and titles.
  const { data: detail } = useSprintDetail(open ? sprint?.id : '');

  const incomplete = useMemo<IncompleteTask[]>(() => {
    const source = detail?.tasks ?? sprint?.tasks ?? [];
    return source.filter((t: any) => t.status !== 'DONE').map((t: any) => ({
      id: t.id,
      taskNumber: t.taskNumber ?? 0,
      title: t.title ?? '(untitled)',
      status: t.status,
      storyPoints: t.storyPoints ?? null,
    }));
  }, [detail, sprint]);

  const otherSprints = useMemo(() => {
    if (!sprints) return [];
    return sprints.filter((s: any) => s.id !== sprint?.id && (s.status === 'PLANNING' || s.status === 'ACTIVE'));
  }, [sprints, sprint?.id]);

  const [wentWell, setWentWell] = useState('');
  const [didntGoWell, setDidntGoWell] = useState('');
  const [actionItems, setActionItems] = useState('');
  const [carryOverIds, setCarryOverIds] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<'backlog' | string>('backlog');
  const [error, setError] = useState<string | null>(null);

  // When the dialog opens, default-select all incomplete tasks for carry-over.
  // Most teams want this; the user can untick any they don't want.
  useEffect(() => {
    if (open) {
      setCarryOverIds(new Set(incomplete.map((t) => t.id)));
      setError(null);
    }
  }, [open, incomplete]);

  const allChecked = carryOverIds.size === incomplete.length && incomplete.length > 0;
  const noneChecked = carryOverIds.size === 0;

  function toggleAll() {
    if (allChecked) setCarryOverIds(new Set());
    else setCarryOverIds(new Set(incomplete.map((t) => t.id)));
  }

  function toggle(id: string) {
    const next = new Set(carryOverIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCarryOverIds(next);
  }

  async function handleConfirm() {
    setError(null);
    const carryOver = noneChecked
      ? 'none'
      : carryOverIds.size === incomplete.length
      ? 'all'
      : 'selected';
    const input: CompleteSprintInput = {
      retro: {
        wentWell: wentWell.trim() || undefined,
        didntGoWell: didntGoWell.trim() || undefined,
        actionItems: actionItems.trim() || undefined,
      },
      carryOver,
      carryOverTaskIds: carryOver === 'selected' ? Array.from(carryOverIds) : undefined,
      carryOverToSprintId: carryOver !== 'none' && target !== 'backlog' ? target : null,
    };
    try {
      await completeSprint.mutateAsync({ sprintId: sprint.id, input });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to complete sprint. Please try again.');
    }
  }

  const stats = sprint ? {
    completed: sprint.doneTasks ?? 0,
    total: sprint.totalTasks ?? 0,
    completedPoints: sprint.donePoints ?? 0,
    totalPoints: sprint.totalPoints ?? 0,
  } : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Complete ${sprint?.name ?? 'sprint'}`}
      subtitle={stats ? `${pluralize(stats.completed, 'task')} done of ${stats.total} · ${stats.completedPoints}/${stats.totalPoints} pts` : undefined}
      size="lg"
      accent="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={completeSprint.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={completeSprint.isPending}
            leadingIcon={<CheckCircle2 size={14} />}
          >
            {completeSprint.isPending ? 'Closing…' : 'Complete sprint'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Retro */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">
            Retro
          </h3>
          <div className="grid grid-cols-1 gap-3">
            <Field label="What went well?" hint="Keep doing — patterns worth repeating.">
              <Textarea
                rows={2}
                value={wentWell}
                onChange={(e) => setWentWell(e.target.value)}
                placeholder="e.g. Pairing on the failover spike unblocked us by Wednesday."
                maxLength={5000}
              />
            </Field>
            <Field label="What didn't?" hint="Stop or change — friction worth surfacing.">
              <Textarea
                rows={2}
                value={didntGoWell}
                onChange={(e) => setDidntGoWell(e.target.value)}
                placeholder="e.g. Started Monday standup later in the week and lost context."
                maxLength={5000}
              />
            </Field>
            <Field label="Action items" hint="Commit to one or two concrete changes for next sprint.">
              <Textarea
                rows={2}
                value={actionItems}
                onChange={(e) => setActionItems(e.target.value)}
                placeholder="e.g. Move standup to 9:30 IST. Add CVE-tagging to PR template."
                maxLength={5000}
              />
            </Field>
          </div>
        </section>

        {/* Carry-over picker */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
              Carry over incomplete tasks
            </h3>
            {incomplete.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[11px] text-brand-600 dark:text-brand-300 hover:underline focus:outline-none"
              >
                {allChecked ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>

          {incomplete.length === 0 ? (
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted italic">
              All tasks in this sprint are done — nothing to carry over.
            </p>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 dark:border-obsidian-border bg-gray-50/40 dark:bg-obsidian-sunken/30 max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-obsidian-border/60">
                {incomplete.map((t) => {
                  const checked = carryOverIds.has(t.id);
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-obsidian-raised/40',
                        checked && 'bg-brand-500/[0.05]',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(t.id)}
                        className="w-3.5 h-3.5 rounded text-brand-600 accent-brand-600 shrink-0"
                      />
                      <code className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-obsidian-faded shrink-0">
                        #{t.taskNumber}
                      </code>
                      <span className="flex-1 truncate text-[12.5px] text-gray-800 dark:text-obsidian-fg">
                        {t.title}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-obsidian-faded shrink-0">
                        {t.status.replace('_', ' ')}
                      </span>
                      {t.storyPoints != null && (
                        <span className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-obsidian-faded shrink-0">
                          {t.storyPoints}pt
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>

              {!noneChecked && (
                <div className="mt-3 flex items-center gap-2 text-[12px]">
                  <span className="text-gray-500 dark:text-obsidian-muted">Move to</span>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    className="px-2 py-1 rounded border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-bg text-gray-800 dark:text-obsidian-fg focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  >
                    <option value="backlog">Backlog</option>
                    {otherSprints.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}{s.status === 'ACTIVE' ? ' (active)' : ''}</option>
                    ))}
                  </select>
                  <ArrowRight size={12} className="text-gray-400 dark:text-obsidian-faded" />
                  <span className="text-gray-700 dark:text-obsidian-fg font-medium tabular-nums">
                    {carryOverIds.size} {carryOverIds.size === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
              )}

              {noneChecked && (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300 flex items-start gap-1.5">
                  <AlertCircle size={11} className="mt-0.5 shrink-0" />
                  None selected — incomplete tasks will stay attached to this completed sprint and won't appear in any active queue.
                </p>
              )}
            </>
          )}
        </section>

        {error && (
          <div role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
