import { z } from 'zod';

// Same year-window guard we apply on Project/Task. Sprints further get a
// max-length guard: a sprint of more than 90 days is almost always a typo
// (the burnup chart is capped at 60 days anyway, so anything past that is
// just confusing — see QA finding #37).
const MIN_DATE = new Date('1990-01-01T00:00:00Z').getTime();
const MAX_DATE = new Date('2100-12-31T23:59:59Z').getTime();
const MAX_SPRINT_DAYS = 90;

const sprintDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Invalid date format (YYYY-MM-DD)').refine((value) => {
  const t = Date.parse(value);
  return !Number.isNaN(t) && t >= MIN_DATE && t <= MAX_DATE;
}, 'Date out of range (1990–2100)');

export const createSprintSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Sprint name is required').max(100),
    goal: z.string().max(1000).optional(),
    startDate: sprintDate,
    endDate: sprintDate,
  })
    .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
      message: 'End date must be after start date',
      path: ['endDate'],
    })
    .refine((data) => {
      const days = (new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / 86_400_000;
      return days <= MAX_SPRINT_DAYS;
    }, { message: `Sprint cannot exceed ${MAX_SPRINT_DAYS} days`, path: ['endDate'] }),
});

export const updateSprintSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    goal: z.string().max(1000).nullable().optional(),
    startDate: sprintDate.optional(),
    endDate: sprintDate.optional(),
    retroNotes: z.any().optional(),
    // 2026-05-21 optimistic-locking expansion. See milestone.schema for
    // the full rationale. Opt-in: callers that don't send this still get
    // last-write-wins behavior.
    expectedUpdatedAt: z
      .string()
      .datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' })
      .optional(),
  })
    // Length guard only fires when both dates are present in this update —
    // we don't want to reject a one-field tweak just because the existing
    // pair would now be out of range. Service-level check covers that case.
    .refine((data) => {
      if (!data.startDate || !data.endDate) return true;
      if (new Date(data.endDate) <= new Date(data.startDate)) return false;
      const days = (new Date(data.endDate).getTime() - new Date(data.startDate).getTime()) / 86_400_000;
      return days <= MAX_SPRINT_DAYS;
    }, { message: `Sprint dates must be valid and within ${MAX_SPRINT_DAYS} days`, path: ['endDate'] }),
});

export const completeSprintSchema = z.object({
  body: z.object({
    // Legacy boolean — still accepted to avoid breaking older clients.
    moveToBacklog: z.boolean().optional(),
    retro: z.object({
      wentWell: z.string().max(5000).optional(),
      didntGoWell: z.string().max(5000).optional(),
      actionItems: z.string().max(5000).optional(),
    }).optional(),
    carryOver: z.enum(['all', 'none', 'selected']).optional(),
    carryOverTaskIds: z.array(z.string().uuid()).max(500).optional(),
    carryOverToSprintId: z.string().uuid().nullable().optional(),
  }).strict(),
});

export const createEpicSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Epic title is required').max(200),
    description: z.string().max(5000).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color').optional(),
  }),
});

export const updateEpicSchema = z.object({
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE']).optional(),
  }),
});

export const assignTaskToSprintSchema = z.object({
  body: z.object({
    sprintId: z.string().uuid().nullable(),
  }),
});
