import { useMemo, useState } from 'react';
import { AlertCircle, Check, Eye, Send, ThumbsUp, X } from 'lucide-react';
import { useRequestReview, useDecideReview } from '@/hooks/useTasks';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';
import { ROLE_LABELS } from '@/lib/constants';

/**
 * Review panel in the task slide-over and full-page detail.
 *
 * Three states, three layouts:
 *   1. **Idle** (status != IN_REVIEW, != DONE) — collapsed "Request review"
 *      affordance. Click → expands into a small picker (project member
 *      dropdown + optional note + Send). Only renders if the user can
 *      request a review (role permission OR is assignee/creator).
 *   2. **In review, viewer is the reviewer (or admin)** — Approve +
 *      Request changes buttons. Request-changes opens a small form that
 *      requires a comment (server enforces too).
 *   3. **In review, viewer is someone else** — read-only "waiting on
 *      X for Y days" strip with no actions.
 *
 * Closed/Done state — the section hides itself (nothing to do here).
 */

interface ReviewSectionProps {
  task: any;
  members: Array<{ userId: string; user: { id: string; name: string; role: string } }>;
}

export function ReviewSection({ task, members }: ReviewSectionProps) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const currentUserRole = useAuthStore((s) => s.user?.role ?? null);
  const canRequestRole = usePermission('task.request_review');

  const requestReview = useRequestReview();
  const decideReview = useDecideReview();

  const isInReview = task.status === 'IN_REVIEW';
  const isDone = task.status === 'DONE';
  const isOwn = task.assigneeId === currentUserId || task.creatorId === currentUserId;
  const canRequest = !isDone && (canRequestRole || isOwn);
  const isAdmin = currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'ADMIN';
  const isReviewer = isInReview && task.reviewerId === currentUserId;
  const canDecide = isInReview && (isReviewer || isAdmin);

  // Section is hidden entirely when the task is DONE and not currently
  // under review, or when there's nothing the user can do AND no review
  // is active. Keeps the slide-over uncluttered for the "Done, dusted"
  // state.
  const shouldRender = isInReview || canRequest;
  if (!shouldRender) return null;

  if (isInReview) {
    return (
      <ActiveReviewPanel
        task={task}
        canDecide={canDecide}
        currentUserId={currentUserId}
        onApprove={(comment) => decideReview.mutateAsync({
          taskId: task.id,
          decision: 'APPROVE',
          comment,
        })}
        onRequestChanges={(comment) => decideReview.mutateAsync({
          taskId: task.id,
          decision: 'REQUEST_CHANGES',
          comment,
        })}
        pending={decideReview.isPending}
      />
    );
  }

  return (
    <RequestReviewPanel
      task={task}
      members={members}
      currentUserId={currentUserId}
      onSubmit={(reviewerId, note) => requestReview.mutateAsync({
        taskId: task.id,
        reviewerId,
        note,
      })}
      pending={requestReview.isPending}
    />
  );
}

/* ─── Idle state: "Request a review" ───────────────────────────── */

function RequestReviewPanel({
  task, members, currentUserId, onSubmit, pending,
}: {
  task: any;
  members: ReviewSectionProps['members'];
  currentUserId: string | null;
  onSubmit: (reviewerId: string, note?: string) => Promise<any>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Eligible reviewers — every project member except the current user
  // and any deactivated accounts (`isActive` is filtered server-side in
  // listProjectMembers, but we guard anyway). Sorted by name.
  const eligible = useMemo(() => {
    return (members ?? [])
      .filter((m) => m.userId !== currentUserId)
      .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? ''));
  }, [members, currentUserId]);

  const submit = async () => {
    if (!reviewerId) return;
    setError(null);
    try {
      await onSubmit(reviewerId, note.trim() || undefined);
      setOpen(false);
      setReviewerId('');
      setNote('');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not request review. Try again?');
    }
  };

  if (!open) {
    return (
      <div className={cn(
        'rounded-xl border border-dashed p-4 flex items-center justify-between gap-3',
        'border-gray-200 dark:border-obsidian-border',
        'bg-gray-50/40 dark:bg-obsidian-sunken/30',
      )}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
            <Eye size={14} className="text-amber-700 dark:text-amber-300" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">Ready for a second pair of eyes?</p>
            <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted leading-snug">
              Tag a reviewer (including the client) without changing the assignee.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-500/20 dark:hover:bg-amber-500/30 dark:text-amber-200 transition-colors shrink-0"
        >
          <Send size={12} /> Request review
        </button>
      </div>
    );
  }

  return (
    <div className={cn(
      'rounded-xl border p-4 space-y-3',
      'border-amber-200 dark:border-amber-500/30',
      'bg-amber-50/40 dark:bg-amber-500/[0.06]',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-amber-700 dark:text-amber-300" />
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-900 dark:text-amber-200">
            Request review
          </h3>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-amber-900 dark:text-amber-200 mb-1">
          Reviewer
        </label>
        <select
          value={reviewerId}
          onChange={(e) => setReviewerId(e.target.value)}
          className={cn(
            'block w-full rounded-md px-3 py-2 text-[13px] transition-colors',
            'bg-white dark:bg-obsidian-bg',
            'border border-amber-200 dark:border-amber-500/30',
            'text-gray-900 dark:text-obsidian-fg',
            'focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400',
          )}
        >
          <option value="">Pick someone…</option>
          {eligible.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user?.name}
              {m.user?.role && ` — ${ROLE_LABELS[m.user.role as keyof typeof ROLE_LABELS] ?? m.user.role}`}
            </option>
          ))}
        </select>
        {eligible.length === 0 && (
          <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300/80">
            No eligible reviewers on this project yet.
          </p>
        )}
      </div>

      <div>
        <label className="block text-[11px] font-medium text-amber-900 dark:text-amber-200 mb-1">
          Note <span className="font-normal opacity-70">(optional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={5000}
          rows={2}
          placeholder="What should the reviewer focus on?"
          className={cn(
            'block w-full rounded-md px-3 py-2 text-[13px] transition-colors resize-y',
            'bg-white dark:bg-obsidian-bg',
            'border border-amber-200 dark:border-amber-500/30',
            'text-gray-900 dark:text-obsidian-fg',
            'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
            'focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400',
          )}
        />
      </div>

      {error && (
        <p className="text-[11.5px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="px-3 py-1.5 rounded-md text-[12px] font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!reviewerId || pending}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
            !reviewerId || pending
              ? 'bg-amber-200/60 text-amber-700/60 cursor-not-allowed dark:bg-amber-500/20 dark:text-amber-300/60'
              : 'bg-amber-600 hover:bg-amber-700 text-white shadow-soft',
          )}
        >
          <Send size={12} /> {pending ? 'Sending…' : 'Send for review'}
        </button>
      </div>
    </div>
  );
}

/* ─── Active review state: "Waiting on X" / "You're the reviewer" ──── */

function ActiveReviewPanel({
  task, canDecide, currentUserId, onApprove, onRequestChanges, pending,
}: {
  task: any;
  canDecide: boolean;
  currentUserId: string | null;
  onApprove: (comment?: string) => Promise<any>;
  onRequestChanges: (comment: string) => Promise<any>;
  pending: boolean;
}) {
  const [mode, setMode] = useState<'idle' | 'approve' | 'changes'>('idle');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reviewerName = task.reviewer?.name ?? 'someone';
  const reviewerIsClient = task.reviewer?.role === 'CLIENT';
  const requesterName = task.reviewRequester?.name ?? null;
  const requestedAtRel = task.reviewRequestedAt ? formatRelative(task.reviewRequestedAt) : null;
  const youAreReviewer = task.reviewerId === currentUserId;

  const headerText = youAreReviewer
    ? `You're reviewing this`
    : `Awaiting review from ${reviewerName}${reviewerIsClient ? ' (client)' : ''}`;

  const submit = async () => {
    setError(null);
    const trimmed = comment.trim();
    try {
      if (mode === 'changes') {
        if (trimmed.length === 0) {
          setError('Leave a note explaining what needs to change.');
          return;
        }
        await onRequestChanges(trimmed);
      } else {
        await onApprove(trimmed || undefined);
      }
      // Server clears reviewer fields + moves status; the cache invalidation
      // refetches the task, which causes the parent to re-render and this
      // panel to either disappear or transition to the idle state.
      setMode('idle');
      setComment('');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not submit. Try again?');
    }
  };

  return (
    <div className={cn(
      'rounded-xl border p-4 space-y-3',
      youAreReviewer
        ? 'border-amber-300 dark:border-amber-500/40 bg-amber-50/50 dark:bg-amber-500/[0.08]'
        : 'border-amber-200 dark:border-amber-500/30 bg-amber-50/30 dark:bg-amber-500/[0.04]',
    )}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-200/70 dark:bg-amber-500/25 flex items-center justify-center shrink-0">
          <Eye size={14} className="text-amber-800 dark:text-amber-200" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-amber-900 dark:text-amber-100">
            {headerText}
          </p>
          <p className="text-[11.5px] text-amber-800/90 dark:text-amber-200/80 mt-0.5">
            {requesterName && `Requested by ${requesterName}`}
            {requesterName && requestedAtRel && ' · '}
            {requestedAtRel && requestedAtRel}
          </p>
        </div>
      </div>

      {canDecide && mode === 'idle' && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setMode('approve')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-emerald-600 hover:bg-emerald-700 text-white shadow-soft transition-colors"
          >
            <ThumbsUp size={12} /> Approve
          </button>
          <button
            type="button"
            onClick={() => setMode('changes')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors"
          >
            Request changes
          </button>
        </div>
      )}

      {canDecide && mode !== 'idle' && (
        <div className="space-y-2 pt-1">
          <label className="block text-[11px] font-medium text-amber-900 dark:text-amber-200">
            {mode === 'changes' ? 'What needs to change?' : 'Add a note (optional)'}
          </label>
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder={mode === 'changes' ? 'Required — describe what to revise.' : 'e.g. "Looks great, shipped"'}
            className={cn(
              'block w-full rounded-md px-3 py-2 text-[13px] transition-colors resize-y',
              'bg-white dark:bg-obsidian-bg',
              'border border-amber-200 dark:border-amber-500/30',
              'text-gray-900 dark:text-obsidian-fg',
              'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
              'focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400',
            )}
          />
          {error && (
            <p className="text-[11.5px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setMode('idle'); setComment(''); setError(null); }}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-500/15 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors',
                pending
                  ? 'bg-amber-200/60 text-amber-700/60 cursor-not-allowed dark:bg-amber-500/20 dark:text-amber-300/60'
                  : mode === 'approve'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-soft'
                    : 'bg-amber-600 hover:bg-amber-700 text-white shadow-soft',
              )}
            >
              {mode === 'approve' ? <Check size={12} /> : <Send size={12} />}
              {pending ? 'Saving…' : mode === 'approve' ? 'Confirm approve' : 'Send back'}
            </button>
          </div>
        </div>
      )}

      {!canDecide && (
        <p className="text-[11.5px] text-amber-800/80 dark:text-amber-200/70 leading-snug">
          The reviewer can Approve (moves it to Done) or Request changes
          (sends it back to In Progress with a note).
        </p>
      )}
    </div>
  );
}
