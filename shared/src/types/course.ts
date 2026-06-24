// Compliance / onboarding course types — shared between backend and frontend.

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type QuestionType = 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SCENARIO';

// What the learner sees for an option. The `isCorrect` flag is stripped from
// API responses to prevent cheating; only the server has it.
export interface QuestionOptionView {
  id: string;
  label: string;
}

export interface QuizQuestionView {
  id: string;
  order: number;
  prompt: string;
  type: QuestionType;
  options: QuestionOptionView[];
}

export interface QuizView {
  id: string;
  passingScore: number;
  allowRetry: boolean;
  questions: QuizQuestionView[];
}

export interface CourseModuleView {
  id: string;
  order: number;
  title: string;
  contentBlocks: unknown; // Same shape as CmsContentBlock[]; UI renders via the block renderer.
  estimatedMinutes: number | null;
  quiz: QuizView | null;
}

export interface CourseDocumentView {
  id: string;
  slug: string;
  title: string;
  bodyText: string;
  version: number;
  order: number;
}

export interface CourseView {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  version: number;
  passingScore: number;
  modules: CourseModuleView[];
  documents: CourseDocumentView[];
}

// Returned by /auth/me alongside user + permissions; used by OnboardingGate to
// decide whether to block platform access.
export interface PendingMandatoryEnrollment {
  enrollmentId: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  courseVersion: number;
}

export interface ModuleProgressView {
  id: string;
  enrollmentId: string;
  moduleId: string;
  startedAt: string;
  completedAt: string | null;
  scrolledToBottom: boolean;
  timeOnPageSec: number;
  quizPassed: boolean;
}

export interface SignatureSummary {
  id: string;
  courseDocumentId: string;
  documentVersion: number;
  signedAt: string;
  signedName: string;
}

export interface QuizAttemptSummary {
  id: string;
  enrollmentId: string;
  quizId: string;
  attemptNumber: number;
  startedAt: string;
  submittedAt: string | null;
  scorePercent: number | null;
  passed: boolean;
}

export interface EnrollmentDetail {
  id: string;
  userId: string;
  courseId: string;
  courseVersion: number;
  enrolledAt: string;
  completedAt: string | null;
  declinedAt: string | null;
  course: { id: string; slug: string; title: string; version: number; passingScore: number };
  moduleProgress: ModuleProgressView[];
  quizAttempts: QuizAttemptSummary[];
  signatures: SignatureSummary[];
}

export interface QuizSubmitResult {
  attemptId: string;
  attemptNumber: number;
  scorePercent: number;
  passed: boolean;
  passingScore: number;
  perQuestion: Array<{ questionId: string; correct: boolean }>;
}

export interface SignDocumentResult {
  id: string;
  signedAt: string;
  signedName: string;
  documentVersion: number;
  alreadySigned: boolean;
}
