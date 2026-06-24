import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import * as service from '../services/enrollment.service';
import { streamEnrollmentReceipt } from '../services/pdfReceipt.service';
import { captureIp, captureUserAgent } from '../utils/request';
import { ForbiddenError, NotFoundError } from '../utils/errors';

export async function listMyEnrollmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const [active, completed] = await Promise.all([
      service.listMyActiveEnrollments(req.user!.id),
      service.listMyCompletedEnrollments(req.user!.id),
    ]);
    res.json({ success: true, data: { active, completed } });
  } catch (err) { next(err); }
}

export async function getMyEnrollmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const enrollment = await service.getEnrollmentForUser(req.params.id, req.user!.id);
    res.json({ success: true, data: enrollment });
  } catch (err) { next(err); }
}

export async function moduleProgressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const progress = await service.recordModuleProgress(
      req.params.id,
      req.user!.id,
      req.params.moduleId,
      {
        scrolledToBottom: req.body?.scrolledToBottom === true,
        timeOnPageSec: typeof req.body?.timeOnPageSec === 'number' ? req.body.timeOnPageSec : undefined,
      },
    );
    res.json({ success: true, data: progress });
  } catch (err) { next(err); }
}

export async function submitQuizAttemptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const result = await service.submitQuizAttempt(
      req.params.id,
      req.user!.id,
      req.params.quizId,
      answers,
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function setLegalNameHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const typedName = typeof req.body?.legalName === 'string' ? req.body.legalName : '';
    const result = await service.setLegalNameForEnrollment(
      req.params.id,
      req.user!.id,
      typedName,
    );
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function declineHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const enrollment = await service.declineEnrollment(req.params.id, req.user!.id, {
      ipAddress: captureIp(req),
      userAgent: captureUserAgent(req),
    });
    res.json({ success: true, data: enrollment });
  } catch (err) { next(err); }
}

// Learner-side receipt download. Streams the same PDF the admin endpoint
// streams, but with an ownership check so a user can only fetch their own.
// Lets employees download their personal compliance record from the new
// /confidentiality page without elevating to an admin role.
export async function myReceiptHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id: req.params.enrollmentId },
      select: { id: true, userId: true },
    });
    if (!enrollment) throw new NotFoundError('Enrollment');
    if (enrollment.userId !== req.user!.id) throw new ForbiddenError();
    await streamEnrollmentReceipt(req.params.enrollmentId, res);
  } catch (err) { next(err); }
}
