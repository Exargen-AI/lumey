import prisma from '../../config/database';
import { comparePassword } from '../../utils/password';
import { ValidationError } from '../../utils/errors';
import { captureIp, captureUserAgent } from '../../utils/request';
import { legalNameMatches } from '@exargen/shared';
import { SigningProvider, SigningContext, SignSubmission } from './types';

interface InAppPayload {
  typedName: string;
  password: string;
}

function isInAppPayload(p: unknown): p is InAppPayload {
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof (p as any).typedName === 'string' &&
    typeof (p as any).password === 'string'
  );
}

// In-app signing ceremony. Validates that:
//   1) the user has a captured legal name on file (`user.legalName`).
//      Without one we fail-closed — the legal-name capture step at the
//      start of the signing ceremony is the source of truth for what
//      counts as a binding signature. Comparing against the display
//      `name` (often a first-name shorthand from email lazy-create) is
//      not a defensible match.
//   2) the typed name matches `legalName` (case-insensitive, collapsed
//      whitespace) — proves the user re-typed their own legal name.
//   3) the password re-entry is correct — proves it's actually them at
//      the keyboard, not someone walking past a logged-in laptop.
// On success creates a DocumentSignature row pinning:
//   - the FULL document text at sign time (`signedTextSnapshot`)
//   - the document version
//   - server-side timestamp (Postgres now())
//   - request IP + UA
//   - `passwordReentered = true`
export const inAppProvider: SigningProvider = {
  async sign(ctx: SigningContext, submission: SignSubmission) {
    if (!isInAppPayload(submission.payload)) {
      throw new ValidationError('Invalid signing payload — expected { typedName, password }');
    }
    const { typedName, password } = submission.payload;

    if (typedName.trim().length === 0) {
      throw new ValidationError('Typed name is required');
    }

    if (!ctx.user.legalName) {
      throw new ValidationError(
        'Confirm your full legal name before signing — the legal-name capture step in the signing ceremony has not been completed.',
      );
    }

    if (!legalNameMatches(typedName, ctx.user.legalName)) {
      throw new ValidationError('Typed name must match your full legal name on record');
    }

    const passwordOk = await comparePassword(password, ctx.user.passwordHash);
    if (!passwordOk) {
      throw new ValidationError('Password is incorrect');
    }

    return prisma.documentSignature.create({
      data: {
        enrollmentId: ctx.enrollment.id,
        courseDocumentId: ctx.document.id,
        documentVersion: ctx.document.version,
        signedName: typedName.trim(),
        signedTextSnapshot: ctx.document.bodyText,
        ipAddress: captureIp(ctx.req),
        userAgent: captureUserAgent(ctx.req),
        passwordReentered: true,
        externalProvider: null,
        externalEnvelopeId: null,
        externalAuditUrl: null,
      },
    });
  },
};
