-- 2026-06-01 — Agent visibility allowlist.
--
-- Adds a per-user opt-in that lets a non-SUPER_ADMIN user see AI agents
-- (userType = AGENT) and everything they touch — agent-assigned tasks,
-- agent comments, agent activity. SUPER_ADMIN sees agents implicitly and
-- manages this allowlist; this flag grants the same visibility to a
-- selected set of users.
--
-- Default false so every existing non-SUPER_ADMIN user loses sight of
-- agents the moment the filters ship — which is the intended lockdown.
-- NOT NULL DEFAULT skips the table rewrite on PG>=11 (lazy default).

ALTER TABLE "users"
  ADD COLUMN "canViewAgents" BOOLEAN NOT NULL DEFAULT false;
