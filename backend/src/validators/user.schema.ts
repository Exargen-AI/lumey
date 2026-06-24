import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { passwordPolicy } from './auth.schema';
import { normalizeEmail } from '../utils/email';

// Reuse the same complexity policy users get on self-serve change-password
// (QA finding #19 — admins were able to reset to "12345678").
export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email().max(254).transform(normalizeEmail),
    password: passwordPolicy,
    role: z.nativeEnum(UserRole),
    company: z.string().max(200).optional(),
    projectIds: z.array(z.object({
      projectId: z.string().uuid(),
      role: z.nativeEnum(UserRole),
    })).max(200).optional(),
  }),
});

export const updateUserSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().max(254).transform(normalizeEmail).optional(),
    role: z.nativeEnum(UserRole).optional(),
    company: z.string().max(200).nullable().optional(),
    isActive: z.boolean().optional(),
    // 2026-06-01 — agent-visibility allowlist grant. Same reason it
    // must be listed here; SUPER_ADMIN-only armor lives in the service.
    canViewAgents: z.boolean().optional(),
  }),
});

export const resetPasswordSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    newPassword: passwordPolicy,
  }),
});

// 2026-06-01 — bulk replace the agent-visibility allowlist.
export const setAgentViewersSchema = z.object({
  body: z.object({
    userIds: z.array(z.string().uuid()).max(500),
  }),
});
