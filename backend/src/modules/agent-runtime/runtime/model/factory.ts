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
import { listModelProviders, selectProvider, type ModelProvider } from './modelProviders';

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

/** Build the concrete client for a chosen provider (reads its secrets from env). */
function buildClientForProvider(provider: ModelProvider, env: NodeJS.ProcessEnv): ModelClient {
  const model = provider.model;
  if (!model) throw new Error(`native runtime: provider ${provider.id} has no model configured`);
  switch (provider.kind) {
    case 'FRONTIER': {
      const baseUrl = env.LUMEY_FRONTIER_URL;
      const apiKey = env.LUMEY_FRONTIER_API_KEY;
      if (!baseUrl || !apiKey) throw new Error('native runtime: frontier model not fully configured (LUMEY_FRONTIER_URL, LUMEY_FRONTIER_API_KEY)');
      // Frontier APIs are fast but a cold/long generation still warrants headroom.
      return createFrontierModelClient({ baseUrl, model, apiKey, timeoutMs: timeoutFromEnv(env, 120_000) });
    }
    case 'SELF_HOSTED': {
      const baseUrl = env.LUMEY_SELFHOSTED_URL;
      if (!baseUrl) throw new Error('native runtime: self-hosted model not configured (LUMEY_SELFHOSTED_URL)');
      // OpenAI-compatible; optional bearer key. Self-hosted GPUs are quicker than
      // a laptop but slower than frontier — a middle-ground deadline.
      return new HttpModelClient({ baseUrl, model, apiKey: env.LUMEY_SELFHOSTED_API_KEY, timeoutMs: timeoutFromEnv(env, 200_000) });
    }
    default: {
      // Local models on consumer hardware are slow — a cold load alone can take
      // ~30s, and an agentic generation longer — so default to a generous deadline.
      return createLocalModelClient({ model, baseUrl: env.LUMEY_LOCAL_MODEL_URL, timeoutMs: timeoutFromEnv(env, 300_000) });
    }
  }
}

/**
 * Resolve a ModelClient for a run via the provider router: an agent's preferred
 * model (from policy) wins if its tier is configured, else the default tier, else
 * the first configured one (local → self-hosted → frontier). Throws loudly (not
 * at request time) when nothing is configured.
 */
export function modelClientForContext(
  ctx: { preferredModel?: string | null } = {},
  env: NodeJS.ProcessEnv = process.env,
): ModelClient {
  const provider = selectProvider(listModelProviders(env), ctx.preferredModel);
  if (!provider) {
    throw new Error('native runtime: no model provider configured (set LUMEY_LOCAL_MODEL, LUMEY_SELFHOSTED_*, or LUMEY_FRONTIER_*)');
  }
  return buildClientForProvider(provider, env);
}

/** Back-compat entry point: route with no per-agent preference. */
export function modelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  return modelClientForContext({}, env);
}
