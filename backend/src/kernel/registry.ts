/**
 * The kernel's module registry. Lifecycle:
 *
 *   register(manifest)*   →   mount(app)   →   boot()
 *
 *   - `register` collects manifests (synchronous, at app-assembly time).
 *   - `mount` resolves the enabled set, validates the dependency graph, and
 *     mounts routes onto Express — SYNCHRONOUS, so it slots into the existing
 *     synchronous app assembly (before the error handler).
 *   - `boot` runs each enabled module's `init` hook (subscriptions, schedules)
 *     in dependency order — ASYNC, awaited during server bootstrap before the
 *     listener accepts traffic, so subscriptions are live before any request.
 *
 * Resolution (entitlement filter + graph validation + topological order) is
 * computed once and memoised so `mount` and `boot` agree.
 */

import type { Express } from 'express';
import { logger } from '../lib/logger';
import { bus as defaultBus, type EventBus } from './eventBus';
import type { Entitlements } from './entitlements';
import type { ModuleManifest, ModuleContext } from './manifest';

export class ModuleRegistry {
  private readonly modules = new Map<string, ModuleManifest>();
  private resolved?: ModuleManifest[];
  private mounted = false;
  private booted = false;

  constructor(
    private readonly entitlements: Entitlements,
    private readonly bus: EventBus = defaultBus,
  ) {}

  /** Register a module. Throws on a duplicate id or after resolution. */
  register(manifest: ModuleManifest): this {
    if (this.resolved) {
      throw new Error(`[kernel] cannot register "${manifest.id}" after the registry has resolved`);
    }
    if (this.modules.has(manifest.id)) {
      throw new Error(`[kernel] duplicate module id: "${manifest.id}"`);
    }
    this.modules.set(manifest.id, manifest);
    return this;
  }

  /** Enabled module ids, in dependency order. Introspection. */
  enabledModuleIds(): string[] {
    return this.resolve().map((m) => m.id);
  }

  /**
   * Filter by entitlement, validate the dependency graph (unknown dep,
   * disabled dep, cycle), and return enabled modules in dependency order
   * (dependencies first). Pure, synchronous, memoised.
   */
  private resolve(): ModuleManifest[] {
    if (this.resolved) return this.resolved;

    const enabled = [...this.modules.values()].filter((m) =>
      this.entitlements.isEnabled(m.entitlement ?? m.id),
    );
    const enabledIds = new Set(enabled.map((m) => m.id));

    // Validate hard dependencies are known AND enabled.
    for (const m of enabled) {
      for (const dep of m.dependsOn ?? []) {
        if (!this.modules.has(dep)) {
          throw new Error(`[kernel] module "${m.id}" depends on unknown module "${dep}"`);
        }
        if (!enabledIds.has(dep)) {
          throw new Error(`[kernel] module "${m.id}" depends on "${dep}", which is disabled`);
        }
      }
    }

    this.resolved = topologicalOrder(enabled);
    return this.resolved;
  }

  /**
   * Mount enabled modules' routes onto the Express app, in dependency order.
   * Synchronous; call once during app assembly, before the error handler.
   */
  mount(app: Express): this {
    if (this.mounted) throw new Error('[kernel] registry already mounted');
    for (const m of this.resolve()) {
      for (const route of m.routes ?? []) {
        app.use(route.path, route.router);
      }
    }
    this.mounted = true;
    return this;
  }

  /**
   * Run enabled modules' `init` hooks in dependency order. Async; await
   * during server bootstrap before accepting traffic.
   */
  async boot(): Promise<void> {
    if (this.booted) throw new Error('[kernel] registry already booted');
    const ctx: ModuleContext = { bus: this.bus, logger };
    for (const m of this.resolve()) {
      await m.init?.(ctx);
      logger.info({ moduleId: m.id, version: m.version }, '[kernel] module booted');
    }
    this.booted = true;
  }
}

/**
 * Kahn topological sort over the enabled subgraph; alphabetical tie-break for
 * determinism. Throws on a cycle. Assumes every `dependsOn` target is in
 * `enabled` (the caller validates that first).
 */
function topologicalOrder(enabled: readonly ModuleManifest[]): ModuleManifest[] {
  const byId = new Map(enabled.map((m) => [m.id, m]));
  const indegree = new Map<string, number>(enabled.map((m) => [m.id, 0]));
  const dependents = new Map<string, string[]>();

  for (const m of enabled) {
    for (const dep of m.dependsOn ?? []) {
      indegree.set(m.id, (indegree.get(m.id) ?? 0) + 1);
      const list = dependents.get(dep) ?? [];
      list.push(m.id);
      dependents.set(dep, list);
    }
  }

  const ready = enabled
    .filter((m) => (indegree.get(m.id) ?? 0) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const order: ModuleManifest[] = [];

  while (ready.length > 0) {
    const m = ready.shift()!;
    order.push(m);
    for (const dependentId of dependents.get(m.id) ?? []) {
      const next = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, next);
      if (next === 0) {
        ready.push(byId.get(dependentId)!);
        ready.sort((a, b) => a.id.localeCompare(b.id));
      }
    }
  }

  if (order.length !== enabled.length) {
    const cyclic = enabled.filter((m) => !order.includes(m)).map((m) => m.id);
    throw new Error(`[kernel] dependency cycle detected among: ${cyclic.join(', ')}`);
  }
  return order;
}
