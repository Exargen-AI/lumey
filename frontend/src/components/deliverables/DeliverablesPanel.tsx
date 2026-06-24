import { useState } from 'react';
import { CheckCircle2, Circle, FileSignature, Plus, Trash2, AlertCircle, Calendar, ShieldCheck } from 'lucide-react';
import { useDeliverables, useCreateDeliverable, useUpdateDeliverable, useDeleteDeliverable, useMarkDelivered, useSignOffDeliverable } from '@/hooks/useDeliverables';
import { useHasAnyPermission, usePermission } from '@/hooks/usePermission';
import { useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

type Deliverable = {
  id: string;
  title: string;
  description: string | null;
  acceptanceCriteria: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'DELIVERED' | 'SIGNED_OFF' | 'REJECTED';
  targetDate: string | null;
  deliveredAt: string | null;
  signedOffAt: string | null;
  signedOffBy: { id: string; name: string; role: string } | null;
  rejectionNote: string | null;
};

const STATUS_CONFIG: Record<Deliverable['status'], { label: string; color: string; ring: string; icon: typeof Circle }> = {
  PENDING:     { label: 'Pending',     color: 'bg-gray-100 text-gray-700',     ring: 'ring-gray-300',     icon: Circle },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-brand-100 text-brand-700', ring: 'ring-brand-300',   icon: Circle },
  DELIVERED:   { label: 'Delivered',   color: 'bg-amber-100 text-amber-700',   ring: 'ring-amber-300',    icon: CheckCircle2 },
  SIGNED_OFF:  { label: 'Signed Off',  color: 'bg-green-100 text-green-700',   ring: 'ring-green-400',    icon: ShieldCheck },
  REJECTED:    { label: 'Sent Back',   color: 'bg-red-100 text-red-700',       ring: 'ring-red-300',      icon: AlertCircle },
};

interface Props {
  projectId: string;
  /** When true, shows admin/PM/engineer controls (create, edit, delete, mark delivered).
   *  When false, renders the read-only client view with sign-off. */
  manage?: boolean;
}

export function DeliverablesPanel({ projectId, manage = false }: Props) {
  const { data: deliverables, isLoading } = useDeliverables(projectId);
  const createMut = useCreateDeliverable(projectId);
  const updateMut = useUpdateDeliverable(projectId);
  const deleteMut = useDeleteDeliverable(projectId);
  const markMut = useMarkDelivered(projectId);
  const signOffMut = useSignOffDeliverable(projectId);

  const canCreate = useHasAnyPermission(['deliverable.create']);
  const canEdit = useHasAnyPermission(['deliverable.edit']);
  const canDelete = useHasAnyPermission(['deliverable.delete']);
  const canSignOff = usePermission('deliverable.sign_off');
  const confirm = useConfirm();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', acceptanceCriteria: '', targetDate: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const resetDraft = () => { setDraft({ title: '', description: '', acceptanceCriteria: '', targetDate: '' }); setShowForm(false); setEditingId(null); setFormError(null); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    setFormError(null);
    try {
      if (editingId) {
        await updateMut.mutateAsync({ id: editingId, data: draft });
      } else {
        await createMut.mutateAsync(draft);
      }
      resetDraft();
    } catch (err: any) {
      // Surface failures inline so users know to retry — was previously swallowed.
      setFormError(err?.response?.data?.error?.message || 'Could not save deliverable. Please try again.');
    }
  };

  const startEdit = (d: Deliverable) => {
    setEditingId(d.id);
    setDraft({
      title: d.title,
      description: d.description || '',
      acceptanceCriteria: d.acceptanceCriteria || '',
      targetDate: d.targetDate ? d.targetDate.slice(0, 10) : '',
    });
    setShowForm(true);
  };

  const list = (deliverables as Deliverable[] | undefined) || [];
  const counts = list.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (isLoading) return <div className="text-sm text-gray-400 py-4">Loading deliverables…</div>;

  return (
    <div className="space-y-4">
      {/* Header + summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileSignature size={20} className="text-brand-600" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Agreed Deliverables</h3>
          {list.length > 0 && (
            <span className="text-xs text-gray-500">
              {counts.SIGNED_OFF || 0} signed off · {counts.DELIVERED || 0} pending review · {(counts.PENDING || 0) + (counts.IN_PROGRESS || 0)} in flight
            </span>
          )}
        </div>
        {manage && canCreate && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
          >
            <Plus size={14} /> Add
          </button>
        )}
      </div>

      {/* Add / edit form */}
      {manage && showForm && (
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
              placeholder="e.g. Phase 1: Real-time inventory dashboard"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Description (what is being delivered)</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Acceptance criteria (what client expects to see)</label>
            <textarea
              value={draft.acceptanceCriteria}
              onChange={(e) => setDraft({ ...draft, acceptanceCriteria: e.target.value })}
              rows={2}
              placeholder="Bullet points or a single-paragraph definition of done"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Target date</label>
              <input
                type="date"
                value={draft.targetDate}
                onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              type="submit"
              disabled={createMut.isPending || updateMut.isPending}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
            >
              {editingId ? 'Save' : 'Create'}
            </button>
            <button type="button" onClick={resetDraft} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
          {formError && (
            <p className="text-[12px] text-rose-600 dark:text-rose-400 leading-snug">{formError}</p>
          )}
        </form>
      )}

      {/* List */}
      {list.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 py-10 text-center">
          <FileSignature size={28} className="mx-auto text-gray-300 mb-2" />
          <p className="text-sm text-gray-500">No agreed deliverables yet.</p>
          {manage && canCreate && !showForm && (
            <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-brand-600 hover:text-brand-700">
              Add the first deliverable
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((d) => {
            const cfg = STATUS_CONFIG[d.status];
            const StatusIcon = cfg.icon;
            const isSignedOff = d.status === 'SIGNED_OFF';
            const isDelivered = d.status === 'DELIVERED';
            return (
              <div
                key={d.id}
                className={cn(
                  'bg-white dark:bg-gray-900 rounded-xl border p-5 ring-1 ring-inset',
                  cfg.ring,
                  'border-gray-200 dark:border-gray-700',
                  isSignedOff && 'bg-green-50/30 dark:bg-green-950/10'
                )}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <StatusIcon size={20} className={cn('mt-0.5 shrink-0', isSignedOff ? 'text-green-600' : 'text-gray-400')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className={cn('font-semibold text-gray-900 dark:text-gray-100', isSignedOff && 'text-green-900 dark:text-green-200')}>{d.title}</h4>
                        <span className={cn('text-[11px] font-medium rounded-full px-2 py-0.5', cfg.color)}>{cfg.label}</span>
                      </div>
                      {d.targetDate && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                          <Calendar size={12} /> Target: {formatDate(d.targetDate)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Manage controls */}
                  {manage && !isSignedOff && (
                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit && (
                        <button
                          onClick={() => startEdit(d)}
                          className="text-xs px-2 py-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                          title="Edit"
                        >
                          Edit
                        </button>
                      )}
                      {canEdit && (d.status === 'PENDING' || d.status === 'IN_PROGRESS' || d.status === 'REJECTED') && (
                        <button
                          onClick={() => markMut.mutate(d.id)}
                          disabled={markMut.isPending}
                          className="text-xs px-2 py-1 rounded text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                        >
                          Mark Delivered
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={async () => {
                            if (deleteMut.isPending) return;
                            const ok = await confirm({
                              title: `Delete "${d.title}"?`,
                              body: 'This deliverable will be removed from the project. This cannot be undone.',
                              tone: 'danger',
                              confirmLabel: 'Delete',
                            });
                            if (ok) deleteMut.mutate(d.id);
                          }}
                          disabled={deleteMut.isPending}
                          className="text-xs p-1.5 rounded text-red-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Client sign-off button */}
                  {!manage && canSignOff && isDelivered && (
                    <button
                      onClick={async () => {
                        // Sign-off is irreversible — branded confirm for legal seriousness.
                        if (signOffMut.isPending) return;
                        const ok = await confirm({
                          title: 'Sign off on this deliverable?',
                          body: 'Sign-off is final and cannot be undone — it records your acceptance for the project record. Make sure everything is to your satisfaction first.',
                          tone: 'warning',
                          confirmLabel: 'Sign off',
                        });
                        if (ok) signOffMut.mutate(d.id);
                      }}
                      disabled={signOffMut.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 shrink-0"
                    >
                      <ShieldCheck size={14} /> Sign Off
                    </button>
                  )}
                </div>

                {d.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 ml-8 mb-2 whitespace-pre-wrap">{d.description}</p>
                )}
                {d.acceptanceCriteria && (
                  <div className="ml-8 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 text-xs">
                    <p className="font-medium text-gray-500 uppercase tracking-wide mb-1">Acceptance criteria</p>
                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{d.acceptanceCriteria}</p>
                  </div>
                )}
                {d.rejectionNote && d.status === 'REJECTED' && (
                  <div className="ml-8 bg-red-50 dark:bg-red-950/20 rounded-lg p-3 text-xs mt-2">
                    <p className="font-medium text-red-600 uppercase tracking-wide mb-1">Sent back</p>
                    <p className="text-red-700 dark:text-red-300 whitespace-pre-wrap">{d.rejectionNote}</p>
                  </div>
                )}

                {/* Sign-off audit footer */}
                {isSignedOff && d.signedOffBy && d.signedOffAt && (
                  <div className="ml-8 mt-3 flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
                    <ShieldCheck size={14} />
                    <span>
                      Signed off by <span className="font-semibold">{d.signedOffBy.name}</span> on {formatDate(d.signedOffAt)}
                    </span>
                  </div>
                )}
                {isDelivered && d.deliveredAt && (
                  <div className="ml-8 mt-2 text-xs text-gray-500">
                    Marked delivered on {formatDate(d.deliveredAt)} — awaiting client sign-off
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
