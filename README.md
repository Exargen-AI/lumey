# Exargen Command Center

Internal project management platform — kanban + sprints + epics + leave tracking + CMS + GitHub PR linking. TypeScript / React / Express / Prisma / Postgres. Deploys on Railway (backend) + Vercel (frontend).

## Quick start (local dev)

```bash
# 1. Install
npm install

# 2. Copy + edit env files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# (set DATABASE_URL, JWT secrets — see backend/.env.example for guidance)

# 3. Run migrations + seed
cd backend
npx prisma migrate deploy
npm run db:seed
cd ..

# 4. Start dev servers
npm run dev          # runs backend (port 3000) + frontend (port 5174) in parallel
```

Default seeded login: `admin@exargen.in` / `Admin@1234` — **rotate before any real user logs in**, see [docs/ADMIN_PLAYBOOK.md §3d](docs/ADMIN_PLAYBOOK.md).

## Layout

```
backend/        Express + Prisma + Postgres
frontend/       Vite + React + TanStack Query + Tailwind
shared/         Types + role/permission constants used by both
docs/           Playbook + spec docs (see below)
```

## Docs

| Doc | Read this when |
|---|---|
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | First time deploying to Railway + Vercel. Env-var matrix, smoke tests, known limits. |
| [`docs/ADMIN_PLAYBOOK.md`](docs/ADMIN_PLAYBOOK.md) | Onboarding a teammate. Resetting a password. Deactivating a user. Super-admin armor invariants. |
| [`docs/INGESTION_SPEC.md`](docs/INGESTION_SPEC.md) | Writing an `implementation.md` that the **Ingest Plan** feature can parse into Epics → Sprints → Tasks. |
| [`docs/PRODUCT_GUIDE.md`](docs/PRODUCT_GUIDE.md) | End-user product guide. What every page does, who uses it, how to navigate. |
| [`DOCUMENTATION.md`](DOCUMENTATION.md) | Engineering reference — schema, services, conventions. |

## What's where

- **Auth + roles**: `backend/src/services/auth.service.ts`, `backend/src/services/user.service.ts`, `backend/src/middleware/{authenticate,requireRoles,requireOrigin}.ts`. Roles ladder from `SUPER_ADMIN` → `ADMIN` → `PRODUCT_MANAGER` → `ENGINEER` → `CLIENT`. Super-admin armor invariants in `assertCanActOnSuperAdmin` etc.
- **Tasks + kanban**: `backend/src/services/task.service.ts`, `frontend/src/components/kanban/`. State machine + Done-gate around AC.
- **Sprints + epics**: `backend/src/services/sprint.service.ts`, `epic.service.ts`. Sprints carry an optional `epicId` (added by ingestion).
- **Plan ingestion**: `backend/src/services/projectIngestion.service.ts`. Markdown → tree → atomic commit. Spec in `docs/INGESTION_SPEC.md`.
- **Leave**: `backend/src/services/leave.service.ts`. SUPER_ADMIN-only approval. Founder is the sole approver in v1.
- **CMS**: `backend/src/services/cmsService.ts`. Multi-project blog system with public + authed routes.
- **GitHub PR linking**: `backend/src/services/githubIntegration.service.ts`. Webhook + auto-close on merge.

## Common dev tasks

```bash
# Reset everything to seed (local only)
cd backend && npx prisma migrate reset --force && npm run db:seed

# Rotate the local admin password (prints once to stdout — copy immediately)
cd backend && npx tsx scripts/reset-admin-password.ts

# Build all workspaces
npm run build:shared && npm run build --workspace=backend && npm run build --workspace=frontend

# Run e2e smoke tests (one Playwright spec for now)
npm run test:e2e --workspace=frontend
```

## Deploy

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full Railway + Vercel walkthrough. The TL;DR env-var checklist:

**Railway (backend)**: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `NODE_ENV=production`, `CORS_ORIGIN=<vercel-url>`, `BACKEND_PUBLIC_URL=<railway-url>`, `LOAD_SEED_DATA=false`.

**Vercel (frontend)**: `VITE_API_URL=<railway-url>`.

## Status

In active development. QA-baselined across 5 specialist audit agents — all CRITICAL findings closed in PR #50, all HIGH in #51. See git log for details.
