/**
 * Rendezvous<T> — a one-shot, in-memory hand-off between the agent loop and a
 * human action. The loop calls {@link wait} and parks; an out-of-band caller
 * (the orchestrator, reaching in through the adapter that holds this object)
 * calls {@link settle} with a value to wake it. A cancel (abort signal) resolves
 * the wait with `null`, so a cancelled run never hangs on an unanswered human.
 *
 * It is the shared core of the human-in-the-loop gates: a **clarification** is a
 * `Rendezvous<string>` (the answer), an **approval** is a
 * `Rendezvous<ApprovalDecision>`. Both are single-shot — the loop parks the
 * instant it asks and cannot ask again until resolved — and deliberately
 * in-memory (the durable record is the PENDING DB row; this is only the live
 * wake-up channel, lost on restart and swept by the boot reaper).
 *
 * Distinct from {@link PauseController}, which is a re-armable *flag* with no
 * payload and may wake many waiters; a Rendezvous carries one value to one
 * parked frame, once.
 */
export class Rendezvous<T> {
  /** Resolver for the frame currently parked in wait(), or null if none. */
  private pending: ((value: T | null) => void) | null = null;

  /** Whether a frame is currently parked awaiting a value. */
  isWaiting(): boolean {
    return this.pending !== null;
  }

  /**
   * Park until {@link settle} delivers a value, or the run is aborted (resolves
   * `null`). Resolves `null` immediately if the signal is already aborted.
   */
  async wait(signal?: AbortSignal): Promise<T | null> {
    if (signal?.aborted) return null;
    return new Promise<T | null>((resolve) => {
      let settled = false;
      const finish = (value: T | null): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        this.pending = null;
        resolve(value);
      };
      const onAbort = (): void => finish(null);
      this.pending = (value) => finish(value);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Deliver a value to the parked frame. Returns `false` if nothing is waiting
   * (so the caller can report "this run isn't waiting" rather than drop it).
   */
  settle(value: T): boolean {
    if (!this.pending) return false;
    this.pending(value);
    return true;
  }
}
