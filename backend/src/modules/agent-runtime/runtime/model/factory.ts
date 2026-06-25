/**
 * The two backends the build plan names — both are the same raw-HTTP
 * `HttpModelClient`, configured differently. They exist as named factories so
 * the difference (defaults + the safety check) is explicit at the call site,
 * and so a RoutingPolicy can later pick "local" vs "frontier" by intent.
 *
 *   - Local: a self-hosted, OpenAI-compatible server (vLLM / Ollama). No auth by
 *     default; defaults to Ollama's local endpoint. This is the air-gap / cost
 *     path.
 *   - Frontier: a hosted gateway over HTTPS. An API key is mandatory — we fail
 *     loudly rather than send an unauthenticated request that 401s mid-run.
 */
import { HttpModelClient, type HttpModelClientConfig } from './httpModelClient';
import type { ModelClient } from './types';

const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1'; // Ollama's OpenAI-compatible endpoint

export interface LocalModelConfig extends Omit<HttpModelClientConfig, 'baseUrl'> {
  /** Defaults to Ollama's local endpoint when omitted. */
  baseUrl?: string;
}

/** A client for a self-hosted, OpenAI-compatible model server (vLLM / Ollama). */
export function createLocalModelClient(config: LocalModelConfig): ModelClient {
  return new HttpModelClient({ ...config, baseUrl: config.baseUrl ?? DEFAULT_LOCAL_BASE_URL });
}

export interface FrontierModelConfig extends HttpModelClientConfig {
  /** Mandatory for a frontier gateway. */
  apiKey: string;
}

/** A client for a hosted frontier gateway over HTTPS. Requires an API key. */
export function createFrontierModelClient(config: FrontierModelConfig): ModelClient {
  if (!config.apiKey) {
    throw new Error('createFrontierModelClient: apiKey is required for a frontier backend');
  }
  return new HttpModelClient(config);
}

/**
 * Resolve a ModelClient from environment — the native runtime's default model
 * source. Throws (loudly, not at request time) when nothing is configured, so a
 * deployment without a model fails a `native` run with a clear message instead
 * of silently misbehaving.
 *
 *   LUMEY_MODEL_BACKEND = local | frontier            (default: local)
 *   local:    LUMEY_LOCAL_MODEL (req), LUMEY_LOCAL_MODEL_URL (opt)
 *   frontier: LUMEY_FRONTIER_URL, LUMEY_FRONTIER_MODEL, LUMEY_FRONTIER_API_KEY (all req)
 */
function timeoutFromEnv(env: NodeJS.ProcessEnv, fallbackMs: number): number {
  const v = Number(env.LUMEY_MODEL_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : fallbackMs;
}

export function modelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const backend = (env.LUMEY_MODEL_BACKEND ?? 'local').toLowerCase();
  if (backend === 'frontier') {
    const { LUMEY_FRONTIER_URL: baseUrl, LUMEY_FRONTIER_MODEL: model, LUMEY_FRONTIER_API_KEY: apiKey } = env;
    if (!baseUrl || !model || !apiKey) {
      throw new Error('native runtime: frontier model not configured (set LUMEY_FRONTIER_URL, LUMEY_FRONTIER_MODEL, LUMEY_FRONTIER_API_KEY)');
    }
    // Frontier APIs are fast but a cold/long generation still warrants headroom.
    return createFrontierModelClient({ baseUrl, model, apiKey, timeoutMs: timeoutFromEnv(env, 120_000) });
  }
  const model = env.LUMEY_LOCAL_MODEL;
  if (!model) {
    throw new Error('native runtime: no model configured (set LUMEY_LOCAL_MODEL, or LUMEY_MODEL_BACKEND=frontier with LUMEY_FRONTIER_*)');
  }
  // Local models on consumer hardware are slow — a cold load alone can take ~30s,
  // and an agentic generation longer — so default to a generous deadline.
  return createLocalModelClient({ model, baseUrl: env.LUMEY_LOCAL_MODEL_URL, timeoutMs: timeoutFromEnv(env, 300_000) });
}
