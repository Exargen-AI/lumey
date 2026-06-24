/**
 * 2026-05-23 catastrophic-tier coverage for `validate` middleware.
 *
 * Every input-validated endpoint (~80 routes) goes through this. If it
 * regresses, the server starts trusting client-supplied fields it shouldn't,
 * or silently drops fields the handler expects.
 *
 * The middleware's contract:
 *   1. zod.safeParse over { body, query, params } — never throws
 *   2. On failure: forwards the ZodError via `next(err)` so errorHandler
 *      can render the documented 400 shape
 *   3. On success: REPLACES req.body / req.query / req.params with the
 *      parsed values. This matters because zod can coerce types
 *      (string → number, "true" → true) and strip unknown fields per
 *      `.strict()` / `.strip()` rules. Handlers MUST read the parsed
 *      data, not the raw req.* input — otherwise a string "1" sneaks
 *      through where the handler expects a number 1.
 *   4. Falls back to the original req.* slot when zod doesn't validate
 *      that slot (e.g., body-only schema doesn't have a `query` field).
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validate } from './validate';

function makeReq(opts: { body?: any; query?: any; params?: any }) {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    params: opts.params ?? {},
  } as any;
}

describe('validate — happy path', () => {
  it('calls next() with no argument when the schema passes', () => {
    const schema = z.object({
      body: z.object({ title: z.string() }),
    });
    const req = makeReq({ body: { title: 'Hello' } });
    const next = vi.fn();
    validate(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('REPLACES req.body with the parsed value (zod coercion is visible to the handler)', () => {
    // Zod can coerce "42" → 42. Without the replacement at line 16 of
    // validate.ts, the handler would still see a string. Pin this.
    const schema = z.object({
      body: z.object({ count: z.coerce.number() }),
    });
    const req = makeReq({ body: { count: '42' } });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.body).toEqual({ count: 42 });
    expect(typeof req.body.count).toBe('number');
  });

  it('REPLACES req.query (handlers reading req.query.limit get the parsed value, not the raw string)', () => {
    const schema = z.object({
      query: z.object({ limit: z.coerce.number().default(50) }),
    });
    const req = makeReq({ query: { limit: '200' } });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.query).toEqual({ limit: 200 });
  });

  it('REPLACES req.params', () => {
    const schema = z.object({
      params: z.object({ id: z.string().uuid() }),
    });
    const id = '00000000-0000-0000-0000-000000000001';
    const req = makeReq({ params: { id } });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.params.id).toBe(id);
  });

  it('STRIPS unknown body fields by default (zod .strip()) — handlers cannot see fields the client snuck in', () => {
    // This is the security-relevant property. A client posting
    //   { title: "OK", role: "SUPER_ADMIN" }
    // to an endpoint whose schema is { title: z.string() } should NOT
    // have `role` reach the handler. Default zod behavior strips it.
    const schema = z.object({
      body: z.object({ title: z.string() }),
    });
    const req = makeReq({ body: { title: 'OK', role: 'SUPER_ADMIN' } });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.body).toEqual({ title: 'OK' });
    expect(req.body.role).toBeUndefined();
  });

  it('applies zod defaults to req.body', () => {
    const schema = z.object({
      body: z.object({
        title: z.string(),
        priority: z.string().default('P2'),
      }),
    });
    const req = makeReq({ body: { title: 'X' } });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.body.priority).toBe('P2');
  });
});

describe('validate — failure path', () => {
  it('forwards the ZodError via next(err) (errorHandler renders the 400)', () => {
    const schema = z.object({
      body: z.object({ title: z.string() }),
    });
    const req = makeReq({ body: { title: 123 } }); // wrong type
    const next = vi.fn();
    validate(schema)(req, {} as any, next);
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]?.[0];
    expect(err).toBeDefined();
    expect(err?.name).toBe('ZodError');
  });

  it('does NOT mutate req.body when validation fails (handler shouldn\'t see partially-valid data)', () => {
    const schema = z.object({
      body: z.object({ title: z.string(), count: z.number() }),
    });
    const original = { title: 'OK', count: 'not a number' };
    const req = makeReq({ body: original });
    validate(schema)(req, {} as any, vi.fn());
    // Original retained — no half-coerced state.
    expect(req.body).toBe(original);
  });

  it('does NOT call next() twice on a validation failure (no double-handling)', () => {
    const schema = z.object({
      body: z.object({ title: z.string() }),
    });
    const next = vi.fn();
    validate(schema)(makeReq({ body: { title: 123 } }), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('validate — partial-schema fallback (the body OR query OR params shape)', () => {
  it('preserves req.query when the schema does not validate query', () => {
    const schema = z.object({
      body: z.object({ title: z.string() }),
      // no `query` field in the schema
    });
    const originalQuery = { foo: 'bar' };
    const req = makeReq({ body: { title: 'X' }, query: originalQuery });
    validate(schema)(req, {} as any, vi.fn());
    // The middleware falls back to req.query — handler still sees the raw value.
    expect(req.query).toBe(originalQuery);
  });

  it('preserves req.params when the schema does not validate params', () => {
    const schema = z.object({
      body: z.object({ title: z.string() }),
    });
    const originalParams = { id: 'p1' };
    const req = makeReq({ body: { title: 'X' }, params: originalParams });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.params).toBe(originalParams);
  });

  it('preserves req.body when a query-only schema is used', () => {
    const schema = z.object({
      query: z.object({ q: z.string() }),
    });
    const originalBody = { whatever: 1 };
    const req = makeReq({ query: { q: 'find me' }, body: originalBody });
    validate(schema)(req, {} as any, vi.fn());
    expect(req.body).toBe(originalBody);
  });
});

describe('validate — defensive single-call invariant', () => {
  it('on success: next() called EXACTLY once, no error passed', () => {
    const schema = z.object({
      body: z.object({ title: z.string() }),
    });
    const next = vi.fn();
    validate(schema)(makeReq({ body: { title: 'X' } }), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
  });

  it('returns no synchronous value (next-based flow, not return-based)', () => {
    const schema = z.object({ body: z.object({ x: z.string() }) });
    const result = validate(schema)(makeReq({ body: { x: 'x' } }), {} as any, vi.fn());
    expect(result).toBeUndefined();
  });
});
