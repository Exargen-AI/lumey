import { useState } from 'react';
import { Plane, Plus, X, Loader2, AlertCircle, CheckCircle2, Clock, Ban, ThumbsDown } from 'lucide-react';
import { Button, Modal, Field, Input, Select, Badge, useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMyLeaves, useApplyLeave, useCancelLeave } from '@/hooks/useLeaves';
import type { LeaveRequest, LeaveStatus, LeaveType } from '@/api/leaves';

/**
 * Self-service leave page — every authenticated user has one.
 *
 * Top half: "Apply for leave" CTA + a quick history.
 * Bottom half: list of own requests, grouped Pending → Approved → Past.
 *
 * Approval is by SUPER_ADMIN only (Pankaj). The applicant cannot edit a
 * pending request — they cancel and re-apply, which keeps the audit
 * trail honest about what was approved vs. what was withdrawn.
 */

const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  CASUAL: 'Casual',
  SICK: 'Sick',
  EARNED: 'Earned',
  UNPAID: 'Unpaid',
  BEREAVEMENT: 'Bereavement',
  OTHER: 'Other',
};

const LEAVE_TYPE_OPTIONS: LeaveType[] = ['CASUAL', 'SICK', 'EARNED', 'UNPAID', 'BEREAVEMENT', 'OTHER'];

const STATUS_TONE: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

const STATUS_ICON: Record<LeaveStatus, React.ReactNode> = {
  PENDING: <Clock size={11} />,
  APPROVED: <CheckCircle2 size={11} />,
  REJECTED: <ThumbsDown size={11} />,
  CANCELLED: <Ban size={11} />,
};

/**
 * `embedded` mode is used when this page is rendered as a tab inside the
 * combined "My Time" page — the parent already shows the icon + title +
 * subtitle, so we suppress them here. The "Apply for Leave" CTA still
 * renders in embedded mode but right-aligned at the top of the tab body
 * so it stays one click away.
 */
export function LeavesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [showApply, setShowApply] = useState(false);
  const { data: leaves, isLoading } = useMyLeaves();

  const pending = leaves?.filter((l) => l.status === 'PENDING') ?? [];
  const approved = leaves?.filter((l) => l.status === 'APPROVED') ?? [];
  const past = leaves?.filter((l) => l.status === 'REJECTED' || l.status === 'CANCELLED') ?? [];

  return (
    <div className="space-y-7">
      {/* ─── Header ─── (suppressed in embedded mode — parent owns it) */}
      {!embedded ? (
        <div className="flex items-end justify-between gap-4 animate-fade-in-down">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
              <Plane size={18} className="text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Leave</h1>
              <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-0.5">
                Apply for leave and track your requests. Approvals come from the founder.
              </p>
            </div>
          </div>
          <Button variant="primary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setShowApply(true)}>
            Apply for Leave
          </Button>
        </div>
      ) : (
        // Embedded: just the action button, right-aligned, no title.
        <div className="flex justify-end">
          <Button variant="primary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setShowApply(true)}>
            Apply for Leave
          </Button>
        </div>
      )}

      {/* ─── Loading ─── */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-gray-400 dark:text-obsidian-faded text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading your leave history…
        </div>
      )}

      {/* ─── Empty ─── */}
      {!isLoading && leaves && leaves.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-obsidian-border py-16 text-center bg-white/40 dark:bg-obsidian-panel/40">
          <Plane size={36} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
          <p className="text-sm text-gray-500 dark:text-obsidian-muted">No leave requests yet.</p>
          <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">
            Click "Apply for Leave" to file your first request.
          </p>
        </div>
      )}

      {/* ─── Lists ─── */}
      {!isLoading && leaves && leaves.length > 0 && (
        <div className="space-y-6">
          {pending.length > 0 && <LeaveSection title="Pending" requests={pending} canCancel />}
          {approved.length > 0 && <LeaveSection title="Approved & upcoming" requests={approved} canCancel />}
          {past.length > 0 && <LeaveSection title="Past" requests={past} />}
        </div>
      )}

      {showApply && <ApplyLeaveModal onClose={() => setShowApply(false)} />}
    </div>
  );
}

function LeaveSection({ title, requests, canCancel }: { title: string; requests: LeaveRequest[]; canCancel?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted">{title}</h2>
        <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-gray-100 text-gray-700 dark:bg-obsidian-raised dark:text-obsidian-muted">
          {requests.length}
        </span>
      </div>
      <div className="rounded-2xl overflow-hidden divide-y bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border divide-gray-100 dark:divide-obsidian-border/60 shadow-soft dark:shadow-soft-dark">
        {requests.map((r) => (
          <LeaveRow key={r.id} leave={r} canCancel={canCancel} />
        ))}
      </div>
    </div>
  );
}

function LeaveRow({ leave, canCancel }: { leave: LeaveRequest; canCancel?: boolean }) {
  const cancel = useCancelLeave();
  const confirm = useConfirm();
  // Inline error surfaces under the row instead of native `alert()`
  // (QA L-L5). 4-second auto-dismiss matches the project's toast cadence.
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Cancel this leave request?',
      body: leave.status === 'APPROVED'
        ? 'This was already approved. Cancelling will free up the days and notify the founder.'
        : 'You can re-apply later if plans change.',
      tone: 'warning',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setCancelError(null);
    try { await cancel.mutateAsync(leave.id); } catch (err: any) {
      const msg = err?.response?.data?.error?.message || 'Failed to cancel';
      setCancelError(msg);
      window.setTimeout(() => setCancelError(null), 4000);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gray-50/60 dark:hover:bg-obsidian-raised/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">
            {formatRange(leave.startDate, leave.endDate)}
          </span>
          <span className="text-xs text-gray-500 dark:text-obsidian-muted">
            ({leave.totalDays} {leave.totalDays === 1 ? 'day' : 'days'})
          </span>
          <Badge tone="neutral">{LEAVE_TYPE_LABELS[leave.leaveType]}</Badge>
          <Badge tone={STATUS_TONE[leave.status]} dot>
            <span className="inline-flex items-center gap-1">{STATUS_ICON[leave.status]}{leave.status}</span>
          </Badge>
        </div>
        {leave.reason && (
          <p className="mt-1 text-xs text-gray-500 dark:text-obsidian-muted line-clamp-2">{leave.reason}</p>
        )}
        {leave.decisionNote && (
          <p className="mt-1 text-xs text-gray-600 dark:text-obsidian-fg">
            <span className="font-medium">{leave.status === 'APPROVED' ? 'Approver: ' : 'Reason: '}</span>
            {leave.decisionNote}
            {leave.decidedBy && <span className="text-gray-400 dark:text-obsidian-faded"> — {leave.decidedBy.name}</span>}
          </p>
        )}
        {cancelError && (
          <div className="mt-1.5 inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-[11px] bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300">
            <AlertCircle size={11} className="mt-0.5 shrink-0" /> {cancelError}
          </div>
        )}
      </div>
      {canCancel && (
        <Button variant="ghost" size="sm" leadingIcon={<X size={13} />} onClick={handleCancel} disabled={cancel.isPending}>
          {cancel.isPending ? 'Cancelling…' : 'Cancel'}
        </Button>
      )}
    </div>
  );
}

/**
 * Local-date helper. `new Date().toISOString().slice(0,10)` returns the
 * UTC date which, for users east of UTC opening the form before ~05:30
 * IST, prefills YESTERDAY (QA L-H3). Build the YYYY-MM-DD from local
 * components instead.
 */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ApplyLeaveModal({ onClose }: { onClose: () => void }) {
  const apply = useApplyLeave();
  const today = todayLocal();
  const [form, setForm] = useState({
    startDate: today,
    endDate: today,
    leaveType: 'CASUAL' as LeaveType,
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  const totalDays = (() => {
    const s = new Date(form.startDate);
    const e = new Date(form.endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    const ms = e.getTime() - s.getTime();
    if (ms < 0) return 0;
    return Math.round(ms / 86_400_000) + 1;
  })();

  const handleSubmit = async () => {
    setError(null);
    if (!form.startDate || !form.endDate) { setError('Pick both start and end dates.'); return; }
    if (totalDays === 0) { setError('End date is before the start date.'); return; }
    try {
      await apply.mutateAsync({
        startDate: form.startDate,
        endDate: form.endDate,
        leaveType: form.leaveType,
        reason: form.reason.trim() || null,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Failed to apply for leave');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply for leave"
      subtitle="The founder will review and approve."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={apply.isPending} onClick={handleSubmit}>
            {apply.isPending ? 'Submitting…' : 'Submit request'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {/* No `min` constraint — past dates allowed for retroactive
              sick leave (QA L-H4: "I was sick yesterday" is the norm,
              not the exception). The endDate min stays tied to
              startDate so the range is always coherent. */}
          <Field label="Start date" required>
            <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </Field>
          <Field label="End date" required>
            <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </Field>
        </div>
        {/* Hint when the user picks a past start date so retro applications
            feel intentional, not accidental. */}
        {form.startDate < today && (
          <div className="text-[11.5px] text-amber-700 dark:text-amber-400 -mt-2 px-1">
            You're applying for leave that's already started. The founder will see this is a retroactive request.
          </div>
        )}
        <Field label="Type" required>
          <Select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value as LeaveType })}>
            {LEAVE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</option>)}
          </Select>
        </Field>
        <Field label="Reason" hint="Optional — context the founder might want when approving">
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            rows={3}
            maxLength={2000}
            placeholder="e.g. Family wedding in Hyderabad."
            className="w-full border border-gray-300 dark:border-obsidian-border dark:bg-obsidian-bg rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
        </Field>
        <div className={cn(
          'rounded-md px-3 py-2 text-xs',
          totalDays > 0
            ? 'bg-brand-50 dark:bg-brand-500/[0.08] text-brand-700 dark:text-brand-300'
            : 'bg-gray-50 dark:bg-obsidian-raised text-gray-500 dark:text-obsidian-muted',
        )}>
          {totalDays > 0
            ? `Requesting ${totalDays} ${totalDays === 1 ? 'calendar day' : 'calendar days'} (${form.startDate} → ${form.endDate})`
            : 'Pick valid dates to see the day count.'}
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-rose-50 border border-rose-200 text-rose-700 dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

function formatRange(start: string, end: string): string {
  // Parse YYYY-MM-DD as LOCAL time, not UTC. `new Date('2026-05-06')`
  // (with no `T` / `Z`) is parsed as UTC midnight by spec; for users east
  // of UTC `toLocaleDateString` then renders the previous day. QA L-M1.
  // Construct from year/month/day components to keep us in local time.
  const parseLocal = (iso: string): Date => {
    const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return new Date(iso);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  const s = parseLocal(start);
  const e = parseLocal(end);
  const sameDay = s.toDateString() === e.toDateString();
  const thisYear = new Date().getFullYear();
  const crossesYears = s.getFullYear() !== e.getFullYear();
  // QA L-M2: when start and end land in different years, ALWAYS show
  // both years (otherwise "Dec 30 – Jan 2, 2027" hides that the start
  // is 2026). When same year and it's the current year, omit. When
  // same year but past/future, show.
  const fmtWith = (d: Date, includeYear: boolean) => d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: includeYear ? 'numeric' : undefined,
  });
  if (sameDay) return fmtWith(s, s.getFullYear() !== thisYear);
  if (crossesYears) return `${fmtWith(s, true)} – ${fmtWith(e, true)}`;
  const includeYear = s.getFullYear() !== thisYear;
  return `${fmtWith(s, false)} – ${fmtWith(e, includeYear)}`;
}
