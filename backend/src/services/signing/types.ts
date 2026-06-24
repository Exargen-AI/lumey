import type { Request } from 'express';
import type { CourseDocument, DocumentSignature, Enrollment, User } from '@prisma/client';

// The seam for swapping signing backends. v1 implements `inAppProvider`
// (typed name + password re-entry). A later DocuSeal/DocuSign adapter
// implements the same interface — same `DocumentSignature` row shape,
// just with the `externalProvider` / `externalEnvelopeId` fields populated.

export interface SigningContext {
  user: User;
  enrollment: Enrollment;
  document: CourseDocument;
  req: Request;
}

export interface SignSubmission {
  // Whatever the client sent. For inAppProvider this is { typedName, password }.
  // For docusealProvider this would be { envelopeId } from a webhook.
  payload: unknown;
}

export interface SigningProvider {
  /**
   * Records a signature event. Must validate the submission, gather forensic
   * context, and create a DocumentSignature row (or throw on validation).
   */
  sign(ctx: SigningContext, submission: SignSubmission): Promise<DocumentSignature>;
}
