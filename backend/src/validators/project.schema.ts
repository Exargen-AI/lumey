import { z } from 'zod';
import { ProjectCategory, ProjectPhase, HealthStatus, UserRole } from '@prisma/client';

// Bound dates to a sane window. Year 9999 / year 1900 used to flow through
// to the DB and break analytics that compute `daysUntil` (QA finding #36).
// Dates outside [1990, 2100] are almost always typos or attacker probes.
const MIN_DATE = new Date('1990-01-01T00:00:00Z').getTime();
const MAX_DATE = new Date('2100-12-31T23:59:59Z').getTime();

const dateOnlyOrDateTime = z.string().refine((value) => {
  // Accept a YYYY-MM-DD short form too — but only if the components are valid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const t = Date.parse(value + 'T00:00:00Z');
    if (Number.isNaN(t)) return false;
    return t >= MIN_DATE && t <= MAX_DATE;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) return false;
  return t >= MIN_DATE && t <= MAX_DATE;
}, 'Invalid or out-of-range date (must be between 1990 and 2100)');

// Ordering invariant: targetDate must come on/after startDate. Applied as a
// schema-level refine so admin/PM can't end-run it via the update path.
function applyDateOrdering<T extends { startDate?: unknown; targetDate?: unknown }>(schema: z.ZodSchema<T>) {
  return schema.refine((data) => {
    const s = (data as any).startDate;
    const t = (data as any).targetDate;
    if (!s || !t) return true;
    return new Date(s).getTime() <= new Date(t).getTime();
  }, { message: 'targetDate must be on or after startDate', path: ['targetDate'] });
}

const createProjectBody = z.object({
  // Cap matches DB-friendly + UI-readable bounds. Cards truncate around 60ch
  // so 100 is comfortable headroom without bloating the row.
  name: z.string().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  // 10K cap — every QA finding #18 free-text DoS lives here.
  description: z.string().max(10_000).optional(),
  clientDescription: z.string().max(10_000).optional(),
  category: z.nativeEnum(ProjectCategory),
  phase: z.nativeEnum(ProjectPhase).default(ProjectPhase.IDEA),
  healthStatus: z.nativeEnum(HealthStatus).default(HealthStatus.GREEN),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  startDate: dateOnlyOrDateTime.optional(),
  targetDate: dateOnlyOrDateTime.optional(),
  memberIds: z.array(z.object({
    userId: z.string().uuid(),
    role: z.nativeEnum(UserRole),
  })).max(200).optional(),
});

const updateProjectBody = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().max(10_000).nullable().optional(),
  clientDescription: z.string().max(10_000).nullable().optional(),
  category: z.nativeEnum(ProjectCategory).optional(),
  phase: z.nativeEnum(ProjectPhase).optional(),
  healthStatus: z.nativeEnum(HealthStatus).optional(),
  autoHealth: z.boolean().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  startDate: dateOnlyOrDateTime.nullable().optional(),
  targetDate: dateOnlyOrDateTime.nullable().optional(),
  memberIds: z.array(z.object({
    userId: z.string().uuid(),
    role: z.nativeEnum(UserRole),
  })).max(200).optional(),
  // 2026-05-21 optimistic-locking expansion. See milestone.schema for
  // the full rationale. Opt-in.
  expectedUpdatedAt: z
    .string()
    .datetime({ message: 'expectedUpdatedAt must be an ISO 8601 timestamp' })
    .optional(),
});

export const createProjectSchema = z.object({
  body: applyDateOrdering(createProjectBody),
});

export const updateProjectSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: applyDateOrdering(updateProjectBody),
});

export const addMemberSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    userId: z.string().uuid(),
    role: z.nativeEnum(UserRole),
  }),
});

// Per-project full-access grant for a CLIENT member (SUPER_ADMIN-only).
export const setMemberFullAccessSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
  }),
  body: z.object({
    fullAccess: z.boolean(),
  }),
});
