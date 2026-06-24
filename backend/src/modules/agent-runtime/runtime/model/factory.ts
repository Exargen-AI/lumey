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
  return new HttpModelClient({ baseUrl: DEFAULT_LOCAL_BASE_URL, ...config });
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
