-- Agent platform foundation (Slice 1).
--
-- Adds the orthogonal `userType` axis to users (HUMAN | AGENT, default HUMAN
-- so existing rows are unaffected) plus the agent-specific metadata columns.
-- Most callers never touch these — only Super Admin sees the agent fields in
-- the user-edit UI, and the values are only consulted by the few policies
-- that distinguish agents from humans (e.g., the Done-transition gate).

-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('HUMAN', 'AGENT');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "userType"                   "UserType" NOT NULL DEFAULT 'HUMAN',
  ADD COLUMN "agentRole"                  TEXT,
  ADD COLUMN "agentSystemPromptPath"      TEXT,
  ADD COLUMN "agentBudgetMonthlyUsdCents" INTEGER,
  ADD COLUMN "agentBudgetUsedUsdCents"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "agentActive"                BOOLEAN NOT NULL DEFAULT true;
