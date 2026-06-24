/**
 * Run usage + cost estimation. The platform measures **tokens**; the SDK turns
 * them into a **cost** only when the caller supplies pricing. Rates change and
 * are deployment-specific, so the client bakes in none — it provides the
 * mechanism, you provide (and own) the numbers. No pricing ⇒ `estimatedCostUsd`
 * is `null`, never a guess.
 */
export interface ModelPricing {
  /** USD per 1,000,000 input (prompt) tokens. */
  readonly inputPer1M: number;
  /** USD per 1,000,000 output (completion) tokens. */
  readonly outputPer1M: number;
}

export interface RunUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  /** USD estimate when pricing was supplied, else null. */
  readonly estimatedCostUsd: number | null;
}

export function estimateCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  pricing: ModelPricing | null | undefined,
): number | null {
  if (!pricing) return null;
  return (usage.inputTokens * pricing.inputPer1M + usage.outputTokens * pricing.outputPer1M) / 1_000_000;
}
