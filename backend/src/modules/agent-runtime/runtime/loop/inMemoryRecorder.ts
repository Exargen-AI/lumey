/**
 * An in-memory RunRecorder for sub-agents. A delegated worker runs a full loop
 * but its steps/transitions are *internal* — they shouldn't flood the parent
 * run's DB trace. This recorder collects them in memory so the parent can
 * summarize the delegation as a single step instead.
 */
import { RunStatus, RunStepType } from '@prisma/client';
import type { RunRecorder, RunUsage } from './loopController';

export class InMemoryRecorder implements RunRecorder {
  readonly steps: { type: RunStepType; title: string; detail?: string }[] = [];
  readonly transitions: { to: RunStatus; summary?: string; error?: string }[] = [];
  usageRecorded: RunUsage | null = null;

  async step(input: { type: RunStepType; title: string; detail?: string }): Promise<void> {
    this.steps.push(input);
  }

  async transition(to: RunStatus, opts?: { summary?: string; error?: string }): Promise<void> {
    this.transitions.push({ to, ...opts });
  }

  async usage(usage: RunUsage): Promise<void> {
    this.usageRecorded = usage;
  }
}
