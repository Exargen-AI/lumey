import api from './client';
import type { SignDocumentResult } from '@exargen/shared';
import type { DocumentDiff } from './adminCourses';

export async function signDocument(
  enrollmentId: string,
  documentSlug: string,
  payload: { typedName: string; password: string },
): Promise<SignDocumentResult> {
  const { data } = await api.post(`/enrollments/${enrollmentId}/sign/${documentSlug}`, payload);
  return data.data;
}

// Learner-side: "what changed since I last signed?" Returns null when there's
// no prior signature on this document for this user.
export async function getMyDocumentDiff(
  enrollmentId: string,
  documentSlug: string,
): Promise<DocumentDiff | null> {
  const { data } = await api.get(`/enrollments/${enrollmentId}/sign/${documentSlug}/diff`);
  return data.data;
}
