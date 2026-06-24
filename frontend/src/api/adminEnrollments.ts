import api from './client';

export interface AdminEnrollmentRow {
  id: string;
  enrolledAt: string;
  completedAt: string | null;
  declinedAt: string | null;
  courseVersion: number;
  currentCourseVersion: number;
  user: { id: string; name: string; email: string; role: string; isActive: boolean };
  course: { id: string; slug: string; title: string };
  counts: { signatures: number; quizAttempts: number };
  /**
   * Per-row completion-gate diagnostic. Mirrors the backend gate check:
   *   - signaturesUnique / requiredDocuments → "is every doc signed?"
   *   - quizzesPassed / requiredQuizzes → "is every module's quiz passed?"
   *   - gateMet → both conditions true. A stuck-in_progress row with
   *     `gateMet: true` is a historical victim of the pre-PR-#144 quiz-
   *     last bug and will auto-flip on the next "Re-check open enrollments".
   *   - latestSignatureAt → the latest historical signing moment, useful
   *     when admin needs to know the real "they finished" timestamp.
   */
  gate: {
    requiredDocuments: number;
    signaturesUnique: number;
    requiredQuizzes: number;
    quizzesPassed: number;
    latestSignatureAt: string | null;
    gateMet: boolean;
  };
  status: 'in_progress' | 'completed' | 'declined' | 'out_of_date';
}

export interface CourseStats {
  course: { id: string; slug: string; title: string; version: number };
  total: number;
  completed: number;
  outOfDate: number;
  declined: number;
  inProgress: number;
  completionPercent: number;
  byRole: Array<{ role: string; total: number; completed: number; completionPercent: number }>;
}

export interface UserOnboardingForensics {
  id: string;
  userId: string;
  courseId: string;
  courseVersion: number;
  enrolledAt: string;
  completedAt: string | null;
  declinedAt: string | null;
  course: { id: string; slug: string; title: string; version: number; isMandatoryOnHire: boolean };
  signatures: Array<{
    id: string;
    courseDocumentId: string;
    documentVersion: number;
    signedAt: string;
    signedName: string;
    signedTextSnapshot: string;
    ipAddress: string | null;
    userAgent: string | null;
    passwordReentered: boolean;
    externalProvider: string | null;
    externalEnvelopeId: string | null;
    externalAuditUrl: string | null;
    courseDocument: { id: string; slug: string; title: string; version: number };
  }>;
  quizAttempts: Array<{
    id: string;
    enrollmentId: string;
    quizId: string;
    attemptNumber: number;
    startedAt: string;
    submittedAt: string | null;
    scorePercent: number | null;
    passed: boolean;
    quiz: { id: string; moduleId: string };
  }>;
  moduleProgress: Array<{
    id: string;
    enrollmentId: string;
    moduleId: string;
    startedAt: string;
    completedAt: string | null;
    scrolledToBottom: boolean;
    timeOnPageSec: number;
    quizPassed: boolean;
    module: { id: string; title: string; order: number };
  }>;
}

export async function sendEnrollmentReminder(enrollmentId: string) {
  const { data } = await api.post(`/admin/enrollments/${enrollmentId}/remind`);
  return data.data as { id: string; sentAt: string };
}

export async function listAdminEnrollments(filters: { courseId?: string; status?: string }): Promise<AdminEnrollmentRow[]> {
  const params: Record<string, string> = {};
  if (filters.courseId) params.courseId = filters.courseId;
  if (filters.status) params.status = filters.status;
  const { data } = await api.get('/admin/enrollments', { params });
  return data.data;
}

export async function getCourseStats(courseId: string): Promise<CourseStats> {
  const { data } = await api.get(`/admin/courses/${courseId}/stats`);
  return data.data;
}

export async function getUserOnboardingForensics(userId: string): Promise<UserOnboardingForensics[]> {
  const { data } = await api.get(`/admin/users/${userId}/onboarding`);
  return data.data;
}

// Fetches the PDF receipt as a blob (so the bearer-token Authorization header
// is attached) and triggers a save dialog by creating an object URL.
export async function downloadEnrollmentReceipt(enrollmentId: string, suggestedName?: string) {
  const response = await api.get(`/admin/enrollments/${enrollmentId}/receipt.pdf`, {
    responseType: 'blob',
  });

  const filename = (() => {
    const cd = response.headers?.['content-disposition'];
    if (typeof cd === 'string') {
      const m = /filename="?([^"]+)"?/.exec(cd);
      if (m && m[1]) return m[1];
    }
    return suggestedName ?? `onboarding-receipt-${enrollmentId}.pdf`;
  })();

  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the blob URL after a tick.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
