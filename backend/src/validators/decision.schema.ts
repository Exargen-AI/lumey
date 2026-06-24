import { z } from 'zod';
import { DecisionStatus } from '@prisma/client';

// 50K cap on rationale + alternatives — these can legitimately be longer
// than a task description (architectural reasoning, prior-art notes), but
// 50K is still ~5 dense pages, well below DoS territory.
export const createDecisionSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1).max(300),
    rationale: z.string().min(1).max(50_000),
    alternatives: z.string().max(50_000).optional(),
    status: z.nativeEnum(DecisionStatus).default(DecisionStatus.PROPOSED),
    tags: z.array(z.string().max(50)).max(20).optional().default([]),
  }),
});

export const updateDecisionSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title: z.string().min(1).max(300).optional(),
    rationale: z.string().max(50_000).optional(),
    alternatives: z.string().max(50_000).nullable().optional(),
    status: z.nativeEnum(DecisionStatus).optional(),
    tags: z.array(z.string().max(50)).max(20).optional(),
  }),
});
