import api from './client';
import type { EnrollmentDetail, QuizSubmitResult } from '@exargen/shared';

export async function getMyEnrollments(): Promise<{ active: any[]; completed: any[] }> {
  const { data } = await api.get('/enrollments/me');
  return data.data;
}

export async function getEnrollment(id: string): Promise<EnrollmentDetail> {
  const { data } = await api.get(`/enrollments/${id}`);
  return data.data;
}

export async function recordModuleProgress(
  enrollmentId: string,
  moduleId: string,
  payload: { scrolledToBottom?: boolean; timeOnPageSec?: number },
) {
  const { data } = await api.post(
    `/enrollments/${enrollmentId}/modules/${moduleId}/progress`,
    payload,
  );
  return data.data;
}

export interface SubmitQuizPayload {
  answers: Array<{ questionId: string; selectedOptionIds: string[] }>;
}

export async function submitQuizAttempt(
  enrollmentId: string,
  quizId: string,
  payload: SubmitQuizPayload,
): Promise<QuizSubmitResult> {
  const { data } = await api.post(
    `/enrollments/${enrollmentId}/quizzes/${quizId}/attempts`,
    payload,
  );
  return data.data;
}

export async function declineEnrollment(enrollmentId: string) {
  const { data } = await api.post(`/enrollments/${enrollmentId}/decline`);
  return data.data;
}

// Learner-side: download my own enrollment's PDF receipt. Same artifact the
// admin endpoint produces; the route enforces ownership server-side.
export async function downloadMyEnrollmentReceipt(enrollmentId: string, suggestedName?: string) {
  const response = await api.get(`/enrollments/${enrollmentId}/receipt.pdf`, {
    responseType: 'blob',
  });

  const filename = (() => {
    const cd = response.headers?.['content-disposition'];
    if (typeof cd === 'string') {
      const m = /filename="?([^"]+)"?/.exec(cd);
      if (m && m[1]) return m[1];
    }
    return suggestedName ?? `confidentiality-receipt-${enrollmentId}.pdf`;
  })();

  const blob = new Blob([response.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// One-time legal-name capture before the first document signing. The
// backend stores the typed value on `user.legalName` and uses it for
// every subsequent signature comparison. Re-submitting the same name
// is a no-op success; submitting a different name when one is already
// on file is rejected (admin must edit).
export async function setEnrollmentLegalName(
  enrollmentId: string,
  typedName: string,
): Promise<{ legalName: string; action: 'created' | 'unchanged' }> {
  const { data } = await api.post(
    `/enrollments/${enrollmentId}/legal-name`,
    { legalName: typedName },
  );
  return data.data;
}
