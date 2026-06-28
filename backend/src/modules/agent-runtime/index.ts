/**
 * Agent-runtime capability module (M2). Owns the run model + lifecycle and,
 * for now, exposes read-only run visibility under tasks. The write side — a
 * RuntimeAdapter driving real executions — lands in M2.2; the run service it
 * will call already exists (`services/agentRun.service`).
 */
import runRoutes from './agentRun.routes';
import inboxRoutes from './inbox.routes';
import type { ModuleManifest } from '../../kernel';

export const agentRuntimeModule: ModuleManifest = {
  id: 'agent-runtime',
  version: '1.0.0',
  entitlement: 'agent-runtime',
  routes: [
    { path: '/api/v1', router: runRoutes },
    { path: '/api/v1', router: inboxRoutes },
  ],
};
