import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileSignature, History, ShieldCheck, X } from 'lucide-react';
import type { CourseDocumentView, EnrollmentDetail } from '@exargen/shared';
import { useSignDocument } from '@/hooks/useOnboarding';
import { useAuthStore } from '@/stores/authStore';
import { getMyDocumentDiff } from '@/api/signing';
import { DiffViewer } from './DiffViewer';
import { useScrollToBottomGate } from './useScrollToBottomGate';
import { cn } from '@/lib/cn';

interface Props {
  enrollmentId: string;
  documents: CourseDocumentView[];
  enrollment: EnrollmentDetail;
  onAllSigned: () => void;
}

// Sequential per-document signing. For each unsigned document:
//   1. Render full bodyText in a scrollable container; "I agree" disabled until
//      the user has scrolled to the bottom (anti-skim signal).
//   2. Type full legal name (must match user.name case-insensitively).
//   3. Re-enter password (proves identity at signing time).
//   4. Submit → server creates DocumentSignature with snapshot/IP/UA/timestamp.
// On success move to next document. After the last, call `onAllSigned`.
export function SigningCeremony({ enrollmentId, documents, enrollment, onAllSigned }: Props) {
  const user = useAuthStore((s) => s.user);
  const sign = useSignDocument(enrollmentId);

  // Match signatures to documents by id directly — same shape the backend's
  // tryMarkEnrollmentCompleted uses. The previous implementation went through
  // an extra slug indirection (`documents.find(d => d.id === s.courseDocumentId)?.slug`)
  // which silently dropped any signature whose courseDocumentId didn't resolve
  // to a current document. When that filter dropped the signature for the
  // doc the user just signed, `next` kept returning the same document and the
  // user appeared stuck — the symptom QA hit on the signing flow.
  const signedDocIds = new Set(enrollment.signatures.map((s) => s.courseDocumentId));

  // Find next unsigned document.
  const ordered = [...documents].sort((a, b) => a.order - b.order);
  const next = ordered.find((d) => !signedDocIds.has(d.id));

  useEffect(() => {
    if (!next) onAllSigned();
  }, [next, onAllSigned]);

  if (!next) return null;

  return (
    <DocumentSigner
      key={next.slug}
      doc={next}
      enrollmentId={enrollmentId}
      userName={user?.name ?? ''}
      submitting={sign.isPending}
      lastError={sign.error instanceof Error ? sign.error.message : null}
      onSign={async ({ typedName, password }) => {
        await sign.mutateAsync({ documentSlug: next.slug, typedName, password });
        sign.reset();
      }}
      progressLabel={`Signing ${ordered.findIndex((d) => d.slug === next.slug) + 1} of ${ordered.length}`}
    />
  );
}

function DocumentSigner({
  doc,
  enrollmentId,
  userName,
  submitting,
  lastError,
  onSign,
  progressLabel,
}: {
  doc: CourseDocumentView;
  enrollmentId: string;
  userName: string;
  submitting: boolean;
  lastError: string | null;
  onSign: (input: { typedName: string; password: string }) => Promise<void>;
  progressLabel: string;
}) {
  const [typedName, setTypedName] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  // Anti-skim: scroll-to-bottom OR fits-without-scrolling unlocks signing.
  // Parent re-keys this component per document, so the hook restarts cleanly
  // for each one. Hook also handles container/content/window resize so the
  // gate doesn't get stuck after image loads, browser zoom, or a viewport
  // change between documents.
  const { ref: scrollRef, passed: scrolledToBottom, onScroll: handleScroll } =
    useScrollToBottomGate<HTMLDivElement>({ slackPx: 4 });

  // "What changed since I last signed?" — fires only when this user has a
  // prior signature on this document (returns null otherwise).
  const diffQ = useQuery({
    queryKey: ['my-doc-diff', enrollmentId, doc.slug],
    queryFn: () => getMyDocumentDiff(enrollmentId, doc.slug),
    staleTime: 60 * 1000,
  });
  const hasDiff = !!diffQ.data && diffQ.data.segments.some((s) => s.type !== 'unchanged');

  const namesMatch =
    typedName.trim().length > 0 &&
    typedName.trim().toLowerCase().replace(/\s+/g, ' ') ===
      userName.trim().toLowerCase().replace(/\s+/g, ' ');
  const canSubmit = scrolledToBottom && agreed && namesMatch && password.length > 0 && !submitting;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="text-indigo-500 mt-1 shrink-0" size={28} />
        <div className="flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            {progressLabel}
          </p>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{doc.title}</h2>
          <p className="text-xs text-gray-500 mt-1">
            Version {doc.version} — your signature will pin this exact text, your IP, your browser, and the server timestamp.
          </p>
        </div>
        {hasDiff && diffQ.data && (
          <button
            type="button"
            onClick={() => setShowDiff(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 self-start"
            title={`See what changed between v${diffQ.data.fromVersion} (which you signed before) and v${diffQ.data.toVersion} (current)`}
          >
            <History size={14} /> What changed since you last signed
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[42vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 text-sm whitespace-pre-wrap font-sans text-gray-800 dark:text-gray-200"
      >
        {doc.bodyText}
      </div>
      {!scrolledToBottom && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Scroll to the end of the document to enable signing.
        </p>
      )}

      <label
        className={cn(
          'flex items-start gap-3 rounded-lg border p-3 transition',
          scrolledToBottom
            ? 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-pointer'
            : 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/30 cursor-not-allowed opacity-60',
        )}
      >
        <input
          type="checkbox"
          className="mt-1"
          disabled={!scrolledToBottom}
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span className="text-sm text-gray-800 dark:text-gray-200">
          I have read this document in full, understand its terms, and agree to be bound by them.
        </span>
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Type your full legal name
          </label>
          <input
            type="text"
            placeholder={userName || 'Your full legal name'}
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            disabled={!agreed}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm disabled:opacity-50"
          />
          {typedName.length > 0 && !namesMatch && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Must match your name on record exactly.
            </p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Re-enter your password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!agreed}
            className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm disabled:opacity-50"
            autoComplete="current-password"
          />
        </div>
      </div>

      {lastError && (
        <p className="text-xs text-red-600 dark:text-red-400">{lastError}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSign({ typedName, password })}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition',
            canSubmit
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-200 dark:bg-gray-800 text-gray-500 cursor-not-allowed',
          )}
        >
          <FileSignature size={16} />
          {submitting ? 'Signing…' : `Sign ${doc.title}`}
        </button>
      </div>

      {showDiff && diffQ.data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
            <header className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-800">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  What changed in {doc.title}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  You previously signed v{diffQ.data.fromVersion}. The current version is v{diffQ.data.toVersion}.
                </p>
              </div>
              <button
                onClick={() => setShowDiff(false)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
              >
                <X size={18} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5">
              <DiffViewer segments={diffQ.data.segments} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Convenience export — used by CoursePlayer to show "all signed" UI before
// onAllSigned propagates to the gate.
export function AllSignedConfirmation() {
  return (
    <div className="rounded-xl border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-950/30 p-8 text-center">
      <CheckCircle2 size={56} className="mx-auto text-green-600 dark:text-green-400" />
      <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-100">
        All documents signed
      </h2>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Welcome aboard. Loading your dashboard…
      </p>
    </div>
  );
}
