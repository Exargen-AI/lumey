/**
 * The RuntimeAdapter seam — the firewall between Lumey and whatever runtime
 * actually executes a run (a reference simulator, our in-house `native`
 * runtime, a third-party agent, …).
 *
 * The rule that keeps us runtime-neutral: an adapter translates its runtime's
 * NATIVE execution into OUR run model (lifecycle + steps + events) via the run
 * service. No runtime-internal concept — no `span.*`, no `tool_confirmation`,
 * no SDK type — ever surfaces above this interface. Swapping runtimes is "write
 * a new adapter", never "rewrite the platform".
 */
import type { Prisma } from '@prisma/client';

/**
 * The minimal task context handed to an adapter to execute a run. Grows as the
 * context compiler (M3) enriches it; intentionally runtime-neutral.
 */
export interface RunContext {
  readonly runId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly task: {
    readonly title: string;
    readonly description: string | null;
    /** Structured acceptance criteria — the run's definition of done. */
    readonly acceptanceCriteria: Prisma.JsonValue;
  };
}

/**
 * Honest capability flags per runtime, so the platform can degrade gracefully
 * (e.g. refuse the air-gapped tier on a runtime that can't self-host).
 */
export interface RuntimeCapabilities {
  /** Executes inside the customer's own infrastructure (air-gap). */
  readonly selfHosted: boolean;
  /** Cross-run persistent memory. */
  readonly memory: boolean;
  /** Rubric-graded iterate→grade→revise loop (Outcomes). */
  readonly outcomes: boolean;
  /** Sub-agent delegation / multi-agent coordination. */
  readonly multiAgent: boolean;
}

export interface RuntimeAdapter {
  /** Stable id, e.g. `reference`, `claude-agent-sdk`, `openhands`. */
  readonly id: string;

  capabilities(): RuntimeCapabilities;

  /**
   * Drive the run from QUEUED to a stopping point — a human-review park
   * (AWAITING_REVIEW / AWAITING_INPUT) or a terminal state — recording steps
   * and lifecycle transitions through the run service as it goes.
   */
  execute(ctx: RunContext): Promise<void>;

  /** Best-effort cancel of an in-flight run. */
  cancel(runId: string): Promise<void>;

  /**
   * Cooperatively suspend an in-flight run at its next turn boundary, keeping
   * its work alive for {@link resume}. Optional: a runtime that cannot suspend
   * mid-run (e.g. the fire-and-forget reference simulator) omits it, and the
   * orchestrator refuses the pause rather than faking one.
   */
  pause?(runId: string): Promise<void>;

  /** Resume a run previously {@link pause}d. Optional, paired with `pause`. */
  resume?(runId: string): Promise<void>;

  /**
   * Deliver a human's answer to a run parked on AWAITING_INPUT (the agent asked
   * via `ask_human`). Returns `true` if a live loop was waiting and consumed it,
   * `false` otherwise (e.g. the run isn't executing here). Optional: only a
   * runtime that supports the clarification round-trip implements it.
   */
  answerClarification?(runId: string, answer: string): Promise<boolean>;
}
