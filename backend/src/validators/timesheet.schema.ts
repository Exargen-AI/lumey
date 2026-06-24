import { z } from 'zod';

// Date guard: YYYY-MM-DD only, plus a sane window. Without this, the service
// previously parsed `new Date(input.date)` against arbitrary strings — year
// 9999, year -1, even invalid forms — and surfaced cryptic Prisma errors
// (QA findings #20, #21).
const MIN_DATE = new Date('1990-01-01').getTime();
const MAX_DATE = new Date('2100-12-31').getTime();

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').refine((v) => {
  const t = Date.parse(v + 'T00:00:00Z');
  return !Number.isNaN(t) && t >= MIN_DATE && t <= MAX_DATE;
}, 'Date out of range (1990–2100)');

// Time-entry hours bounded at the schema layer too (service still verifies,
// but rejecting at the edge avoids a service round-trip).
const hours = z.number().min(0, 'Hours must be ≥ 0').max(24, 'Hours must be ≤ 24');

const entryShape = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  date: dateOnly,
  hours,
  // Notes are visible in time reports — cap at a reasonable single-message length.
  notes: z.string().max(500).optional(),
});

export const logTimeSchema = z.object({
  body: entryShape,
});

export const bulkLogTimeSchema = z.object({
  // 50 entries matches the existing handler's manual cap. With a Zod schema
  // the cap is now enforced uniformly with the same error shape.
  body: z.object({
    entries: z.array(entryShape).min(1).max(50),
  }),
});

export const submitTimesheetSchema = z.object({
  body: z.object({
    // Restrict to within the last 12 weeks — submitting timesheets for
    // arbitrarily old weeks rewrites historical records and bypasses
    // approval workflows on closed periods.
    weekStart: dateOnly.refine((v) => {
      const t = Date.parse(v + 'T00:00:00Z');
      const cutoff = Date.now() - 12 * 7 * 86_400_000;
      return t >= cutoff && t <= Date.now() + 14 * 86_400_000;
    }, 'weekStart must be within the last 12 weeks'),
  }),
});

export const reopenTimesheetSchema = z.object({
  body: z.object({
    weekStart: dateOnly,
  }),
});

export const rejectTimesheetSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().max(1000).optional(),
  }),
});

export const weeklyTimesheetQuerySchema = z.object({
  query: z.object({ weekStart: dateOnly.optional() }),
});

// Approval list query: optional `status` for the tabs (Pending / Approved /
// Rejected / All). Default is SUBMITTED so the existing queue behaviour is
// preserved for any caller that doesn't pass the param.
export const listApprovalsQuerySchema = z.object({
  query: z.object({
    status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'ALL']).optional(),
  }),
});
