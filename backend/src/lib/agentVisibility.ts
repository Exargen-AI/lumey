/**
 * Agent visibility policy (2026-06-01).
 *
 * AI agents are `User` rows with `userType = 'AGENT'`. They can be
 * assigned tasks, comment, and appear in the activity feed like any
 * user. By founder directive, agents and everything they touch are
 * hidden from regular users — visible only to:
 *
 *   1. SUPER_ADMIN (implicitly, always), and
 *   2. users on the allowlist (`User.canViewAgents = true`), which only
 *      SUPER_ADMIN can manage.
 *
 * This module is the single source of truth for "may this viewer see
 * agents?" so every service filters consistently. Enforcement is
 * server-side (not just UI masking) — agent data must never reach an
 * unauthorised client, even in a raw API response.
 */

import { UserRole, UserType } from '@prisma/client';

/** The minimal viewer shape the policy needs. */
export interface AgentVisibilityViewer {
  role: UserRole | string;
  canViewAgents?: boolean | null;
}

/**
 * True when this viewer is allowed to see AI agents and agent-owned
 * work. SUPER_ADMIN always can; everyone else needs the per-user
 * allowlist flag.
 */
export function viewerCanSeeAgents(viewer: AgentVisibilityViewer | null | undefined): boolean {
  if (!viewer) return false;
  if (viewer.role === UserRole.SUPER_ADMIN) return true;
  return viewer.canViewAgents === true;
}

/**
 * A Prisma `where` fragment that EXCLUDES tasks assigned to an agent.
 * Tasks with no assignee, or assigned to a human, pass. Spread into a
 * task query's `where` (under `AND`) when `viewerCanSeeAgents` is false.
 *
 *   NOT { assignee is { userType: AGENT } }
 *
 * Postgres/Prisma: for a null assignee the inner relation filter is
 * false, so NOT(false) = true → the task is kept. Exactly what we want.
 */
export const EXCLUDE_AGENT_ASSIGNED_TASKS = {
  NOT: { assignee: { is: { userType: UserType.AGENT } } },
} as const;

/**
 * Mask an actor (assignee / creator / reviewer / comment author) when
 * it's an AI agent and the viewer isn't allowed to see agents. Returns
 * the actor unchanged otherwise.
 *
 * Returns `null` rather than a "Internal team" placeholder — the
 * directive is no *mention* of agents at all, not a euphemism. The
 * field reads as empty / unassigned to an unauthorised viewer.
 *
 * Pass `canSeeAgents` (the result of `viewerCanSeeAgents(viewer)`)
 * computed once per request, so this stays a cheap pure check inside
 * map loops.
 */
export function maskAgentActor<T extends { userType?: string | null } | null | undefined>(
  actor: T,
  canSeeAgents: boolean,
): T | null {
  if (!actor) return actor;
  if (canSeeAgents) return actor;
  if (actor.userType === UserType.AGENT) return null;
  return actor;
}
