/**
 * "Your action needed" — items on a project that are blocked on the client.
 * Produced by `clientActions.service.ts` and consumed by the callout at the
 * top of the client project status page.
 *
 * Two sources today:
 *   - Deliverable.status === 'DELIVERED'  → team delivered, awaiting sign-off
 *   - Decision.status === 'PROPOSED'       → open question, not yet accepted
 *
 * Both surface in one merged feed, sorted by `waitingDays` descending so the
 * oldest (most urgent) item is at the top.
 */

export type ClientActionKind = 'DELIVERABLE' | 'DECISION';

export interface ClientActionItem {
  kind: ClientActionKind;
  /** The deliverable or decision ID — used to deep-link to its detail row. */
  id: string;
  /** Display title. */
  title: string;
  /** Whole days since the item entered its current waiting state. */
  waitingDays: number;
  /** ISO timestamp when the item started waiting on the client (DELIVERED-at
   *  for deliverables, createdAt for decisions). */
  since: string;
}

export interface ClientActionsResponse {
  /** All items needing client input, oldest-first. */
  items: ClientActionItem[];
  /** `items.length` — convenience for the count badge. */
  count: number;
}
