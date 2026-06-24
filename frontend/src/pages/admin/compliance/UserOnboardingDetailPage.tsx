import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown, FileSignature, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useUserOnboardingForensics } from '@/hooks/useAdminCompliance';
import { downloadEnrollmentReceipt } from '@/api/adminEnrollments';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/cn';

export function UserOnboardingDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const q = useUserOnboardingForensics(userId);

  if (q.isLoading) return <p className="text-sm text-gray-400">Loading forensic record…</p>;
  if (!q.data || q.data.length === 0) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-gray-500">No onboarding records for this user.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">User Onboarding History</h1>
        <p className="mt-1 text-sm text-gray-500">
          Forensic-grade record of every course this user has been enrolled in: signatures with full
          text snapshots, IP, user-agent, timestamps, and quiz attempts.
        </p>
      </div>

      {q.data.map((enrollment) => (
        <section
          key={enrollment.id}
          className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-5"
        >
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-indigo-500" />
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                  {enrollment.course.title}
                </h2>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Enrolled at v{enrollment.courseVersion} · current is v{enrollment.course.version} ·{' '}
                {enrollment.completedAt ? `Completed ${formatDate(enrollment.completedAt)}` : enrollment.declinedAt ? `Declined ${formatDate(enrollment.declinedAt)}` : 'In progress'}
              </p>
            </div>
            {enrollment.completedAt && (
              <button
                onClick={() =>
                  downloadEnrollmentReceipt(enrollment.id, `receipt-${enrollment.course.slug}.pdf`)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <FileDown size={12} /> Download PDF receipt
              </button>
            )}
          </header>

          {enrollment.declinedAt && (
            <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-800 dark:text-red-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>This user declined the course on {formatDate(enrollment.declinedAt)}. They were logged out and have not regained platform access.</span>
            </div>
          )}

          {/* Signatures */}
          {enrollment.signatures.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Signatures
              </h3>
              <div className="space-y-2">
                {enrollment.signatures.map((sig) => (
                  <details
                    key={sig.id}
                    className="group rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40"
                  >
                    <summary className="cursor-pointer p-3 flex items-start gap-3 hover:bg-gray-100 dark:hover:bg-gray-900 rounded-lg">
                      <FileSignature size={14} className="text-indigo-500 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {sig.courseDocument.title}{' '}
                          <span className="text-[10px] text-gray-500 font-normal">v{sig.documentVersion}</span>
                        </p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Signed as <span className="font-medium text-gray-700 dark:text-gray-300">{sig.signedName}</span>{' '}
                          · {formatDate(sig.signedAt)} · IP {sig.ipAddress ?? '—'}
                        </p>
                      </div>
                    </summary>
                    <div className="px-3 pb-3 space-y-3">
                      <KV label="Signed at (server time)" value={new Date(sig.signedAt).toISOString()} mono />
                      <KV label="IP address" value={sig.ipAddress ?? '—'} mono />
                      <KV label="User agent" value={sig.userAgent ?? '—'} mono small />
                      <KV
                        label="Identity ritual"
                        value={
                          sig.passwordReentered
                            ? 'Typed name + password re-entry'
                            : sig.externalProvider
                              ? `External: ${sig.externalProvider}`
                              : 'Typed name only'
                        }
                      />
                      {sig.externalEnvelopeId && <KV label="External envelope" value={sig.externalEnvelopeId} mono />}
                      <div>
                        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">
                          Agreed text snapshot
                        </p>
                        <pre className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 p-3 text-[11px] text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-sans max-h-[40vh] overflow-y-auto">
                          {sig.signedTextSnapshot}
                        </pre>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Quiz attempts */}
          {enrollment.quizAttempts.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Quiz attempts ({enrollment.quizAttempts.length})
              </h3>
              <div className="space-y-1">
                {enrollment.quizAttempts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between text-xs rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 px-3 py-1.5"
                  >
                    <span className="text-gray-600 dark:text-gray-400">
                      Attempt #{a.attemptNumber} · {formatDate(a.startedAt)}
                    </span>
                    {a.scorePercent !== null ? (
                      <span
                        className={cn(
                          'font-medium',
                          a.passed ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {a.scorePercent}% · {a.passed ? 'Passed' : 'Failed'}
                      </span>
                    ) : (
                      <span className="text-gray-500">Incomplete</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Module progress */}
          {enrollment.moduleProgress.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Module progress
              </h3>
              <div className="space-y-1">
                {enrollment.moduleProgress
                  .slice()
                  .sort((a, b) => a.module.order - b.module.order)
                  .map((mp) => (
                    <div key={mp.id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">
                        Module {mp.module.order}: {mp.module.title}
                      </span>
                      <span className={cn(mp.quizPassed ? 'text-green-600' : 'text-gray-500')}>
                        {mp.quizPassed ? 'Quiz passed' : mp.scrolledToBottom ? 'Read' : 'Started'} · {mp.timeOnPageSec}s
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/compliance/enrollments"
      className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
    >
      <ArrowLeft size={14} /> Back to onboarding status
    </Link>
  );
}

function KV({ label, value, mono, small }: { label: string; value: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span
        className={cn(
          'text-gray-800 dark:text-gray-200 break-all',
          mono && 'font-mono',
          small && 'text-[11px]',
        )}
      >
        {value}
      </span>
    </div>
  );
}
