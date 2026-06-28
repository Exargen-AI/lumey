/**
 * ClarificationController — the in-memory rendezvous for one mid-run question.
 *
 * Where {@link PauseController} is a human-initiated *suspend* with no payload,
 * this is an **agent-initiated question** that carries an answer back: the agent
 * calls `ask_human`, the loop parks on {@link wait}, and a human's answer
 * (routed through the orchestrator → the adapter that holds this controller)
 * wakes it via {@link answer}. A cancel resolves the wait with `null` so a
 * cancelled run never hangs on an unanswered question.
 *
 * It is a thin, domain-named facade over the shared {@link Rendezvous} primitive
 * (`answer` reads better than `settle` at the call site); the parking mechanics
 * — single-shot, abort-aware, in-memory — live there and are shared with the
 * approval gate. Only one question is ever open at a time: the loop parks the
 * instant it asks, so it cannot ask again until answered.
 */
import { Rendezvous } from './rendezvous';

export class ClarificationController {
  private readonly gate = new Rendezvous<string>();

  /** Whether a loop turn is currently parked awaiting a human answer. */
  isWaiting(): boolean {
    return this.gate.isWaiting();
  }

  /** Park until answered (resolves the answer) or aborted (resolves `null`). */
  wait(signal?: AbortSignal): Promise<string | null> {
    return this.gate.wait(signal);
  }

  /** Deliver the human's answer; `false` if nothing was waiting. */
  answer(text: string): boolean {
    return this.gate.settle(text);
  }
}
