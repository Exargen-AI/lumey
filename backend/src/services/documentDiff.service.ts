import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';

// Document version history.
//
// We don't keep an explicit per-version body archive; we recover historical
// text from the `signedTextSnapshot` field on DocumentSignature rows. Every
// legally-binding signature pins the full text at sign time, so for any
// version that anyone ever signed, we have the exact text on record.
//
// For the current (latest) version, we read CourseDocument.bodyText directly.

export interface DocumentVersionText {
  version: number;
  isCurrent: boolean;
  text: string;
  // Where we got it: 'current-row' or signature id
  source: 'current-row' | string;
}

export async function getDocumentVersionText(
  courseId: string,
  documentSlug: string,
  version: number,
): Promise<DocumentVersionText | null> {
  const document = await prisma.courseDocument.findUnique({
    where: { courseId_slug: { courseId, slug: documentSlug } },
  });
  if (!document) throw new NotFoundError('Course document');

  if (document.version === version) {
    return { version, isCurrent: true, text: document.bodyText, source: 'current-row' };
  }

  // Look up any signature that pinned this version. Doesn't matter whose —
  // the text snapshot is identical for everyone who signed at that version.
  const sig = await prisma.documentSignature.findFirst({
    where: { courseDocumentId: document.id, documentVersion: version },
    select: { id: true, signedTextSnapshot: true },
  });
  if (!sig) return null;
  return { version, isCurrent: false, text: sig.signedTextSnapshot, source: sig.id };
}

// Returns line-level diff. Output is an array of segments. Each segment is
// either `unchanged` (text appearing in both), `removed` (only in `from`),
// or `added` (only in `to`). Suitable for rendering as a redline.
//
// Algorithm: line-level LCS. For our use case (multi-paragraph legal docs)
// this is plenty — it produces sensible block-level diffs. If a line changes
// it'll show as one removed + one added block, which is fine in a redline view.
export interface DiffSegment {
  type: 'unchanged' | 'removed' | 'added';
  text: string;
}

export async function diffDocumentVersions(
  courseId: string,
  documentSlug: string,
  fromVersion: number,
  toVersion: number,
): Promise<{
  fromVersion: number;
  toVersion: number;
  fromText: string | null;
  toText: string | null;
  segments: DiffSegment[];
}> {
  const from = await getDocumentVersionText(courseId, documentSlug, fromVersion);
  const to = await getDocumentVersionText(courseId, documentSlug, toVersion);

  if (!from || !to) {
    return {
      fromVersion,
      toVersion,
      fromText: from?.text ?? null,
      toText: to?.text ?? null,
      segments: [],
    };
  }

  const segments = lcsLineDiff(from.text, to.text);

  return { fromVersion, toVersion, fromText: from.text, toText: to.text, segments };
}

// Diff a learner's most recent past signature on a specific document against
// the current version. Returns null if the user has never signed this document
// before (nothing to diff against).
export async function diffLearnerLastSigned(
  userId: string,
  enrollmentId: string,
  documentSlug: string,
): Promise<{
  documentSlug: string;
  fromVersion: number;
  toVersion: number;
  segments: DiffSegment[];
} | null> {
  const enrollment = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!enrollment || enrollment.userId !== userId) return null;

  const document = await prisma.courseDocument.findUnique({
    where: { courseId_slug: { courseId: enrollment.courseId, slug: documentSlug } },
  });
  if (!document) return null;

  // Find the user's most recent prior signature on THIS document — could be
  // from a previous enrollment cycle or a prior course version.
  const prior = await prisma.documentSignature.findFirst({
    where: {
      courseDocumentId: document.id,
      enrollment: { userId },
    },
    orderBy: { signedAt: 'desc' },
  });
  if (!prior) return null;
  if (prior.documentVersion === document.version) {
    // They already signed at the current version — no diff needed (and the
    // sign endpoint will return alreadySigned).
    return null;
  }

  return {
    documentSlug,
    fromVersion: prior.documentVersion,
    toVersion: document.version,
    segments: lcsLineDiff(prior.signedTextSnapshot, document.bodyText),
  };
}

// LCS-based line diff. Returns segments grouped by run (consecutive lines of
// the same type are coalesced into one segment for nicer rendering).
function lcsLineDiff(a: string, b: string): DiffSegment[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const m = aLines.length;
  const n = bLines.length;

  // Build LCS DP table.
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLines[i - 1] === bLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce ops.
  type Op = { type: 'unchanged' | 'removed' | 'added'; text: string };
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (aLines[i - 1] === bLines[j - 1]) {
      ops.push({ type: 'unchanged', text: aLines[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: 'removed', text: aLines[i - 1] });
      i--;
    } else {
      ops.push({ type: 'added', text: bLines[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: 'removed', text: aLines[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: 'added', text: bLines[j - 1] });
    j--;
  }
  ops.reverse();

  // Coalesce consecutive same-type runs.
  const out: DiffSegment[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.type === op.type) {
      last.text += '\n' + op.text;
    } else {
      out.push({ ...op });
    }
  }
  return out;
}
