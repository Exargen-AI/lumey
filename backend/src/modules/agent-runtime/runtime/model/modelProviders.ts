/**
 * Model provider registry + router — the heart of the "three model options"
 * strategy, all behind the one `ModelClient` seam:
 *
 *   LOCAL        — Ollama / llama.cpp on the box (air-gap, zero cost, the default
 *                  direction). No auth.
 *   SELF_HOSTED  — an open-source LLM you run on your own server (vLLM / TGI),
 *                  OpenAI-compatible. Optional bearer key.
 *   FRONTIER     — a hosted frontier gateway (controlled, opt-in). API key required.
 *
 * This module reads the deployment's env into a list of **provider descriptors**
 * (never exposing secrets) and picks one for a run: an agent's preferred model
 * (from `AgentPolicy.model`) wins if its provider is configured; otherwise the
 * default; otherwise the first configured provider in priority order
 * (local → self-hosted → frontier — sovereign first, frontier last). The
 * selection is pure + testable; building the actual client lives in `factory.ts`.
 */

export type ModelProviderKind = 'LOCAL' | 'SELF_HOSTED' | 'FRONTIER';

/** A redacted, FE-safe description of a configured (or configurable) model tier. */
export interface ModelProvider {
  /** Stable id: `local` | `self-hosted` | `frontier`. */
  readonly id: string;
  readonly kind: ModelProviderKind;
  readonly label: string;
  /** The model id this tier serves, or null when unconfigured. */
  readonly model: string | null;
  /** The base URL host (no secrets), or null when unconfigured. */
  readonly endpoint: string | null;
  /** Whether this tier authenticates with an API key. */
  readonly requiresKey: boolean;
  /** True once the env for this tier is fully set. */
  readonly configured: boolean;
  /** True for the tier a run uses when nothing more specific is chosen. */
  readonly isDefault: boolean;
}

const DEFAULT_LOCAL_BASE_URL = 'http://localhost:11434/v1';

/** Sovereign first, frontier last — the controlled-fallback priority order. */
const PRIORITY: ModelProviderKind[] = ['LOCAL', 'SELF_HOSTED', 'FRONTIER'];

/** Strip any credentials from a URL before it leaves the server. */
function safeEndpoint(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url.replace(/\/\/[^@/]+@/, '//'); // best-effort strip user:pass@
  }
}

/**
 * The three tiers as descriptors, each marked configured/default. Always returns
 * all three (an unconfigured tier shows as a setup target), in priority order.
 */
export function listModelProviders(env: NodeJS.ProcessEnv = process.env): ModelProvider[] {
  const local = {
    id: 'local',
    kind: 'LOCAL' as const,
    label: 'Local (Ollama / llama.cpp)',
    model: env.LUMEY_LOCAL_MODEL ?? null,
    endpoint: safeEndpoint(env.LUMEY_LOCAL_MODEL_URL) ?? (env.LUMEY_LOCAL_MODEL ? DEFAULT_LOCAL_BASE_URL : null),
    requiresKey: false,
    configured: Boolean(env.LUMEY_LOCAL_MODEL),
  };
  const selfHosted = {
    id: 'self-hosted',
    kind: 'SELF_HOSTED' as const,
    label: 'Self-hosted OSS (vLLM / TGI)',
    model: env.LUMEY_SELFHOSTED_MODEL ?? null,
    endpoint: safeEndpoint(env.LUMEY_SELFHOSTED_URL),
    requiresKey: Boolean(env.LUMEY_SELFHOSTED_API_KEY),
    configured: Boolean(env.LUMEY_SELFHOSTED_MODEL && env.LUMEY_SELFHOSTED_URL),
  };
  const frontier = {
    id: 'frontier',
    kind: 'FRONTIER' as const,
    label: 'Frontier API (controlled)',
    model: env.LUMEY_FRONTIER_MODEL ?? null,
    endpoint: safeEndpoint(env.LUMEY_FRONTIER_URL),
    requiresKey: true,
    configured: Boolean(env.LUMEY_FRONTIER_MODEL && env.LUMEY_FRONTIER_URL && env.LUMEY_FRONTIER_API_KEY),
  };

  const byKind: Record<ModelProviderKind, Omit<ModelProvider, 'isDefault'>> = {
    LOCAL: local,
    SELF_HOSTED: selfHosted,
    FRONTIER: frontier,
  };

  const defaultKind = resolveDefaultKind(env, byKind);
  return PRIORITY.map((kind) => ({ ...byKind[kind], isDefault: kind === defaultKind }));
}

/**
 * The default tier: honour `LUMEY_MODEL_BACKEND` (back-compat: `frontier`/`local`)
 * when that tier is configured, else the first configured tier in priority order.
 */
function resolveDefaultKind(
  env: NodeJS.ProcessEnv,
  byKind: Record<ModelProviderKind, Omit<ModelProvider, 'isDefault'>>,
): ModelProviderKind | null {
  const backend = env.LUMEY_MODEL_BACKEND?.toLowerCase();
  const hinted: ModelProviderKind | undefined =
    backend === 'frontier' ? 'FRONTIER' : backend === 'self-hosted' || backend === 'selfhosted' ? 'SELF_HOSTED' : backend === 'local' ? 'LOCAL' : undefined;
  if (hinted && byKind[hinted].configured) return hinted;
  return PRIORITY.find((k) => byKind[k].configured) ?? null;
}

/**
 * Pick the provider for a run: a preferred model (from policy) wins if its tier
 * is configured; otherwise the default; otherwise the first configured tier.
 * Returns null when nothing is configured at all.
 */
export function selectProvider(providers: readonly ModelProvider[], preferredModel?: string | null): ModelProvider | null {
  if (preferredModel) {
    const match = providers.find((p) => p.configured && p.model === preferredModel);
    if (match) return match;
  }
  return providers.find((p) => p.configured && p.isDefault) ?? providers.find((p) => p.configured) ?? null;
}
