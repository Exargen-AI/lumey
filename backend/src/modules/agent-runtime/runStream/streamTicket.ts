/**
 * Stream tickets — the auth bridge for Server-Sent Events (SSE).
 *
 * The problem: a browser `EventSource` (our live run-trace transport) **cannot
 * send an `Authorization` header**. Our normal auth is a Bearer access token in
 * that header, so the stream endpoint can't be protected the usual way. The two
 * common workarounds are both worse than they look:
 *   - putting the access token in the query string → it leaks into server/proxy
 *     logs and browser history, and it's long-lived (whole session);
 *   - a cookie → we deliberately keep the access token out of cookies/storage.
 *
 * The enterprise-grade answer is a **single-use, short-lived ticket**:
 *   1. The client asks for a ticket over a normal Bearer-authenticated,
 *      Origin-checked POST (so the *real* auth + access check happen there).
 *   2. The server mints an opaque, cryptographically-random ticket bound to
 *      exactly `(userId, runId)` with a ~30s TTL.
 *   3. The client opens `EventSource(.../stream?ticket=…)`. The stream endpoint
 *      `consume()`s the ticket — which validates it, checks the `runId` matches
 *      the URL, and **deletes it (single-use)**.
 *
 * So even if a ticket is logged or intercepted, it is useless: it works once,
 * for ~30s, for one user, for one run.
 *
 * Storage is **in-process** (a Map) — correct for our single-node deployment and
 * matching the in-process event bus the stream reads from. A multi-instance
 * deployment would back this (and the SSE fan-out) with Redis; that swap is
 * isolated behind this module and is intentionally deferred (see ENTERPRISE-PLAN
 * "Architecture risks").
 */
import { randomBytes } from 'crypto';

/** How long a freshly-minted ticket stays valid before the stream must use it. */
const TICKET_TTL_MS = 30_000;

interface TicketRecord {
  readonly userId: string;
  readonly runId: string;
  readonly expiresAt: number; // epoch ms
}

/** Live tickets, keyed by the opaque token. Entries are removed on use or expiry. */
const tickets = new Map<string, TicketRecord>();

/** Drop any tickets whose TTL has passed (called lazily on each mint/consume). */
function sweepExpired(now: number): void {
  for (const [token, rec] of tickets) {
    if (rec.expiresAt <= now) tickets.delete(token);
  }
}

/**
 * Mint a single-use stream ticket bound to a user + run. Call this only AFTER
 * the caller has been authenticated and authorized for the run (the POST route
 * does both via `authenticate` + `taskAccess`).
 */
export function issueStreamTicket(userId: string, runId: string): { ticket: string; expiresInMs: number } {
  const now = Date.now();
  sweepExpired(now);
  // 32 random bytes → 64 hex chars. Unguessable; not derived from any secret, so
  // it carries no value beyond its single use.
  const ticket = randomBytes(32).toString('hex');
  tickets.set(ticket, { userId, runId, expiresAt: now + TICKET_TTL_MS });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

/**
 * Validate and **consume** a ticket. Returns the bound `{ userId, runId }` on
 * success, or `null` if the ticket is unknown, expired, or already used. The
 * ticket is deleted on any lookup attempt that finds it, so it can never be
 * replayed — even a successful consume burns it.
 */
export function consumeStreamTicket(ticket: string | undefined): { userId: string; runId: string } | null {
  if (!ticket) return null;
  const now = Date.now();
  sweepExpired(now);
  const rec = tickets.get(ticket);
  if (!rec) return null;
  tickets.delete(ticket); // single-use: burn it whether or not it was still valid
  if (rec.expiresAt <= now) return null;
  return { userId: rec.userId, runId: rec.runId };
}

/** Test-only: clear all tickets so suites don't leak state into each other. */
export function _resetStreamTicketsForTest(): void {
  tickets.clear();
}
