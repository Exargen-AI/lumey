import { z } from 'zod';
import { MilestoneStatus } from '@prisma/client';

const dateOnlyOrDateTime = z.string().refine((value) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  return !Number.isNaN(Date.parse(value));
}, 'Invalid date format');

export const createMilestoneSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1).max(200),
    description: z.string().optional(),
    date: dateOnlyOrDateTime,
    status: z.nativeEnum(MilestoneStatus).default(MilestoneStatus.UPCOMING),
    clientVisible: z.boolean().default(true),
  }),
});

export const updateMilestoneSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().nullable().optional(),
    date: dateOnlyOrDateTime.optional(),
    status: z.nativeEnum(MilestoneStatus).optional(),
    clientVisible: z.boolean().optional(),
    // 2026-05-21 optimistic-locking expansion (matches Task pattern from
    // PR #128). ISO timestamp of the row's updatedAt as the caller last
    // saw it. If present and stale, the service rejects with 409 instead
    // of silently overwriting a concurrent edit. OPT-IN: callers that
    // don't send it preserve last-write-wins behavior.
    expectedUpdatedAt: z
      .string()
      .datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' })
      .optional(),
  }),
});
