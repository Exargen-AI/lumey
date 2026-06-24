import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as coursesApi from '@/api/adminCourses';
import * as enrollmentsApi from '@/api/adminEnrollments';

// ─── Courses (admin) ───

export function useAdminCourses() {
  return useQuery({
    queryKey: ['admin-courses'],
    queryFn: coursesApi.listAdminCourses,
  });
}

export function useAdminCourse(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-course', id],
    queryFn: () => coursesApi.getAdminCourse(id!),
    enabled: !!id,
  });
}

export function useUpdateCourseDocumentBody(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentId: string; bodyText: string }) =>
      coursesApi.updateCourseDocumentBody(courseId, input.documentId, input.bodyText),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-course', courseId] });
      qc.invalidateQueries({ queryKey: ['admin-courses'] });
      qc.invalidateQueries({ queryKey: ['admin-enrollments'] });
    },
  });
}

export function useBumpCourseVersion(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (note?: string) => coursesApi.bumpCourseVersion(courseId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-course', courseId] });
      qc.invalidateQueries({ queryKey: ['admin-courses'] });
    },
  });
}

// ─── Enrollments (admin) ───

export function useAdminEnrollments(filters: { courseId?: string; status?: string }) {
  return useQuery({
    queryKey: ['admin-enrollments', filters],
    queryFn: () => enrollmentsApi.listAdminEnrollments(filters),
  });
}

export function useCourseStats(courseId: string | undefined) {
  return useQuery({
    queryKey: ['course-stats', courseId],
    queryFn: () => enrollmentsApi.getCourseStats(courseId!),
    enabled: !!courseId,
  });
}

export function useUserOnboardingForensics(userId: string | undefined) {
  return useQuery({
    queryKey: ['user-onboarding', userId],
    queryFn: () => enrollmentsApi.getUserOnboardingForensics(userId!),
    enabled: !!userId,
  });
}

// ─── Phase 3 ───

export function useRunAnnualExpiry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: coursesApi.runAnnualExpiry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-enrollments'] });
      qc.invalidateQueries({ queryKey: ['admin-courses'] });
    },
  });
}

/**
 * 2026-05-22 backfill: re-run the enrollment-completion check across
 * every still-open enrollment. Fixes the historical "stuck in_progress"
 * bug where users who quizzed AFTER signing got their enrollment
 * stranded with both gates satisfied but `completedAt` never set.
 */
export function useRecheckOpenEnrollments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: coursesApi.recheckOpenEnrollments,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-enrollments'] });
      qc.invalidateQueries({ queryKey: ['admin-courses'] });
    },
  });
}

export function useForceExpireCourse(courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => coursesApi.forceExpireCourse(courseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-enrollments'] });
      qc.invalidateQueries({ queryKey: ['admin-course', courseId] });
      qc.invalidateQueries({ queryKey: ['course-stats', courseId] });
    },
  });
}

export function useSendReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enrollmentId: string) => enrollmentsApi.sendEnrollmentReminder(enrollmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-enrollments'] });
    },
  });
}

export function useDocumentDiff(
  courseId: string | undefined,
  slug: string | undefined,
  fromVersion: number | null,
  toVersion: number | null,
) {
  return useQuery({
    queryKey: ['document-diff', courseId, slug, fromVersion, toVersion],
    queryFn: () => coursesApi.getDocumentDiff(courseId!, slug!, fromVersion!, toVersion!),
    enabled: !!courseId && !!slug && fromVersion !== null && toVersion !== null && fromVersion !== toVersion,
  });
}
