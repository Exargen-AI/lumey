/**
 * Agent-runtime capability module (M2). Owns the run model + lifecycle and,
 * for now, exposes read-only run visibility under tasks. The write side — a
 * RuntimeAdapter driving real executions — lands in M2.2; the run service it
 * will call already exists (`services/agentRun.service`).
 */
import { RunStatus } from '@prisma/client';
import runRoutes from './agentRun.routes';
import inboxRoutes from './inbox.routes';
import type { RunTransitionedEvent } from './events';
import { isTerminal } from '../../lib/runLifecycle';
import { issueRunReceipt } from '../../services/runReceipt.service';
import type { ModuleManifest } from '../../kernel';

export const agentRuntimeModule: ModuleManifest = {
  id: 'agent-runtime',
  version: '1.0.0',
  entitlement: 'agent-runtime',
  routes: [
    { path: '/api/v1', router: runRoutes },
    { path: '/api/v1', router: inboxRoutes },
  ],
  init: (ctx) => {
    // Governance: issue/refresh the run receipt whenever a run comes to rest —
    // a terminal state, or AWAITING_REVIEW (the common "agent finished, over to a
    // human" point). Idempotent upsert, so a resume-then-rest just refreshes it.
    ctx.bus.subscribe<RunTransitionedEvent>('run.transitioned', async (event) => {
      if (isTerminal(event.to) || event.to === RunStatus.AWAITING_REVIEW) {
        await issueRunReceipt(event.runId);
      }
    });
  },
};
