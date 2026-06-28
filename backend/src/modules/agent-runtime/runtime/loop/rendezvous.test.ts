import { describe, it, expect } from 'vitest';
import { Rendezvous } from './rendezvous';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Rendezvous', () => {
  it('parks until settled and resolves with the delivered value', async () => {
    const r = new Rendezvous<{ ok: boolean }>();
    let got: { ok: boolean } | null = null;
    const waiting = r.wait().then((v) => {
      got = v;
    });
    await tick();
    expect(r.isWaiting()).toBe(true);

    expect(r.settle({ ok: true })).toBe(true);
    await waiting;
    expect(got).toEqual({ ok: true });
    expect(r.isWaiting()).toBe(false);
  });

  it('settle() === false when nothing is waiting', () => {
    const r = new Rendezvous<string>();
    expect(r.settle('x')).toBe(false);
  });

  it('resolves null when aborted while waiting, and a late settle is a no-op', async () => {
    const r = new Rendezvous<string>();
    const ac = new AbortController();
    const waiting = r.wait(ac.signal);
    await tick();
    ac.abort();
    expect(await waiting).toBeNull();
    expect(r.isWaiting()).toBe(false);
    expect(r.settle('too late')).toBe(false);
  });

  it('returns null immediately if the signal is already aborted', async () => {
    const r = new Rendezvous<string>();
    const ac = new AbortController();
    ac.abort();
    expect(await r.wait(ac.signal)).toBeNull();
  });
});
