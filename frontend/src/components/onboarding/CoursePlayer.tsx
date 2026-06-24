import { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import type { CourseModuleView, CourseView, EnrollmentDetail } from '@exargen/shared';
import { useCourse, useDeclineEnrollment, useEnrollment, useRecordModuleProgress } from '@/hooks/useOnboarding';
import { ContentBlockRenderer } from './ContentBlockRenderer';
import { QuizRunner } from './QuizRunner';
import { SigningCeremony, AllSignedConfirmation } from './SigningCeremony';
import { LegalNameCaptureStep } from './LegalNameCaptureStep';
import { useScrollToBottomGate } from './useScrollToBottomGate';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/cn';

// Phases:
//   - 'modules':    stepping through modules, taking quizzes
//   - 'legal-name': one-time capture of `user.legalName` before any signing
//   - 'signing':    all quizzes passed + legal name on file; signing each doc
//   - 'complete':   all signed; the gate's effect kicks in to refetch /me

type Phase = 'modules' | 'legal-name' | 'signing' | 'complete';

interface Props {
  courseSlug: string;
  enrollmentId: string;
  onCompleted: () => void;
  onDeclined: () => void;
}

export function CoursePlayer({ courseSlug, enrollmentId, onCompleted, onDeclined }: Props) {
  const courseQ = useCourse(courseSlug);
  const enrollmentQ = useEnrollment(enrollmentId);

  if (courseQ.isLoading || enrollmentQ.isLoading) {
    return <CourseLoadingState />;
  }
  if (courseQ.error || !courseQ.data) {
    return <CourseError message="Failed to load the course." />;
  }
  if (enrollmentQ.error || !enrollmentQ.data) {
    return <CourseError message="Failed to load your enrollment." />;
  }

  return (
    <CoursePlayerInner
      course={courseQ.data}
      enrollment={enrollmentQ.data}
      onCompleted={onCompleted}
      onDeclined={onDeclined}
    />
  );
}

function CoursePlayerInner({
  course,
  enrollment,
  onCompleted,
  onDeclined,
}: {
  course: CourseView;
  enrollment: EnrollmentDetail;
  onCompleted: () => void;
  onDeclined: () => void;
}) {
  const orderedModules = useMemo(() => [...course.modules].sort((a, b) => a.order - b.order), [course.modules]);
  const orderedDocs = useMemo(() => [...course.documents].sort((a, b) => a.order - b.order), [course.documents]);

  // Module progress map keyed by moduleId for quick lookup.
  const progressByModule = useMemo(() => {
    const m = new Map<string, EnrollmentDetail['moduleProgress'][number]>();
    enrollment.moduleProgress.forEach((p) => m.set(p.moduleId, p));
    return m;
  }, [enrollment.moduleProgress]);

  const allQuizzesPassed = orderedModules.every((mod) => {
    if (!mod.quiz) return true;
    return progressByModule.get(mod.id)?.quizPassed === true;
  });

  // First module index whose quiz isn't passed yet — that's where we start.
  const firstUnfinishedIdx = orderedModules.findIndex((mod) => {
    if (!mod.quiz) return false;
    return !progressByModule.get(mod.id)?.quizPassed;
  });

  // Legal name on file determines whether we go straight to signing or
  // detour through the legal-name capture step. Read from auth store so a
  // successful capture (which patches user.legalName via setUserLegalName)
  // re-renders us into 'signing' on the next tick.
  const userLegalName = useAuthStore((s) => s.user?.legalName ?? null);
  const computeInitialPhase = (): Phase => {
    if (!allQuizzesPassed) return 'modules';
    if (!userLegalName) return 'legal-name';
    return 'signing';
  };

  const [phase, setPhase] = useState<Phase>(computeInitialPhase);
  const [currentIdx, setCurrentIdx] = useState<number>(Math.max(0, firstUnfinishedIdx));

  // If signing finishes, switch to complete and notify the parent (the gate).
  const handleAllSigned = () => {
    setPhase('complete');
    // Give React a moment to render the success card before refetching /me.
    setTimeout(onCompleted, 800);
  };

  // Decline modal state
  const [confirmDecline, setConfirmDecline] = useState(false);
  const decline = useDeclineEnrollment(enrollment.id);
  const handleConfirmDecline = async () => {
    await decline.mutateAsync();
    onDeclined();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
              Mandatory onboarding
            </p>
            <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">{course.title}</h1>
          </div>
          <button
            type="button"
            onClick={() => setConfirmDecline(true)}
            className="text-xs text-gray-500 hover:text-red-600 underline-offset-2 hover:underline"
          >
            Decline & exit
          </button>
        </div>
        <ProgressBar phase={phase} modules={orderedModules} progressByModule={progressByModule} signedCount={enrollment.signatures.length} totalDocs={orderedDocs.length} />
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-6">
        {phase === 'modules' && (
          <ModuleStage
            // Re-key per module so module-local state (scroll gate, quiz visibility,
            // start time) starts fresh on every module instead of leaking the
            // previous module's state through stale closures.
            key={orderedModules[currentIdx].id}
            module={orderedModules[currentIdx]}
            enrollmentId={enrollment.id}
            progress={progressByModule.get(orderedModules[currentIdx].id)}
            isLast={currentIdx === orderedModules.length - 1}
            onPrev={currentIdx > 0 ? () => setCurrentIdx((i) => i - 1) : null}
            onNext={() => {
              if (currentIdx < orderedModules.length - 1) {
                setCurrentIdx((i) => i + 1);
              } else {
                // After the last module's quiz: detour through the legal-name
                // capture step if we haven't captured it yet, otherwise go
                // directly to signing.
                setPhase(userLegalName ? 'signing' : 'legal-name');
              }
            }}
          />
        )}

        {phase === 'legal-name' && (
          <LegalNameCaptureStep
            enrollmentId={enrollment.id}
            onCaptured={() => setPhase('signing')}
          />
        )}

        {phase === 'signing' && (
          <SigningCeremony
            enrollmentId={enrollment.id}
            documents={orderedDocs}
            enrollment={enrollment}
            onAllSigned={handleAllSigned}
          />
        )}

        {phase === 'complete' && <AllSignedConfirmation />}
      </main>

      {confirmDecline && (
        <DeclineConfirmModal
          courseTitle={course.title}
          onCancel={() => setConfirmDecline(false)}
          onConfirm={handleConfirmDecline}
          submitting={decline.isPending}
        />
      )}
    </div>
  );
}

// ─── Module stage with quiz gate ───

function ModuleStage({
  module,
  enrollmentId,
  progress,
  isLast,
  onPrev,
  onNext,
}: {
  module: CourseModuleView;
  enrollmentId: string;
  progress: EnrollmentDetail['moduleProgress'][number] | undefined;
  isLast: boolean;
  onPrev: (() => void) | null;
  onNext: () => void;
}) {
  const recordProgress = useRecordModuleProgress(enrollmentId);
  const [showQuiz, setShowQuiz] = useState(false);
  const startedAtRef = useRef<number>(Date.now());

  // Anti-skim: scroll-to-bottom OR fits-without-scrolling unlocks the gate.
  // The hook handles ResizeObserver, window resize, and uses functional
  // setState so re-keying-per-module is the only thing that drives reset —
  // no stale-closure bug across module navigation (see useScrollToBottomGate).
  const { ref: containerRef, passed: scrolledToBottom, onScroll: handleScroll } =
    useScrollToBottomGate<HTMLDivElement>({
      initialPassed: progress?.scrolledToBottom === true,
      onFirstPass: () => {
        const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
        recordProgress.mutate({ moduleId: module.id, scrolledToBottom: true, timeOnPageSec: elapsed });
      },
    });

  const quizAlreadyPassed = progress?.quizPassed === true;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Module {module.order} · ~{module.estimatedMinutes ?? 5} min
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 mt-1">
          {module.title}
        </h2>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="max-h-[55vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <ContentBlockRenderer blocks={module.contentBlocks} />
      </div>

      {!scrolledToBottom && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Scroll to the end of the module to continue.
        </p>
      )}

      {/* If this module has a quiz and it's not yet passed, the user must take it before advancing. */}
      {module.quiz && !quizAlreadyPassed && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          {!showQuiz ? (
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">Comprehension check</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                  Pass this short quiz ({module.quiz.questions.length} questions, {module.quiz.passingScore}% to pass) to continue.
                </p>
              </div>
              <button
                type="button"
                disabled={!scrolledToBottom}
                onClick={() => setShowQuiz(true)}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap',
                  scrolledToBottom
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed',
                )}
              >
                Start quiz
              </button>
            </div>
          ) : (
            <QuizRunner
              enrollmentId={enrollmentId}
              quiz={module.quiz}
              onPassed={() => {
                onNext();
              }}
            />
          )}
        </div>
      )}

      {/* If module has no quiz OR quiz is already passed, allow direct nav. */}
      {(!module.quiz || quizAlreadyPassed) && (
        <div className="flex justify-between gap-3">
          {onPrev ? (
            <button
              type="button"
              onClick={onPrev}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <ChevronLeft size={16} /> Previous
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            disabled={!scrolledToBottom}
            onClick={onNext}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg',
              scrolledToBottom
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed',
            )}
          >
            {isLast ? 'Continue to signing' : 'Next module'} <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Progress bar across the top ───

function ProgressBar({
  phase,
  modules,
  progressByModule,
  signedCount,
  totalDocs,
}: {
  phase: Phase;
  modules: CourseModuleView[];
  progressByModule: Map<string, EnrollmentDetail['moduleProgress'][number]>;
  signedCount: number;
  totalDocs: number;
}) {
  const passedQuizzes = modules.filter((m) => m.quiz && progressByModule.get(m.id)?.quizPassed).length;
  const totalQuizzes = modules.filter((m) => !!m.quiz).length;
  const moduleStepLabel = `${passedQuizzes}/${totalQuizzes} modules passed`;
  const docStepLabel = `${signedCount}/${totalDocs} documents signed`;

  // The progress bar still shows two macro-states: modules vs documents.
  // The legal-name capture step is a brief sub-step of the documents stage,
  // so we mark "documents" active during 'legal-name' too — visually the
  // user has finished the modules and is on their way through the signing.
  const inDocumentsStage = phase === 'legal-name' || phase === 'signing';

  return (
    <div className="max-w-3xl mx-auto px-6 pb-3 flex items-center gap-4 text-xs text-gray-500">
      <Step done={phase !== 'modules'} active={phase === 'modules'} label={moduleStepLabel} />
      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      <Step done={phase === 'complete'} active={inDocumentsStage} label={docStepLabel} />
    </div>
  );
}

function Step({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5',
        done ? 'text-green-600 dark:text-green-400' : active ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-500',
      )}
    >
      {done ? <CheckCircle2 size={14} /> : <span className={cn('w-2 h-2 rounded-full', active ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700')} />}
      <span>{label}</span>
    </span>
  );
}

// ─── Decline modal ───

function DeclineConfirmModal({
  courseTitle,
  onCancel,
  onConfirm,
  submitting,
}: {
  courseTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-3">
          <ShieldAlert className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" size={28} />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Decline this course?</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Declining the {courseTitle} course is permanent and will be recorded with a
              timestamp, your IP, and your browser for audit purposes. You'll keep access to the
              platform; HR will follow up about the policies you've refused to acknowledge.
            </p>
            <p className="mt-3 text-xs text-gray-500">
              If you have a question about the policies, contact HR before declining.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Declining…' : 'Decline & exit'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Loading + error states ───

function CourseLoadingState() {
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      <p className="text-sm">Loading onboarding course…</p>
    </div>
  );
}

function CourseError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">
      <p className="text-sm">{message}</p>
    </div>
  );
}
