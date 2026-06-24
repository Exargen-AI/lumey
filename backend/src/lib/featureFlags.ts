/**
 * Pulse Multi-Signal Productivity Score — feature-flag scaffold.
 *
 * Lightweight env-driven flags for code paths still in beta. The
 * Command Center backend does not yet have a structured feature-flag
 * system (LaunchDarkly / Unleash / OpenFeature etc.); this module
 * gives us one centralised place to read `process.env.FEATURE_*`
 * variables so emitters do not sprinkle `if (process.env...) ` checks
 * everywhere.
 *
 * When a richer flag system lands, this module's public API
 * (`isFeatureEnabled`, `withFeature`) stays the same and the
 * implementation switches behind it. Callers do not change.
 *
 * Flag convention:
 *   - Flag name: `pulseCompositeScore.beta`
 *   - Env var:   `FEATURE_PULSE_COMPOSITE_SCORE_BETA`
 *   - Default:   off (env unset or 'false')
 *
 * To turn on locally: `export FEATURE_PULSE_COMPOSITE_SCORE_BETA=true`
 * In production: set on Railway service env vars.
 */

const KNOWN_FLAGS = {
  /**
   * Wave-1 beta of the composite productivity score (PR #33).
   * When OFF: outbox emit is a no-op; scoreRecomputeWorker stays idle;
   * Reports tab keeps showing the legacy 0-100 productivity score.
   * When ON: events flow, scores compute, dashboard reads the new
   *          composite (with a "beta" chip until GA).
   */
  'pulseCompositeScore.beta': 'FEATURE_PULSE_COMPOSITE_SCORE_BETA',
} as const;

export type FeatureFlag = keyof typeof KNOWN_FLAGS;

/**
 * Returns true iff the env var corresponding to `flag` is set to one
 * of {1, true, yes, on} (case-insensitive). Unset, empty, or any
 * other value returns false.
 *
 * Re-reads `process.env` on every call so flips during test runs (via
 * `vi.stubEnv`) take effect immediately — no module-level memoisation.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const envVar = KNOWN_FLAGS[flag];
  const raw = (process.env[envVar] || '').toLowerCase().trim();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * Convenience wrapper for "run this if flag on, else return fallback".
 *
 *   const x = await withFeature('pulseCompositeScore.beta', async () => 5, 0);
 */
export async function withFeature<T>(
  flag: FeatureFlag,
  fn: () => Promise<T> | T,
  fallback: T,
): Promise<T> {
  return isFeatureEnabled(flag) ? fn() : fallback;
}
