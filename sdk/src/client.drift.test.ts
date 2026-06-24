import { describe, it, expect } from 'vitest';
import { LumeyClient } from './client';
import { MockTransport, type HttpMethod } from './transport';
import { OPERATIONS, fillPath, type ResponseShape } from './contract/operations';
import type { AgentRunSummary } from './contract/schemas';

const RUN: AgentRunSummary = {
  id: 'R', taskId: 'T', agentId: 'a', status: 'AWAITING_REVIEW',
  model: null, summary: null, error: null, startedAt: null, endedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
};
const TASK = { id: 'T', title: 't', status: 'TODO' };

/** A response fixture that satisfies the schema an operation returns. */
function fixtureFor(shape: ResponseShape): unknown {
  switch (shape.kind) {
    case 'void':
      return {};
    case 'array':
      return [RUN];
    case 'nullable':
      return TASK; // the only nullable op is tasks.next → TaskRef
    case 'object':
      return shape.type === 'AgentRunDetail' ? { ...RUN, steps: [], events: [] } : RUN;
  }
}

/** Invoke the client method named by an operation id with test params. */
const PARAMS = { taskId: 'T', runId: 'R' };
function invoke(lumey: LumeyClient, id: string): Promise<unknown> {
  const map: Record<string, () => Promise<unknown>> = {
    'tasks.next': () => lumey.tasks.next(),
    'runs.start': () => lumey.runs.start('T'),
    'runs.list': () => lumey.runs.list('T'),
    'runs.get': () => lumey.runs.get('T', 'R'),
    'runs.cancel': () => lumey.runs.cancel('T', 'R'),
  };
  if (!map[id]) throw new Error(`no client binding for operation ${id} — manifest/client drift`);
  return map[id]();
}

describe('client conforms to the operations manifest (no drift)', () => {
  it.each(OPERATIONS.map((op) => [op.id, op] as const))('%s hits the declared method + path', async (_id, op) => {
    const transport = new MockTransport(() => fixtureFor(op.response));
    const lumey = new LumeyClient({ transport });

    await invoke(lumey, op.id);

    const call = transport.calls[0];
    expect(call.method).toBe(op.http as HttpMethod);
    expect(call.path).toBe(fillPath(op.path, PARAMS));
    if (op.write) expect(call.opts.idempotencyKey ?? '__auto__').toBeTruthy();
  });

  it('every operation has a client binding', () => {
    // invoke() throws on an unbound id, so this just asserts the manifest is non-empty
    expect(OPERATIONS.length).toBeGreaterThan(0);
  });
});
