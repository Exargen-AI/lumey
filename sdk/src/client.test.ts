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
