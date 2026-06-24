import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import supertest from 'supertest';
import { ModuleRegistry, ConfigEntitlements } from '../../kernel';
import { agentRuntimeModule } from './index';

function appWith(disabledCsv: string | undefined): Express {
  const app = express();
  app.use(express.json());
  const registry = new ModuleRegistry(new ConfigEntitlements(disabledCsv));
  registry.register(agentRuntimeModule);
  registry.mount(app);
  return app;
}

const SOME_UUID = '11111111-1111-4111-8111-111111111111';

describe('agent-runtime module — mounted via the kernel registry', () => {
  it('mounts run-visibility routes when enabled (401, not 404)', async () => {
    const res = await supertest(appWith(undefined)).get(`/api/v1/tasks/${SOME_UUID}/runs`).send();
    expect(res.status).toBe(401); // route exists; auth middleware rejected
  });

  it('does NOT mount the routes when agent-runtime is disabled (404)', async () => {
    const res = await supertest(appWith('agent-runtime'))
      .get(`/api/v1/tasks/${SOME_UUID}/runs`)
      .send();
    expect(res.status).toBe(404); // gated off — no handler registered
  });
});
