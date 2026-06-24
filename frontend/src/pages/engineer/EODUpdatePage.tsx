import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Flame, AlertCircle, Sun } from 'lucide-react';
import { useMyTasks } from '@/hooks/useTasks';
import { useSubmitDailyUpdate, useMyStreak } from '@/hooks/useDailyUpdates';
import { useAuthStore } from '@/stores/authStore';
import { Button, Field, Textarea, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { PRIORITY_COLORS, PRIORITY_LABELS, TASK_STATUS_ORDER, TASK_STATUS_LABELS } from '@/lib/constants';

interface TaskEntry {
  taskId: string;
  title: string;
  projectName: string;
  priority: string;
  currentStatus: string;
  selected: boolean;
  note: string;
  statusAfter: string;
}

export function EODUpdatePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data: myTasks } = useMyTasks();
  const { data: streakData } = useMyStreak();
  const submitUpdate = useSubmitDailyUpdate();

  const [step, setStep] = useState(1);
  const [taskEntries, setTaskEntries] = useState<TaskEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [blockers, setBlockers] = useState('');
  const [plans, setPlans] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const initialized = useRef(false);

  // Initialize task entries from myTasks (effect, not render-time, to avoid
  // setState-during-render warnings).
  useEffect(() => {
    if (myTasks && !initialized.current) {
      initialized.current = true;
      const active = myTasks
        .filter((t: any) => t.status !== 'DONE')
        .map((t: any) => ({
          taskId: t.id,
          title: t.title,
          projectName: t.project?.name || 'Unknown',
          priority: t.priority,
          currentStatus: t.status,
          selected: false,
          note: '',
          statusAfter: t.status,
        }));
      setTaskEntries(active);
    }
  }, [myTasks]);

  const selectedCount = taskEntries.filter((t) => t.selected).length;

  const handleToggleTask = (index: number) => {
    const updated = [...taskEntries];
    updated[index] = { ...updated[index], selected: !updated[index].selected };
    setTaskEntries(updated);
  };

  const handleTaskNote = (index: number, note: string) => {
    const updated = [...taskEntries];
    updated[index] = { ...updated[index], note };
    setTaskEntries(updated);
  };

  const handleTaskStatus = (index: number, statusAfter: string) => {
    const updated = [...taskEntries];
    updated[index] = { ...updated[index], statusAfter };
    setTaskEntries(updated);
  };

  const handleSubmit = async () => {
    setSubmitError('');
    const selectedTasks = taskEntries
      .filter((t) => t.selected)
      .map((t) => ({
        taskId: t.taskId,
        note: t.note || undefined,
        statusBefore: t.currentStatus,
        statusAfter: t.statusAfter,
      }));

    try {
      await submitUpdate.mutateAsync({
        summary,
        blockers: blockers || undefined,
        plans: plans || undefined,
        tasks: selectedTasks,
      });
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err?.response?.data?.error?.message || 'Failed to submit update. Please try again.');
    }
  };

  // ─── Confirmation screen ───
  if (submitted) {
    // useSubmitDailyUpdate invalidates ['my-streak'] on success, so streakData
    // refetches with today's update already counted. The previous `+1` was
    // double-counting — a brand-new user's first submit showed "2 Day Streak"
    // instead of "1 Day Streak". Fall back to 1 only while the refetch is in flight.
    const newStreak = streakData?.currentStreak ?? 1;
    return (
      <div className="max-w-lg mx-auto text-center py-16 animate-fade-in-up">
        <div className="text-6xl mb-6">🎉</div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg mb-2">
          Great work today, {user?.name?.split(' ')[0]}!
        </h1>

        <div
          className="inline-flex items-center gap-2 bg-orange-50 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-500/30 rounded-full px-5 py-2.5 my-6"
          style={{ boxShadow: '0 0 24px rgba(251,146,60,0.25)' }}
        >
          <Flame size={20} className="text-orange-500" />
          <span className="font-bold text-orange-600 dark:text-orange-300 tabular-nums">{newStreak} Day Streak!</span>
        </div>

        <div className="space-y-2 my-6 text-gray-600 dark:text-obsidian-muted">
          <p>
            You updated <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">{selectedCount}</span> {selectedCount === 1 ? 'task' : 'tasks'} today
          </p>
          {selectedCount > 0 && <p className="text-emerald-600 dark:text-emerald-400 font-medium">Keep up the momentum!</p>}
        </div>

        <Button variant="primary" size="lg" onClick={() => navigate('/eng/dashboard')}>
          Done for today
        </Button>
      </div>
    );
  }

  // ─── Wizard ───
  return (
    <div className="max-w-2xl mx-auto animate-fade-in-up">
      {/* Header — back link + step indicator */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/eng/dashboard')}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 dark:text-obsidian-muted dark:hover:text-obsidian-fg transition-colors group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" /> Back to dashboard
        </button>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={cn(
                  'w-8 h-1 rounded-full transition-colors',
                  s <= step ? 'bg-brand-500 dark:bg-brand-400' : 'bg-gray-200 dark:bg-obsidian-raised',
                )}
              />
            ))}
          </div>
          <span className="text-[11px] text-gray-500 dark:text-obsidian-muted font-medium">Step {step} of 3</span>
        </div>
      </div>

      {/* Card with brand-violet accent header */}
      <div className={cn(
        'rounded-2xl overflow-hidden',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
      )}>
        {/* Accent header */}
        <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-fuchsia-600 px-6 py-4">
          <span aria-hidden className="pointer-events-none absolute inset-0 opacity-20"
            style={{ backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,0.4), transparent 40%)' }}
          />
          <h1 className="relative text-base font-semibold tracking-tight text-white flex items-center gap-2">
            {step === 1 && <><Sun size={16} /> End of Day Update</>}
            {step === 2 && <>💭 How was your day?</>}
            {step === 3 && <><Check size={16} /> Review & Submit</>}
          </h1>
        </div>

        {/* ─── Step 1: Task Selection ─── */}
        {step === 1 && (
          <div className="p-6">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg mb-1">What did you work on today?</h2>
            <p className="text-[13px] text-gray-500 dark:text-obsidian-muted mb-5">Select the tasks you touched and update their status.</p>

            {taskEntries.length === 0 ? (
              <div className={cn(
                'rounded-xl border-2 border-dashed py-12 text-center',
                'border-gray-200 dark:border-obsidian-border',
                'bg-gray-50/40 dark:bg-obsidian-bg/40',
              )}>
                <p className="text-sm text-gray-400 dark:text-obsidian-faded">No active tasks assigned to you.</p>
                <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">You can still submit a summary on the next step.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {taskEntries.map((task, i) => {
                  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS];
                  return (
                    <div
                      key={task.taskId}
                      className={cn(
                        'rounded-xl border p-3.5 transition-all',
                        task.selected
                          ? 'border-brand-300 bg-brand-50/50 dark:border-brand-500/40 dark:bg-brand-500/[0.06] shadow-soft dark:shadow-soft-dark'
                          : 'border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel opacity-80 hover:opacity-100',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={task.selected}
                          onChange={() => handleToggleTask(i)}
                          className="w-4 h-4 rounded text-brand-600 accent-brand-600"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[10px] font-bold rounded px-1.5 py-0.5 shrink-0"
                              style={{ backgroundColor: priorityColor + '20', color: priorityColor }}
                            >
                              {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
                            </span>
                            <span className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{task.title}</span>
                          </div>
                          <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">{task.projectName}</span>
                        </div>
                        {task.selected && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">{TASK_STATUS_LABELS[task.currentStatus as keyof typeof TASK_STATUS_LABELS]}</span>
                            <ChevronRight size={12} className="text-gray-400 dark:text-obsidian-faded" />
                            <Select
                              size="sm"
                              value={task.statusAfter}
                              onChange={(e) => handleTaskStatus(i, e.target.value)}
                              className="text-[11px] font-medium text-brand-700 dark:text-brand-300 border-brand-300 dark:border-brand-500/40 w-32"
                            >
                              {TASK_STATUS_ORDER.map((s) => (
                                <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
                              ))}
                            </Select>
                          </div>
                        )}
                      </div>
                      {task.selected && (
                        <div className="mt-3 ml-7">
                          <input
                            type="text"
                            value={task.note}
                            onChange={(e) => handleTaskNote(i, e.target.value)}
                            placeholder="What did you do on this task?"
                            className={cn(
                              'w-full text-[13px] rounded-md px-3 h-9',
                              'bg-white border border-gray-200 hover:border-gray-300',
                              'dark:bg-obsidian-raised dark:border-obsidian-border dark:hover:border-obsidian-border-strong',
                              'text-gray-900 dark:text-obsidian-fg',
                              'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
                              'focus:outline-none focus:border-brand-500 dark:focus:border-brand-400',
                              'transition-colors',
                            )}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100 dark:border-obsidian-border">
              <p className="text-[13px] text-gray-500 dark:text-obsidian-muted">
                <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">{selectedCount}</span> task{selectedCount !== 1 ? 's' : ''} selected
              </p>
              <Button variant="primary" size="sm" trailingIcon={<ArrowRight size={14} />} onClick={() => setStep(2)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {/* ─── Step 2: Summary, Blockers, Plans ─── */}
        {step === 2 && (
          <div className="p-6 space-y-5">
            <Field label="What did you accomplish today?" required>
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="Brief summary of your day…"
                autoFocus
              />
            </Field>

            <Field label="Any blockers?" hint="Optional">
              <Textarea
                value={blockers}
                onChange={(e) => setBlockers(e.target.value)}
                rows={2}
                placeholder="What's blocking your progress?"
              />
            </Field>

            <Field label="Tomorrow's plan" hint="Optional">
              <Textarea
                value={plans}
                onChange={(e) => setPlans(e.target.value)}
                rows={2}
                placeholder="What will you focus on tomorrow?"
              />
            </Field>

            <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-obsidian-border">
              <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft size={14} />} onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                variant="primary"
                size="sm"
                trailingIcon={<ArrowRight size={14} />}
                disabled={!summary.trim()}
                onClick={() => setStep(3)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* ─── Step 3: Review ─── */}
        {step === 3 && (
          <div className="p-6">
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg mb-4">Review your update</h2>

            <div className={cn(
              'rounded-xl p-5 space-y-3 mb-5',
              'bg-gray-50 border border-gray-100 dark:bg-obsidian-sunken dark:border-obsidian-border',
            )}>
              <ReviewRow label="Tasks updated" value={<span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">{selectedCount}</span>} />
              <ReviewRow label="Summary" value={<span className="text-[13px] text-gray-900 dark:text-obsidian-fg leading-relaxed">{summary}</span>} />
              {blockers && <ReviewRow label="Blockers" value={<span className="text-[13px] text-rose-600 dark:text-rose-400 leading-relaxed">{blockers}</span>} />}
              {plans && <ReviewRow label="Tomorrow" value={<span className="text-[13px] text-gray-900 dark:text-obsidian-fg leading-relaxed">{plans}</span>} />}
            </div>

            {selectedCount > 0 && (
              <div className="mb-5">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">Task changes</h3>
                <div className="space-y-1.5">
                  {taskEntries.filter((t) => t.selected).map((t) => (
                    <div key={t.taskId} className="flex items-center gap-2 text-[13px]">
                      <Check size={13} className="text-emerald-500 shrink-0" />
                      <span className="text-gray-900 dark:text-obsidian-fg truncate">{t.title}</span>
                      {t.currentStatus !== t.statusAfter && (
                        <span className="text-[10px] text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-500/15 rounded px-1.5 py-0.5 shrink-0 font-medium">
                          {TASK_STATUS_LABELS[t.currentStatus as keyof typeof TASK_STATUS_LABELS]} → {TASK_STATUS_LABELS[t.statusAfter as keyof typeof TASK_STATUS_LABELS]}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Submit error — was previously set but never displayed */}
            {submitError && (
              <div className={cn(
                'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm mb-5 animate-fade-in',
                'bg-rose-50 border border-rose-200 text-rose-700',
                'dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300',
              )}>
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <span className="leading-snug">{submitError}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-obsidian-border">
              <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft size={14} />} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button
                variant="primary"
                size="md"
                loading={submitUpdate.isPending}
                onClick={handleSubmit}
              >
                {submitUpdate.isPending ? 'Submitting…' : 'Submit Update'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Small helper for the review section so each row reads consistently.
function ReviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] text-gray-500 dark:text-obsidian-muted shrink-0 uppercase tracking-wide font-medium pt-0.5 w-20">{label}</span>
      <div className="flex-1 min-w-0">{value}</div>
    </div>
  );
}
