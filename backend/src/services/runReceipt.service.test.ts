import '../test/prismaMock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { issueRunReceipt, getRunReceipt } from './runReceipt.service';

const { getRunSdlcSpy } = vi.hoisted(() => ({ getRunSdlcSpy: vi.fn() }));
vi.mock('./runSdlc.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getRunSdlc: getRunSdlcSpy,
}));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.agentRun.findUnique.mockResolvedValue({
    id: 'r1', taskId: 't1', agentId: 'a1', model: 'qwen2.5-coder:14b', status: 'AWAITING_REVIEW',
    summary: 'done', startedAt: new Date('2026-06-28T09:00:00Z'), endedAt: null,
    inputTokens: 1200, outputTokens: 800, totalTokens: 2000,
  } as never);
  prismaMock.runStep.findMany.mockResolvedValue([{ type: 'EDIT' }, { type: 'EDIT' }, { type: 'TEST' }] as never);
  getRunSdlcSpy.mockResolvedValue({
    commits: [{ sha: 'a' }, { sha: 'b' }],
    pullRequest: { externalId: 'o/r#42', number: 42, url: 'u', state: 'OPEN' },
    checks: [
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { status: 'COMPLETED', conclusion: 'FAILURE' },
    ],
  } as never);
  prismaMock.runReceipt.upsert.mockResolvedValue({ id: 'rec1' } as never);
});

describe('issueRunReceipt', () => {
  it('snapshots the run + work and hashes it', async () => {
    await issueRunReceipt('r1');
    const arg = prismaMock.runReceipt.upsert.mock.calls[0][0] as {
      where: { runId: string };
      create: { digest: string; algo: string; content: Record<string, unknown> };
    };
    expect(arg.where).toEqual({ runId: 'r1' });
    expect(arg.create.algo).toBe('sha256'); // no LUMEY_RECEIPT_SECRET in tests
    expect(arg.create.digest).toMatch(/^[0-9a-f]{64}$/);
    const work = arg.create.content.work as Record<string, unknown>;
    expect(work).toMatchObject({ steps: 3, commits: 2 });
    expect(work.checks).toEqual({ total: 2, passed: 1, failed: 1 });
    expect((arg.create.content.usage as Record<string, unknown>).totalTokens).toBe(2000);
  });

  it('is a no-op (null) when the run is gone', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue(null as never);
    expect(await issueRunReceipt('gone')).toBeNull();
    expect(prismaMock.runReceipt.upsert).not.toHaveBeenCalled();
  });
});

describe('getRunReceipt', () => {
  it('verifies an untampered receipt and flags a tampered one', async () => {
    // First issue one to get a real (content, digest) pair.
    await issueRunReceipt('r1');
    const { content, digest, algo } = (prismaMock.runReceipt.upsert.mock.calls[0][0] as { create: { content: unknown; digest: string; algo: string } }).create;

    prismaMock.runReceipt.findUnique.mockResolvedValue({ runId: 'r1', content, digest, algo } as never);
    expect((await getRunReceipt('r1'))?.verified).toBe(true);

    // Tamper with the stored snapshot — the recomputed digest no longer matches.
    const tampered = { ...(content as Record<string, unknown>), usage: { totalTokens: 999_999 } };
    prismaMock.runReceipt.findUnique.mockResolvedValue({ runId: 'r1', content: tampered, digest, algo } as never);
    expect((await getRunReceipt('r1'))?.verified).toBe(false);
  });

  it('returns null when no receipt has been issued', async () => {
    prismaMock.runReceipt.findUnique.mockResolvedValue(null as never);
    expect(await getRunReceipt('r1')).toBeNull();
  });
});
