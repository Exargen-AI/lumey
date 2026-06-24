import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as coursesApi from '@/api/courses';
import * as enrollmentsApi from '@/api/enrollments';
import * as signingApi from '@/api/signing';
import { useAuthStore } from '@/stores/authStore';

export function useMyEnrollments() {
  return useQuery({
    queryKey: ['my-enrollments'],
    queryFn: enrollmentsApi.getMyEnrollments,
    refetchOnWindowFocus: true,
  });
}

export function useCourse(slug: string | undefined) {
  return useQuery({
    queryKey: ['course', slug],
    queryFn: () => coursesApi.getCourseBySlug(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEnrollment(enrollmentId: string | undefined) {
  return useQuery({
    queryKey: ['enrollment', enrollmentId],
    queryFn: () => enrollmentsApi.getEnrollment(enrollmentId!),
    enabled: !!enrollmentId,
    // Refetch when the user re-focuses the tab — they may have completed
    // something in another tab.
    refetchOnWindowFocus: true,
  });
}

export function useRecordModuleProgress(enrollmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { moduleId: string; scrolledToBottom?: boolean; timeOnPageSec?: number }) =>
      enrollmentsApi.recordModuleProgress(enrollmentId, input.moduleId, {
        scrolledToBottom: input.scrolledToBottom,
        timeOnPageSec: input.timeOnPageSec,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollment', enrollmentId] });
    },
  });
}

export function useSubmitQuizAttempt(enrollmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { quizId: string; answers: Array<{ questionId: string; selectedOptionIds: string[] }> }) =>
      enrollmentsApi.submitQuizAttempt(enrollmentId, input.quizId, { answers: input.answers }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollment', enrollmentId] });
    },
  });
}

export function useSignDocument(enrollmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { documentSlug: string; typedName: string; password: string }) =>
      signingApi.signDocument(enrollmentId, input.documentSlug, {
        typedName: input.typedName,
        password: input.password,
      }),
    // Await invalidation so mutateAsync resolves only after the enrollment
    // cache has the new signature. Without the await there's a window where
    // the next render still sees stale data — the SigningCeremony then shows
    // the just-signed document a second time before the refetch lands, which
    // can read as "stuck on the same screen."
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['enrollment', enrollmentId] });
    },
  });
}

export function useSetLegalName(enrollmentId: string) {
  const setUserLegalName = useAuthStore((s) => s.setUserLegalName);
  return useMutation({
    mutationFn: (typedName: string) =>
      enrollmentsApi.setEnrollmentLegalName(enrollmentId, typedName),
    // The mutation result is the authoritative legalName the server stored.
    // Push it straight into the auth store so the gate renders SigningCeremony
    // on the next render — no /me round-trip needed.
    onSuccess: (result) => {
      setUserLegalName(result.legalName);
    },
  });
}

export function useDeclineEnrollment(enrollmentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => enrollmentsApi.declineEnrollment(enrollmentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollment', enrollmentId] });
    },
  });
}
