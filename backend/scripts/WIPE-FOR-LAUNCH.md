# Wipe-for-launch — run notes

Reduces a populated DB to "ready for real users." Keeps the super admin
(and any `pankaj@*` / `*pankaj*` account if present), wipes everything
else. Optionally rotates the super admin password as part of the same
transaction.

## Verified on local
Ran 2026-05-11. Reduced `23 users / 17 projects / 862 tasks` → `1 user / 0
projects / 0 tasks` in a single transaction. Login verified post-wipe
with the rotated password.

## Running on production

> **⚠️ This is irreversible without a backup.** Take a fresh snapshot of
> the production database before running. If you don't have a recent
> snapshot, stop and arrange one first.

The script reads its target from `DATABASE_URL`. The safest way to point
it at production is to set that env var explicitly for the one command —
don't bake the prod URL into a long-running shell session.

```bash
# 1. Get production DATABASE_URL — wherever you keep prod secrets (Vercel
#    env vars, 1Password, .env.production, your team's vault, etc.).

# 2. ALWAYS dry-run first. This will not modify the database.
cd backend
DATABASE_URL='<paste-prod-url>' npx tsx scripts/wipe-for-launch.ts

# 3. Read the output. Confirm:
#    - Preserved users: admin@exargen.in (⭐ SUPER_ADMIN) AND pankaj@exargen.com
#      (plus anything matching "pankaj" in email or name)
#    - At least one active SUPER_ADMIN remains (script enforces this)
#    - Counts under "Will be deleted" match your expectations
#    - Nothing under pankaj that you didn't intend to delete

# 4. Run for real. The password value here MUST match what the user knows
#    today (otherwise everyone gets locked out).
DATABASE_URL='<paste-prod-url>' npx tsx scripts/wipe-for-launch.ts \
  --confirm \
  --reset-admin-password='<the password the user already uses on prod>'

# 5. If you DON'T want to rotate the password (i.e. prod already has the
#    right one and you want to leave it alone), drop the
#    --reset-admin-password flag. The wipe still runs, password stays.

# 6. Verify by logging in at https://central.exargen.com with the
#    admin's email and the (possibly newly-rotated) password.
```

## Flags

| Flag | Default | Purpose |
|---|---|---|
| (none) | DRY-RUN | Surveys the database. Lists exactly what would be deleted. Makes no changes. |
| `--confirm` | off | Required to actually delete. Defends against `npx tsx wipe-for-launch.ts` typos. |
| `--reset-admin-password=<value>` | unset | If set, rotates ALL preserved SUPER_ADMIN passwords to this value in the same transaction. Also bumps `tokenVersion` and deletes refresh tokens for those users so any existing sessions die. |
| `--preserve-emails=<csv>` | `admin@exargen.in,pankaj@exargen.com` | Override the email allowlist. |
| `--preserve-patterns=<csv>` | `pankaj` | Substring patterns matched against email AND name (case-insensitive). |
| `--help` | — | Show flag reference. |

## What it deletes

In one transaction, in FK dependency order:

- Project tree: tasks, task links, task external links, task status history,
  sprints, epics, comments, decisions, milestones, deliverables, status
  updates, project acknowledgments, GitHub integrations, custom fields,
  project members, projects themselves
- All daily updates + daily update tasks, all notifications, all activities,
  all leave requests, all time entries, all timesheet weeks
- All CMS content (blogs, content projects, media, templates, generated
  drafts, content engine searches), all AI analysis results
- Enrollments + their children (signatures, quiz attempts, module progress)
  for non-preserved users
- Refresh tokens for non-preserved users
- Non-preserved users themselves
- Refresh tokens + bumped `tokenVersion` for preserved SUPER_ADMIN(s) if
  `--reset-admin-password` was passed

## What it preserves

- Users matching the preserve list (`admin@exargen.in`, `pankaj@exargen.com`,
  anything with "pankaj")
- Their enrollments + enrollment children (so onboarding progress stays)
- Their refresh tokens (unless password was rotated)
- All system data: courses, course modules, course documents, quizzes,
  quiz questions, permissions, role permissions

## Safety guarantees baked into the script

1. **Dry-run by default.** Refuses to delete without `--confirm` explicitly
   on the command line.
2. **Empty preserve list = abort.** Won't run if the preserve list would
   keep zero users.
3. **No remaining SUPER_ADMIN = abort.** Won't run if the wipe would leave
   the platform without an active super admin.
4. **One transaction.** Any error during execution rolls back the entire
   wipe. The database is either fully wiped or fully untouched — never in
   a half-state.
5. **Post-wipe verification.** Final counts are checked against the plan;
   any mismatch exits non-zero.

## What it does NOT touch

- Migrations and migration history (Prisma `_prisma_migrations` table)
- Database schema (no DDL — only `DELETE` and `UPDATE`)
- Anthropic / OpenAI API keys or any environment variables
- Vercel / hosting config
- Git history

## Post-wipe checklist for the super admin

After running on prod, the super admin should:

1. **Log in fresh** at `https://central.exargen.com` with the (possibly rotated) password
2. **Verify dashboard is empty** — 0 products, 0 in flight, 0 team, empty product health board
3. **Go to People → Add User** to invite real team members. Set role per person (Admin / Product Manager / Engineer / Client).
4. **Go to Projects → New Project** to create real projects, add the right members, set leads, start sprints.
5. **Ignore the mandatory onboarding course prompt for now** OR walk through it as a sanity check that nothing's broken (the system seeded an enrollment on first login).

## If you need to roll back

The wipe is destructive — your only recovery is the snapshot you took
before running. If you took the snapshot (you did, right?), restore from
that snapshot via your DB provider's console. There is no in-app undo.

## When NOT to run this

- On a staging environment where other engineers are mid-feature-test
- On any database where you don't have a recent backup
- Right before a launch demo (run at least a few hours before so you have
  time to fix anything that surfaces)
- When you're tired / under time pressure (the script is safe but
  human judgment around "did I really want to delete pankaj's projects" is
  required)
