/**
 * Registry of runtime adapters. The orchestrator resolves a runtime by id;
 * built-in adapters self-register here. Adding a runtime (Claude Agent SDK,
 * OpenHands, …) is registering one more adapter — nothing above the seam
 * changes.
 */
import type { RuntimeAdapter } from './runtimeAdapter';
import { referenceAdapter } from './adapters/reference';

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

/** The default runtime until a real one is wired (M2.x). */
export const DEFAULT_ADAPTER_ID = 'reference';
