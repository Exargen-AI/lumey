import { useState } from 'react';
import { Send, X } from 'lucide-react';
import type { StoryUpdateData } from '@exargen/shared';
import { Field, Input, Textarea, Select } from '@/components/ui';

interface StoryUpdateFormProps {
  onSubmit: (data: StoryUpdateData) => Promise<void> | void;
  onCancel: () => void;
  /** Disables the submit button while the post is in flight. */
  submitting?: boolean;
  /** Pre-fills the form for an in-place edit of an existing update. */
  initial?: StoryUpdateData;
}

/**
 * The structured "story update" composer an engineer fills after working a
 * task — the client-facing template (objective / current task / reason /
 * impact / design change / progress / next step). Posting it creates a
 * `story_update` comment that renders as a distinct card and notifies the
 * client. Objective, current task, and progress are required; the rest are
 * optional so a quick "now at 60%" bump stays low-friction.
 */
export function StoryUpdateForm({ onSubmit, onCancel, submitting, initial }: StoryUpdateFormProps) {
  const isEdit = !!initial;
  const [objective, setObjective] = useState(initial?.objective ?? '');
  const [currentTask, setCurrentTask] = useState(initial?.currentTask ?? '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [impact, setImpact] = useState(initial?.impact ?? '');
  const [designChanged, setDesignChanged] = useState(initial?.designChange === 'changed');
  const [designOriginal, setDesignOriginal] = useState(initial?.designOriginal ?? '');
  const [designNew, setDesignNew] = useState(initial?.designNew ?? '');
  const [progress, setProgress] = useState(initial?.progress ?? 50);
  const [nextStep, setNextStep] = useState(initial?.nextStep ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!objective.trim() || !currentTask.trim()) {
      setError('Objective and current task are required.');
      return;
    }
    setError(null);
    const data: StoryUpdateData = {
      objective: objective.trim(),
      currentTask: currentTask.trim(),
      reason: reason.trim() || undefined,
      impact: impact.trim() || undefined,
      designChange: designChanged ? 'changed' : 'none',
      designOriginal: designChanged ? designOriginal.trim() || undefined : undefined,
      designNew: designChanged ? designNew.trim() || undefined : undefined,
      progress,
      nextStep: nextStep.trim() || undefined,
    };
    await onSubmit(data);
  };

  return (
    <div className="rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50/40 dark:bg-brand-500/[0.06] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h5 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand-700 dark:text-brand-300">
          {isEdit ? 'Edit progress update' : 'Progress update'}
        </h5>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600 dark:text-obsidian-faded dark:hover:text-obsidian-fg transition-colors"
          aria-label="Cancel update"
        >
          <X size={14} />
        </button>
      </div>

      <Field label="Story objective" required>
        <Textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="What outcome is this story working toward?"
          rows={2}
        />
      </Field>

      <Field label="Current task" required>
        <Textarea
          value={currentTask}
          onChange={(e) => setCurrentTask(e.target.value)}
          placeholder="What are you working on right now?"
          rows={2}
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Reason" hint="optional">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this task / what prompted it?"
            rows={2}
          />
        </Field>
        <Field label="Impact" hint="optional">
          <Textarea
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
            placeholder="What depends on or is affected by this?"
            rows={2}
          />
        </Field>
      </div>

      <Field label="Design change?">
        <Select
          value={designChanged ? 'changed' : 'none'}
          onChange={(e) => setDesignChanged(e.target.value === 'changed')}
        >
          <option value="none">No design change</option>
          <option value="changed">Yes — design changed</option>
        </Select>
      </Field>

      {designChanged && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Original">
            <Textarea
              value={designOriginal}
              onChange={(e) => setDesignOriginal(e.target.value)}
              placeholder="The original assumption / approach"
              rows={2}
            />
          </Field>
          <Field label="New">
            <Textarea
              value={designNew}
              onChange={(e) => setDesignNew(e.target.value)}
              placeholder="What it changed to"
              rows={2}
            />
          </Field>
        </div>
      )}

      <Field label={`Progress — ${progress}%`}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="flex-1 accent-brand-600 dark:accent-brand-400"
            aria-label="Progress percent"
          />
          <Input
            type="number"
            min={0}
            max={100}
            size="sm"
            value={progress}
            onChange={(e) => {
              const n = Number(e.target.value);
              setProgress(Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, n)));
            }}
            className="w-16 text-center"
          />
        </div>
      </Field>

      <Field label="Next step" hint="optional">
        <Textarea
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
          placeholder="What happens next?"
          rows={2}
        />
      </Field>

      {error && (
        <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-snug">{error}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={12} />
          {submitting ? 'Saving…' : isEdit ? 'Save update' : 'Post update'}
        </button>
      </div>
    </div>
  );
}
