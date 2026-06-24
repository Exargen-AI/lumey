import { useState } from 'react';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import type { QuizSubmitResult, QuizView } from '@exargen/shared';
import { useSubmitQuizAttempt } from '@/hooks/useOnboarding';
import { cn } from '@/lib/cn';

interface Props {
  enrollmentId: string;
  quiz: QuizView;
  onPassed: () => void;
}

// One question at a time, then submit when every question has at least one
// selected option. On fail: show which questions were missed (NOT the correct
// answer) and the option to retry. On pass: surface the green check + "Continue".
export function QuizRunner({ enrollmentId, quiz, onPassed }: Props) {
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizSubmitResult | null>(null);
  const submit = useSubmitQuizAttempt(enrollmentId);

  const allAnswered = quiz.questions.every((q) => (selections[q.id] ?? []).length > 0);

  const handleSubmit = async () => {
    const answers = quiz.questions.map((q) => ({
      questionId: q.id,
      selectedOptionIds: selections[q.id] ?? [],
    }));
    const r = await submit.mutateAsync({ quizId: quiz.id, answers });
    setResult(r);
    if (r.passed) {
      // Give the user a beat to see "you passed" before advancing.
      setTimeout(onPassed, 1200);
    }
  };

  const handleRetry = () => {
    setSelections({});
    setResult(null);
  };

  if (result?.passed) {
    return (
      <div className="rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/30 p-6 text-center">
        <CheckCircle2 size={48} className="mx-auto text-green-600 dark:text-green-400" />
        <h3 className="mt-3 text-lg font-semibold text-gray-900 dark:text-gray-100">Quiz passed</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {result.scorePercent}% (passing: {result.passingScore}%)
        </p>
        <p className="mt-2 text-xs text-gray-500">Loading next module…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {quiz.questions.map((q, idx) => {
          const selected = selections[q.id] ?? [];
          const perQ = result?.perQuestion.find((p) => p.questionId === q.id);
          const wrong = result && perQ && !perQ.correct;
          return (
            <div
              key={q.id}
              className={cn(
                'rounded-lg border p-4',
                wrong
                  ? 'border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900',
              )}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                Question {idx + 1} of {quiz.questions.length}
              </p>
              <p className="font-medium text-gray-900 dark:text-gray-100">{q.prompt}</p>
              <div className="mt-3 space-y-2">
                {q.options.map((opt) => {
                  const isSelected = selected.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className={cn(
                        'flex items-start gap-3 cursor-pointer rounded-md border p-2.5 text-sm transition',
                        isSelected
                          ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300',
                      )}
                    >
                      <input
                        type="radio"
                        name={q.id}
                        className="mt-0.5"
                        disabled={!!result}
                        checked={isSelected}
                        onChange={() =>
                          setSelections((s) => ({ ...s, [q.id]: [opt.id] }))
                        }
                      />
                      <span className="text-gray-800 dark:text-gray-200">{opt.label}</span>
                    </label>
                  );
                })}
              </div>
              {wrong && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <XCircle size={14} /> Answer was incorrect — review the module above and try again.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {result && !result.passed && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                Score: {result.scorePercent}% — passing is {result.passingScore}%
              </p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                Re-read the module above. The questions in red were missed.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {result && !result.passed && (
          <button
            type="button"
            onClick={handleRetry}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Retry quiz
          </button>
        )}
        {!result && (
          <button
            type="button"
            disabled={!allAnswered || submit.isPending}
            onClick={handleSubmit}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg',
              allAnswered && !submit.isPending
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed',
            )}
          >
            {submit.isPending ? 'Grading…' : 'Submit quiz'}
          </button>
        )}
      </div>
    </div>
  );
}
