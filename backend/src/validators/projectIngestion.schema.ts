import { z } from 'zod';
import { TaskPriority, TaskType } from '@prisma/client';

const checklistItemSchema = z.object({
  id: z.string().optional(),
  text: z.string().min(1).max(500),
  done: z.boolean(),
});

const taskSchema = z.object({
  hash: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).nullable(),
  priority: z.nativeEnum(TaskPriority),
  storyPoints: z.number().int().min(1).max(100).nullable(),
  taskType: z.nativeEnum(TaskType),
  assigneeName: z.string().max(254).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  labels: z.array(z.string().max(50)).max(20),
  acceptanceCriteria: z.array(checklistItemSchema).max(50),
  subtasks: z.array(checklistItemSchema).max(50),
});

// QA I-H1: a hand-crafted commit body could bypass the parser's
// startDate/endDate sanity check; the zod schema accepted any
// `YYYY-MM-DD → YYYY-MM-DD` pair including inverted ranges. The
// `.refine()` here makes the API itself reject them.
const sprintSchema = z.object({
  hash: z.string(),
  name: z.string().min(1).max(120),
  goal: z.string().max(2_000).nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tasks: z.array(taskSchema).max(500),
}).refine(
  (s) => new Date(`${s.endDate}T00:00:00Z`).getTime() >= new Date(`${s.startDate}T00:00:00Z`).getTime(),
  { message: 'Sprint endDate must be on or after startDate', path: ['endDate'] },
);

const epicSchema = z.object({
  hash: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5_000).nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  sprints: z.array(sprintSchema).max(50),
  backlogTasks: z.array(taskSchema).max(500),
});

export const parsedPlanSchema = z.object({
  projectName: z.string().max(200).nullable(),
  projectDescription: z.string().max(10_000).nullable(),
  epics: z.array(epicSchema).max(100),
  rootBacklogTasks: z.array(taskSchema).max(500),
  warnings: z.array(z.string().max(500)).max(500),
});

export const parsePlanSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    // 500KB cap matches the parser's own DoS guard.
    markdown: z.string().min(1).max(500_000),
    // 'regex' is the default deterministic parser; 'llm' invokes Smart
    // Parse (Claude Haiku 4.5 by default). Validated here so a typo
    // ('lim') doesn't silently fall through to regex.
    mode: z.enum(['regex', 'llm']).optional(),
  }),
});

export const commitPlanSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    plan: parsedPlanSchema,
    updateProjectMeta: z.boolean().optional().default(false),
  }),
});
