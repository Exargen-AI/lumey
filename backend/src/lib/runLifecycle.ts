/**
 * The agent-run lifecycle state machine.
 *
 *   QUEUED ──► RUNNING ──► SUCCEEDED        (happy path)
 *      │          │  ├────► PAUSED          ─► RUNNING   (human suspend ↔ resume)
 *      │          │  ├────► AWAITING_REVIEW ─► RUNNING | SUCCEEDED
 *      │          │  ├────► AWAITING_INPUT  ─► RUNNING
 *      │          │  └────► BLOCKED         ─► RUNNING
 *      │          └──► FAILED
 *      └──► FAILED                          (setup failed before the run started)
 *   (any non-terminal) ──► CANCELLED
 *
 * Transitions are validated centrally so neither the runtime adapter nor the
 * API can drive a run into an impossible state (e.g. resurrecting a CANCELLED
 * run, or jumping QUEUED straight to SUCCEEDED without doing work).
 */
import { RunStatus } from '@prisma/client';
import { ValidationError } from '../utils/errors';

/** Terminal states — a run that reaches one is finished and immutable. */
const TERMINAL: ReadonlySet<RunStatus> = new Set([
  RunStatus.SUCCEEDED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
]);

/** Allowed next states for each state. Computed enum keys keep this typed. */
const LEGAL: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  [RunStatus.QUEUED]: [RunStatus.RUNNING, RunStatus.FAILED, RunStatus.CANCELLED],
  [RunStatus.RUNNING]: [
    RunStatus.PAUSED,
    RunStatus.AWAITING_REVIEW,
    RunStatus.AWAITING_INPUT,
    RunStatus.BLOCKED,
    RunStatus.SUCCEEDED,
    RunStatus.FAILED,
    RunStatus.CANCELLED,
  ],
  // PAUSED is a human-held suspend: resume back to RUNNING, or tear down
  // (CANCELLED by a human, FAILED if the holding process restarts — see reaper).
  [RunStatus.PAUSED]: [RunStatus.RUNNING, RunStatus.CANCELLED, RunStatus.FAILED],
  [RunStatus.AWAITING_REVIEW]: [RunStatus.RUNNING, RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED],
  [RunStatus.AWAITING_INPUT]: [RunStatus.RUNNING, RunStatus.CANCELLED, RunStatus.FAILED],
  [RunStatus.BLOCKED]: [RunStatus.RUNNING, RunStatus.CANCELLED, RunStatus.FAILED],
  [RunStatus.SUCCEEDED]: [],
  [RunStatus.FAILED]: [],
  [RunStatus.CANCELLED]: [],
};

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return LEGAL[from].includes(to);
}

/** Throws {@link ValidationError} on an illegal transition. */
export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new ValidationError(`illegal run transition: ${from} → ${to}`);
  }
}
