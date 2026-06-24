/**
 * Email normalization. Canonical form is `trim()` + lowercase ASCII.
 *
 * Why we need this:
 *
 *   The `User.email` column is `String @unique` in Postgres, and Postgres
 *   string comparison is case-sensitive by default. Before normalization
 *   was in place, a user who registered with `John@Exargen.in` and later
 *   logged in with `john@exargen.in` (or vice-versa) hit a hard
 *   "Invalid email or password" — the lookup misses because the strings
 *   don't byte-match. Reported as a prod bug 2026-05-21.
 *
 * Why a helper instead of inlining `.toLowerCase()`:
 *
 *   1. Single chokepoint for future tweaks (Unicode NFC, IDN, etc.).
 *   2. Easy to grep — `normalizeEmail(` audit shows every entry point.
 *   3. The Zod validators ALSO normalize via `.transform(normalizeEmail)`
 *      so route inputs are canonical the moment they leave the validator
 *      boundary. The service-layer calls are defense-in-depth for
 *      programmatic callers (seeds, scripts, tests) that bypass routes.
 *
 * What we deliberately do NOT do:
 *
 *   - We don't strip Gmail-style `+tags` or dots-in-local-part. Those are
 *     provider conventions, not RFC requirements; treating
 *     `foo+work@gmail.com` and `foo@gmail.com` as the same identity
 *     would silently merge two distinct mailboxes for anyone who isn't
 *     on Gmail.
 *   - We don't punycode IDN domains here. If/when we add Unicode TLD
 *     support, this is the seam to extend.
 */
export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}
