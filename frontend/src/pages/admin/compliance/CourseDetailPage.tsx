/* eslint-disable no-alert -- Phase 4 migration target: legacy
   `window.confirm` on course-version save should move to the useConfirm
   modal for consistency with the rest of the destructive prompts. */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Edit2, FileText, AlertTriangle, X, History, Clock, FileDown, ShieldCheck } from 'lucide-react';
import {
  useAdminCourse,
  useAdminEnrollments,
  useBumpCourseVersion,
  useCourseStats,
  useDocumentDiff,
  useForceExpireCourse,
  useUpdateCourseDocumentBody,
} from '@/hooks/useAdminCompliance';
import { DiffViewer } from '@/components/onboarding/DiffViewer';
import { downloadEnrollmentReceipt } from '@/api/adminEnrollments';
import { formatDate, formatRelative } from '@/lib/formatters';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';

export function ComplianceCourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const courseQ = useAdminCourse(id);
  const statsQ = useCourseStats(id);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [diffingDoc, setDiffingDoc] = useState<{ slug: string; currentVersion: number } | null>(null);
  const [bumpOpen, setBumpOpen] = useState(false);
  const [forceExpireOpen, setForceExpireOpen] = useState(false);

  if (courseQ.isLoading) return <p className="text-sm text-gray-400">Loading course…</p>;
  if (!courseQ.data) return <p className="text-sm text-gray-500">Course not found.</p>;

  const c = courseQ.data;
  const stats = statsQ.data;
  const editingDoc = c.documents.find((d) => d.id === editingDocId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/compliance/courses"
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{c.title}</h1>
          <p className="text-xs text-gray-500">
            v{c.version} · {c.slug} · {c.status}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBumpOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100"
          >
            Bump version & re-prompt
          </button>
          <button
            type="button"
            onClick={() => setForceExpireOpen(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-700 bg-red-50 hover:bg-red-100 inline-flex items-center gap-1.5"
            title="Expire all current completions for this course immediately. Use after a regulatory event or major policy change."
          >
            <Clock size={12} /> Force-expire all completions
          </button>
        </div>
      </div>

      {c.description && (
        <p className="text-sm text-gray-700 dark:text-gray-300 max-w-3xl">{c.description}</p>
      )}

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Total" value={stats.total} tone="default" />
          <StatCard label="Completed" value={stats.completed} tone="success" />
          <StatCard label="In progress" value={stats.inProgress} tone="info" />
          <StatCard label="Out of date" value={stats.outOfDate} tone="warning" />
          <StatCard label="Declined" value={stats.declined} tone="danger" />
        </div>
      )}

      {/* By-role breakdown */}
      {stats && stats.byRole.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">By role</h3>
          <div className="mt-3 space-y-2">
            {stats.byRole.map((r) => (
              <div key={r.role} className="grid grid-cols-[1fr_auto_140px] items-center gap-3 text-xs">
                <span className="font-medium text-gray-700 dark:text-gray-300">{r.role}</span>
                <span className="text-gray-500 tabular-nums">
                  {r.completed} / {r.total} ({r.completionPercent}%)
                </span>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${r.completionPercent}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-employee signature roster — surfaces who has signed THIS course
          and lets the admin download each individual's compliance receipt PDF
          (NDA + IP assignment + every other course doc, with full agreed-text
          snapshot + signature audit metadata). SUPER_ADMIN can pull the PDF
          even for in-progress employees who have signed but haven't passed
          the quiz yet; ADMIN sees the PDF only once the row is completed. */}
      <SignedByEmployeesPanel courseId={c.id} />

      {/* Documents */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Documents (signed by employees)</h2>
        <div className="space-y-2">
          {c.documents.map((d) => (
            <div
              key={d.id}
              className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-start justify-between gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-gray-400" />
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">{d.title}</h3>
                  <span className="text-[10px] text-gray-500 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
                    v{d.version}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{d.slug} · order {d.order}</p>
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 line-clamp-2 max-w-2xl">
                  {d.bodyText.slice(0, 240)}
                  {d.bodyText.length > 240 ? '…' : ''}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingDocId(d.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <Edit2 size={12} /> Edit text
                </button>
                {d.version > 1 && (
                  <button
                    type="button"
                    onClick={() => setDiffingDoc({ slug: d.slug, currentVersion: d.version })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <History size={12} /> View diff
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Modules</h2>
        <div className="space-y-2">
          {c.modules.map((m) => (
            <div
              key={m.id}
              className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">
                    Module {m.order} · {m.title}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    ~{m.estimatedMinutes ?? 5} min · {m.quiz?.questions.length ?? 0} quiz questions
                  </p>
                </div>
              </div>
              {m.quiz && (
                <ul className="mt-3 space-y-1 text-xs">
                  {m.quiz.questions.map((q, i) => (
                    <li key={q.id} className="text-gray-600 dark:text-gray-400">
                      <span className="font-medium text-gray-700 dark:text-gray-300">Q{i + 1}.</span>{' '}
                      {q.prompt}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-gray-500">
          Module content + quiz authoring is currently seed-driven. Edit{' '}
          <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
            backend/src/seed/onboardingCourse.seed.ts
          </code>{' '}
          and re-seed to change them, or extend this page in a future phase.
        </p>
      </section>

      <p className="text-[11px] text-gray-500">
        Created {formatDate(c.createdAt)} · Updated {formatDate(c.updatedAt)}
      </p>

      {editingDoc && (
        <EditDocumentModal
          courseId={c.id}
          documentId={editingDoc.id}
          documentTitle={editingDoc.title}
          documentVersion={editingDoc.version}
          initialBody={editingDoc.bodyText}
          onClose={() => setEditingDocId(null)}
        />
      )}

      {bumpOpen && (
        <BumpVersionModal courseId={c.id} currentVersion={c.version} onClose={() => setBumpOpen(false)} />
      )}

      {diffingDoc && (
        <DocumentDiffModal
          courseId={c.id}
          slug={diffingDoc.slug}
          currentVersion={diffingDoc.currentVersion}
          onClose={() => setDiffingDoc(null)}
        />
      )}

      {forceExpireOpen && (
        <ForceExpireModal
          courseId={c.id}
          courseTitle={c.title}
          onClose={() => setForceExpireOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Lists every enrollment for this course so the admin can see, per-employee:
 *   - status (in progress / completed / out of date / declined)
 *   - how many of the course's documents they've signed so far
 *   - when they enrolled, when they completed
 *   - a per-employee `PDF` download button that yields a receipt containing
 *     the FULL agreed text of every signed document (NDA, IP assignment, etc.)
 *     plus the signature audit metadata (IP, user agent, timestamp, identity
 *     ritual). This is the artifact you keep offline for legal.
 *
 * Filtering: pulls every status (no `status` filter passed) and lets the user
 * narrow via the in-panel dropdown. Search hits name/email. SUPER_ADMIN can
 * download the receipt for in-progress rows that already have ≥1 signature;
 * ADMIN sees the PDF button only on completed rows.
 */
function SignedByEmployeesPanel({ courseId }: { courseId: string }) {
  const enrollmentsQ = useAdminEnrollments({ courseId });
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const isSuperAdmin = useAuthStore((s) => s.user?.role === 'SUPER_ADMIN');

  const rows = (enrollmentsQ.data ?? []).filter((e) => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return e.user.name.toLowerCase().includes(s) || e.user.email.toLowerCase().includes(s);
  });

  const STATUS_TONE: Record<string, string> = {
    in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
    completed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
    declined: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    out_of_date: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  };
  const STATUS_LABEL: Record<string, string> = {
    in_progress: 'In progress',
    completed: 'Completed',
    declined: 'Declined',
    out_of_date: 'Out of date',
  };

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-indigo-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Signed by employees
          </h2>
          <span className="text-[11px] text-gray-500">
            {isSuperAdmin
              ? '(per-employee download of NDA + IP assignment + all signed docs as one PDF)'
              : '(per-employee status; signed-PDF download is SUPER_ADMIN only)'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900"
          >
            <option value="">All statuses</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="out_of_date">Out of date</option>
            <option value="declined">Declined</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 text-[11px] uppercase font-medium text-gray-500">
              <th className="text-left px-4 py-2">Employee</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2" title="Sigs = unique documents signed / required documents. Quiz = modules with a passing quiz attempt / modules that require a quiz. A green ✓ means the completion gate is already satisfied — the row will flip on the next 'Re-check open enrollments'.">
                Gate progress
              </th>
              <th className="text-left px-4 py-2">Last activity</th>
              <th className="text-left px-4 py-2">Completed</th>
              <th className="text-right px-4 py-2">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {enrollmentsQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-sm text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!enrollmentsQ.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  No employees match these filters.
                </td>
              </tr>
            )}
            {rows.map((e) => {
              // PDF receipt download is SUPER_ADMIN ONLY — per Pankaj's policy.
              // The PDF carries the full agreed text + per-signature audit
              // metadata (IP, user agent, identity ritual). ADMIN sees this
              // panel but cannot retrieve the signed artifact; backend route
              // enforces the same restriction with 403.
              const canDownload = isSuperAdmin && e.counts.signatures > 0;
              const sigsDone = e.gate.signaturesUnique;
              const sigsNeed = e.gate.requiredDocuments;
              const quizDone = e.gate.quizzesPassed;
              const quizNeed = e.gate.requiredQuizzes;
              const lastActivity =
                e.gate.latestSignatureAt ?? e.completedAt ?? e.enrolledAt;
              return (
                <tr
                  key={e.id}
                  className="border-b border-gray-100 dark:border-gray-800 last:border-0 text-sm hover:bg-gray-50 dark:hover:bg-gray-900/40"
                >
                  <td className="px-4 py-2">
                    <Link
                      to={`/compliance/users/${e.user.id}`}
                      className="font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600"
                    >
                      {e.user.name}
                    </Link>
                    <p className="text-[11px] text-gray-500">
                      {e.user.email} · {e.user.role}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        'inline-block px-2 py-0.5 text-[11px] font-medium rounded-full',
                        STATUS_TONE[e.status],
                      )}
                    >
                      {STATUS_LABEL[e.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {/* Per-row diagnostic. Sigs and Quiz get colored chips
                        showing "satisfied/required" so the admin can spot
                        which rows are stuck on a real gap vs. ready-to-flip. */}
                    <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
                      <span
                        className={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded',
                          sigsDone === sigsNeed
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                        )}
                        title={`${sigsDone} of ${sigsNeed} required documents signed`}
                      >
                        Sigs {sigsDone}/{sigsNeed}
                      </span>
                      {quizNeed > 0 && (
                        <span
                          className={cn(
                            'inline-flex items-center px-1.5 py-0.5 rounded',
                            quizDone === quizNeed
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200'
                              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                          )}
                          title={`${quizDone} of ${quizNeed} required quizzes passed`}
                        >
                          Quiz {quizDone}/{quizNeed}
                        </span>
                      )}
                      {!e.completedAt && e.gate.gateMet && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200"
                          title="Completion gate is already satisfied — this row will flip to 'Completed' on the next 'Re-check open enrollments'."
                        >
                          ready
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500" title={formatDate(lastActivity)}>
                    {formatRelative(lastActivity)}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {e.completedAt ? (
                      <span title={formatDate(e.completedAt)}>{formatRelative(e.completedAt)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {canDownload ? (
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
                            : `In-progress receipt — includes the ${e.counts.signatures} signature(s) collected so far with the full agreed text.`
                        }
                      >
                        <FileDown size={12} /> PDF
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isSuperAdmin && (
        <p className="mt-2 text-[11px] text-gray-500 flex items-center gap-1.5">
          <ShieldCheck size={11} className="text-indigo-500" />
          SUPER_ADMIN: you (and only you) can download the signed receipt PDFs. ADMIN
          users can see the list and status but cannot retrieve the signed artifacts.
          You can pull receipts in-progress, before quizzes are completed.
        </p>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'default' | 'success' | 'info' | 'warning' | 'danger';
}) {
  const cls: Record<typeof tone, string> = {
    default: 'text-gray-900 dark:text-gray-100',
    success: 'text-green-600 dark:text-green-400',
    info: 'text-indigo-600 dark:text-indigo-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <p className="text-[10px] uppercase tracking-wider font-medium text-gray-500">{label}</p>
      <p className={cn('text-2xl font-semibold mt-1', cls[tone])}>{value}</p>
    </div>
  );
}

function EditDocumentModal({
  courseId,
  documentId,
  documentTitle,
  documentVersion,
  initialBody,
  onClose,
}: {
  courseId: string;
  documentId: string;
  documentTitle: string;
  documentVersion: number;
  initialBody: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const update = useUpdateCourseDocumentBody(courseId);

  const changed = body !== initialBody;

  const handleSave = async () => {
    if (!changed) return;
    if (
      !window.confirm(
        'Saving will bump this document\'s version and the course version, which forces every employee to re-acknowledge on their next login.\n\nProceed?',
      )
    ) {
      return;
    }
    await update.mutateAsync({ documentId, bodyText: body });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl">
        <header className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{documentTitle}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Currently v{documentVersion}. Saving will publish v{documentVersion + 1} and bump the course version.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300 mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              This is a legally binding text. Have it reviewed by counsel before saving.
              Existing signatures at older versions remain in the audit record.
            </span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full min-h-[55vh] rounded-md border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3 text-sm font-mono text-gray-900 dark:text-gray-100"
          />
          {update.error instanceof Error && (
            <p className="mt-2 text-xs text-red-600">{update.error.message}</p>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!changed || update.isPending}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md',
              changed && !update.isPending
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed',
            )}
          >
            {update.isPending ? 'Saving…' : `Save & publish v${documentVersion + 1}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function BumpVersionModal({
  courseId,
  currentVersion,
  onClose,
}: {
  courseId: string;
  currentVersion: number;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const bump = useBumpCourseVersion(courseId);

  const handleConfirm = async () => {
    await bump.mutateAsync(note.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={22} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Bump course version
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              This forces every employee to re-acknowledge the course on their next login.
              Use this when you've made a material change you want everyone to re-confirm.
            </p>
          </div>
        </div>
        <label className="block mt-4">
          <span className="text-xs text-gray-600 dark:text-gray-400">Note (recorded in audit log)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='e.g. "Updated NDA per legal review"'
            className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={bump.isPending}
            className="px-4 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {bump.isPending ? 'Publishing…' : `Publish v${currentVersion + 1}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function DocumentDiffModal({
  courseId,
  slug,
  currentVersion,
  onClose,
}: {
  courseId: string;
  slug: string;
  currentVersion: number;
  onClose: () => void;
}) {
  const [fromVersion, setFromVersion] = useState(currentVersion - 1);
  const toVersion = currentVersion;
  const diffQ = useDocumentDiff(courseId, slug, fromVersion, toVersion);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl">
        <header className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Diff — {slug}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Comparing v{fromVersion} (older) vs v{toVersion} (current). Older texts come from
              snapshots saved on past signatures.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <X size={18} />
          </button>
        </header>
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="text-gray-500">Compare from version:</span>
            <select
              value={fromVersion}
              onChange={(e) => setFromVersion(Number(e.target.value))}
              className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1"
            >
              {Array.from({ length: currentVersion - 1 }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  v{v}
                </option>
              ))}
            </select>
          </label>
          <span className="text-gray-400">→</span>
          <span className="text-gray-700 dark:text-gray-300">v{currentVersion} (current)</span>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {diffQ.isLoading && <p className="text-sm text-gray-400">Loading diff…</p>}
          {diffQ.data && diffQ.data.fromText === null && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              No snapshot exists for v{fromVersion} — no one signed at that version, so we can't reconstruct it.
            </p>
          )}
          {diffQ.data && diffQ.data.fromText !== null && (
            <DiffViewer segments={diffQ.data.segments} />
          )}
        </div>
      </div>
    </div>
  );
}

function ForceExpireModal({
  courseId,
  courseTitle,
  onClose,
}: {
  courseId: string;
  courseTitle: string;
  onClose: () => void;
}) {
  const expire = useForceExpireCourse(courseId);
  const [result, setResult] = useState<{ scanned: number; refreshed: number } | null>(null);

  const handleConfirm = async () => {
    const r = await expire.mutateAsync();
    setResult({ scanned: r.scanned, refreshed: r.refreshed });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-start gap-3">
          <Clock size={22} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Force-expire all completions
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              This immediately expires every active completion for{' '}
              <strong>{courseTitle}</strong>. Every employee who had completed this course will be
              re-prompted on their next login. Use this for regulatory events or major policy
              changes you want everyone to re-confirm right now.
            </p>
            {result && (
              <div className="mt-3 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/20 p-3 text-xs text-green-800 dark:text-green-300">
                Done. Scanned {result.scanned} completions, refreshed {result.refreshed} users.
              </div>
            )}
            {expire.error instanceof Error && !result && (
              <p className="mt-2 text-xs text-red-600">{expire.error.message}</p>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleConfirm}
              disabled={expire.isPending}
              className="px-4 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {expire.isPending ? 'Expiring…' : 'Force-expire all'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
