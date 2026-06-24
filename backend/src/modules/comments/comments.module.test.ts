/**
 * End-to-end proof of the kernel module model: the comments module's routes
 * are actually reachable through Express when mounted by the registry, and
 * the entitlement gate genuinely controls whether the routes exist.
 *
 * Discriminator: a MOUNTED but unauthenticated comment route returns 401
 * (auth middleware ran); an UNMOUNTED route returns 404 (no handler). So
 * 401 ⇒ mounted, 404 ⇒ gated off.
 */
import { describe, it, expect } from 'vitest';
import express, { type Express } from 'express';
import supertest from 'supertest';
import { ModuleRegistry, ConfigEntitlements } from '../../kernel';
import { commentsModule } from './index';

function appWith(disabledCsv: string | undefined): Express {
  const app = express();
  app.use(express.json());
  const registry = new ModuleRegistry(new ConfigEntitlements(disabledCsv));
  registry.register(commentsModule);
  registry.mount(app);
  return app;
}

const SOME_UUID = '11111111-1111-4111-8111-111111111111';

describe('comments module — mounted via the kernel registry', () => {
  it('mounts the comment routes when the entitlement is enabled (401, not 404)', async () => {
    const res = await supertest(appWith(undefined))
      .get(`/api/v1/projects/${SOME_UUID}/comments`)
      .send();
    expect(res.status).toBe(401); // route exists; auth middleware rejected
  });

  it('does NOT mount the routes when the comments entitlement is disabled (404)', async () => {
    const res = await supertest(appWith('comments'))
      .get(`/api/v1/projects/${SOME_UUID}/comments`)
      .send();
    expect(res.status).toBe(404); // gated off — no handler registered
  });
});
