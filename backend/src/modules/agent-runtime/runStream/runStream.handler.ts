/**
 * Live run-trace streaming over Server-Sent Events (SSE).
 *
 * Two endpoints make one feature:
 *   - `POST …/stream-ticket` — Bearer-authenticated + `taskAccess`-gated; mints a
 *     single-use ticket (see `streamTicket.ts`). This is where the *real* auth
 *     and access check happen.
 *   - `GET  …/stream?ticket=…` — authenticated by *consuming* that ticket (an
 *     `EventSource` can't send headers), then streams the run's `run.*` facts as
 *     they happen.
 *
 * Security posture:
 *   - the stream is gated by a single-use, ~30s, run-scoped ticket;
 *   - we still re-verify the run belongs to the URL's task (defense in depth);
 *   - payloads are **signal-only** — type + ids + new status, never code/diffs.
 *     The browser already holds an authorized REST session; it refetches the
 *     authoritative detail on each signal. So the stream can't widen what a
 *     viewer can see, and there's no second copy of run data to drift.
 *
 * Resource hygiene: every stream unsubscribes from the bus, clears its
 * heartbeat, and ends on client disconnect, on a terminal transition, or at a
 * hard max-lifetime cap — so a forgotten tab can't leak a subscription forever.
 */
import type { Request, Response, NextFunction } from 'express';
import prisma from '../../../config/database';
import { bus } from '../../../kernel';
import type { Unsubscribe } from '../../../kernel/eventBus';
import { logger } from '../../../lib/logger';
import { isTerminal } from '../../../lib/runLifecycle';
import { NotFoundError } from '../../../utils/errors';
import type { RunCreatedEvent, RunStepRecordedEvent, RunTransitionedEvent } from '../events';
import { consumeStreamTicket, issueStreamTicket } from './streamTicket';

/** A stream is force-closed after this long, regardless of activity — leak guard. */
const MAX_STREAM_MS = 30 * 60 * 1000; // 30 minutes
/** Heartbeat cadence — keeps proxies from idling the connection out. */
const HEARTBEAT_MS = 25_000;

/** Confirm a run exists AND belongs to the given task; returns its status. */
async function loadRunForTask(taskId: string, runId: string): Promise<{ status: string }> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { taskId: true, status: true } });
  if (!run || run.taskId !== taskId) throw new NotFoundError('Run');
  return { status: run.status };
}

/**
 * `POST /tasks/:id/runs/:runId/stream-ticket`
 * Runs behind `authenticate` + `taskAccess`, so by the time we get here the user
 * is known and may access the task. We verify the run is under that task, then
 * mint a ticket bound to this user + run.
 */
export async function issueStreamTicketHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await loadRunForTask(req.params.id, req.params.runId);
    const { ticket, expiresInMs } = issueStreamTicket(req.user!.id, req.params.runId);
    res.status(201).json({ success: true, data: { ticket, expiresInMs } });
  } catch (err) {
    next(err);
  }
}

/**
 * `GET /tasks/:id/runs/:runId/stream?ticket=…`
 * NOT behind `authenticate` (an EventSource can't send a Bearer header). Auth is
 * the ticket: it must validate, and its bound `runId` must match the URL. Any
 * mismatch is a flat 401 *before* we open the stream.
 */
export async function streamRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const runId = req.params.runId;
    const claim = consumeStreamTicket(typeof req.query.ticket === 'string' ? req.query.ticket : undefined);
    if (!claim || claim.runId !== runId) {
      res.status(401).json({ success: false, error: { message: 'Invalid or expired stream ticket' } });
      return;
    }
    // Defense in depth: the ticket proves *who*, this proves the run is really
    // under the task in the URL (and gives us the current status to seed with).
    const { status } = await loadRunForTask(req.params.id, runId);

    // ── open the SSE channel ──────────────────────────────────────────────
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tell nginx not to buffer the stream
    });
    res.flushHeaders?.();

    /** Write one named SSE event with a JSON payload. */
    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Idempotent teardown — may fire from disconnect, terminal, or the cap.
    // `heartbeat`/`maxTimer` are referenced here but declared just below as
    // `const`; safe because `cleanup` only ever runs *after* they're assigned
    // (via the timers / bus / req-close registered after this point).
    let closed = false;
    const unsubs: Unsubscribe[] = [];
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(maxTimer);
      for (const off of unsubs) off();
      if (!res.writableEnded) res.end();
    };

    // Seed the client with the current status so its pill is correct immediately,
    // then forward live facts. We filter every event to THIS run.
    send('connected', { runId, status });
    unsubs.push(
      bus.subscribe<RunStepRecordedEvent>('run.step.recorded', (e) => {
        if (e.runId === runId) send('run.step.recorded', { runId, seq: e.seq, stepType: e.stepType });
      }),
      bus.subscribe<RunTransitionedEvent>('run.transitioned', (e) => {
        if (e.runId !== runId) return;
        send('run.transitioned', { runId, to: e.to });
        if (isTerminal(e.to as never)) cleanup(); // nothing more will happen — free it
      }),
      bus.subscribe<RunCreatedEvent>('run.created', (e) => {
        if (e.runId === runId) send('run.created', { runId });
      }),
    );

    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const maxTimer = setTimeout(cleanup, MAX_STREAM_MS);
    req.on('close', cleanup); // browser navigated away / EventSource.close()
    logger.debug({ runId, userId: claim.userId }, '[agent-runtime] run stream opened');
  } catch (err) {
    // If we already started the SSE body we can't send JSON — just end it.
    if (res.headersSent) {
      res.end();
      return;
    }
    next(err);
  }
}
