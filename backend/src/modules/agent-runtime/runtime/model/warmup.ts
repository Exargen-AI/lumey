/**
 * Warm the local model at startup. Local models pay a one-time load cost
 * (~30–60s for a 7B) on the first request after the server (or the model's
 * keep-alive window) goes cold — which is exactly when a user dispatches the
 * first run and watches it stall. A tiny throwaway completion at boot pays that
 * cost up front, so the first *real* run is instant. No-op for a frontier
 * backend or when no local model is configured; never throws.
 */
import { modelClientFromEnv } from './factory';
import type { ModelClient } from './types';

export async function warmLocalModel(
  env: NodeJS.ProcessEnv = process.env,
  makeClient: (e: NodeJS.ProcessEnv) => ModelClient = modelClientFromEnv,
): Promise<boolean> {
  if ((env.LUMEY_MODEL_BACKEND ?? 'local').toLowerCase() === 'frontier') return false;
  if (!env.LUMEY_LOCAL_MODEL) return false;
  try {
    await makeClient(env).complete({ messages: [{ role: 'user', content: 'warm' }], maxTokens: 1 });
    return true;
  } catch {
    return false; // a cold/unreachable model must never block startup
  }
}
