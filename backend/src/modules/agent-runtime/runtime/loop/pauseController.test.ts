import { describe, it, expect } from 'vitest';
import { PauseController } from './pauseController';

/** Resolve on the next macrotask — lets us assert a promise has NOT resolved. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('PauseController', () => {
  it('resolves waitWhilePaused immediately when not paused (hot path)', async () => {
    const pc = new PauseController();
    let resolved = false;
    await pc.waitWhilePaused().then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true);
    expect(pc.isPaused()).toBe(false);
  });

  it('parks while paused and releases on resume', async () => {
    const pc = new PauseController();
    pc.pause();
    expect(pc.isPaused()).toBe(true);

    let released = false;
    const waiting = pc.waitWhilePaused().then(() => {
      released = true;
    });

    await tick();
    expect(released).toBe(false); // still parked

    pc.resume();
    await waiting;
    expect(released).toBe(true);
    expect(pc.isPaused()).toBe(false);
  });

  it('releases every parked waiter on a single resume', async () => {
    const pc = new PauseController();
    pc.pause();
    let a = false;
    let b = false;
    const wa = pc.waitWhilePaused().then(() => {
      a = true;
    });
    const wb = pc.waitWhilePaused().then(() => {
      b = true;
    });
    await tick();
    expect([a, b]).toEqual([false, false]);
    pc.resume();
    await Promise.all([wa, wb]);
    expect([a, b]).toEqual([true, true]);
  });

  it('lets an abort signal win over a pause (cancel must never strand the loop)', async () => {
    const pc = new PauseController();
    const ac = new AbortController();
    pc.pause();

    let released = false;
    const waiting = pc.waitWhilePaused(ac.signal).then(() => {
      released = true;
    });
    await tick();
    expect(released).toBe(false);

    ac.abort(); // cancel arrives while parked
    await waiting;
    expect(released).toBe(true); // unparked so the loop can observe the abort
  });

  it('does not park when the signal is already aborted', async () => {
    const pc = new PauseController();
    const ac = new AbortController();
    ac.abort();
    pc.pause();
    let resolved = false;
    await pc.waitWhilePaused(ac.signal).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(true); // resolved immediately despite being paused
  });

  it('pause and resume are idempotent', async () => {
    const pc = new PauseController();
    pc.resume(); // no-op when never paused
    pc.pause();
    pc.pause(); // still just paused
    expect(pc.isPaused()).toBe(true);
    const waiting = pc.waitWhilePaused();
    pc.resume();
    pc.resume(); // second resume harmless
    await waiting;
    expect(pc.isPaused()).toBe(false);
  });
});
