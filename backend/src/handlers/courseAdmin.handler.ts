import { Request, Response, NextFunction } from 'express';
import * as service from '../services/courseAdmin.service';
import * as enrollmentAdmin from '../services/enrollmentAdmin.service';
import * as signing from '../services/signing/signing.service';
import * as maintenance from '../services/onboardingMaintenance.service';
import * as docDiff from '../services/documentDiff.service';
import { streamEnrollmentReceipt } from '../services/pdfReceipt.service';

export async function listCoursesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.listCoursesForAdmin();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getCourseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getCourseForAdmin(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateDocumentBodyHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const bodyText = typeof req.body?.bodyText === 'string' ? req.body.bodyText : '';
    const result = await service.updateCourseDocumentBody(
      req.params.id,
      req.params.documentId,
      bodyText,
      req.user!.id,
    );
    res.json({
      success: true,
      data: {
        document: { id: result.document.id, version: result.document.version, slug: result.document.slug },
        course: { id: result.course.id, version: result.course.version },
      },
    });
  } catch (err) { next(err); }
}

export async function bumpVersionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    const updated = await service.bumpCourseVersion(req.params.id, req.user!.id, note);
    res.json({ success: true, data: { id: updated.id, version: updated.version } });
  } catch (err) { next(err); }
}

export async function listEnrollmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await enrollmentAdmin.listEnrollmentsForAdmin({
      courseId: typeof req.query.courseId === 'string' ? req.query.courseId : undefined,
      status: req.query.status as any,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function courseStatsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await enrollmentAdmin.getCourseEnrollmentStats(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function userOnboardingForensicsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await signing.getUserOnboardingForensics(req.params.userId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function enrollmentReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await streamEnrollmentReceipt(req.params.enrollmentId, res);
  } catch (err) { next(err); }
}

// ─── Phase 3 additions ───

export async function expireStaleHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await maintenance.expireStaleCompletions(_req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function forceExpireCourseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await maintenance.forceExpireCourseCompletions(req.params.id, req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function sendReminderHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await enrollmentAdmin.sendEnrollmentReminder(req.params.id, req.user!.id);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function documentDiffHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const fromVersion = parseInt(String(req.query.from ?? ''), 10);
    const toVersion = parseInt(String(req.query.to ?? ''), 10);
    if (Number.isNaN(fromVersion) || Number.isNaN(toVersion)) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'from and to query params must be integers' } });
      return;
    }
    const data = await docDiff.diffDocumentVersions(req.params.id, req.params.slug, fromVersion, toVersion);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * 2026-05-22 backfill (Pankaj report): walks every open enrollment
 * and runs the completion-gate check. Catches historical rows stuck
 * "in_progress" before the submitQuizAttempt fix landed. Idempotent.
 */
export async function recheckOpenEnrollmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await enrollmentAdmin.recheckOpenEnrollments(req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
