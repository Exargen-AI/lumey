/**
 * productivityOutbox — unit tests.
 *
 * Verifies the outbox writer:
 *   - No-ops when the feature flag is off (zero DB activity)
 *   - Writes a single event when the flag is on
 *   - Uses skipDuplicates so retries of the same source mutation
 *     don't produce duplicate rows
 *   - Maps every input field onto the right column
 *   - Batch variant handles N inputs as one createMany call
 *
 * Uses a hand-rolled stub for the transactional Prisma client because
 * `prismaMock` is built around the global PrismaClient and the outbox
 * accepts the (narrower) TransactionClient type.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  emitProductivityEvent,
  emitProductivityEvents,
  type EmitProductivityEventInput,
} from './productivityOutbox';

// Minimal stub of the Prisma transaction client surface our outbox
// uses. Only `productivityEvent.createMany` matters.
type CreateManyArgs = {
  data: unknown[];
  skipDuplicates?: boolean;
};
function makeTxStub() {
  const createMany = vi.fn(async (args: CreateManyArgs) => ({ count: args.data.length }));
  return {
    productivityEvent: { createMany },
    // Cast hatch for the type — the outbox typedef demands a wider shape than this
    // test stub provides. We never call those methods, so casting is safe.
    _createMany: createMany,
  };
}

const FLAG = 'FEATURE_PULSE_COMPOSITE_SCORE_BETA';

const sampleInput: EmitProductivityEventInput = {
  userId: 'user-1',
  signal: 'STANDUP',
  eventType: 'standup.submitted',
  occurredAt: new Date('2026-05-29T10:00:00Z'),
  rawPayload: { date: '2026-05-29', bodyLength: 120, bodyHash: 'abc' },
  source: 'daily_updates',
  sourceId: 'du-1',
};

describe('emitProductivityEvent', () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('no-ops and returns 0 when the feature flag is off', async () => {
    const tx = makeTxStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await emitProductivityEvent(tx as any, sampleInput);
    expect(result).toBe(0);
    expect(tx._createMany).not.toHaveBeenCalled();
  });

  it('writes one event with skipDuplicates when the flag is on', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await emitProductivityEvent(tx as any, sampleInput);
    expect(result).toBe(1);
    expect(tx._createMany).toHaveBeenCalledTimes(1);
    const [args] = tx._createMany.mock.calls[0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(1);
    expect(args.data[0]).toMatchObject({
      userId: 'user-1',
      signal: 'STANDUP',
      eventType: 'standup.submitted',
      source: 'daily_updates',
      sourceId: 'du-1',
      scoreDelta: null,
      gamingFlag: null,
    });
  });

  it('passes scoreDelta and gamingFlag through when set', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    await emitProductivityEvent(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx as any,
      {
        ...sampleInput,
        scoreDelta: 7.5,
        gamingFlag: 'standup_too_short',
      },
    );
    const [args] = tx._createMany.mock.calls[0];
    expect(args.data[0]).toMatchObject({
      scoreDelta: 7.5,
      gamingFlag: 'standup_too_short',
    });
  });
});

describe('emitProductivityEvents (batch)', () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('no-ops for empty input regardless of flag', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await emitProductivityEvents(tx as any, []);
    expect(result).toBe(0);
    expect(tx._createMany).not.toHaveBeenCalled();
  });

  it('writes N events as one createMany call when the flag is on', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    const inputs: EmitProductivityEventInput[] = [
      { ...sampleInput, sourceId: 'du-1' },
      { ...sampleInput, sourceId: 'du-2' },
      { ...sampleInput, sourceId: 'du-3' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await emitProductivityEvents(tx as any, inputs);
    expect(result).toBe(3);
    expect(tx._createMany).toHaveBeenCalledTimes(1);
    expect(tx._createMany.mock.calls[0][0].data).toHaveLength(3);
  });

  it('no-ops for N inputs when the flag is off', async () => {
    const tx = makeTxStub();
    const inputs: EmitProductivityEventInput[] = [sampleInput, sampleInput];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await emitProductivityEvents(tx as any, inputs);
    expect(result).toBe(0);
    expect(tx._createMany).not.toHaveBeenCalled();
  });
});
