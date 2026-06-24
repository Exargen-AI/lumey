import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, FileDown, AlertTriangle, Bell, RefreshCw } from 'lucide-react';
import {
  useAdminCourses,
  useAdminEnrollments,
  useRunAnnualExpiry,
  useRecheckOpenEnrollments,
  useSendReminder,
} from '@/hooks/useAdminCompliance';
import { downloadEnrollmentReceipt } from '@/api/adminEnrollments';
import { formatDate, formatRelative } from '@/lib/formatters';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';

const STATUS_TONE: Record<string, string> = {
  in_progress: 'bg-indigo-100 text-indigo-700',
  completed: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  out_of_date: 'bg-amber-100 text-amber-700',
};
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  out_of_date: 'Out of date',
};

export function ComplianceEnrollmentsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [courseFilter, setCourseFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const coursesQ = useAdminCourses();
  const enrollmentsQ = useAdminEnrollments({
    courseId: courseFilter || undefined,
    status: statusFilter || undefined,
  });
  const sendReminder = useSendReminder();
  const runExpiry = useRunAnnualExpiry();
  const recheckOpen = useRecheckOpenEnrollments();
  const [reminderToast, setReminderToast] = useState<string | null>(null);
  const [expiryToast, setExpiryToast] = useState<string | null>(null);
  // Production-safety: the re-check sweep is irreversible (sets completedAt
  // on enrollment rows), so we gate it behind an explicit confirmation
  // modal rather than firing on a single button click. The modal explains
  // exactly what will happen — and what WON'T happen (no emails, no
  // re-prompts, no impact on already-completed users).
  const [recheckConfirmOpen, setRecheckConfirmOpen] = useState(false);
  // SUPER_ADMIN gets to download the partial-signed receipt even before the
  // employee finishes the quizzes (the PDF still contains every signature
  // the employee has made so far — IP, NDA, etc — with the full agreed text).
  // ADMIN keeps the original behavior: PDF only visible on completed rows.
  const isSuperAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN');

  const handleReminder = async (enrollmentId: string, name: string) => {
    try {
      await sendReminder.mutateAsync(enrollmentId);
      setReminderToast(`Reminder sent to ${name}.`);
    } catch (err) {
      setReminderToast(err instanceof Error ? err.message : 'Failed to send reminder');
    }
    setTimeout(() => setReminderToast(null), 4000);
  };

  const handleRunExpiry = async () => {
    try {
      const r = await runExpiry.mutateAsync();
      setExpiryToast(`Scanned ${r.scanned} stale completions, refreshed ${r.refreshed} users.`);
    } catch (err) {
      setExpiryToast(err instanceof Error ? err.message : 'Expiry run failed');
    }
    setTimeout(() => setExpiryToast(null), 5000);
  };

  // 2026-05-22 backfill: re-runs the completion-gate check on every
  // still-open enrollment. Catches historical rows stuck "in_progress"
  // before the quiz-submission completion fix landed. Flipped rows are
  // stamped with the real historical completion moment (max of latest
  // signature / latest passed quiz) — no email goes to the employee.
  const handleRecheckOpen = async () => {
    try {
      const r = await recheckOpen.mutateAsync();
      setExpiryToast(
        r.completed > 0
          ? `Scanned ${r.scanned} open enrollments — marked ${r.completed} as completed using their real historical timestamps. No employee was emailed.`
          : `Scanned ${r.scanned} open enrollments — none were ready to complete. Look at the "Gate progress" column to see what's missing per row.`,
      );
    } catch (err) {
      setExpiryToast(err instanceof Error ? err.message : 'Recheck failed');
    }
    setTimeout(() => setExpiryToast(null), 8000);
  };

  // Pre-flight summary for the confirm modal — count, by gate status, how
  // many rows would actually flip if the user proceeds. Lets us show
  // "8 will flip, 6 are missing a quiz" before any DB write happens.
  const allEnrollments = enrollmentsQ.data ?? [];
  const openEnrollments = allEnrollments.filter(
    (e) => !e.completedAt && !e.declinedAt,
  );
  const readyToFlip = openEnrollments.filter((e) => e.gate.gateMet);
  const stuckOnGap = openEnrollments.filter((e) => !e.gate.gateMet);

  const filtered = (enrollmentsQ.data ?? []).filter((e) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      e.user.name.toLowerCase().includes(s) ||
      e.user.email.toLowerCase().includes(s) ||
      e.course.title.toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Onboarding Status</h1>
          <p className="mt-1 text-sm text-gray-500">
            Per-employee compliance status across every published course.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setRecheckConfirmOpen(true)}
            disabled={recheckOpen.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 disabled:opacity-50"
            title="Re-run the completion gate on every still-open enrollment. Marks as complete any rows that were stuck 'in_progress' despite having satisfied all signatures + quizzes. Idempotent — opens a confirmation dialog with a preview."
          >
            <RefreshCw size={14} className={recheckOpen.isPending ? 'animate-spin' : undefined} />
            {recheckOpen.isPending ? 'Re-checking…' : 'Re-check open enrollments'}
          </button>
          <button
            type="button"
            onClick={handleRunExpiry}
            disabled={runExpiry.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            title="Find every completed enrollment whose validity window has elapsed and queue a fresh re-acknowledgment for those users. Idempotent."
          >
            <RefreshCw size={14} className={runExpiry.isPending ? 'animate-spin' : undefined} />
            {runExpiry.isPending ? 'Running…' : 'Run annual expiry'}
          </button>
        </div>
      </div>

      {(reminderToast || expiryToast) && (
        <div className="rounded-md border border-indigo-300 bg-indigo-50 dark:bg-indigo-950/20 px-3 py-2 text-xs text-indigo-800 dark:text-indigo-200">
          {reminderToast ?? expiryToast}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-900"
          />
        </div>
        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        >
          <option value="">All courses</option>
          {coursesQ.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} (v{c.version})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="out_of_date">Out of date (course bumped)</option>
          <option value="declined">Declined</option>
        </select>
      </div>

      {enrollmentsQ.isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 text-xs uppercase font-medium text-gray-500">
              <th className="text-left px-4 py-2">Employee</th>
              <th className="text-left px-4 py-2">Course</th>
              <th className="text-left px-4 py-2">Status</th>
              <th
                className="text-left px-4 py-2"
                title="Sigs = unique documents signed / required. Quiz = passed-quiz modules / required. 'ready' chip means the gate is already satisfied — this row will auto-flip on the next 'Re-check open enrollments'."
              >
                Gate progress
              </th>
              <th className="text-left px-4 py-2">Enrolled</th>
              <th className="text-left px-4 py-2">Completed</th>
              <th className="text-right px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0 text-sm hover:bg-gray-50 dark:hover:bg-gray-900/40">
                <td className="px-4 py-2">
                  <Link to={`/compliance/users/${e.user.id}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600">
                    {e.user.name}
                  </Link>
                  <p className="text-[11px] text-gray-500">
                    {e.user.email} · {e.user.role}
                  </p>
                </td>
                <td className="px-4 py-2">
                  <span className="text-gray-700 dark:text-gray-200">{e.course.title}</span>
                  <p className="text-[11px] text-gray-500">
                    v{e.courseVersion}
                    {e.courseVersion !== e.currentCourseVersion && (
                      <span className="ml-1 text-amber-600">(current is v{e.currentCourseVersion})</span>
                    )}
                  </p>
                </td>
                <td className="px-4 py-2">
                  <span className={cn('inline-block px-2 py-0.5 text-[11px] font-medium rounded-full', STATUS_TONE[e.status])}>
                    {STATUS_LABEL[e.status]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {/* Same gate diagnostic as the per-course panel — admin
                      can spot rows that are ready-to-flip vs. stuck on a
                      real gap (e.g. missing quiz attempt). */}
                  <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
                    <span
                      className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded',
                        e.gate.signaturesUnique === e.gate.requiredDocuments
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                      )}
                      title={`${e.gate.signaturesUnique} of ${e.gate.requiredDocuments} required documents signed`}
                    >
                      Sigs {e.gate.signaturesUnique}/{e.gate.requiredDocuments}
                    </span>
                    {e.gate.requiredQuizzes > 0 && (
                      <span
                        className={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded',
                          e.gate.quizzesPassed === e.gate.requiredQuizzes
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                        )}
                        title={`${e.gate.quizzesPassed} of ${e.gate.requiredQuizzes} required quizzes passed`}
                      >
                        Quiz {e.gate.quizzesPassed}/{e.gate.requiredQuizzes}
                      </span>
                    )}
                    {!e.completedAt && e.gate.gateMet && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
                        title="Completion gate already satisfied — click 'Re-check open enrollments' above to flip this row to Completed using the real historical timestamp."
                      >
                        ready
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-xs text-gray-500" title={formatDate(e.enrolledAt)}>
                  {formatRelative(e.enrolledAt)}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {e.completedAt ? (
                    <span title={formatDate(e.completedAt)}>{formatRelative(e.completedAt)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    {(e.status === 'in_progress' || e.status === 'out_of_date') && (
                      <button
                        type="button"
                        disabled={sendReminder.isPending}
                        onClick={() => handleReminder(e.id, e.user.name)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                        title="Send an in-app reminder. Throttled to once per 24 hours per user."
                      >
                        <Bell size={12} /> Remind
                      </button>
                    )}
                    {/* PDF download is SUPER_ADMIN ONLY — per Pankaj's policy.
                        The signed receipt PDF contains the full agreed text of
                        every signed document plus IP / user-agent / identity
                        ritual metadata. ADMIN users never see this button;
                        the backend route also rejects ADMIN with 403. The
                        SUPER_ADMIN can pull the receipt anytime there is at
                        least one signature on the row, including in-progress
                        rows (mid-flight access for IP/NDA artifacts). */}
                    {isSuperAdmin && e.counts.signatures > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadEnrollmentReceipt(
                            e.id,
                            `receipt-${e.user.name.replace(/\s+/g, '_')}-${e.course.slug}.pdf`,
                          )
                        }
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                        title={
                          e.completedAt
                            ? 'Download the signed compliance receipt PDF (includes NDA / IP-assignment text + signatures + audit metadata).'
                            : `In-progress receipt — includes the ${e.counts.signatures} signature(s) collected so far with the full agreed text. Quizzes may not yet be passed.`
                        }
                      >
                        <FileDown size={12} /> PDF
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !enrollmentsQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                  No enrollments match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-500 flex items-center gap-1">
        <AlertTriangle size={12} className="text-amber-500" />
        "Out of date" means the user completed an older course version. They will be re-prompted on next login.
      </p>

      {recheckConfirmOpen && (
        <RecheckConfirmModal
          readyCount={readyToFlip.length}
          stuckCount={stuckOnGap.length}
          readyPreview={readyToFlip.slice(0, 6).map((e) => ({
            name: e.user.name,
            role: e.user.role,
            course: e.course.title,
          }))}
          stuckPreview={stuckOnGap.slice(0, 6).map((e) => ({
            name: e.user.name,
            role: e.user.role,
            sigs: `${e.gate.signaturesUnique}/${e.gate.requiredDocuments}`,
            quiz: `${e.gate.quizzesPassed}/${e.gate.requiredQuizzes}`,
          }))}
          isPending={recheckOpen.isPending}
          onCancel={() => setRecheckConfirmOpen(false)}
          onConfirm={async () => {
            setRecheckConfirmOpen(false);
            await handleRecheckOpen();
          }}
        />
      )}
    </div>
  );
}

/**
 * Pre-flight confirmation for the "Re-check open enrollments" backfill. Before
 * this modal existed, the backfill was a one-click action — risky in
 * production, especially with clients in the enrollment list. The modal:
 *   - Shows EXACTLY how many rows will flip (gateMet === true).
 *   - Names a few employees so the admin can sanity-check.
 *   - Reassures explicitly: no emails, no re-prompts, idempotent.
 *   - Lists what stays untouched (already-completed rows, rows missing a
 *     real gate input).
 *   - States the historical-timestamp + renewal-clock behavior in plain
 *     language so the admin knows exactly what dates will get written.
 */
function RecheckConfirmModal({
  readyCount,
  stuckCount,
  readyPreview,
  stuckPreview,
  isPending,
  onCancel,
  onConfirm,
}: {
  readyCount: number;
  stuckCount: number;
  readyPreview: Array<{ name: string; role: string; course: string }>;
  stuckPreview: Array<{ name: string; role: string; sigs: string; quiz: string }>;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-start gap-3">
          <RefreshCw size={22} className="text-indigo-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Re-check open enrollments
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Based on the data already in the database, this will mark{' '}
              <strong className="text-gray-900 dark:text-gray-100">
                {readyCount} of {readyCount + stuckCount}
              </strong>{' '}
              in-progress enrollments as completed.
            </p>
          </div>
        </div>

        {readyCount > 0 && (
          <div className="mt-4 rounded-md border border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-3 text-xs text-green-900 dark:text-green-100">
            <p className="font-medium">Will be marked completed ({readyCount}):</p>
            <ul className="mt-1 space-y-0.5">
              {readyPreview.map((e, i) => (
                <li key={i}>
                  {e.name} <span className="text-green-700/70 dark:text-green-300/70">({e.role})</span> · {e.course}
                </li>
              ))}
              {readyCount > readyPreview.length && (
                <li className="text-green-700/70 dark:text-green-300/70">
                  …and {readyCount - readyPreview.length} more
                </li>
              )}
            </ul>
          </div>
        )}

        {stuckCount > 0 && (
          <div className="mt-3 rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/60 p-3 text-xs text-gray-700 dark:text-gray-300">
            <p className="font-medium">Will stay in-progress ({stuckCount} — missing real data):</p>
            <ul className="mt-1 space-y-0.5">
              {stuckPreview.map((e, i) => (
                <li key={i}>
                  {e.name} <span className="text-gray-500">({e.role})</span> · Sigs {e.sigs} · Quiz {e.quiz}
                </li>
              ))}
              {stuckCount > stuckPreview.length && (
                <li className="text-gray-500">…and {stuckCount - stuckPreview.length} more</li>
              )}
            </ul>
          </div>
        )}

        <div className="mt-4 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/20 p-3 text-xs text-indigo-900 dark:text-indigo-100 space-y-1">
          <p className="font-medium">What this does + what it does NOT do:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>
              <strong>completedAt</strong>: set to the real historical moment each employee
              finished (max of their latest signature / latest passed quiz).
              Their PDF and audit trail show authentic dates.
            </li>
            <li>
              <strong>Renewal clock</strong>: starts from <em>today</em>, not the historical
              date — so nobody gets auto-flipped to "needs re-acknowledgment" on their next login.
            </li>
            <li>
              <strong>No emails. No notifications. No reminders sent.</strong> Employees and
              clients are not bothered.
            </li>
            <li>
              <strong>Already-completed rows are untouched</strong>, and rows missing real data
              (Sigs/Quiz incomplete in the database) stay in-progress — they need attention
              separately.
            </li>
            <li>
              <strong>Idempotent</strong>: clicking this again later is safe; it'll be a no-op
              for rows already flipped.
            </li>
          </ul>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending || readyCount === 0}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            title={
              readyCount === 0
                ? 'Nothing to flip — every in-progress row is missing real data.'
                : `Mark ${readyCount} enrollment(s) as completed`
            }
          >
            {isPending
              ? 'Re-checking…'
              : readyCount === 0
                ? 'Nothing to do'
                : `Yes, mark ${readyCount} as completed`}
          </button>
        </div>
      </div>
    </div>
  );
}
