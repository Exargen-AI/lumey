import { useState } from 'react';
import { CheckCircle2, ShieldCheck, Clock, AlertCircle, ArrowRight, FileDown } from 'lucide-react';
import { useMyEnrollments } from '@/hooks/useOnboarding';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { CoursePlayer } from '@/components/onboarding/CoursePlayer';
import { downloadMyEnrollmentReceipt } from '@/api/enrollments';
import { formatDate, formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

// User-facing landing for compliance courses. Replaces the previous
// hard-blocking OnboardingGate — the platform is fully usable on login, and
// the user comes here to read what they've agreed to and complete anything
// that's still outstanding.
//
// States:
//   - One or more pending enrollments → show "Action required" card(s) with
//     a "Start course" CTA that switches to the full-screen CoursePlayer.
//   - Only completed enrollments → show "✓ Compliant" card(s) with metadata
//     and a "Download receipt" link.
//   - Both → both lists, in that order.
//   - Nothing at all (e.g. CLIENT user) → empty state.
export function MyConfidentialityPage() {
  const enrollmentsQ = useMyEnrollments();
  const pending = useAuthStore((s) => s.pendingMandatoryEnrollments);
  const { refreshAuth } = useAuth();

  // When the user clicks "Start course" on a pending enrollment, we render
  // the existing CoursePlayer full-screen as a temporary takeover (same UX
  // as the old gate, just opt-in). On completion or decline we exit back
  // to this page and re-fetch.
  const [activeEnrollment, setActiveEnrollment] = useState<{
    courseSlug: string;
    enrollmentId: string;
  } | null>(null);

  const handleExit = async () => {
    setActiveEnrollment(null);
    // Refresh auth so pendingMandatoryEnrollments updates the sidebar dot,
    // and refetch enrollments so the page reflects new completion state.
    await refreshAuth();
    await enrollmentsQ.refetch();
  };

  if (activeEnrollment) {
    return (
      <CoursePlayer
        courseSlug={activeEnrollment.courseSlug}
        enrollmentId={activeEnrollment.enrollmentId}
        onCompleted={handleExit}
        onDeclined={handleExit}
      />
    );
  }

  if (enrollmentsQ.isLoading) {
    return <p className="text-sm text-gray-400">Loading your compliance status…</p>;
  }

  const active = enrollmentsQ.data?.active ?? [];
  const completed = enrollmentsQ.data?.completed ?? [];

  // Build a map slug → most-recent completion for nice "previously completed" status.
  const completedBySlug = new Map<string, any>();
  for (const c of completed) {
    const slug = c.course.slug;
    if (!completedBySlug.has(slug)) completedBySlug.set(slug, c);
  }

  const hasAnyContent = active.length > 0 || completed.length > 0 || pending.length > 0;

  return (
    <div className="space-y-7">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-indigo-500" size={20} />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Confidentiality</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500 max-w-2xl">
            The policies you've agreed to as part of your engagement with Exargen — and any new ones
            still waiting for your acknowledgment. Your signatures are recorded with timestamp, IP,
            and a snapshot of the exact text you agreed to.
          </p>
        </div>
      </header>

      {/* Pending — the "action required" surface. */}
      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Action required
          </h2>
          {active.map((e) => {
            const previouslyCompleted = completedBySlug.get(e.course.slug);
            // "Continue" when any module has been touched or any policy
            // signed — without it the button still reads "Start course"
            // after a refresh mid-course, suggesting progress was lost.
            // The list endpoint returns counts only, not the full rows.
            const inProgress =
              (e._count?.moduleProgress ?? 0) > 0 ||
              (e._count?.signatures ?? 0) > 0;
            return (
              <div
                key={e.id}
                className="rounded-xl border border-amber-300 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-5"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <AlertCircle size={16} className="text-amber-600 dark:text-amber-400" />
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                        {e.course.title}
                      </h3>
                      <span className="text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 bg-amber-200 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200">
                        v{e.course.version}
                      </span>
                    </div>
                    {e.course.description && (
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-300 max-w-2xl">
                        {e.course.description}
                      </p>
                    )}
                    {previouslyCompleted && (
                      <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
                        You previously completed v{previouslyCompleted.courseVersion} on{' '}
                        {formatDate(previouslyCompleted.completedAt)}. The course has been updated;
                        a fresh acknowledgment is needed.
                      </p>
                    )}
                    <p className="mt-2 text-[11px] text-gray-500">
                      Enrolled {formatRelative(e.enrolledAt)} · pass quiz ≥{e.course.passingScore}% per module · then sign each policy
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveEnrollment({ courseSlug: e.course.slug, enrollmentId: e.id })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
                  >
                    {previouslyCompleted
                      ? 'Re-acknowledge'
                      : inProgress
                        ? 'Continue'
                        : 'Start course'}
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Completed — historical compliance record. */}
      {completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
            Completed
          </h2>
          {completed.map((e) => (
            <CompletedCard key={e.id} enrollment={e} />
          ))}
        </section>
      )}

      {!hasAnyContent && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center">
          <ShieldCheck className="mx-auto text-gray-400" size={32} />
          <p className="mt-3 text-sm text-gray-500">
            You have no compliance courses assigned right now.
          </p>
        </div>
      )}
    </div>
  );
}

function CompletedCard({ enrollment }: { enrollment: any }) {
  const expired =
    !!enrollment.expiresAt && new Date(enrollment.expiresAt).getTime() < Date.now();
  const downloadName = `confidentiality-receipt-${enrollment.course.slug}.pdf`;

  return (
    <div
      className={cn(
        'rounded-xl border p-5 flex items-start justify-between gap-4 flex-wrap',
        expired
          ? 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 opacity-80'
          : 'border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/20',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {expired ? (
            <Clock size={16} className="text-gray-500" />
          ) : (
            <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
          )}
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
            {enrollment.course.title}
          </h3>
          <span className="text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            v{enrollment.courseVersion}
          </span>
        </div>
        <div className="mt-1 grid sm:grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-gray-600 dark:text-gray-400">
          <span>
            Completed:{' '}
            <span className="text-gray-800 dark:text-gray-200">
              {formatDate(enrollment.completedAt)}
            </span>
          </span>
          {enrollment.expiresAt && (
            <span>
              {expired ? 'Expired' : 'Valid until'}:{' '}
              <span className="text-gray-800 dark:text-gray-200">
                {formatDate(enrollment.expiresAt)}
              </span>
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => downloadMyEnrollmentReceipt(enrollment.id, downloadName)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <FileDown size={12} /> Download receipt
      </button>
    </div>
  );
}
