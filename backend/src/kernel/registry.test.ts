import { describe, it, expect, vi } from 'vitest';
import type { Express, Router } from 'express';
import { ModuleRegistry } from './registry';
import { EventBus } from './eventBus';
import type { Entitlements } from './entitlements';
import type { ModuleManifest } from './manifest';

// ── test doubles ──────────────────────────────────────────────────────────
class FakeEntitlements implements Entitlements {
  constructor(private readonly disabled: Set<string> = new Set()) {}
  isEnabled(key: string): boolean {
    return !this.disabled.has(key);
  }
}

const fakeRouter = (id: string): Router => ({ __id: id }) as unknown as Router;

function mod(id: string, opts: Partial<ModuleManifest> = {}): ModuleManifest {
  return { id, version: '1.0.0', ...opts };
}

function fakeApp(): { app: Express; use: ReturnType<typeof vi.fn> } {
  const use = vi.fn();
  return { app: { use } as unknown as Express, use };
}

function registry(entitlements = new FakeEntitlements()): ModuleRegistry {
  return new ModuleRegistry(entitlements, new EventBus());
}

// ── registration ────────────────────────────────────────────────────────
describe('ModuleRegistry — registration', () => {
  it('lists registered, enabled modules', () => {
    const reg = registry().register(mod('comments')).register(mod('kanban'));
    expect(reg.enabledModuleIds().sort()).toEqual(['comments', 'kanban']);
  });

  it('rejects a duplicate module id', () => {
    const reg = registry().register(mod('comments'));
    expect(() => reg.register(mod('comments'))).toThrow(/duplicate module id/);
  });

  it('rejects registration after the registry has resolved', () => {
    const reg = registry().register(mod('comments'));
    reg.enabledModuleIds(); // forces resolution
    expect(() => reg.register(mod('kanban'))).toThrow(/after the registry has resolved/);
  });
});

// ── entitlement gating ────────────────────────────────────────────────────
describe('ModuleRegistry — entitlement gating', () => {
  it('excludes a disabled module by its entitlement key', () => {
    const reg = new ModuleRegistry(new FakeEntitlements(new Set(['kanban'])), new EventBus());
    reg.register(mod('comments')).register(mod('kanban'));
    expect(reg.enabledModuleIds()).toEqual(['comments']);
  });

  it('uses an explicit entitlement key when set', () => {
    const reg = new ModuleRegistry(new FakeEntitlements(new Set(['billing'])), new EventBus());
    reg.register(mod('payments', { entitlement: 'billing' }));
    expect(reg.enabledModuleIds()).toEqual([]);
  });
});

// ── dependency graph ──────────────────────────────────────────────────────
describe('ModuleRegistry — dependency graph', () => {
  it('orders dependencies before dependents', () => {
    const reg = registry()
      .register(mod('agent-runtime', { dependsOn: ['kanban'] }))
      .register(mod('kanban'));
    expect(reg.enabledModuleIds()).toEqual(['kanban', 'agent-runtime']);
  });

  it('is deterministic (alphabetical) among independent modules', () => {
    const reg = registry().register(mod('zebra')).register(mod('alpha')).register(mod('mango'));
    expect(reg.enabledModuleIds()).toEqual(['alpha', 'mango', 'zebra']);
  });

  it('throws when a dependency is unknown', () => {
    const reg = registry().register(mod('agent-runtime', { dependsOn: ['nope'] }));
    expect(() => reg.enabledModuleIds()).toThrow(/depends on unknown module "nope"/);
  });

  it('throws when a dependency is disabled', () => {
    const reg = new ModuleRegistry(new FakeEntitlements(new Set(['kanban'])), new EventBus());
    reg.register(mod('agent-runtime', { dependsOn: ['kanban'] })).register(mod('kanban'));
    expect(() => reg.enabledModuleIds()).toThrow(/depends on "kanban", which is disabled/);
  });

  it('throws on a dependency cycle', () => {
    const reg = registry()
      .register(mod('a', { dependsOn: ['b'] }))
      .register(mod('b', { dependsOn: ['a'] }));
    expect(() => reg.enabledModuleIds()).toThrow(/dependency cycle detected/);
  });
});

// ── mounting ──────────────────────────────────────────────────────────────
describe('ModuleRegistry — mount', () => {
  it('mounts each enabled module’s routes in dependency order', () => {
    const ka = fakeRouter('kanban');
    const ar = fakeRouter('agent-runtime');
    const reg = registry()
      .register(mod('agent-runtime', { dependsOn: ['kanban'], routes: [{ path: '/api/v1', router: ar }] }))
      .register(mod('kanban', { routes: [{ path: '/api/v1', router: ka }] }));
    const { app, use } = fakeApp();

    reg.mount(app);

    expect(use.mock.calls).toEqual([
      ['/api/v1', ka], // dependency first
      ['/api/v1', ar],
    ]);
  });

  it('does not mount a disabled module’s routes', () => {
    const reg = new ModuleRegistry(new FakeEntitlements(new Set(['kanban'])), new EventBus());
    reg.register(mod('kanban', { routes: [{ path: '/api/v1', router: fakeRouter('k') }] }));
    const { app, use } = fakeApp();

    reg.mount(app);

    expect(use).not.toHaveBeenCalled();
  });

  it('refuses to mount twice', () => {
    const reg = registry().register(mod('comments'));
    const { app } = fakeApp();
    reg.mount(app);
    expect(() => reg.mount(app)).toThrow(/already mounted/);
  });
});

// ── boot ──────────────────────────────────────────────────────────────────
describe('ModuleRegistry — boot', () => {
  it('runs init hooks in dependency order', async () => {
    const order: string[] = [];
    const reg = registry()
      .register(mod('agent-runtime', { dependsOn: ['kanban'], init: () => void order.push('agent-runtime') }))
      .register(mod('kanban', { init: () => void order.push('kanban') }));

    await reg.boot();

    expect(order).toEqual(['kanban', 'agent-runtime']);
  });

  it('awaits async init hooks', async () => {
    let ready = false;
    const reg = registry().register(
      mod('comments', {
        init: async () => {
          await new Promise((r) => setTimeout(r, 5));
          ready = true;
        },
      }),
    );

    await reg.boot();

    expect(ready).toBe(true);
  });

  it('refuses to boot twice', async () => {
    const reg = registry().register(mod('comments'));
    await reg.boot();
    await expect(reg.boot()).rejects.toThrow(/already booted/);
  });

  it('hands modules a context with the bus and logger', async () => {
    const reg = registry().register(
      mod('comments', {
        init: (ctx) => {
          expect(ctx.bus).toBeInstanceOf(EventBus);
          expect(ctx.logger).toBeTruthy();
        },
      }),
    );
    await expect(reg.boot()).resolves.toBeUndefined();
  });
});
