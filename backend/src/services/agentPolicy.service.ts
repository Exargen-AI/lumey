/**
 * Agent policy — per-agent governance. The receipt (P4.1) proves what a run
 * *did*; this controls what an agent is *allowed* to do: a kill-switch, a tool
 * allowlist (least privilege), and per-run token/step ceilings (the circuit
 * breaker). Absent ⇒ unrestricted, so existing agents are unaffected.
 *
 * `resolveEffectivePolicy` is the single read used by the orchestrator (start
 * gate), the native adapter (tool filtering + budget), and the API — it always
 * returns a fully-defaulted shape so callers never branch on "no row".
 */
import prisma from '../config/database';
import { Prisma, UserType } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';

export interface EffectivePolicy {
  /** False = kill-switch: the agent may not start runs. */
  readonly enabled: boolean;
  /** If set, the ONLY tools the agent may use; null = all tools. */
  readonly allowedTools: string[] | null;
  /** Per-run token ceiling (circuit breaker); null = runtime default. */
  readonly maxRunTokens: number | null;
  /** Per-run step ceiling; null = runtime default. */
  readonly maxRunSteps: number | null;
  /** Preferred model id (stored now; Fleet routing consumes it in P5). */
  readonly model: string | null;
}

const UNRESTRICTED: EffectivePolicy = {
  enabled: true,
  allowedTools: null,
  maxRunTokens: null,
  maxRunSteps: null,
  model: null,
};

/** The agent's effective policy, fully defaulted (unrestricted when no row). */
export async function resolveEffectivePolicy(agentId: string): Promise<EffectivePolicy> {
  const row = await prisma.agentPolicy.findUnique({ where: { userId: agentId } });
  if (!row) return UNRESTRICTED;
  return {
    enabled: row.enabled,
    allowedTools: Array.isArray(row.allowedTools) ? (row.allowedTools as string[]) : null,
    maxRunTokens: row.maxRunTokens,
    maxRunSteps: row.maxRunSteps,
    model: row.model,
  };
}

export interface AgentPolicyInput {
  enabled?: boolean;
  /** string[] to set an allowlist, null to clear it (all tools). */
  allowedTools?: string[] | null;
  maxRunTokens?: number | null;
  maxRunSteps?: number | null;
  model?: string | null;
}

/** Create or update an agent's policy. Only AGENT users may carry one. */
export async function upsertAgentPolicy(agentId: string, input: AgentPolicyInput) {
  const user = await prisma.user.findUnique({ where: { id: agentId }, select: { userType: true } });
  if (!user) throw new NotFoundError('Agent');
  if (user.userType !== UserType.AGENT) throw new ValidationError('Policies apply only to agent users.');
  if (input.allowedTools && input.allowedTools.some((t) => typeof t !== 'string')) {
    throw new ValidationError('allowedTools must be an array of tool names.');
  }
  for (const [key, value] of [['maxRunTokens', input.maxRunTokens], ['maxRunSteps', input.maxRunSteps]] as const) {
    if (value != null && (!Number.isInteger(value) || value <= 0)) {
      throw new ValidationError(`${key} must be a positive integer.`);
    }
  }

  // Prisma distinguishes "leave unchanged" (undefined) from "clear" (JsonNull/null).
  const tools: Prisma.AgentPolicyUpdateInput['allowedTools'] =
    input.allowedTools === undefined ? undefined : input.allowedTools === null ? Prisma.JsonNull : input.allowedTools;

  return prisma.agentPolicy.upsert({
    where: { userId: agentId },
    create: {
      userId: agentId,
      enabled: input.enabled ?? true,
      allowedTools: input.allowedTools ?? Prisma.JsonNull,
      maxRunTokens: input.maxRunTokens ?? null,
      maxRunSteps: input.maxRunSteps ?? null,
      model: input.model ?? null,
    },
    update: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(tools !== undefined ? { allowedTools: tools } : {}),
      ...(input.maxRunTokens !== undefined ? { maxRunTokens: input.maxRunTokens } : {}),
      ...(input.maxRunSteps !== undefined ? { maxRunSteps: input.maxRunSteps } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
    },
  });
}
