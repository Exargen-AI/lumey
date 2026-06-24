import { Request, Response, NextFunction } from 'express';

/**
 * Defense-in-depth against prototype pollution.
 *
 * Round 2 finding R3: Zod's default `.object()` strips unknown keys, so a
 * payload containing `__proto__`, `constructor`, or `prototype` was already
 * being filtered before Prisma saw it — and Prisma itself ignores nested
 * `__proto__` because of how its query engine serializes. So in practice
 * we couldn't find an exploitable path. BUT:
 *
 *   1. Not every code path runs a payload through Zod (file upload metadata,
 *      ad-hoc handlers, future endpoints).
 *   2. Some Zod schemas use `.passthrough()` for forward-compat (e.g. CMS
 *      `data` blob), which would let those keys through.
 *   3. The cost of a recursive walk on a 25MB payload is negligible — JSON.
 *      parse already did the deep walk; we're piggy-backing.
 *
 * This middleware deletes `__proto__`, `constructor`, and `prototype` keys
 * recursively from `req.body` BEFORE any handler sees it. Same approach
 * Express's own docs recommend for the rare case `app.set('query parser')`
 * receives raw user JSON.
 *
 * Note: we do NOT walk arrays past 10k entries or recurse past depth 32.
 * Both are paranoid-but-cheap caps so an attacker can't OOM us by sending
 * a million-element array of nested objects.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;
// 2026-05-23 audit fix: the original comment promised "we do NOT walk
// arrays past 10k entries" but the cap was never implemented. With the
// body-parser limit at 25MB, an authenticated attacker could send a
// massive JSON array and pin the event loop walking it. The cap matches
// the original intent — beyond 10k we trust that any prototype-pollution
// payload is well within the first 10k entries (real-world arrays are
// tasks lists, comment threads, AC items — all far below this).
const MAX_ARRAY_WALK = 10_000;

function strip(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return value;
  if (value == null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    const limit = Math.min(value.length, MAX_ARRAY_WALK);
    for (let i = 0; i < limit; i++) {
      strip(value[i], depth + 1);
    }
    return value;
  }

  // Plain object — delete dangerous own keys, recurse into the rest.
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      // Object.defineProperty so a getter on `__proto__` can't re-throw.
      try {
        delete (value as Record<string, unknown>)[key];
      } catch {
        // Some hosts make __proto__ non-configurable; if delete fails, null
        // it out so it can't pollute downstream lookups via `in` checks.
        try { (value as Record<string, unknown>)[key] = undefined; } catch { /* ignore */ }
      }
      continue;
    }
    strip((value as Record<string, unknown>)[key], depth + 1);
  }

  return value;
}

export function stripDangerousKeys(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    strip(req.body, 0);
  }
  next();
}
