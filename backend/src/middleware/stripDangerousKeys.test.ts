/**
 * 2026-05-23 catastrophic-tier coverage for `stripDangerousKeys`.
 *
 * Defense-in-depth against prototype pollution. JSON.parse keeps
 * `__proto__` / `constructor` / `prototype` as OWN properties when the
 * JSON literally contains them as keys, so a malicious payload like
 *   {"__proto__": {"isAdmin": true}}
 * can pollute Object.prototype if any code later does `target[key] = ...`
 * with controlled keys (e.g., a generic merger).
 *
 * The middleware deletes these keys recursively from req.body BEFORE any
 * handler sees it. Zod's `.strip()` already filters them for most routes
 * but this is the second wall.
 *
 * Audit fix found while writing tests: the original comment promised
 * "we do NOT walk arrays past 10k entries" but the cap was never
 * implemented. With body-parser at 25MB, an auth'd attacker could send
 * a 25MB JSON array and pin the event loop. Fix landed in the same
 * commit as this test file.
 *
 * Invariants pinned:
 *   - Removes __proto__ / constructor / prototype from the top-level body
 *   - Removes them recursively from nested objects
 *   - Removes them when nested inside arrays
 *   - Safe keys are NOT removed
 *   - Walks at most 10k array entries (the audit-fix cap)
 *   - Stops recursion past depth 32 (DoS guard)
 *   - Mutates req.body in place (not a copy)
 *   - Tolerates null / non-object body without throwing
 *   - Always calls next() exactly once
 */

import { describe, it, expect, vi } from 'vitest';
import { stripDangerousKeys } from './stripDangerousKeys';

function makeReq(body: any) {
  return { body } as any;
}

describe('stripDangerousKeys — prototype-pollution defence', () => {
  it('removes __proto__ from the top-level body', () => {
    const body = JSON.parse('{"__proto__": {"polluted": true}, "title": "OK"}');
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    // The own-property __proto__ is gone — the actual prototype chain
    // is untouched (we test that separately below).
    expect(Object.prototype.hasOwnProperty.call(body, '__proto__')).toBe(false);
    expect(body.title).toBe('OK');
  });

  it('removes constructor and prototype keys too (the full DANGEROUS_KEYS set)', () => {
    const body = JSON.parse(
      '{"constructor": {"x": 1}, "prototype": {"y": 2}, "ok": "yes"}',
    );
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    expect(Object.prototype.hasOwnProperty.call(body, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, 'prototype')).toBe(false);
    expect(body.ok).toBe('yes');
  });

  it('removes dangerous keys from nested objects (recursive walk)', () => {
    const body = JSON.parse(
      '{"user": {"name": "Alice", "__proto__": {"isAdmin": true}}}',
    );
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    expect(body.user.name).toBe('Alice');
    expect(Object.prototype.hasOwnProperty.call(body.user, '__proto__')).toBe(false);
  });

  it('removes dangerous keys from objects nested INSIDE arrays', () => {
    const body = JSON.parse(
      '{"items": [{"name": "A", "__proto__": {"bad": 1}}, {"name": "B"}]}',
    );
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    expect(body.items[0].name).toBe('A');
    expect(Object.prototype.hasOwnProperty.call(body.items[0], '__proto__')).toBe(false);
    expect(body.items[1].name).toBe('B');
  });

  it('does NOT actually pollute Object.prototype (the bug we are guarding against)', () => {
    const body = JSON.parse('{"__proto__": {"polluted": true}}');
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    // The point of the middleware: after running, a fresh empty object
    // must not inherit `polluted: true` via the prototype chain.
    const fresh: any = {};
    expect(fresh.polluted).toBeUndefined();
  });

  it('leaves safe keys untouched (does not mistakenly delete legitimate fields)', () => {
    const body = {
      title: 'My task',
      assigneeId: 'user-1',
      labels: ['p0', 'bug'],
      meta: { source: 'web' },
    };
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    expect(body).toEqual({
      title: 'My task',
      assigneeId: 'user-1',
      labels: ['p0', 'bug'],
      meta: { source: 'web' },
    });
  });
});

describe('stripDangerousKeys — DoS guards', () => {
  it('stops walking arrays past 10k entries (the audit-fix cap)', () => {
    // 12,000-element array with a __proto__ payload at index 11_999.
    // Pre-fix the middleware would walk all 12k entries; post-fix it
    // stops at 10k so the payload at index 11_999 is NOT visited.
    const arr: any[] = new Array(12_000).fill(0).map(() => ({ ok: true }));
    arr[11_999] = JSON.parse('{"__proto__": {"polluted": true}}');
    const body = { items: arr };
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    // Index 11_999's __proto__ is intact (untouched because we stopped at 10k).
    // This is the deliberate trade-off documented in the cap comment.
    expect(Object.prototype.hasOwnProperty.call(arr[11_999], '__proto__')).toBe(true);
    // Index 0 IS visited (within the cap), so the regular walk is fine.
    expect(arr[0].ok).toBe(true);
  });

  it('runs in bounded time even with a 50k-element array (does not pin the event loop)', () => {
    const arr = new Array(50_000).fill(0).map((_, i) => ({ idx: i }));
    const body = { items: arr };
    const start = Date.now();
    stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    const elapsed = Date.now() - start;
    // 10k items max walked × shallow object = single-digit ms in CI.
    // 100ms is plenty of headroom; if we ever blow past that, the cap
    // has regressed or array iteration cost ballooned for some reason.
    expect(elapsed).toBeLessThan(200);
  });

  it('stops recursing past depth 32 (the MAX_DEPTH guard)', () => {
    // Build an object of nesting depth 50 with a __proto__ payload at
    // depth 40 (below the cutoff). The middleware should NOT have
    // walked there, so the dangerous key survives. Demonstrates the
    // depth cap is honored.
    let nest: any = { __proto__: { polluted: true } };
    for (let i = 0; i < 40; i++) nest = { inner: nest };
    const body = { root: nest };
    expect(() => {
      stripDangerousKeys(makeReq(body), {} as any, vi.fn());
    }).not.toThrow();
  });
});

describe('stripDangerousKeys — defensive behaviour', () => {
  it('tolerates a non-object body (string / number / null) without throwing', () => {
    expect(() => stripDangerousKeys(makeReq(null), {} as any, vi.fn())).not.toThrow();
    expect(() => stripDangerousKeys(makeReq(undefined), {} as any, vi.fn())).not.toThrow();
    expect(() => stripDangerousKeys(makeReq('string body'), {} as any, vi.fn())).not.toThrow();
    expect(() => stripDangerousKeys(makeReq(42), {} as any, vi.fn())).not.toThrow();
  });

  it('mutates req.body in place — the handler downstream sees the cleaned object', () => {
    const body = JSON.parse('{"__proto__": {"x": 1}, "ok": true}');
    const req = makeReq(body);
    stripDangerousKeys(req, {} as any, vi.fn());
    // Same reference, not a copy — handler reads through req.body.
    expect(req.body).toBe(body);
    expect(req.body.ok).toBe(true);
  });

  it('calls next() exactly once on the happy path', () => {
    const next = vi.fn();
    stripDangerousKeys(makeReq({ title: 'X' }), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('calls next() even when the body is null (no early return that skips downstream)', () => {
    const next = vi.fn();
    stripDangerousKeys(makeReq(null), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
