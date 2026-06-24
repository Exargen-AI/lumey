import { describe, it, expect } from 'vitest';
import { RunStatus } from '@prisma/client';
import { canTransition, assertTransition, isTerminal } from './runLifecycle';
import { ValidationError } from '../utils/errors';

describe('runLifecycle', () => {
  it('marks only SUCCEEDED / FAILED / CANCELLED as terminal', () => {
    expect(isTerminal(RunStatus.SUCCEEDED)).toBe(true);
    expect(isTerminal(RunStatus.FAILED)).toBe(true);
    expect(isTerminal(RunStatus.CANCELLED)).toBe(true);
    expect(isTerminal(RunStatus.QUEUED)).toBe(false);
    expect(isTerminal(RunStatus.RUNNING)).toBe(false);
    expect(isTerminal(RunStatus.AWAITING_REVIEW)).toBe(false);
  });

  it('allows the happy path QUEUED → RUNNING → SUCCEEDED', () => {
    expect(canTransition(RunStatus.QUEUED, RunStatus.RUNNING)).toBe(true);
    expect(canTransition(RunStatus.RUNNING, RunStatus.SUCCEEDED)).toBe(true);
  });

  it('forbids skipping work (QUEUED → SUCCEEDED) and resurrecting terminals', () => {
    expect(canTransition(RunStatus.QUEUED, RunStatus.SUCCEEDED)).toBe(false);
    expect(canTransition(RunStatus.SUCCEEDED, RunStatus.RUNNING)).toBe(false);
    expect(canTransition(RunStatus.CANCELLED, RunStatus.RUNNING)).toBe(false);
    expect(canTransition(RunStatus.FAILED, RunStatus.RUNNING)).toBe(false);
  });

  it('allows a run to pause and resume (RUNNING ↔ AWAITING_*/BLOCKED)', () => {
    for (const paused of [RunStatus.AWAITING_REVIEW, RunStatus.AWAITING_INPUT, RunStatus.BLOCKED]) {
      expect(canTransition(RunStatus.RUNNING, paused)).toBe(true);
      expect(canTransition(paused, RunStatus.RUNNING)).toBe(true);
    }
  });

  it('lets a review approve straight to SUCCEEDED', () => {
    expect(canTransition(RunStatus.AWAITING_REVIEW, RunStatus.SUCCEEDED)).toBe(true);
  });

  it('allows cancellation from any non-terminal state', () => {
    for (const s of [
      RunStatus.QUEUED,
      RunStatus.RUNNING,
      RunStatus.AWAITING_REVIEW,
      RunStatus.AWAITING_INPUT,
      RunStatus.BLOCKED,
    ]) {
      expect(canTransition(s, RunStatus.CANCELLED)).toBe(true);
    }
  });

  it('assertTransition throws ValidationError on an illegal move', () => {
    expect(() => assertTransition(RunStatus.QUEUED, RunStatus.RUNNING)).not.toThrow();
    expect(() => assertTransition(RunStatus.SUCCEEDED, RunStatus.RUNNING)).toThrow(ValidationError);
  });
});
