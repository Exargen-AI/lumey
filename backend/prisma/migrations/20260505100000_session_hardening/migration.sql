-- Adds the columns and table needed for refresh-token rotation, account
-- lockout, and server-side revocation of in-flight access tokens.

-- 1. tokenVersion enables global per-user invalidation: every JWT carries the
--    user's tokenVersion at issue time; bumping the row lets us reject
--    every still-valid access token in one update.
ALTER TABLE "users"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil" TIMESTAMP(3);

-- 2. Refresh tokens are no longer self-contained JWTs — they're rows. Each
--    /auth/refresh marks the old row revoked and writes a new one whose
--    replacedById chains backwards. This gives us reuse detection (if a
--    revoked token is presented, the whole chain is killed) plus immediate
--    server-side logout.
CREATE TABLE "refresh_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "replacedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "userAgent" TEXT,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refresh_tokens_replacedById_key" ON "refresh_tokens"("replacedById");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
