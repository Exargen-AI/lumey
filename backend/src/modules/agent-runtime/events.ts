/**
 * Domain events owned by the agent-runtime module — its public contract on the
 * kernel bus. Observability (and the live-trace UI feed) will subscribe to
 * these; nothing imports the run service's internals to learn what happened.
 */
import type { DomainEvent } from '../../kernel';
import type { RunStatus } from '@prisma/client';

/** Fact: a run was created (still QUEUED). */
export interface RunCreatedEvent extends DomainEvent {
  readonly type: 'run.created';
  readonly runId: string;
  readonly taskId: string;
  readonly agentId: string;
}

/** Fact: a run moved between lifecycle states. */
export interface RunTransitionedEvent extends DomainEvent {
  readonly type: 'run.transitioned';
  readonly runId: string;
  readonly taskId: string;
  readonly from: RunStatus;
  readonly to: RunStatus;
}

/** Fact: a step was recorded on a run (the unit of the trace). */
export interface RunStepRecordedEvent extends DomainEvent {
  readonly type: 'run.step.recorded';
  readonly runId: string;
  readonly stepId: string;
  readonly seq: number;
  readonly stepType: string;
  readonly title: string;
}
