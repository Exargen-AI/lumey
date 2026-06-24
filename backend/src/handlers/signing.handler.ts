import { Request, Response, NextFunction } from 'express';
import * as service from '../services/signing/signing.service';
import { diffLearnerLastSigned } from '../services/documentDiff.service';

export async function signDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { signature, alreadySigned } = await service.signCourseDocument({
      enrollmentId: req.params.id,
      userId: req.user!.id,
      documentSlug: req.params.documentSlug,
      payload: req.body,
      req,
    });
    res.status(alreadySigned ? 200 : 201).json({
      success: true,
      data: {
        id: signature.id,
        signedAt: signature.signedAt,
        signedName: signature.signedName,
        documentVersion: signature.documentVersion,
        alreadySigned,
      },
    });
  } catch (err) { next(err); }
}

// Admin-only forensic view of a user's full onboarding history.
export async function getUserOnboardingForensicsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getUserOnboardingForensics(req.params.userId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// Learner-side diff: "what changed since you last signed this document?"
// Returns null payload if there's no prior signature or current matches prior.
export async function getMyDocumentDiffHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await diffLearnerLastSigned(req.user!.id, req.params.id, req.params.documentSlug);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
