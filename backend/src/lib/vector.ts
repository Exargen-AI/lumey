/**
 * Vector helpers for semantic similarity. Cosine similarity measures the *angle*
 * between two embedding vectors (1 = same meaning, 0 = unrelated), independent of
 * magnitude — the standard relevance score for RAG retrieval.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Rank items by cosine similarity of their vector to the query; highest first. */
export function rankBySimilarity<T>(
  query: readonly number[],
  items: readonly { item: T; vector: readonly number[] }[],
  limit: number,
): T[] {
  return items
    .map(({ item, vector }) => ({ item, score: cosineSimilarity(query, vector) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((s) => s.item);
}
