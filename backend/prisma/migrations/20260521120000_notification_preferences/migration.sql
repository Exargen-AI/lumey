-- Per-user notification mute preferences.
--
-- Sparse table: rows exist only for explicit opt-outs. Absence of a
-- row for (user, type) means the user has not muted that type and
-- will receive the notification as normal. New notification types
-- ship as feature PRs; users implicitly opt in to all new types
-- because nothing in this table will match yet.

CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- Unique key for upserts: clicking the toggle twice should converge,
-- not create two rows. (The service uses
-- `upsert(where: { userId_type: { ... } })` so this index name
-- matters — Prisma derives it from @@unique([userId, type]).)
CREATE UNIQUE INDEX "notification_preferences_userId_type_key"
    ON "notification_preferences"("userId", "type");

-- The hot read path is "show me all my mutes" before each
-- notification fan-out. The unique index above covers that as a
-- prefix-only lookup on userId, but adding an explicit single-column
-- index on userId makes the query plan unambiguous (Postgres tends
-- to skip the composite index for solo-userId predicates).
CREATE INDEX "notification_preferences_userId_idx"
    ON "notification_preferences"("userId");

ALTER TABLE "notification_preferences"
    ADD CONSTRAINT "notification_preferences_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
