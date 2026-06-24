import { z } from 'zod';
import { LeaveStatus, LeaveType } from '@prisma/client';

// YYYY-MM-DD only — keeps the wire format honest. Full ISO datetimes would
// invite "what timezone is 2026-03-04T19:00:00.000Z" debates we don't need.
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const applyLeaveSchema = z.object({
  body: z.object({
    startDate: dateString,
    endDate: dateString,
    leaveType: z.nativeEnum(LeaveType).default(LeaveType.CASUAL),
    // 2000-char cap matches blockerNote etc. Reasons for sick leave can be
    // long ("doctor said X, follow-up Tuesday, expecting Y"). Optional —
    // some leave types are self-explanatory (BEREAVEMENT, WEDDING).
    reason: z.string().max(2_000).optional().nullable(),
  }),
});

export const decideLeaveSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    decisionNote: z.string().max(2_000).optional().nullable(),
  }).optional().default({}),
});

export const leaveIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid leave id') }),
});

export const listAllLeavesSchema = z.object({
  query: z.object({
    status: z.nativeEnum(LeaveStatus).optional(),
  }),
});
