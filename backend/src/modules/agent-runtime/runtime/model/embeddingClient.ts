/**
 * EmbeddingClient — turns text into a vector (an "embedding") that captures
 * meaning, so memory recall can find *relevant* facts by similarity rather than
 * just recency (semantic RAG). Same posture as the ModelClient: a thin raw-HTTP
 * client over the OpenAI-compatible `/embeddings` endpoint, pointed at a **local**
 * model (e.g. `nomic-embed-text` via Ollama) — never an online API.
 */
export interface EmbeddingClient {
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingClientConfig {
  /** OpenAI-compatible base, e.g. `http://localhost:11434/v1`. */
  readonly baseUrl: string;
  /** Embedding model id, e.g. `nomic-embed-text`. */
  readonly model: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export function createEmbeddingClient(cfg: EmbeddingClientConfig): EmbeddingClient {
  if (!cfg.baseUrl || !cfg.model) throw new Error('createEmbeddingClient: baseUrl and model are required');
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/embeddings`;

  async function embedMany(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, input: texts }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`embedding request failed (${res.status})`);
      const json = (await res.json()) as { data?: { embedding?: number[] }[] };
      if (!Array.isArray(json.data)) throw new Error('embedding response had no data array');
      return json.data.map((d) => d.embedding ?? []);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    model: cfg.model,
    async embed(text) {
      return (await embedMany([text]))[0] ?? [];
    },
    embedMany,
  };
}

/**
 * Build an embedding client from env, or null when none is configured (so
 * semantic recall is opt-in and degrades gracefully to recency).
 *   LUMEY_EMBED_MODEL (e.g. nomic-embed-text) · LUMEY_LOCAL_MODEL_URL (opt)
 */
export function embeddingClientFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingClient | null {
  const model = env.LUMEY_EMBED_MODEL;
  if (!model) return null;
  return createEmbeddingClient({ model, baseUrl: env.LUMEY_LOCAL_MODEL_URL ?? 'http://localhost:11434/v1' });
}
