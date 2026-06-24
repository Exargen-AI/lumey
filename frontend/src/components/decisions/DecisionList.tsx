import { useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Trash2, Edit2, Lightbulb, X } from 'lucide-react';
import { useDecisions, useCreateDecision, useUpdateDecision, useDeleteDecision } from '@/hooks/useDecisions';
import { Can } from '@/components/auth/Can';
import { Button, useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';

const STATUS_TONE: Record<string, { pill: string; dot: string; label: string }> = {
  PROPOSED:   {
    pill:  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    dot:   'bg-amber-500',
    label: 'Proposed',
  },
  ACCEPTED:   {
    pill:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot:   'bg-emerald-500',
    label: 'Accepted',
  },
  SUPERSEDED: {
    pill:  'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted',
    dot:   'bg-gray-400 dark:bg-obsidian-faded',
    label: 'Superseded',
  },
};

interface DecisionFormData {
  title: string;
  rationale: string;
  alternatives?: string;
  status: string;
  tags: string[];
}

export function DecisionList({ projectId }: { projectId: string }) {
  const { data: decisions, isLoading } = useDecisions(projectId);
  const createDecision = useCreateDecision(projectId);
  const updateDecision = useUpdateDecision(projectId);
  const deleteDecision = useDeleteDecision(projectId);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState<DecisionFormData>({ title: '', rationale: '', alternatives: '', status: 'PROPOSED', tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setForm({ title: '', rationale: '', alternatives: '', status: 'PROPOSED', tags: [] });
    setTagInput('');
    setShowForm(false);
    setEditingId(null);
    setFormError(null);
  };

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.rationale.trim()) return;
    setFormError(null);
    const data = { ...form, alternatives: form.alternatives || undefined };
    try {
      if (editingId) {
        await updateDecision.mutateAsync({ id: editingId, data });
      } else {
        await createDecision.mutateAsync(data);
      }
      resetForm();
    } catch (err: any) {
      // Was previously uncaught — would crash the page on mutation failure.
      setFormError(err?.response?.data?.error?.message || 'Could not save decision. Please try again.');
    }
  };

  const handleEdit = (decision: any) => {
    setForm({
      title: decision.title,
      rationale: decision.rationale,
      alternatives: decision.alternatives || '',
      status: decision.status,
      tags: decision.tags || [],
    });
    setEditingId(decision.id);
    setShowForm(true);
  };

  const confirm = useConfirm();
  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete this decision record?',
      body: 'The decision will be removed from the audit trail. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) await deleteDecision.mutateAsync(id);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] });
    }
    setTagInput('');
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
      </div>
    );
  }

  const grouped = {
    PROPOSED:   decisions?.filter((d: any) => d.status === 'PROPOSED') || [],
    ACCEPTED:   decisions?.filter((d: any) => d.status === 'ACCEPTED') || [],
    SUPERSEDED: decisions?.filter((d: any) => d.status === 'SUPERSEDED') || [],
  };

  const totalCount = decisions?.length || 0;

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-gray-500 dark:text-obsidian-muted">
          <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">{totalCount}</span> decision {totalCount === 1 ? 'record' : 'records'}
        </p>
        <Can permission="decision.create">
          <Button
            variant="primary"
            size="sm"
            leadingIcon={<Plus size={14} />}
            onClick={() => { resetForm(); setShowForm(true); }}
          >
            New Decision
          </Button>
        </Can>
      </div>

      {/* ─── Form ─── */}
      {showForm && (
        <div className={cn(
          'rounded-2xl p-6 space-y-4 animate-fade-in-down',
          'bg-white border border-brand-300/60 dark:bg-obsidian-panel dark:border-brand-500/30',
          'shadow-lift dark:shadow-lift-dark',
        )}>
          <h3 className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            {editingId ? 'Edit Decision' : 'New Decision'}
          </h3>

          <FormField label="Title" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="What was decided?"
              className={fieldClass}
            />
          </FormField>

          <FormField label="Rationale" required hint="Why was this decision made? Future-you will thank you.">
            <textarea
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              placeholder="The reasoning behind the decision…"
              rows={3}
              className={cn(fieldClass, 'resize-y min-h-[80px]')}
            />
          </FormField>

          <FormField label="Alternatives Considered" hint="Optional — what did you weigh against?">
            <textarea
              value={form.alternatives}
              onChange={(e) => setForm({ ...form, alternatives: e.target.value })}
              placeholder="Other options that were on the table…"
              rows={2}
              className={cn(fieldClass, 'resize-y min-h-[60px]')}
            />
          </FormField>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className={fieldClass}
              >
                <option value="PROPOSED">Proposed</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="SUPERSEDED">Superseded</option>
              </select>
            </FormField>

            <FormField label="Tags" hint="Press Enter to add">
              <div className="space-y-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                  placeholder="architecture, security…"
                  className={fieldClass}
                />
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 text-[11px] px-2 py-0.5 rounded-full">
                        {tag}
                        <button
                          onClick={() => setForm({ ...form, tags: form.tags.filter((t) => t !== tag) })}
                          className="hover:text-rose-500 transition-colors"
                          title={`Remove ${tag}`}
                          type="button"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </FormField>
          </div>

          {formError && (
            <p className="text-[12px] text-rose-600 dark:text-rose-400 leading-snug">{formError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={createDecision.isPending || updateDecision.isPending}
              disabled={!form.title.trim() || !form.rationale.trim()}
              onClick={handleSubmit}
            >
              {editingId ? 'Save changes' : 'Create decision'}
            </Button>
          </div>
        </div>
      )}

      {/* ─── Decision groups ─── */}
      {(['PROPOSED', 'ACCEPTED', 'SUPERSEDED'] as const).map((status) => {
        const items = grouped[status];
        if (!items.length) return null;
        const tone = STATUS_TONE[status];
        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-3">
              <span className={cn('w-1.5 h-1.5 rounded-full', tone.dot)} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted">
                {tone.label}
              </h3>
              <span className={cn('text-[10px] font-bold rounded-full px-1.5 py-0.5', tone.pill)}>
                {items.length}
              </span>
            </div>
            <div className="space-y-2">
              {items.map((decision: any) => {
                const isExpanded = expandedId === decision.id;
                const itemTone = STATUS_TONE[decision.status];
                return (
                  <div
                    key={decision.id}
                    className={cn(
                      'rounded-xl overflow-hidden transition-shadow',
                      'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
                      'shadow-soft dark:shadow-soft-dark',
                      isExpanded && 'shadow-lift dark:shadow-lift-dark border-brand-200 dark:border-brand-500/30',
                    )}
                  >
                    <div
                      className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-obsidian-raised/60 transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : decision.id)}
                    >
                      {isExpanded
                        ? <ChevronDown size={16} className="text-brand-500 dark:text-brand-400 shrink-0" />
                        : <ChevronRight size={16} className="text-gray-400 dark:text-obsidian-faded shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <h4 className="text-[14px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{decision.title}</h4>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-md font-semibold', itemTone.pill)}>
                            {itemTone.label}
                          </span>
                          {decision.tags?.map((tag: string) => (
                            <span key={tag} className="text-[10px] bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-muted px-1.5 py-0.5 rounded-md">
                              {tag}
                            </span>
                          ))}
                          <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">{formatRelative(decision.createdAt)}</span>
                        </div>
                      </div>
                      <Can permission="decision.edit">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEdit(decision); }}
                          className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 dark:text-obsidian-faded dark:hover:text-brand-400 hover:bg-gray-100 dark:hover:bg-obsidian-raised transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                      </Can>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-3 ml-7 space-y-3 border-t border-gray-100 dark:border-obsidian-border animate-fade-in">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">Rationale</p>
                          <p className="text-[13px] text-gray-700 dark:text-obsidian-fg whitespace-pre-wrap leading-relaxed">{decision.rationale}</p>
                        </div>
                        {decision.alternatives && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-1.5">Alternatives Considered</p>
                            <p className="text-[13px] text-gray-600 dark:text-obsidian-muted whitespace-pre-wrap leading-relaxed">{decision.alternatives}</p>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-2">
                          <p className="text-[11px] text-gray-400 dark:text-obsidian-faded">By {decision.createdBy?.name || 'Unknown'}</p>
                          <Can permission="decision.edit">
                            <button
                              onClick={() => handleDelete(decision.id)}
                              className="text-[11px] text-rose-500 hover:text-rose-700 dark:hover:text-rose-400 flex items-center gap-1 transition-colors"
                            >
                              <Trash2 size={11} /> Delete
                            </button>
                          </Can>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ─── Empty state ─── */}
      {!decisions?.length && !showForm && (
        <div className={cn(
          'rounded-2xl border-2 border-dashed py-14 text-center',
          'border-gray-200 dark:border-obsidian-border',
          'bg-white/40 dark:bg-obsidian-panel/40',
        )}>
          <Lightbulb size={32} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
          <p className="text-sm text-gray-500 dark:text-obsidian-muted">No decisions recorded yet.</p>
          <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1 mb-4">
            Capture the "why" behind your choices so the team can revisit them later.
          </p>
          <Can permission="decision.create">
            <Button variant="secondary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setShowForm(true)}>
              Create the first one
            </Button>
          </Can>
        </div>
      )}
    </div>
  );
}

// ─── Form helpers ───

const fieldClass = cn(
  'w-full text-sm rounded-lg px-3 py-2',
  'border border-gray-200 hover:border-gray-300',
  'dark:border-obsidian-border dark:hover:border-obsidian-border-strong',
  'focus:outline-none focus:border-brand-500 dark:focus:border-brand-400',
  'transition-colors',
);

function FormField({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
        {hint && <span className="text-[10px] text-gray-400 dark:text-obsidian-faded italic">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
