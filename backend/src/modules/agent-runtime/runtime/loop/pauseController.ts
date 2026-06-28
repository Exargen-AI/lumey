/**
 * PauseController — cooperative, in-memory pause for a single in-flight run.
 *
 * Pause is **not** cancel. Cancel aborts the loop and discards its work; pause
 * *suspends* the loop at a safe checkpoint with everything — the transcript, the
 * sandbox, the running async function — still alive, so resume continues exactly
 * where it left off. That continuity is the whole point: a human can step in
 * mid-run, look, and let the agent carry on without losing context.
 *
 * The mechanism: the loop `await`s {@link waitWhilePaused} at each turn boundary.
 * While not paused it resolves immediately (zero cost on the hot path). While
 * paused it parks on a promise — the loop's async frame simply suspends — until
 * {@link resume} resolves the waiters, or the run's abort signal fires (a cancel
 * must always win over a pause, so we never strand a loop a human is trying to
 * stop).
 *
 * Scope + durability: one controller lives per in-flight run inside the adapter,
 * for the lifetime of that run's execution. It is deliberately in-memory — a
 * paused run holds its transcript/sandbox in this process, so it does not
 * survive a restart (the boot reaper fails interrupted PAUSED runs, same as
 * RUNNING). Durable pause-across-restart would require persisting the transcript
 * and is a later milestone.
 */
export class PauseController {
  /** True between pause() and the next resume(). The loop reads this to park. */
  private paused = false;
  /** Resolvers for loop frames currently parked in waitWhilePaused(). */
  private waiters: Array<() => void> = [];

  /** Whether the run is currently held paused. */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Request a pause. Idempotent. The loop does not stop *here* — it stops at its
   * next call to {@link waitWhilePaused} (the turn boundary), so any in-flight
   * model call or tool finishes first and the run never tears mid-step.
   */
  pause(): void {
    this.paused = true;
  }

  /** Lift the pause and wake every parked loop frame. Idempotent. */
  resume(): void {
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  /**
   * Resolve immediately unless paused; while paused, block until {@link resume}
   * (or until `signal` aborts — cancel beats pause). Called by the loop at each
   * turn boundary.
   */
  async waitWhilePaused(signal?: AbortSignal): Promise<void> {
    if (!this.paused || signal?.aborted) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const wake = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', wake);
        resolve();
      };
      this.waiters.push(wake);
      // An abort while parked must release the frame so the loop can observe the
      // cancellation at its next checkpoint and finish CANCELLED.
      signal?.addEventListener('abort', wake, { once: true });
    });
  }
}
