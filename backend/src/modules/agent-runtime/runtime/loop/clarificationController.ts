/**
 * ClarificationController — the in-memory rendezvous for one mid-run question.
 *
 * Where {@link PauseController} is a human-initiated *suspend* with no payload,
 * this is an **agent-initiated question** that carries an answer back. When the
 * agent calls its `ask_human` tool, the loop parks on {@link wait}; a human's
 * answer (routed through the orchestrator → the adapter that holds this
 * controller) resolves the parked promise with the text, and the loop injects it
 * as the tool result and continues. A cancel (abort) resolves the wait with
 * `null` so a cancelled run never hangs on an unanswered question.
 *
 * Like the pause handle it is deliberately in-memory and per-run: a parked
 * question holds the loop's transcript in this process, so it does not survive a
 * restart (the boot reaper fails interrupted AWAITING_INPUT runs alongside
 * RUNNING/PAUSED). The PENDING DB row is the durable record; this is only the
 * live wake-up channel. Only one question is ever open at a time — the loop
 * parks the instant it asks, so it cannot ask again until answered.
 */
export class ClarificationController {
  /** Resolver for the loop frame currently parked on a question, else null. */
  private pending: ((answer: string | null) => void) | null = null;

  /** Whether a loop turn is currently parked awaiting a human answer. */
  isWaiting(): boolean {
    return this.pending !== null;
  }

  /**
   * Park until a human answers (resolves the answer text) or the run is aborted
   * (resolves `null`). Called by the loop right after it opens the question.
   */
  async wait(signal?: AbortSignal): Promise<string | null> {
    if (signal?.aborted) return null;
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        this.pending = null;
        resolve(value);
      };
      const onAbort = (): void => finish(null);
      this.pending = (answer) => finish(answer);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * Deliver the human's answer to the parked loop. Returns `false` if nothing
   * was waiting (so the caller can report "this run is not awaiting input"
   * rather than silently dropping the answer).
   */
  answer(text: string): boolean {
    if (!this.pending) return false;
    this.pending(text);
    return true;
  }
}
