/**
 * Pulse — Per-employee productivity score (2026-05-29).
 *
 * Pure function that maps an employee's daily activity into a 0-100
 * score + a band (HIGH / MEDIUM / LOW) + an itemised breakdown so the
 * dashboard can explain "why is this employee a 42?".
 *
 * Inspired by deviceRisk.service.ts — same pure-function pattern so
 * the score is deterministic and easy to test.
 *
 * Bands:
 *   HIGH    score >= 70 — heads down
 *   MEDIUM  score 40-69 — typical day with some distraction
 *   LOW     score < 40  — minimal productive output OR active gaming
 *
 * Versioning: SCORING_VERSION bumps with rubric changes. The current
 * value is surfaced in the API response so historical interpretations
 * remain clear when the rubric evolves.
 */

export const SCORING_VERSION = 1;

export interface ProductivityScoreInputs {
  // Time spent in foreground per category today, in seconds.
  productiveSeconds: number;
  communicationSeconds: number;
  entertainmentSeconds: number;
  personalSeconds: number;
  unknownSeconds: number;
  tamperSeconds: number;
  // Total screen-time today (sum of active+idle+locked from the
  // power-state buckets). Used to normalise the productive-share
  // calculation.
  activeSeconds: number;
}

export type ProductivityBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ProductivityScoreResult {
  score: number;
  band: ProductivityBand;
  scoringVersion: number;
  breakdown: ProductivityBreakdownItem[];
  // Headline human-readable summary surfaced in the UI.
  summary: string;
}

export interface ProductivityBreakdownItem {
  kind:
    | 'PRODUCTIVE_SHARE'
    | 'COMMUNICATION_CREDIT'
    | 'ENTERTAINMENT_PENALTY'
    | 'PERSONAL_PENALTY'
    | 'TAMPER_PENALTY'
    | 'NO_ACTIVITY';
  // Positive = points added; negative = points subtracted.
  delta: number;
  message: string;
}

// ─── Tunables ────────────────────────────────────────────────────────

// Communication time is credited at 70% — Slack and Teams are work but
// you can rabbit-hole on them too. Tunable.
const COMMUNICATION_CREDIT_FACTOR = 0.7;

// Entertainment penalty: -10 per hour beyond a 1-hour daily allowance.
const ENTERTAINMENT_FREE_SECONDS = 60 * 60;
const ENTERTAINMENT_PENALTY_PER_HOUR = 10;

// Personal-browsing penalty: -10 per hour beyond a 2-hour daily allowance.
const PERSONAL_FREE_SECONDS = 2 * 60 * 60;
const PERSONAL_PENALTY_PER_HOUR = 10;

// Tamper-tool penalty: 50-point hit (single biggest penalty in the
// rubric). You can't claim productive time if you were running a
// mouse jiggler.
const TAMPER_PENALTY = 50;

const NO_ACTIVITY_THRESHOLD_SECONDS = 30; // <30s screen time → "no data"

const HIGH_THRESHOLD = 70;
const MEDIUM_THRESHOLD = 40;

// ─── Pure scorer ─────────────────────────────────────────────────────

export function computeProductivityScore(
  input: ProductivityScoreInputs,
): ProductivityScoreResult {
  const breakdown: ProductivityBreakdownItem[] = [];
  const active = Math.max(0, input.activeSeconds);

  if (active < NO_ACTIVITY_THRESHOLD_SECONDS) {
    return {
      score: 0,
      band: 'LOW',
      scoringVersion: SCORING_VERSION,
      breakdown: [
        {
          kind: 'NO_ACTIVITY',
          delta: 0,
          message: 'No activity reported yet today',
        },
      ],
      summary: 'No activity reported yet today',
    };
  }

  // 1. Base = (productive + 0.7 * communication) / activeSeconds × 100.
  //    This is the fraction of today's screen time spent on productive
  //    + communication apps, weighted.
  const productiveSeconds = Math.max(0, input.productiveSeconds);
  const communicationSeconds = Math.max(0, input.communicationSeconds);
  const creditedCommunication = communicationSeconds * COMMUNICATION_CREDIT_FACTOR;
  const baseNumerator = productiveSeconds + creditedCommunication;
  const baseRaw = Math.min(100, (baseNumerator / active) * 100);

  breakdown.push({
    kind: 'PRODUCTIVE_SHARE',
    delta: Math.round((productiveSeconds / active) * 100),
    message: `${Math.round((productiveSeconds / active) * 100)}% of screen time on productive apps`,
  });
  if (communicationSeconds > 0) {
    breakdown.push({
      kind: 'COMMUNICATION_CREDIT',
      delta: Math.round((creditedCommunication / active) * 100),
      message: `${Math.round((creditedCommunication / active) * 100)}% credited for communication (Slack/Teams/Zoom)`,
    });
  }

  let score = baseRaw;

  // 2. Entertainment penalty.
  const entertainment = Math.max(0, input.entertainmentSeconds);
  if (entertainment > ENTERTAINMENT_FREE_SECONDS) {
    const overHours = (entertainment - ENTERTAINMENT_FREE_SECONDS) / 3600;
    const penalty = Math.min(40, overHours * ENTERTAINMENT_PENALTY_PER_HOUR);
    score -= penalty;
    breakdown.push({
      kind: 'ENTERTAINMENT_PENALTY',
      delta: -Math.round(penalty),
      message: `${Math.round(entertainment / 60)} min entertainment (penalty for time beyond 1h)`,
    });
  }

  // 3. Personal-browsing penalty.
  const personal = Math.max(0, input.personalSeconds);
  if (personal > PERSONAL_FREE_SECONDS) {
    const overHours = (personal - PERSONAL_FREE_SECONDS) / 3600;
    const penalty = Math.min(20, overHours * PERSONAL_PENALTY_PER_HOUR);
    score -= penalty;
    breakdown.push({
      kind: 'PERSONAL_PENALTY',
      delta: -Math.round(penalty),
      message: `${Math.round(personal / 60)} min personal browsing (penalty for time beyond 2h)`,
    });
  }

  // 4. Tamper-tool penalty (the big one).
  if (input.tamperSeconds > 0) {
    score -= TAMPER_PENALTY;
    breakdown.push({
      kind: 'TAMPER_PENALTY',
      delta: -TAMPER_PENALTY,
      message: 'Tamper tool detected — score capped',
    });
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const band: ProductivityBand =
    finalScore >= HIGH_THRESHOLD
      ? 'HIGH'
      : finalScore >= MEDIUM_THRESHOLD
        ? 'MEDIUM'
        : 'LOW';

  // Headline summary — picked to surface the most useful signal.
  let summary: string;
  if (input.tamperSeconds > 0) {
    summary = 'Tamper tool detected; productive output not trusted';
  } else if (entertainment > ENTERTAINMENT_FREE_SECONDS * 2) {
    summary = `${Math.round(entertainment / 60)} min entertainment today`;
  } else if (productiveSeconds > active * 0.6) {
    summary = 'Heads-down day';
  } else if (band === 'MEDIUM') {
    summary = 'Mixed day — some productive, some distracted';
  } else {
    summary = 'Mostly off the laptop';
  }

  return {
    score: finalScore,
    band,
    scoringVersion: SCORING_VERSION,
    breakdown,
    summary,
  };
}
