import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as handler from '../handlers/agent.handler';

const router = Router();

// All agent-self endpoints require auth; the service layer asserts the
// caller is actually an agent (req.user.userType === 'AGENT'). We don't
// gate at the route layer because we want a clear error message ("Budget
// increment is an agent-only action") rather than a generic 403.

router.post('/agents/me/budget-increment', authenticate, handler.budgetIncrementHandler);

// Per-task knowledge-pack bundle. Agent-only (enforced in the service) and
// requires project membership.
router.get('/agents/me/knowledge-pack/:projectSlug', authenticate, handler.knowledgePackHandler);

// 2026-05-23 Layer 2 / agent control plane.
// Next-task picker. The runtime calls this once per work cycle to get
// the single highest-priority, unblocked, assigned task. Agent-only;
// see agentNextTask.service for the full selection contract.
router.get('/agents/me/next-task', authenticate, handler.nextTaskHandler);

export default router;
