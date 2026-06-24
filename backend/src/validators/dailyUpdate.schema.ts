import { z } from 'zod';
import { Mood, TaskStatus } from '@prisma/client';

// Cap free-text + bound the tasks array. Without these, a 10K-task EOD
// payload locked rows + ran an N-statement transaction (QA finding #22).
// Reasonable EOD has at most a handful of touched tasks; 50 is generous.
const FREE_TEXT_MAX = 5_000;

export const submitDailyUpdateSchema = z.object({
  body: z.object({
    summary: z.string().min(1, 'Summary is required').max(FREE_TEXT_MAX),
    mood: z.nativeEnum(Mood).optional(),
    blockers: z.string().max(FREE_TEXT_MAX).nullable().optional(),
    plans: z.string().max(FREE_TEXT_MAX).nullable().optional(),
    // 0–24 to match a single day. Negative or > 24 is always a typo.
    hoursWorked: z.number().min(0).max(24).nullable().optional(),
    tasks: z.array(z.object({
      taskId: z.string().uuid(),
      note: z.string().max(2000).optional(),
      statusBefore: z.nativeEnum(TaskStatus),
      statusAfter: z.nativeEnum(TaskStatus),
    })).max(50).optional(),
  }),
});

export const teamDailyUpdatesQuerySchema = z.object({
  query: z.object({
    // Optional explicit date pin. If absent, the team feed shows "today" in
    // server-local time. Strict YYYY-MM-DD avoids feeding NaN dates into the
    // query (would have surfaced as 500 before — see service:289).
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
});
