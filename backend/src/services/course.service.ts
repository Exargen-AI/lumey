import { CourseStatus, Prisma, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { LIST_QUERY_CAP } from '../constants/listLimits';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';

// Shape returned to learners. Crucially does NOT include the `isCorrect` flag
// on quiz options — that would let a malicious user inspect the network response
// and cheat. The `gradeQuiz` step on the server uses the stored DB rows.
export interface LearnerCourseView {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  version: number;
  passingScore: number;
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
        // Options without isCorrect — sanitized for the client.
        options: Array<{ id: string; label: string }>;
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

// ─── Mandatory-course discovery ───

/**
 * Returns every PUBLISHED + isMandatoryOnHire course whose `applicableRoles`
 * includes the given role. Used by:
 *  - `user.service.createUser` to auto-enroll new hires
 *  - `auth.service.getUserProfile` to compute `pendingMandatoryEnrollments`
 *  - the OnboardingGate to know what to render
 */
export async function getMandatoryCoursesForRole(role: UserRole) {
  return prisma.course.findMany({
    where: {
      status: CourseStatus.PUBLISHED,
      isMandatoryOnHire: true,
      applicableRoles: { has: role },
    },
    select: {
      id: true,
      slug: true,
      title: true,
      version: true,
      passingScore: true,
    },
    orderBy: { createdAt: 'asc' },
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: LIST_QUERY_CAP,
  });
}

// ─── Read APIs for the learner UI ───

export async function getCourseBySlugForLearner(slug: string): Promise<LearnerCourseView> {
  const course = await prisma.course.findUnique({
    where: { slug },
    include: {
      modules: {
        orderBy: { order: 'asc' },
        include: {
          quiz: { include: { questions: { orderBy: { order: 'asc' } } } },
        },
      },
      documents: { orderBy: { order: 'asc' } },
    },
  });
  if (!course) throw new NotFoundError('Course');
  if (course.status !== CourseStatus.PUBLISHED) {
    throw new NotFoundError('Course');
  }

  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    description: course.description,
    version: course.version,
    passingScore: course.passingScore,
    modules: course.modules.map((m) => ({
      id: m.id,
      order: m.order,
      title: m.title,
      contentBlocks: m.contentBlocks,
      estimatedMinutes: m.estimatedMinutes,
      quiz: m.quiz
        ? {
            id: m.quiz.id,
            passingScore: m.quiz.passingScore,
            allowRetry: m.quiz.allowRetry,
            questions: m.quiz.questions.map((q) => ({
              id: q.id,
              order: q.order,
              prompt: q.prompt,
              type: q.type,
              // Strip isCorrect so the client cannot cheat.
              options: sanitizeOptions(q.options),
            })),
          }
        : null,
    })),
    documents: course.documents.map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      bodyText: d.bodyText,
      version: d.version,
      order: d.order,
    })),
  };
}

function sanitizeOptions(options: unknown): Array<{ id: string; label: string }> {
  if (!Array.isArray(options)) return [];
  return options
    .filter((o): o is { id: string; label: string } =>
      typeof o === 'object' && o !== null && typeof (o as any).id === 'string' && typeof (o as any).label === 'string',
    )
    .map((o) => ({ id: o.id, label: o.label }));
}

// ─── Admin authoring (minimal — full editor UI lands in Phase 2) ───

export interface CreateCourseInput {
  slug: string;
  title: string;
  description?: string | null;
  version?: number;
  isMandatoryOnHire?: boolean;
  passingScore?: number;
  acknowledgmentValidityDays?: number | null;
  applicableRoles: UserRole[];
  status?: CourseStatus;
  modules: Array<{
    order: number;
    title: string;
    contentBlocks: unknown;
    estimatedMinutes?: number | null;
    quiz?: {
      passingScore?: number;
      allowRetry?: boolean;
      questions: Array<{
        order: number;
        prompt: string;
        type?: 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SCENARIO';
        // The full option shape including isCorrect — only the server ever sees this.
        options: Array<{ id: string; label: string; isCorrect: boolean }>;
        explanation?: string | null;
      }>;
    };
  }>;
  documents: Array<{
    slug: string;
    title: string;
    bodyText: string;
    version?: number;
    order: number;
  }>;
}

/**
 * Creates a course with all nested modules, quizzes, questions, and documents
 * in a single transaction. If the slug already exists, throws ValidationError.
 * Used by the seed script and (later) by the admin authoring UI.
 */
export async function createCourse(input: CreateCourseInput, actorUserId?: string) {
  const existing = await prisma.course.findUnique({ where: { slug: input.slug } });
  if (existing) {
    throw new ValidationError(`Course with slug "${input.slug}" already exists`);
  }

  const course = await prisma.$transaction(async (tx) => {
    const created = await tx.course.create({
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description ?? null,
        version: input.version ?? 1,
        isMandatoryOnHire: input.isMandatoryOnHire ?? false,
        passingScore: input.passingScore ?? 80,
        acknowledgmentValidityDays: input.acknowledgmentValidityDays ?? null,
        applicableRoles: input.applicableRoles,
        status: input.status ?? CourseStatus.DRAFT,
        publishedAt: input.status === CourseStatus.PUBLISHED ? new Date() : null,
      },
    });

    for (const m of input.modules) {
      const mod = await tx.courseModule.create({
        data: {
          courseId: created.id,
          order: m.order,
          title: m.title,
          contentBlocks: m.contentBlocks as Prisma.InputJsonValue,
          estimatedMinutes: m.estimatedMinutes ?? null,
        },
      });
      if (m.quiz) {
        const quiz = await tx.quiz.create({
          data: {
            moduleId: mod.id,
            passingScore: m.quiz.passingScore ?? 80,
            allowRetry: m.quiz.allowRetry ?? true,
          },
        });
        for (const q of m.quiz.questions) {
          await tx.quizQuestion.create({
            data: {
              quizId: quiz.id,
              order: q.order,
              prompt: q.prompt,
              type: q.type ?? 'MULTIPLE_CHOICE',
              options: q.options as unknown as Prisma.InputJsonValue,
              explanation: q.explanation ?? null,
            },
          });
        }
      }
    }

    for (const d of input.documents) {
      await tx.courseDocument.create({
        data: {
          courseId: created.id,
          slug: d.slug,
          title: d.title,
          bodyText: d.bodyText,
          version: d.version ?? 1,
          order: d.order,
        },
      });
    }

    return created;
  });

  if (actorUserId) {
    await logActivity({
      userId: actorUserId,
      action: 'course_created',
      targetType: 'course',
      targetId: course.id,
      details: { slug: course.slug, title: course.title, version: course.version },
    });
  }

  return course;
}

// ─── Internal helpers used by enrollment.service and signing.service ───

export async function getCourseDocumentForGrading(courseId: string, slug: string) {
  const doc = await prisma.courseDocument.findUnique({
    where: { courseId_slug: { courseId, slug } },
  });
  if (!doc) throw new NotFoundError('Course document');
  return doc;
}

/**
 * Server-side authoritative grading. Reads stored options (including isCorrect)
 * from the DB, NEVER from client input. Returns score percent (0..100) and a
 * normalized answers payload safe to persist into QuizAttempt.answers.
 */
export interface SubmittedAnswer {
  questionId: string;
  selectedOptionIds: string[];
}

export interface GradedAnswer {
  questionId: string;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  correct: boolean;
}

export async function gradeQuizSubmission(
  quizId: string,
  submitted: SubmittedAnswer[],
): Promise<{ scorePercent: number; passed: boolean; answers: GradedAnswer[]; passingScore: number }> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: true },
  });
  if (!quiz) throw new NotFoundError('Quiz');

  if (quiz.questions.length === 0) {
    return { scorePercent: 100, passed: true, answers: [], passingScore: quiz.passingScore };
  }

  const submittedByQ = new Map(submitted.map((a) => [a.questionId, a.selectedOptionIds]));

  const answers: GradedAnswer[] = quiz.questions.map((q) => {
    const submittedIds = submittedByQ.get(q.id) ?? [];
    const correctIds = extractCorrectOptionIds(q.options);
    const correct = setEquals(new Set(submittedIds), new Set(correctIds));
    return {
      questionId: q.id,
      selectedOptionIds: submittedIds,
      correctOptionIds: correctIds,
      correct,
    };
  });

  const correctCount = answers.filter((a) => a.correct).length;
  const scorePercent = Math.round((correctCount / quiz.questions.length) * 100);
  const passed = scorePercent >= quiz.passingScore;

  return { scorePercent, passed, answers, passingScore: quiz.passingScore };
}

function extractCorrectOptionIds(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options
    .filter((o): o is { id: string; isCorrect: boolean } =>
      typeof o === 'object' &&
      o !== null &&
      typeof (o as any).id === 'string' &&
      (o as any).isCorrect === true,
    )
    .map((o) => o.id);
}

function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
