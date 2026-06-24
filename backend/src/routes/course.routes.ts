import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as courseHandler from '../handlers/course.handler';
import * as enrollmentHandler from '../handlers/enrollment.handler';
import * as signingHandler from '../handlers/signing.handler';
import * as adminHandler from '../handlers/courseAdmin.handler';
import { requireRoles } from '../middleware/requireRoles';

const router = Router();
const adminOnly = requireRoles('SUPER_ADMIN', 'ADMIN');
// Signed compliance PDFs include the FULL agreed text of every signed
// document plus IP / user-agent / identity-ritual metadata for every
// signature. Per Pankaj's policy: only SUPER_ADMIN can pull this off the
// server. ADMIN users still see the rest of the compliance UI but cannot
// retrieve the signed artifacts themselves.
const superAdminOnly = requireRoles('SUPER_ADMIN');

// ─── Course content (read-only, learner) ───
router.get('/courses/:slug', authenticate, courseHandler.getCourseBySlugHandler);

// ─── My enrollments ───
router.get('/enrollments/me', authenticate, enrollmentHandler.listMyEnrollmentsHandler);
router.get('/enrollments/:id', authenticate, enrollmentHandler.getMyEnrollmentHandler);

// Module heartbeat (scroll, time-on-page anti-skim signals).
router.post('/enrollments/:id/modules/:moduleId/progress', authenticate, enrollmentHandler.moduleProgressHandler);

// Quiz submission. Server grades; client can only send selected option ids.
router.post('/enrollments/:id/quizzes/:quizId/attempts', authenticate, enrollmentHandler.submitQuizAttemptHandler);

// One-time legal-name capture. Must complete before any signature is
// accepted (the in-app signing provider fails closed if user.legalName
// is null). See enrollment.service.setLegalNameForEnrollment.
router.post('/enrollments/:id/legal-name', authenticate, enrollmentHandler.setLegalNameHandler);

// Per-document signature (the legally-binding moment).
router.post('/enrollments/:id/sign/:documentSlug', authenticate, signingHandler.signDocumentHandler);

// "What changed since I last signed?" — returns the redline diff between the
// current document version and the user's most recent prior signature.
router.get('/enrollments/:id/sign/:documentSlug/diff', authenticate, signingHandler.getMyDocumentDiffHandler);

// Decline — terminal, captures full forensic context.
router.post('/enrollments/:id/decline', authenticate, enrollmentHandler.declineHandler);

// Learner-side receipt download — same PDF as the admin endpoint, with an
// ownership check so users can only fetch their own.
router.get('/enrollments/:enrollmentId/receipt.pdf', authenticate, enrollmentHandler.myReceiptHandler);

// ─── Admin: course authoring + audit ───
router.get('/admin/courses', authenticate, adminOnly, adminHandler.listCoursesHandler);
router.get('/admin/courses/:id', authenticate, adminOnly, adminHandler.getCourseHandler);
router.patch('/admin/courses/:id/documents/:documentId', authenticate, adminOnly, adminHandler.updateDocumentBodyHandler);
router.post('/admin/courses/:id/bump-version', authenticate, adminOnly, adminHandler.bumpVersionHandler);

// Admin: enrollments dashboard + per-user forensics + PDF receipt
router.get('/admin/enrollments', authenticate, adminOnly, adminHandler.listEnrollmentsHandler);
router.get('/admin/courses/:id/stats', authenticate, adminOnly, adminHandler.courseStatsHandler);
router.get('/admin/users/:userId/onboarding', authenticate, adminOnly, adminHandler.userOnboardingForensicsHandler);
// SUPER_ADMIN ONLY: signed compliance receipt PDF (contains the full agreed
// text + signature audit metadata for every signed document). The route
// guard is tightened to SUPER_ADMIN per Pankaj's policy decision —
// previously this was open to ADMIN as well.
router.get('/admin/enrollments/:enrollmentId/receipt.pdf', authenticate, superAdminOnly, adminHandler.enrollmentReceiptHandler);

// Admin: maintenance + reminders + diff (Phase 3)
router.post('/admin/onboarding/expire-stale', authenticate, adminOnly, adminHandler.expireStaleHandler);
router.post('/admin/courses/:id/force-expire', authenticate, adminOnly, adminHandler.forceExpireCourseHandler);
router.post('/admin/enrollments/:id/remind', authenticate, adminOnly, adminHandler.sendReminderHandler);
// 2026-05-22 backfill (Pankaj bug): sweep open enrollments + run the
// gate-check that the `submitQuizAttempt` path used to skip. Catches
// any historical enrollments stuck "in_progress" despite having
// satisfied all gates. Idempotent — safe to re-run.
router.post('/admin/onboarding/recheck-open', authenticate, adminOnly, adminHandler.recheckOpenEnrollmentsHandler);
router.get('/admin/courses/:id/documents/:slug/diff', authenticate, adminOnly, adminHandler.documentDiffHandler);

export default router;
