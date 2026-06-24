import { useState } from 'react';
import { ClipboardCheck, Loader2, CheckCircle2, X, MessageSquare, RefreshCw } from 'lucide-react';
import { Button, Modal, Field, Badge, Tooltip, useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAllLeaves, useApproveLeave, useRejectLeave, useLeaveCounts, useRevokeApprovedLeave } from '@/hooks/useLeaves';
import type { LeaveRequest, LeaveStatus, LeaveType } from '@/api/leaves';

/**
 * Founder-only leave approvals queue.
 *
 * Tab order: Pending (work to do) → Approved → Rejected → Cancelled →
 * All. Pending count is the badge on the sidebar.
 *
 * Approve = one click + optional note.
 * Reject  = requires a note (the applicant deserves an explanation).
 *
 * Both decisions are final via this UI; the applicant can still
 * `cancel` an approved leave themselves if plans change.
 */

type Tab = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ALL';

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  CASUAL: 'Casual',
  SICK: 'Sick',
  EARNED: 'Earned',
  UNPAID: 'Unpaid',
  BEREAVEMENT: 'Bereavement',
  OTHER: 'Other',
};

const STATUS_TONE: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/**
 * `embedded` mode hides the page-level header so this component can be
 * rendered as a sub-tab inside the combined Approvals page. The status
 * tabs and refresh button stay since they're functional.
 */
export function LeaveApprovalsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('PENDING');
  const { data: leaves, isLoading, isFetching, refetch } = useAllLeaves(tab === 'ALL' ? undefined : tab);
  // QA L-H1: real counts per status so non-active tabs display their
  // badges. Pankaj sees "Pending (3)" while sitting on the Approved tab.
  const { data: countsData } = useLeaveCounts(true);
  // QA L-H2: revoke an APPROVED leave (e.g. founder changes mind because
  // a deliverable shifted). Distinct from applicant cancel — preserves
  // the audit trail and notifies the applicant.
  const [decideTarget, setDecideTarget] = useState<{ leave: LeaveRequest; mode: 'approve' | 'reject' | 'revoke' } | null>(null);

  const counts: Record<Tab, number> = {
    PENDING: countsData?.PENDING ?? 0,
    APPROVED: countsData?.APPROVED ?? 0,
    REJECTED: countsData?.REJECTED ?? 0,
    CANCELLED: countsData?.CANCELLED ?? 0,
    ALL: countsData?.ALL ?? 0,
  };

  return (
    <div className="space-y-6">
      {!embedded ? (
        <div className="flex items-end justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
              <ClipboardCheck size={18} className="text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Leave approvals</h1>
              <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-0.5">Founder-only — your decisions are final.</p>
            </div>
          </div>
          {/* Manual refresh as a fallback for the 30s poll. Useful when the
              founder is actively waiting on a leave to come in and doesn't
              want to wait for the next tick. */}
          <Tooltip content="Refresh now" side="top">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-2 rounded-md border border-gray-200 dark:border-obsidian-border hover:bg-gray-50 dark:hover:bg-obsidian-raised text-gray-500 dark:text-obsidian-muted disabled:opacity-50 transition-colors"
              aria-label="Refresh leaves"
            >
              <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} />
            </button>
          </Tooltip>
        </div>
      ) : (
        <div className="flex justify-end">
          <Tooltip content="Refresh now" side="top">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-2 rounded-md border border-gray-200 dark:border-obsidian-border hover:bg-gray-50 dark:hover:bg-obsidian-raised text-gray-500 dark:text-obsidian-muted disabled:opacity-50 transition-colors"
              aria-label="Refresh leaves"
            >
              <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} />
            </button>
          </Tooltip>
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-obsidian-raised w-fit">
        {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ALL'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
              tab === t
                ? 'bg-white dark:bg-obsidian-bg text-gray-900 dark:text-obsidian-fg shadow-sm'
                : 'text-gray-500 dark:text-obsidian-muted hover:text-gray-700 dark:hover:text-obsidian-fg',
            )}
          >
            {t.charAt(0) + t.slice(1).toLowerCase()}
            {counts[t] > 0 && (
              <span className={cn(
                'ml-1.5 text-[10px] font-bold rounded-full px-1.5 py-0.5',
                tab === t
                  ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'bg-gray-200 text-gray-600 dark:bg-obsidian-bg dark:text-obsidian-muted',
              )}>
                {counts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 dark:text-obsidian-faded text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading…
        </div>
      ) : leaves && leaves.length > 0 ? (
        <div className="rounded-2xl overflow-hidden divide-y bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border divide-gray-100 dark:divide-obsidian-border/60 shadow-soft dark:shadow-soft-dark">
          {leaves.map((leave) => (
            <ApproverRow
              key={leave.id}
              leave={leave}
              onDecide={(mode) => setDecideTarget({ leave, mode })}
            />
          ))}
        </div>
      ) : (
        // Tab-aware copy so "no requests" reads as either good news (Pending
        // queue clear) or "expected, no history yet" rather than the same
        // generic phrase regardless of context.
        <LeaveEmptyState tab={tab} />
      )}

      {decideTarget && (
        <DecideModal
          leave={decideTarget.leave}
          mode={decideTarget.mode}
          onClose={() => setDecideTarget(null)}
        />
      )}
    </div>
  );
}

function ApproverRow({ leave, onDecide }: { leave: LeaveRequest; onDecide: (mode: 'approve' | 'reject' | 'revoke') => void }) {
  return (
    <div className="grid grid-cols-12 gap-4 items-center px-5 py-4 hover:bg-gray-50/60 dark:hover:bg-obsidian-raised/40 transition-colors">
      {/* Applicant + dates */}
      <div className="col-span-5 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
            {leave.applicant?.name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-obsidian-fg truncate">{leave.applicant?.name ?? '—'}</div>
            <div className="text-xs text-gray-500 dark:text-obsidian-muted">{formatRange(leave.startDate, leave.endDate)} · {leave.totalDays}d</div>
          </div>
        </div>
        {leave.reason && (
          <p className="mt-2 text-xs text-gray-500 dark:text-obsidian-muted line-clamp-2 italic">"{leave.reason}"</p>
        )}
      </div>

      {/* Type + status */}
      <div className="col-span-3 flex flex-col gap-1.5">
        <Badge tone="neutral">{LEAVE_TYPE_LABELS[leave.leaveType]}</Badge>
        <Badge tone={STATUS_TONE[leave.status]} dot>{leave.status}</Badge>
      </div>

      {/* Decision context (if any) */}
      <div className="col-span-2 text-xs text-gray-500 dark:text-obsidian-muted">
        {leave.decidedAt && leave.decidedBy && (
          <>
            <div className="font-medium text-gray-700 dark:text-obsidian-fg">{leave.decidedBy.name}</div>
            <div>{formatDateOnly(leave.decidedAt)}</div>
          </>
        )}
        {leave.cancelledAt && !leave.decidedAt && (
          <div className="italic">Cancelled by applicant</div>
        )}
      </div>

      {/* Actions */}
      <div className="col-span-2 flex items-center gap-1.5 justify-end">
        {leave.status === 'PENDING' ? (
          <>
            <Button variant="ghost" size="sm" leadingIcon={<X size={13} />} onClick={() => onDecide('reject')}>
              Reject
            </Button>
            <Button variant="primary" size="sm" leadingIcon={<CheckCircle2 size={13} />} onClick={() => onDecide('approve')}>
              Approve
            </Button>
          </>
        ) : leave.status === 'APPROVED' ? (
          <>
            {leave.decisionNote && (
              <span className="text-xs text-gray-500 dark:text-obsidian-muted inline-flex items-center gap-1" title={leave.decisionNote}>
                <MessageSquare size={11} /> Note
              </span>
            )}
            <Button variant="ghost" size="sm" leadingIcon={<X size={13} />} onClick={() => onDecide('revoke')} title="Revoke this approved leave (notifies the applicant)">
              Revoke
            </Button>
          </>
        ) : leave.decisionNote ? (
          <span className="text-xs text-gray-500 dark:text-obsidian-muted inline-flex items-center gap-1" title={leave.decisionNote}>
            <MessageSquare size={11} /> Note
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DecideModal({ leave, mode, onClose }: { leave: LeaveRequest; mode: 'approve' | 'reject' | 'revoke'; onClose: () => void }) {
  const approve = useApproveLeave();
  const reject = useRejectLeave();
  const revoke = useRevokeApprovedLeave();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isReject = mode === 'reject';
  const isRevoke = mode === 'revoke';
  const requiresNote = isReject || isRevoke;
  const isPending = approve.isPending || reject.isPending || revoke.isPending;

  const submit = async () => {
    setError(null);
    if (requiresNote && !note.trim()) {
      setError(isRevoke
        ? 'Revocation requires a note — the applicant deserves to know why their approved leave was undone.'
        : 'A short note explains the decision to the applicant.');
      return;
    }
    try {
      if (isReject) {
        await reject.mutateAsync({ id: leave.id, decisionNote: note.trim() || undefined });
      } else if (isRevoke) {
        await revoke.mutateAsync({ id: leave.id, decisionNote: note.trim() });
      } else {
        await approve.mutateAsync({ id: leave.id, decisionNote: note.trim() || undefined });
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || `Failed to ${mode}`);
    }
  };

  const title = isReject ? 'Reject leave request?'
    : isRevoke ? 'Revoke approved leave?'
    : 'Approve leave request?';
  const ctaLabel = isReject ? 'Reject' : isRevoke ? 'Revoke approval' : 'Approve';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      subtitle={`${leave.applicant?.name ?? 'Applicant'} · ${formatRange(leave.startDate, leave.endDate)} · ${leave.totalDays}d ${LEAVE_TYPE_LABELS[leave.leaveType]}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant={isReject || isRevoke ? 'danger' : 'primary'}
            size="sm"
            loading={isPending}
            onClick={submit}
          >
            {isPending ? 'Saving…' : ctaLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {leave.reason && (
          <div className="rounded-md bg-gray-50 dark:bg-obsidian-raised/40 border border-gray-200 dark:border-obsidian-border px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted mb-1">Applicant's reason</div>
            <p className="text-sm text-gray-800 dark:text-obsidian-fg whitespace-pre-wrap">{leave.reason}</p>
          </div>
        )}
        {isRevoke && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-500/[0.08] border border-amber-200 dark:border-amber-500/30 px-3 py-2.5">
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <strong>This was already approved.</strong> Revoking will mark it as REJECTED and notify {leave.applicant?.name ?? 'the applicant'} so they can plan around the change. The original approval audit row stays intact.
            </p>
          </div>
        )}
        <Field
          label={isReject ? 'Reason for rejection' : isRevoke ? 'Reason for revoking' : 'Note (optional)'}
          required={requiresNote}
          hint={isReject ? 'Tell the applicant what to fix or do next.'
            : isRevoke ? 'Explain what changed since you approved it.'
            : undefined}
        >
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={isReject ? 'e.g. Conflicts with deliverable due that week — please re-apply for the following week.'
              : isRevoke ? 'e.g. Critical bug fix needed during your leave; let\'s discuss new dates.'
              : 'Optional context the applicant will see.'}
            className="w-full border border-gray-300 dark:border-obsidian-border dark:bg-obsidian-bg rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
            autoFocus
          />
        </Field>
        {error && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function formatRange(start: string, end: string): string {
  // Parse YYYY-MM-DD as LOCAL time so users east of UTC don't see
  // yesterday's date (QA L-M1). For year-boundary leaves like
  // "Dec 30 → Jan 2", show both years (QA L-M2).
  const parseLocal = (iso: string): Date => {
    const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return new Date(iso);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const s = parseLocal(start);
  const e = parseLocal(end);
  const sameDay = s.toDateString() === e.toDateString();
  const crossesYears = s.getFullYear() !== e.getFullYear();
  const fmt = (d: Date, includeYear: boolean) => d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined,
  });
  if (sameDay) return fmt(s, false);
  if (crossesYears) return `${fmt(s, true)} – ${fmt(e, true)}`;
  return `${fmt(s, false)} – ${fmt(e, false)}`;
}
function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function LeaveEmptyState({ tab }: { tab: Tab }) {
  // Differentiated copy by tab — Pending = "all caught up", history tabs =
  // "nothing to look back on yet". Same shape as the timesheet equivalent
  // so the two approval pages feel consistent.
  const copy: Record<Tab, { title: string; body: string; tone: 'good' | 'neutral' }> = {
    PENDING: { title: 'All caught up', body: 'No leave requests are waiting on your decision.', tone: 'good' },
    APPROVED: { title: 'No approved leaves yet', body: 'Approved leaves are kept here for your records.', tone: 'neutral' },
    REJECTED: { title: 'No rejections', body: 'Leaves you reject (with a note) appear here.', tone: 'neutral' },
    CANCELLED: { title: 'No cancellations', body: 'Leaves the applicant withdrew show up here.', tone: 'neutral' },
    ALL: { title: 'No leave requests yet', body: 'Once your team applies for leave it will appear here.', tone: 'neutral' },
  };
  const c = copy[tab];
  return (
    <div className={cn(
      'rounded-2xl border-2 border-dashed py-16 text-center',
      'border-gray-200 dark:border-obsidian-border',
      'bg-white/40 dark:bg-obsidian-panel/40',
    )}>
      <ClipboardCheck size={36} strokeWidth={1.5} className={cn(
        'mx-auto mb-3',
        c.tone === 'good' ? 'text-emerald-400 dark:text-emerald-500/70' : 'text-gray-300 dark:text-obsidian-faded',
      )} />
      <p className="text-sm font-medium text-gray-700 dark:text-obsidian-fg">{c.title}</p>
      <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">{c.body}</p>
    </div>
  );
}
