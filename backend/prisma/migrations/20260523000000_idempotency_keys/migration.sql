-- Idempotency-Key infrastructure (Layer 2 / agent control plane, 2026-05-23).
--
-- Adds a table for the Idempotency-Key middleware. Agents (and any other
-- API client) can send `Idempotency-Key: <opaque>` on POST/PATCH/PUT/DELETE
-- so that a retry after a network failure replays the original response
-- instead of creating a duplicate resource.
--
-- Contract (matches Stripe's well-known shape):
--   • Composite uniqueness on (userId, key, method, path) — same key
--     reused across endpoints does not collide.
--   • requestHash = SHA-256 of (method + path + sorted body JSON). On a
--     retry with the SAME key but a DIFFERENT body, the middleware
--     returns 422 — that's misuse, not retry.
--   • TTL is 24h. A daily sweep deletes expired rows. The `expiresAt`
--     index keeps that sweep cheap.
--
-- Cascade-delete from User so dedup rows can't outlive their owner.

CREATE TABLE "idempotency_keys" (
  "id"           TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "method"       TEXT NOT NULL,
  "path"         TEXT NOT NULL,
  "requestHash"  TEXT NOT NULL,
  "statusCode"   INTEGER NOT NULL,
  "responseBody" JSONB NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- Composite uniqueness — the "same request" contract.
CREATE UNIQUE INDEX "idempotency_keys_userId_key_method_path_key"
  ON "idempotency_keys"("userId", "key", "method", "path");

-- Per-user lookup (sweep "every key for this user" — used on user delete).
CREATE INDEX "idempotency_keys_userId_idx"
  ON "idempotency_keys"("userId");

-- Cleanup sweep (`deleteMany({ where: { expiresAt: { lt: now } } })`).
CREATE INDEX "idempotency_keys_expiresAt_idx"
  ON "idempotency_keys"("expiresAt");

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
