import api from './client';

export interface AdminCourseListItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  version: number;
  isMandatoryOnHire: boolean;
  passingScore: number;
  acknowledgmentValidityDays: number | null;
  applicableRoles: string[];
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    modules: number;
    documents: number;
    totalEnrollments: number;
    completed: number;
    declined: number;
    inProgress: number;
  };
}

export interface AdminCourseDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  version: number;
  isMandatoryOnHire: boolean;
  passingScore: number;
  applicableRoles: string[];
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  modules: Array<{
    id: string;
    order: number;
    title: string;
    contentBlocks: unknown;
    estimatedMinutes: number | null;
    quiz: {
      id: string;
      passingScore: number;
      allowRetry: boolean;
      questions: Array<{
        id: string;
        order: number;
        prompt: string;
        type: string;
        // Admin sees full options including isCorrect.
        options: Array<{ id: string; label: string; isCorrect: boolean }>;
        explanation: string | null;
      }>;
    } | null;
  }>;
  documents: Array<{
    id: string;
    slug: string;
    title: string;
    bodyText: string;
    version: number;
    order: number;
  }>;
}

export async function listAdminCourses(): Promise<AdminCourseListItem[]> {
  const { data } = await api.get('/admin/courses');
  return data.data;
}

export async function getAdminCourse(id: string): Promise<AdminCourseDetail> {
  const { data } = await api.get(`/admin/courses/${id}`);
  return data.data;
}

export async function updateCourseDocumentBody(
  courseId: string,
  documentId: string,
  bodyText: string,
) {
  const { data } = await api.patch(`/admin/courses/${courseId}/documents/${documentId}`, { bodyText });
  return data.data as { document: { id: string; version: number; slug: string }; course: { id: string; version: number } };
}

export async function bumpCourseVersion(courseId: string, note?: string) {
  const { data } = await api.post(`/admin/courses/${courseId}/bump-version`, { note });
  return data.data as { id: string; version: number };
}

export interface ExpiryResult {
  scanned: number;
  refreshed: number;
  refreshedUserIds: string[];
}

export async function runAnnualExpiry(): Promise<ExpiryResult> {
  const { data } = await api.post('/admin/onboarding/expire-stale');
  return data.data;
}

export interface RecheckOpenResult {
  scanned: number;
  completed: number;
}

/**
 * 2026-05-22 backfill: sweep every open enrollment and re-run the
 * completion-gate check. Catches historical enrollments stuck
 * "in_progress" before the submitQuizAttempt fix landed.
 */
export async function recheckOpenEnrollments(): Promise<RecheckOpenResult> {
  const { data } = await api.post('/admin/onboarding/recheck-open');
  return data.data;
}

export async function forceExpireCourse(courseId: string): Promise<ExpiryResult> {
  const { data } = await api.post(`/admin/courses/${courseId}/force-expire`);
  return data.data;
}

export interface DiffSegment {
  type: 'unchanged' | 'removed' | 'added';
  text: string;
}

export interface DocumentDiff {
  fromVersion: number;
  toVersion: number;
  fromText: string | null;
  toText: string | null;
  segments: DiffSegment[];
}

export async function getDocumentDiff(
  courseId: string,
  slug: string,
  fromVersion: number,
  toVersion: number,
): Promise<DocumentDiff> {
  const { data } = await api.get(`/admin/courses/${courseId}/documents/${slug}/diff`, {
    params: { from: fromVersion, to: toVersion },
  });
  return data.data;
}
