import { describe, it, expect } from 'vitest';
import { ClarificationController } from './clarificationController';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ClarificationController', () => {
  it('parks until answered and resolves with the answer text', async () => {
    const c = new ClarificationController();
    let resolved: string | null = 'unset';
    const waiting = c.wait().then((a) => {
      resolved = a;
    });

    await tick();
    expect(c.isWaiting()).toBe(true);
    expect(resolved).toBe('unset'); // still parked

    expect(c.answer('use postgres')).toBe(true);
    await waiting;
    expect(resolved).toBe('use postgres');
    expect(c.isWaiting()).toBe(false);
  });

  it('reports answer() === false when nothing is waiting', () => {
    const c = new ClarificationController();
    expect(c.isWaiting()).toBe(false);
    expect(c.answer('nobody asked')).toBe(false);
  });

  it('resolves null when the run is aborted while waiting (cancel)', async () => {
    const c = new ClarificationController();
    const ac = new AbortController();
    let resolved: string | null = 'unset';
    const waiting = c.wait(ac.signal).then((a) => {
      resolved = a;
    });
    await tick();
    expect(c.isWaiting()).toBe(true);

    ac.abort();
    await waiting;
    expect(resolved).toBeNull();
    expect(c.isWaiting()).toBe(false);
  });

  it('returns null immediately if the signal is already aborted', async () => {
    const c = new ClarificationController();
    const ac = new AbortController();
    ac.abort();
    expect(await c.wait(ac.signal)).toBeNull();
    expect(c.isWaiting()).toBe(false);
  });

  it('a late answer after an abort is a no-op (settled once)', async () => {
    const c = new ClarificationController();
    const ac = new AbortController();
    const waiting = c.wait(ac.signal);
    await tick();
    ac.abort();
    expect(await waiting).toBeNull();
    // the loop has moved on; a stray answer must not throw or resurrect anything
    expect(c.answer('too late')).toBe(false);
  });
});
