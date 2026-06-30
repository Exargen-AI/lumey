-- Immutable agent-vs-human audit attribution on every activity (P4).
-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "actorType" "UserType" NOT NULL DEFAULT 'HUMAN';

-- CreateIndex
CREATE INDEX "activities_actorType_idx" ON "activities"("actorType");

-- Backfill: existing rows authored by an AGENT user are attributed AGENT
-- (everything else stays HUMAN by the column default).
UPDATE "activities" a
SET "actorType" = 'AGENT'
FROM "users" u
WHERE a."userId" = u."id" AND u."userType" = 'AGENT';

