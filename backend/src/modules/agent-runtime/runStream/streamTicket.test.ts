import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issueStreamTicket, consumeStreamTicket, _resetStreamTicketsForTest } from './streamTicket';

beforeEach(() => _resetStreamTicketsForTest());
afterEach(() => vi.useRealTimers());

describe('stream tickets', () => {
  it('mints an opaque ticket bound to (userId, runId)', () => {
    const { ticket, expiresInMs } = issueStreamTicket('u1', 'r1');
    expect(ticket).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex
    expect(expiresInMs).toBeGreaterThan(0);
    expect(consumeStreamTicket(ticket)).toEqual({ userId: 'u1', runId: 'r1' });
  });

  it('is single-use — a second consume returns null', () => {
    const { ticket } = issueStreamTicket('u1', 'r1');
    expect(consumeStreamTicket(ticket)).not.toBeNull();
    expect(consumeStreamTicket(ticket)).toBeNull();
  });

  it('rejects unknown / missing tickets', () => {
    expect(consumeStreamTicket('deadbeef')).toBeNull();
    expect(consumeStreamTicket(undefined)).toBeNull();
  });

  it('expires after the TTL', () => {
    vi.useFakeTimers();
    const { ticket } = issueStreamTicket('u1', 'r1');
    vi.advanceTimersByTime(31_000); // TTL is 30s
    expect(consumeStreamTicket(ticket)).toBeNull();
  });

  it('mints distinct tickets each time (no collisions)', () => {
    const a = issueStreamTicket('u1', 'r1').ticket;
    const b = issueStreamTicket('u1', 'r1').ticket;
    expect(a).not.toBe(b);
  });
});
