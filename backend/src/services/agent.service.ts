import prisma from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';

// Slice 1 of the agent platform: lets the runtime record per-task API cost
// against the agent's monthly budget. The runtime calls this once per task,
// passing the cents spent on Claude API for that task. We're storing usage
// only — enforcement (refusing to spawn when the budget is exhausted) is the
// runtime's job in v1; later slices may surface a "paused — budget exceeded"
// dashboard banner.

export async function incrementAgentBudget(userId: string, usdCents: number) {
  if (!Number.isFinite(usdCents) || usdCents < 0) {
    throw new ValidationError('usdCents must be a non-negative number');
  }
  // Sanity cap per request — refuse 6-digit-cent ($1000) increments since
  // they almost certainly indicate a bug in the runtime rather than a real
  // single-task cost. Tunable.
  if (usdCents > 100_000) {
    throw new ValidationError('usdCents per increment must be <= 100,000 (i.e. $1000 per task)');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, userType: true, agentBudgetUsedUsdCents: true, agentBudgetMonthlyUsdCents: true },
  });
  if (!user) throw new NotFoundError('User');
  if (user.userType !== 'AGENT') {
    throw new ForbiddenError('Budget increment is an agent-only action');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { agentBudgetUsedUsdCents: { increment: Math.round(usdCents) } },
    select: { id: true, agentBudgetUsedUsdCents: true, agentBudgetMonthlyUsdCents: true },
  });

  // Audit-log every increment so we can reconstruct cost-per-task later.
  await logActivity({
    userId,
    action: 'agent_budget_increment',
    targetType: 'user',
    targetId: userId,
    details: { usdCents: Math.round(usdCents), newTotalUsdCents: updated.agentBudgetUsedUsdCents },
  });

  return {
    usedUsdCents: updated.agentBudgetUsedUsdCents,
    monthlyUsdCents: updated.agentBudgetMonthlyUsdCents,
    over: updated.agentBudgetMonthlyUsdCents !== null
      ? updated.agentBudgetUsedUsdCents > updated.agentBudgetMonthlyUsdCents
      : false,
  };
}
