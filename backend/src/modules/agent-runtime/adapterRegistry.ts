/**
 * Registry of runtime adapters. The orchestrator resolves a runtime by id;
 * built-in adapters self-register here. Adding a runtime (a third-party agent,
 * a hosted runtime, …) is registering one more adapter — nothing above the seam
 * changes.
 */
import type { RuntimeAdapter } from './runtimeAdapter';
import { referenceAdapter } from './adapters/reference';
import { nativeAdapter } from './adapters/native';

const adapters = new Map<string, RuntimeAdapter>();

export function registerAdapter(adapter: RuntimeAdapter): void {
  if (adapters.has(adapter.id)) {
    throw new Error(`[agent-runtime] duplicate adapter id: "${adapter.id}"`);
  }
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: string): RuntimeAdapter {
  const adapter = adapters.get(id);
  if (!adapter) {
    throw new Error(`[agent-runtime] unknown runtime adapter: "${id}"`);
  }
  return adapter;
}

export function listAdapters(): string[] {
  return [...adapters.keys()];
}

// ── built-in adapters ──
registerAdapter(referenceAdapter);
registerAdapter(nativeAdapter);

/**
 * The default runtime. `reference` (the deterministic simulator) stays the
 * default so the product works with no model configured; select `native` (our
 * in-house loop) per-run once a model is wired via env.
 */
export const DEFAULT_ADAPTER_ID = 'reference';
