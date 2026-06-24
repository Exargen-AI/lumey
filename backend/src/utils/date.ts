/**
 * Format a Date as `YYYY-MM-DD` in **UTC** (Wave 12 fix).
 *
 * The Pulse scoring pipeline runs in UTC throughout — `scoreCadences`
 * (DAILY / WEEKLY ISO Mon-Sun / MONTHLY windows), `rolling30DayWindow`,
 * the per-snapshot emit in `deviceTelemetry.service.ts`. If
 * `toDateOnlyString` returns local-TZ dates while the scoring windows
 * use UTC, the `date` field on emitted events drifts by ±1 day around
 * midnight in any non-UTC zone — silently breaking the per-day dedup
 * logic in `presence.scorer.ts` (`clockedSecondsByDate` /
 * `pulseByDate`) and `standup.scorer.ts` (`latestByDate`).
 *
 * Pre-Wave-12 this happened to work because Railway runs in UTC, but
 * it broke locally on any non-UTC laptop — e.g. an India-based dev
 * running the dev-seed on macOS would see different date strings than
 * the worker computed for the same moment.
 *
 * UTC throughout is the safe contract. If we ever want per-user TZ
 * windows (the wave-6+ enhancement noted in the design doc), that
 * goes via an explicit `tz` argument; `toDateOnlyString` stays UTC.
 */
export function toDateOnlyString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

