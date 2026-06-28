import '../../../test/prismaMock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { prismaMock } from '../../../test/prismaMock';
import { NotFoundError } from '../../../utils/errors';
import { issueStreamTicketHandler, streamRunHandler } from './runStream.handler';
import { issueStreamTicket, _resetStreamTicketsForTest } from './streamTicket';

beforeEach(() => {
  vi.clearAllMocks();
  _resetStreamTicketsForTest();
});
afterEach(() => vi.useRealTimers());

function res() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn(),
    flushHeaders: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
    writableEnded: false,
    headersSent: false,
  } as unknown as Response;
}

describe('issueStreamTicketHandler', () => {
  it('mints a ticket when the run belongs to the task', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ taskId: 't1', status: 'RUNNING' } as never);
    const r = res();
    await issueStreamTicketHandler({ params: { id: 't1', runId: 'r1' }, user: { id: 'u1' } } as unknown as Request, r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(201);
    expect((r.json as ReturnType<typeof vi.fn>).mock.calls[0][0].data.ticket).toMatch(/^[0-9a-f]{64}$/);
  });

  it('404s when the run is missing or under a different task', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ taskId: 'OTHER', status: 'RUNNING' } as never);
    const next = vi.fn();
    await issueStreamTicketHandler({ params: { id: 't1', runId: 'r1' }, user: { id: 'u1' } } as unknown as Request, res(), next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('streamRunHandler (auth)', () => {
  it('401s without a ticket', async () => {
    const r = res();
    await streamRunHandler({ params: { id: 't1', runId: 'r1' }, query: {} } as unknown as Request, r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(401);
    expect(r.writeHead).not.toHaveBeenCalled();
  });

  it('401s when the ticket is for a different run', async () => {
    const { ticket } = issueStreamTicket('u1', 'rX'); // ticket bound to a DIFFERENT run
    const r = res();
    await streamRunHandler({ params: { id: 't1', runId: 'r1' }, query: { ticket } } as unknown as Request, r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('opens the SSE stream with a valid ticket and seeds the status', async () => {
    vi.useFakeTimers();
    prismaMock.agentRun.findUnique.mockResolvedValue({ taskId: 't1', status: 'RUNNING' } as never);
    const { ticket } = issueStreamTicket('u1', 'r1');
    const r = res();
    // capture the run's `req.on('close', …)` handler so we can simulate disconnect
    const handlers: Record<string, () => void> = {};
    const reqOn = vi.fn((ev: string, cb: () => void) => { handlers[ev] = cb; });

    await streamRunHandler({ params: { id: 't1', runId: 'r1' }, query: { ticket }, on: reqOn } as unknown as Request, r, vi.fn());

    expect(r.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(r.write).toHaveBeenCalledWith(expect.stringContaining('event: connected'));
    expect(handlers.close).toBeTypeOf('function');

    // disconnect → idempotent cleanup ends the response
    handlers.close();
    expect(r.end).toHaveBeenCalled();
  });
});
