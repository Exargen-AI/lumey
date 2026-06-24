/**
 * 2026-05-23 agent-friendliness audit — coverage for `incrementAgentBudget`.
 *
 * Slice 1 of the agent platform: records per-task API spend so the
 * runtime can later refuse to spawn when an agent's monthly budget is
 * exhausted. Currently storage-only — but if it regresses, agent cost
 * accounting becomes wrong without anyone noticing (no human reviews
 * agent spend per-task; we lean on this rollup).
 *
 * Critical invariants pinned:
 *   - Refuses negative / non-finite cents (data-integrity guard)
 *   - Refuses >$1000 / single increment (sanity cap — bug-shape guard)
 *   - Refuses if target user is not an agent (privilege boundary)
 *   - 404 when user doesn't exist
 *   - Computes `over` correctly when budget is set / null
 *   - Audit-logs every increment with the post-write total
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';

const { logActivitySpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

import { incrementAgentBudget } from './agent.service';

const AGENT_ID = 'agent-1';
const HUMAN_ID = 'human-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('incrementAgentBudget — input validation', () => {
  it('rejects negative cents', async () => {
    await expect(incrementAgentBudget(AGENT_ID, -1)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects NaN / Infinity / non-numeric', async () => {
    await expect(incrementAgentBudget(AGENT_ID, NaN)).rejects.toBeInstanceOf(ValidationError);
    await expect(incrementAgentBudget(AGENT_ID, Infinity)).rejects.toBeInstanceOf(ValidationError);
    await expect(incrementAgentBudget(AGENT_ID, -Infinity)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects increments over 100,000 cents ($1000) — sanity cap to catch runtime bugs', async () => {
    await expect(incrementAgentBudget(AGENT_ID, 100_001)).rejects.toThrow(/100,000/);
  });

  it('accepts the exact sanity-cap boundary (100,000 cents)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: AGENT_ID,
      userType: 'AGENT',
      agentBudgetUsedUsdCents: 0,
      agentBudgetMonthlyUsdCents: null,
    } as any);
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 100_000,
      agentBudgetMonthlyUsdCents: null,
    } as any);
    await expect(incrementAgentBudget(AGENT_ID, 100_000)).resolves.toBeDefined();
  });
});

describe('incrementAgentBudget — authorization', () => {
  it('throws NotFoundError when user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(incrementAgentBudget('ghost', 100)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when target is a HUMAN, not an AGENT (privilege boundary)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: HUMAN_ID,
      userType: 'HUMAN',
      agentBudgetUsedUsdCents: 0,
      agentBudgetMonthlyUsdCents: null,
    } as any);
    await expect(incrementAgentBudget(HUMAN_ID, 100)).rejects.toBeInstanceOf(ForbiddenError);
    // CRITICAL: must not write to user.update — that would set a budget
    // field on a HUMAN row, polluting the data model.
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('incrementAgentBudget — persistence + return shape', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: AGENT_ID,
      userType: 'AGENT',
      agentBudgetUsedUsdCents: 1000,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);
  });

  it('increments via Prisma atomic operator (no race with concurrent increments)', async () => {
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 1250,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);
    await incrementAgentBudget(AGENT_ID, 250);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: AGENT_ID },
      data: { agentBudgetUsedUsdCents: { increment: 250 } },
      select: expect.any(Object),
    });
  });

  it('rounds fractional cents (input could be float from cost calc) before persisting', async () => {
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 1003,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);
    await incrementAgentBudget(AGENT_ID, 2.7);
    const args = prismaMock.user.update.mock.calls[0]?.[0] as any;
    expect(args.data.agentBudgetUsedUsdCents).toEqual({ increment: 3 });
  });

  it('returns over=true when used > monthly cap', async () => {
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 12_000,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);
    const result = await incrementAgentBudget(AGENT_ID, 5_000);
    expect(result.over).toBe(true);
  });

  it('returns over=false when used <= monthly cap', async () => {
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 5_000,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);
    const result = await incrementAgentBudget(AGENT_ID, 100);
    expect(result.over).toBe(false);
  });

  it('returns over=false when monthlyUsdCents is null (no budget set — unlimited)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: AGENT_ID,
      userType: 'AGENT',
      agentBudgetUsedUsdCents: 1_000_000,
      agentBudgetMonthlyUsdCents: null,
    } as any);
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 1_000_100,
      agentBudgetMonthlyUsdCents: null,
    } as any);
    const result = await incrementAgentBudget(AGENT_ID, 100);
    expect(result.over).toBe(false);
  });
});

describe('incrementAgentBudget — audit trail', () => {
  it('writes an agent_budget_increment activity-log entry with the rounded cents + new total', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: AGENT_ID,
      userType: 'AGENT',
      agentBudgetUsedUsdCents: 1000,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);
    prismaMock.user.update.mockResolvedValue({
      id: AGENT_ID,
      agentBudgetUsedUsdCents: 1250,
      agentBudgetMonthlyUsdCents: 10_000,
    } as any);

    await incrementAgentBudget(AGENT_ID, 250);

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AGENT_ID,
        action: 'agent_budget_increment',
        targetType: 'user',
        targetId: AGENT_ID,
        details: expect.objectContaining({
          usdCents: 250,
          newTotalUsdCents: 1250,
        }),
      }),
    );
  });

  it('does NOT write an audit log when the input validation fails (no half-state)', async () => {
    await expect(incrementAgentBudget(AGENT_ID, -1)).rejects.toThrow();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('does NOT write an audit log when the user is not an agent', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: HUMAN_ID,
      userType: 'HUMAN',
    } as any);
    await expect(incrementAgentBudget(HUMAN_ID, 100)).rejects.toThrow();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });
});
