/**
 * Pulse — STANDUP body normalisation helpers (Wave 12).
 *
 * Centralises the "is this standup body a duplicate of recent days?"
 * logic that feeds the STANDUP scorer's `standup_duplicate_count`
 * gaming guard.
 *
 * Previously inlined in `dailyUpdate.service.ts` as a lowercase +
 * collapse-whitespace pass. That was trivially gameable — adding `.`,
 * `!`, version numbers (`v1`, `v2`), trailing space, or emojis all
 * defeated the hash dedup.
 *
 * The new normalisation strips ALL non-letter characters (digits,
 * punctuation, emoji, symbols, separators) before hashing, so the
 * common adversarial mutations collapse to the same hash:
 *
 *   "Working on tasks."      → "workingontasks"
 *   "Working on tasks!"      → "workingontasks"
 *   "Working on tasks 1"     → "workingontasks"
 *   "Working on tasks v1"    → "workingontasksv"  ← `v` preserved
 *   "Working on tasks 🚀"    → "workingontasks"
 *   "Working   on  tasks"    → "workingontasks"
 *
 * Body length is reported separately based on the VISIBLE
 * (whitespace-collapsed lowercase) body so the body-too-short guard
 * still trips on <50-char attempts even when the hash-normalised
 * form is short.
 */

import { createHash } from 'crypto';

export const STANDUP_HASH_PREFIX_LEN = 16;

/** Normalise a standup body for duplicate-hash detection. */
export function normaliseStandupForHash(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    // \p{L} = any Unicode letter, \p{Mn} = combining mark.
    // Everything else (digits, punctuation, emoji, symbols, sep) is
    // stripped. The `\s` is intentionally kept so words don't fuse.
    .replace(/[^\p{L}\p{Mn}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Visible body length used by the body-too-short gaming guard. */
export function visibleStandupLength(raw: string): number {
  return raw.toLowerCase().replace(/\s+/g, ' ').trim().length;
}

/**
 * Build the hash prefix the scorer compares across days. Slicing to
 * 16 hex chars (= 64 bits of entropy) is plenty for the recent-N-days
 * dedup horizon while keeping the JSON payload small.
 */
export function standupBodyHash(raw: string): string {
  return createHash('sha256')
    .update(normaliseStandupForHash(raw))
    .digest('hex')
    .slice(0, STANDUP_HASH_PREFIX_LEN);
}
