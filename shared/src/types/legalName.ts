// Shared legal-name validation. Used by:
//   - Frontend (`LegalNameCaptureStep`) for inline form validation.
//   - Backend (`PATCH /users/me/legal-name`) at the route boundary as a
//     defense-in-depth check.
//
// We are intentionally STRICT here — the legal name is what gets pinned
// onto every compliance signature, so first-name shorthand ("preetham")
// or junk ("xx yy") must be rejected. The bar is "plausibly a real
// person's full legal name", not "passes any character-count check".

const ONLY_LETTERS_HYPHEN_APOSTROPHE_DOT_SPACE = /^[\p{L}\p{M}\-'.\s]+$/u;
const HAS_LETTER = /\p{L}/u;
const VOWEL = /[aeiouyà-ü]/i;

export interface LegalNameValidationResult {
  ok: boolean;
  /** Human-readable reason for failure. Null when ok=true. */
  reason: string | null;
  /** Normalized form (trimmed, single-spaced). Useful for storing. */
  normalized: string;
}

/**
 * Validate a typed-out full legal name. Caller decides what to do with
 * the rejection (UI hint, 400 response, etc.).
 *
 * Rules in order of strictness:
 *   1. Trim + collapse internal whitespace; reject empty.
 *   2. Total length 5..120 chars.
 *   3. Only letters (any script), hyphens, apostrophes, periods, spaces.
 *   4. At least 2 tokens (first + last name).
 *   5. Each token at least 2 chars and contains at least one letter.
 *   6. Reject obvious junk: all-same-character tokens, no-vowel pure-Latin
 *      tokens longer than 3 chars, identical first/last token (`"xx xx"`).
 */
export function validateLegalName(input: string): LegalNameValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'Legal name is required.', normalized: '' };
  }

  const normalized = input.trim().replace(/\s+/g, ' ');

  if (normalized.length === 0) {
    return { ok: false, reason: 'Legal name is required.', normalized };
  }
  if (normalized.length < 5) {
    return { ok: false, reason: 'Legal name is too short.', normalized };
  }
  if (normalized.length > 120) {
    return { ok: false, reason: 'Legal name is too long (max 120 characters).', normalized };
  }

  if (!ONLY_LETTERS_HYPHEN_APOSTROPHE_DOT_SPACE.test(normalized)) {
    return {
      ok: false,
      reason: 'Legal name can only contain letters, spaces, hyphens, apostrophes, and periods.',
      normalized,
    };
  }

  const tokens = normalized.split(' ').filter((t) => t.length > 0);
  if (tokens.length < 2) {
    return {
      ok: false,
      reason: 'Please enter your full legal name (first and last name).',
      normalized,
    };
  }

  for (const t of tokens) {
    if (t.length < 2) {
      return {
        ok: false,
        reason: 'Each part of your name must be at least 2 characters.',
        normalized,
      };
    }
    if (!HAS_LETTER.test(t)) {
      return { ok: false, reason: 'Each part of your name must contain letters.', normalized };
    }
    // All-same-character: "aaaa", "----"
    if (t.length >= 2 && /^(.)\1+$/u.test(t)) {
      return { ok: false, reason: 'Please enter a real legal name.', normalized };
    }
    // Pure-Latin tokens must contain at least one vowel (rule of thumb to
    // catch keyboard mashing like "xqz pdr"). Only applied to tokens > 3
    // chars and only when the token is purely ASCII-letter — non-Latin
    // scripts have their own vowel rules.
    if (t.length > 3 && /^[A-Za-z]+$/.test(t) && !VOWEL.test(t)) {
      return { ok: false, reason: 'Please enter a real legal name.', normalized };
    }
  }

  // First and last token identical → not a real name.
  if (tokens[0].toLowerCase() === tokens[tokens.length - 1].toLowerCase()) {
    return { ok: false, reason: 'Please enter your real first and last name.', normalized };
  }

  return { ok: true, reason: null, normalized };
}

/**
 * Case- and whitespace-insensitive comparison used at signature time.
 * Returns true iff `typed` matches `stored` after normalization. Caller
 * is responsible for ensuring `stored` is non-null (no legal name on
 * file means signing should be blocked upstream).
 */
export function legalNameMatches(typed: string, stored: string): boolean {
  const a = typed.trim().toLowerCase().replace(/\s+/g, ' ');
  const b = stored.trim().toLowerCase().replace(/\s+/g, ' ');
  return a.length > 0 && a === b;
}
