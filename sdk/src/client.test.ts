import { describe, it, expect } from 'vitest';
import { LumeyClient } from './client';
import { MockTransport, type HttpMethod, type RequestOptions } from './transport';
import { LumeyContractError } from './errors';
import type { AgentRunSummary } from './contract/schemas';

const RUN: AgentRunSummary = {
  id: 'run1',
  taskId: 'task1',
  agentId: 'agent1',
  status: 'AWAITING_REVIEW',
  model: null,
  summary: 'done',
  error: null,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  startedAt: null,
  endedAt: null,
  createdAt: '2026-06-24T00:00:00.000Z',
};

function client(handler: (m: HttpMethod, p: string, o: RequestOptions) => unknown) {
  const transport = new MockTransport(handler);
  return { lumey: new LumeyClient({ transport }), transport };
}

describe('tasks.next', () => {
  it('returns a validated task', async () => {
    const { lumey } = client(() => ({ id: 't1', title: 'Build it', status: 'TODO' }));
    const task = await lumey.tasks.next();
    expect(task).toMatchObject({ id: 't1', title: 'Build it' });
  });

  it('returns null when there is no task', async () => {
    const { lumey } = client(() => null);
    expect(await lumey.tasks.next()).toBeNull();
  });

  it('hits the agent next-task endpoint', async () => {
    const { lumey, transport } = client(() => ({ id: 't1', title: 'x', status: 'TODO' }));
    await lumey.tasks.next();
    expect(transport.calls[0]).toMatchObject({ method: 'GET', path: '/agents/me/next-task' });
  });
});

describe('runs', () => {
  it('starts a run and validates the response', async () => {
    const { lumey, transport } = client(() => RUN);
    const run = await lumey.runs.start('task1');
    expect(run.status).toBe('AWAITING_REVIEW');
    expect(transport.calls[0]).toMatchObject({ method: 'POST', path: '/tasks/task1/runs' });
  });

  it('honours a caller-supplied idempotency key', async () => {
    const { lumey, transport } = client(() => RUN);
    await lumey.runs.start('task1', { idempotencyKey: 'fixed-key' });
    expect(transport.calls[0].opts.idempotencyKey).toBe('fixed-key');
  });

  it('lists runs', async () => {
    const { lumey } = client(() => [RUN, RUN]);
    expect(await lumey.runs.list('task1')).toHaveLength(2);
  });

  it('gets a run detail with steps + events', async () => {
    const { lumey } = client(() => ({ ...RUN, steps: [], events: [] }));
    const detail = await lumey.runs.get('task1', 'run1');
    expect(detail.steps).toEqual([]);
  });

  it('cancels a run via the cancel endpoint', async () => {
    const { lumey, transport } = client(() => ({}));
    await lumey.runs.cancel('task1', 'run1');
    expect(transport.calls[0]).toMatchObject({ method: 'POST', path: '/tasks/task1/runs/run1/cancel' });
  });

  it('throws a LumeyContractError when the response violates the contract', async () => {
    const { lumey } = client(() => ({ id: 'run1' /* missing required fields */ }));
    await expect(lumey.runs.start('task1')).rejects.toBeInstanceOf(LumeyContractError);
  });
});

describe('runs.events (resumable stream)', () => {
  function detail(status: string, seqs: number[]) {
    return {
      ...RUN,
      status,
      steps: [],
      events: seqs.map((seq) => ({ id: `e${seq}`, seq, type: 'run.step.recorded', payload: {}, at: '2026-01-01T00:00:00.000Z' })),
    };
  }

  it('yields new events across polls and stops at a terminal status', async () => {
    const responses = [detail('RUNNING', [1, 2]), detail('SUCCEEDED', [1, 2, 3])];
    let i = 0;
    const { lumey } = client(() => responses[Math.min(i++, responses.length - 1)]);

    const seen: number[] = [];
    for await (const ev of lumey.runs.events('T', 'R', { pollMs: 0 })) seen.push(ev.seq);

    expect(seen).toEqual([1, 2, 3]); // de-duped across polls, in order
    expect(i).toBe(2); // stopped polling once terminal
  });

  it('resumes from a cursor (sinceSeq)', async () => {
    const { lumey } = client(() => detail('SUCCEEDED', [1, 2, 3]));
    const seen: number[] = [];
    for await (const ev of lumey.runs.events('T', 'R', { pollMs: 0, sinceSeq: 2 })) seen.push(ev.seq);
    expect(seen).toEqual([3]); // only events after the cursor
  });

  it('stops at maxPolls when the run never terminates', async () => {
    const { lumey, transport } = client(() => detail('RUNNING', [1]));
    const seen: number[] = [];
    for await (const ev of lumey.runs.events('T', 'R', { pollMs: 0, maxPolls: 3 })) seen.push(ev.seq);
    expect(seen).toEqual([1]); // only new events (seq 1 once)
    expect(transport.calls).toHaveLength(3);
  });
});

describe('runs.usage', () => {
  const withTokens = (i: number, o: number, t: number) => ({ ...RUN, inputTokens: i, outputTokens: o, totalTokens: t, steps: [], events: [] });

  it('returns token usage with no cost when pricing is omitted', async () => {
    const { lumey } = client(() => withTokens(100, 50, 150));
    expect(await lumey.runs.usage('T', 'R')).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostUsd: null });
  });

  it('estimates cost when pricing is supplied', async () => {
    const { lumey } = client(() => withTokens(1_000_000, 1_000_000, 2_000_000));
    const u = await lumey.runs.usage('T', 'R', { pricing: { inputPer1M: 3, outputPer1M: 15 } });
    expect(u.estimatedCostUsd).toBe(18); // 1M·$3 + 1M·$15 per 1M
  });
});
