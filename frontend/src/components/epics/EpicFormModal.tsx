import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal, Button, Field, Input } from '@/components/ui';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { useCreateEpic, useUpdateEpic } from '@/hooks/useSprints';
import type { EpicSummary } from '@/api/sprints';
import { cn } from '@/lib/cn';

interface EpicFormModalProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Pass an existing epic to switch into edit mode. */
  epic?: EpicSummary | null;
}

/**
 * Curated palette — each chip is hand-picked to read clearly on the dark
 * Obsidian canvas. Eight is the sweet spot: enough variety to differentiate
 * 8+ epics in a single project, few enough that pickers don't sprawl.
 */
const EPIC_COLORS = [
  '#7c3aed', // brand violet
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // rose
  '#ec4899', // pink
  '#a3a3a3', // neutral
];

/**
 * Create-or-edit epic dialog. Three fields: title (required), description
 * (markdown later — plain textarea for now), color (curated swatches).
 *
 * Uses our existing Modal primitive so behaviour matches the rest of the app
 * (Esc closes, focus trap, backdrop click).
 */
export function EpicFormModal({ projectId, open, onClose, epic }: EpicFormModalProps) {
  const isEdit = !!epic;
  const [title, setTitle] = useState(epic?.title ?? '');
  const [description, setDescription] = useState(epic?.description ?? '');
  const [color, setColor] = useState(epic?.color ?? EPIC_COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateEpic(projectId);
  const updateMutation = useUpdateEpic(projectId);
  const submitting = createMutation.isPending || updateMutation.isPending;

  // Reset whenever the modal opens with a different epic (or no epic).
  useEffect(() => {
    if (!open) return;
    setTitle(epic?.title ?? '');
    setDescription(epic?.description ?? '');
    setColor(epic?.color ?? EPIC_COLORS[0]);
    setError(null);
  }, [open, epic?.id, epic?.title, epic?.description, epic?.color]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError('Title is required.');
      return;
    }
    // Treat the empty-paragraph shell TipTap emits as "no description".
    const cleaned = description.replace(/<p>\s*<\/p>/g, '').trim();
    try {
      if (isEdit && epic) {
        await updateMutation.mutateAsync({
          id: epic.id,
          data: {
            title: trimmed,
            description: cleaned || null,
            color,
          },
        });
      } else {
        await createMutation.mutateAsync({
          title: trimmed,
          description: cleaned || undefined,
          color,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to save the epic. Please try again.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit epic' : 'New epic'}
      subtitle={isEdit ? `Editing “${epic?.title}”` : undefined}
      size="md"
      accent="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="epic-form"
            disabled={submitting || title.trim().length === 0}
            leadingIcon={<Check size={14} />}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create epic'}
          </Button>
        </>
      }
    >
      <form id="epic-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Title" required>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Knowledge Graph"
            maxLength={200}
          />
        </Field>

        <Field
          label="Description"
          hint="Goals, scope, what's in / out. Type / for commands or @ to mention."
        >
          <RichTextEditor
            value={description}
            onChange={setDescription}
            liveUpdate
            projectId={projectId}
            placeholder="A short brief — what this epic delivers and why now."
          />
        </Field>

        <Field label="Color">
          <div className="flex flex-wrap gap-2 pt-1" role="radiogroup" aria-label="Epic color">
            {EPIC_COLORS.map((c) => {
              const selected = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'group relative w-7 h-7 rounded-full transition-transform',
                    'hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500/60',
                    'dark:focus-visible:ring-offset-obsidian-panel',
                    selected && 'scale-110',
                  )}
                  style={{ backgroundColor: c }}
                >
                  {selected && (
                    <span className="absolute inset-0 flex items-center justify-center">
                      <Check size={14} className="text-white drop-shadow" strokeWidth={3} />
                    </span>
                  )}
                  <span
                    className={cn(
                      'absolute inset-0 rounded-full ring-2 transition-opacity',
                      selected ? 'opacity-100 ring-white/40 dark:ring-white/30' : 'opacity-0 group-hover:opacity-50 ring-white/20',
                    )}
                  />
                </button>
              );
            })}
          </div>
        </Field>

        {error && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
      </form>
    </Modal>
  );
}
