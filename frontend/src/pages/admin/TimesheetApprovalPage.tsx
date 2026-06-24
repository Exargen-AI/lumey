import { useState } from 'react';
import { ClipboardCheck, Check, X, ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import {
  usePendingApprovals,
  useApproveTimesheet,
  useRejectTimesheet,
  useApprovalCounts,
} from '@/hooks/useTimesheet';
import type { ApprovalStatusFilter } from '@/api/timesheet';
import { Button, Tooltip, Badge, useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/formatters';

/**
 * Timesheet approvals — pending queue + history.
 *
 * Tabs (mirrors the leave-approvals page so admins don't have to learn two
 * different layouts):
 *   Pending   — submitted, awaiting decision. Approve/reject actions live here.
 *   Approved  — read-only history. Shows who approved and when.
 *   Rejected  — read-only history. Shows the rejection reason.
 *   All       — combined view, sorted by most-recent activity.
 *
 * Bug fix (defect #1): previously only the Pending list existed. The moment
 * an admin approved or rejected a row, it disappeared with nowhere to go;
 * the page rendered "All timesheets reviewed" and the audit trail was lost.
 * The 30-second poll on `usePendingApprovals` also means a freshly-submitted
 * timesheet shows up in the queue without a manual refresh.
 */

type Tab = ApprovalStatusFilter;
const TABS: Tab[] = ['SUBMITTED', 'APPROVED', 'REJECTED', 'ALL'];
const TAB_LABEL: Record<Tab, string> = {
  SUBMITTED: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  ALL: 'All',
};

/**
 * `embedded` mode hides the page-level header so this component can be
 * rendered as a sub-tab inside the combined Approvals page. The tab
 * controls (Pending / Approved / Rejected / All) and the manual refresh
 * button still render — they're functional, not decorative.
 */
export function TimesheetApprovalPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('SUBMITTED');
  const { data: rows, isLoading, isFetching, refetch } = usePendingApprovals(tab);
  const { data: counts } = useApprovalCounts(true);
  const approveMutation = useApproveTimesheet();
  const rejectMutation = useRejectTimesheet();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const confirm = useConfirm();
  const handleApprove = async (id: string) => {
    const ok = await confirm({
      title: 'Approve this timesheet?',
      body: 'The engineer will see this approval in their timesheet history.',
      confirmLabel: 'Approve',
    });
    if (ok) approveMutation.mutate(id);
  };

  const handleReject = (id: string) => {
    if (!rejectReason.trim()) return;
    rejectMutation.mutate({ id, reason: rejectReason.trim() }, {
      onSuccess: () => { setRejectingId(null); setRejectReason(''); },
    });
  };

  const tabCounts: Record<Tab, number> = {
    SUBMITTED: counts?.SUBMITTED ?? 0,
    APPROVED: counts?.APPROVED ?? 0,
    REJECTED: counts?.REJECTED ?? 0,
    ALL: counts?.ALL ?? 0,
  };

  return (
    <div className="space-y-6">
      {/* ─── Header ─── (suppressed when embedded; the parent Approvals
          page provides title + subtitle. Refresh button moves to the tab
          row in embedded mode so it stays accessible.) */}
      {!embedded ? (
        <div className="flex items-end justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
              <ClipboardCheck size={18} className="text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Timesheet Approvals</h1>
              <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
                Review pending timesheets and audit previously-actioned ones.
              </p>
            </div>
          </div>
          <Tooltip content="Refresh now" side="top">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-2 rounded-md border border-gray-200 dark:border-obsidian-border hover:bg-gray-50 dark:hover:bg-obsidian-raised text-gray-500 dark:text-obsidian-muted disabled:opacity-50 transition-colors"
              aria-label="Refresh approvals"
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
              aria-label="Refresh approvals"
            >
              <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* ─── Tabs ─── */}
      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-obsidian-raised w-fit">
        {TABS.map((t) => (
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
            {TAB_LABEL[t]}
            {tabCounts[t] > 0 && (
              <span className={cn(
                'ml-1.5 text-[10px] font-bold rounded-full px-1.5 py-0.5',
                tab === t
                  ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'bg-gray-200 text-gray-600 dark:bg-obsidian-bg dark:text-obsidian-muted',
              )}>
                {tabCounts[t]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── List ─── */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}
        </div>
      ) : !rows?.length ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="stagger-fade space-y-2">
          {rows.map((ts: any) => {
            const isExpanded = expandedId === ts.id;
            const isRejecting = rejectingId === ts.id;
            const weekEnd = new Date(ts.weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            const showActions = ts.status === 'SUBMITTED';

            return (
              <div
                key={ts.id}
                className={cn(
                  'rounded-2xl overflow-hidden transition-shadow',
                  'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
                  'shadow-soft dark:shadow-soft-dark',
                  isExpanded && 'shadow-lift dark:shadow-lift-dark border-brand-200 dark:border-brand-500/30',
                )}
              >
                {/* Summary row */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50/60 dark:hover:bg-obsidian-raised/40 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : ts.id)}
                >
                  {isExpanded
                    ? <ChevronDown size={16} className="text-brand-500 dark:text-brand-400 shrink-0" />
                    : <ChevronRight size={16} className="text-gray-400 dark:text-obsidian-faded shrink-0" />
                  }
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-[13px] font-semibold text-white shrink-0">
                    {ts.user?.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-medium text-gray-900 dark:text-obsidian-fg leading-tight truncate">{ts.user?.name}</p>
                      <StatusPill status={ts.status} />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5 leading-tight">
                      {formatDate(ts.weekStart)} – {formatDate(weekEnd.toISOString())}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-[16px] font-bold text-gray-900 dark:text-obsidian-fg tabular-nums">{ts.totalHours}h</p>
                      <p className="text-[10px] text-gray-400 dark:text-obsidian-faded">
                        {ts.status === 'SUBMITTED' && ts.submittedAt && `Submitted ${formatRelative(ts.submittedAt)}`}
                        {ts.status === 'APPROVED' && ts.approvedAt && `Approved ${formatRelative(ts.approvedAt)}`}
                        {ts.status === 'REJECTED' && ts.approvedAt && `Rejected ${formatRelative(ts.approvedAt)}`}
                      </p>
                    </div>
                    {showActions && (
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <Tooltip content="Approve" side="top">
                          <button
                            onClick={() => handleApprove(ts.id)}
                            disabled={approveMutation.isPending}
                            className="p-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 dark:text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                            aria-label="Approve"
                          >
                            <Check size={16} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Reject with reason" side="top">
                          <button
                            onClick={() => setRejectingId(isRejecting ? null : ts.id)}
                            className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:hover:bg-rose-500/25 dark:text-rose-400 rounded-lg transition-colors"
                            aria-label="Reject"
                          >
                            <X size={16} />
                          </button>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                </div>

                {/* Reject reason input (only on Pending tab) */}
                {showActions && isRejecting && (
                  <div className="px-5 pb-4 flex gap-2 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection (the engineer will see this)…"
                      autoFocus
                      className={cn(
                        'flex-1 h-9 rounded-md px-3 text-[13px]',
                        'bg-white border border-rose-300 hover:border-rose-400',
                        'dark:bg-obsidian-raised dark:border-rose-500/40 dark:hover:border-rose-500/60',
                        'text-gray-900 dark:text-obsidian-fg placeholder:text-rose-300 dark:placeholder:text-rose-500/40',
                        'focus:outline-none focus:border-rose-500 dark:focus:border-rose-400',
                      )}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleReject(ts.id); }}
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      loading={rejectMutation.isPending}
                      disabled={!rejectReason.trim()}
                      onClick={() => handleReject(ts.id)}
                    >
                      Reject
                    </Button>
                  </div>
                )}

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-gray-100 dark:border-obsidian-border px-5 py-4 bg-gray-50/50 dark:bg-obsidian-sunken/40 animate-fade-in space-y-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">
                        Summary for {ts.user?.name}
                      </p>
                      <div className="flex items-center gap-2 text-[13px]">
                        <Clock size={14} className="text-gray-400 dark:text-obsidian-faded" />
                        <span className="text-gray-700 dark:text-obsidian-fg">{ts.totalHours} hours logged across the week</span>
                      </div>
                      <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-2">
                        Role: <span className="capitalize">{ts.user?.role?.toLowerCase().replace('_', ' ')}</span>
                      </p>
                    </div>

                    {/* Audit trail block — only on actioned rows. Without this,
                        the history view is just a list with no answer to "who
                        approved this and when." */}
                    {ts.status !== 'SUBMITTED' && (
                      <div className="border-t border-gray-200/60 dark:border-obsidian-border/60 pt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">
                          Decision
                        </p>
                        <div className="flex items-start gap-2 text-[13px]">
                          {ts.status === 'APPROVED'
                            ? <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                            : <XCircle size={14} className="text-rose-500 mt-0.5 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-700 dark:text-obsidian-fg">
                              {ts.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                              {ts.approver?.name && <> by <span className="font-medium">{ts.approver.name}</span></>}
                              {ts.approvedAt && <> · {formatDate(ts.approvedAt)}</>}
                            </p>
                            {ts.status === 'REJECTED' && ts.rejectionReason && (
                              <p className="text-[12px] text-rose-700 dark:text-rose-300 mt-1 break-words">
                                Reason: {ts.rejectionReason}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
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

// ─── Helpers ──────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const tone = status === 'SUBMITTED'
    ? 'warning'
    : status === 'APPROVED'
      ? 'success'
      : status === 'REJECTED'
        ? 'danger'
        : 'neutral';
  const label = status === 'SUBMITTED' ? 'Pending' : status.charAt(0) + status.slice(1).toLowerCase();
  return <Badge tone={tone as any}>{label}</Badge>;
}

function EmptyState({ tab }: { tab: Tab }) {
  // Empty state copy is tab-specific so admins can tell the difference
  // between "great, queue is clear" (Pending) vs "nothing yet" (history).
  const copy: Record<Tab, { title: string; body: string; tone: 'good' | 'neutral' }> = {
    SUBMITTED: { title: 'All caught up', body: 'No timesheets are waiting on your decision.', tone: 'good' },
    APPROVED: { title: 'No approvals yet', body: 'Approved timesheets will be archived here for audit.', tone: 'neutral' },
    REJECTED: { title: 'No rejections', body: 'Rejected timesheets show up here with the reason you gave.', tone: 'neutral' },
    ALL: { title: 'No timesheets yet', body: 'Once your team submits weekly timesheets they will appear here.', tone: 'neutral' },
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
