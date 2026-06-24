# Deployment — Vercel (frontend) + Railway (backend) + Postgres

This is the production deploy guide. Read top to bottom before the first deploy. Every gotcha here came from a real QA finding before the system saw users.

## TL;DR — env-var checklist

The single most common failure mode is missing or wrong env vars. Verify these before you `git push` to your main branch (which triggers both Vercel and Railway deploys).

### Railway (backend service)

| Variable | Required? | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | `postgresql://…@…railway.app:6543/railway?sslmode=require` | Railway provides automatically when you add a Postgres plugin |
| `JWT_ACCESS_SECRET` | yes | 64-char random hex | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` — placeholder strings are REJECTED at boot in prod |
| `JWT_REFRESH_SECRET` | yes | 64-char random hex | Same generator. Different from the access secret. |
| `JWT_ACCESS_EXPIRY` | no | `15m` | Default fine |
| `JWT_REFRESH_EXPIRY` | no | `7d` | Default fine |
| `NODE_ENV` | yes | `production` | Required so cookies use `Secure + SameSite=None`, CSP turns on, etc. |
| `CORS_ORIGIN` | yes | `https://command-center.exargen.in` | Comma-separated. Localhost defaults are REJECTED in production. |
| `BACKEND_PUBLIC_URL` | yes (recommended) | `https://command-center-production.up.railway.app` | Helmet uses this for CSP `connect-src`. Without it the prod SPA can't fetch (CSP blocks the cross-origin XHR). |
| `CMS_PUBLIC_BASE_URL` | optional | `https://blog.exargen.in` | Only if CMS public routes are exposed externally |
| `PORT` | no | `3000` | Railway sets `PORT` automatically; the default in code is fine |
| `LOAD_SEED_DATA` | no, but **set to false in prod** | `false` | Seed users carry the documented `Admin@1234` password. Rotate via `backend/scripts/reset-admin-password.ts` before onboarding. |

### Vercel (frontend project)

| Variable | Required? | Example | Notes |
|---|---|---|---|
| `VITE_API_URL` | **yes** | `https://command-center-production.up.railway.app` | No trailing slash. **Without this set on Vercel, the SPA calls its own origin and 404s on every request.** |

Vercel preview URLs land on `https://<project>-<hash>.vercel.app`. To allow them through CORS, add `https://*.vercel.app` to Railway's `CORS_ORIGIN` (the backend's CORS allowlist supports wildcards).

---

## File-storage caveat (read this BEFORE letting users upload anything you care about)

`/uploads` writes to **Railway's local filesystem**. Railway containers are ephemeral — every redeploy and every container restart **wipes the directory**. Any CMS image, blog cover, or media asset users upload before durable storage is wired will be lost.

Two options, in order of preference:

1. **Cloudflare R2 / AWS S3** (proper fix, ~3-4 hours of work). The repo already declares `@aws-sdk/client-s3` as a dep but doesn't import it; this is the path of least surprise once you have credentials. Tracking issue: H-C3 in the QA baseline.
2. **Railway Volume** (interim). Attach a persistent volume to the backend service in Railway's dashboard, mount it at `/app/backend/uploads`. Files survive deploys but not service deletion. No code change required.

Until one of these is live, **don't let anyone publish a CMS post with images they care about**.

The CMS upload route now uses `multer` for multipart uploads (10 MB / file, 10 files / request, MIME-allowlisted). Base64-in-JSON is still accepted as a backward-compat fallback but the catch-all 25 MB JSON parser is no longer the primary path.

---

## First-deploy walkthrough

### Backend on Railway
1. Connect the repo to a new Railway project. Use the existing `railway.json` (Dockerfile build, `npx prisma migrate deploy` as `preDeployCommand`, `node dist/index.js` as `startCommand`).
2. Add a Postgres plugin. Confirm `DATABASE_URL` is auto-injected.
3. Set the env vars from the table above. Pay attention to: `NODE_ENV=production`, both JWT secrets, `CORS_ORIGIN` (with the actual Vercel hostname), `BACKEND_PUBLIC_URL` (with Railway's auto-assigned URL — set this AFTER the first deploy succeeds and you can copy the URL from the dashboard).
4. Deploy. Watch the logs for `Server running on port … in production mode`.
5. Hit the health endpoint to confirm: `curl https://<backend>.up.railway.app/api/v1/health` → `{"success":true,"data":{"status":"ok",...}}`.

### Frontend on Vercel
1. Connect the repo. Build command is the default Vite (`npm run build`), output dir `frontend/dist`.
2. Set `VITE_API_URL` in Project → Settings → Environment Variables to the Railway backend URL.
3. Deploy. Visit the Vercel URL.
4. Sign in. The first-ever login uses `admin@exargen.in` with whatever password the `reset-admin-password.ts` script printed during your last rotation.

### Smoke test sequence (run after both deploys are live)

```bash
# 1. Backend healthy
curl https://<backend>.up.railway.app/api/v1/health

# 2. CORS preflight from your real frontend URL
curl -I -X OPTIONS https://<backend>.up.railway.app/api/v1/auth/login \
  -H "Origin: https://<frontend>.vercel.app" \
  -H "Access-Control-Request-Method: POST"
# Expect: 204, with Access-Control-Allow-Origin: https://<frontend>.vercel.app
#                  and Access-Control-Allow-Credentials: true

# 3. Login + cookie set
curl -i -X POST https://<backend>.up.railway.app/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://<frontend>.vercel.app" \
  -d '{"email":"admin@exargen.in","password":"<rotated pw>"}'
# Expect: 200, Set-Cookie: refreshToken=…; Path=/api/v1/auth; HttpOnly; Secure; SameSite=None

# 4. Refresh works
curl -i -X POST https://<backend>.up.railway.app/api/v1/auth/refresh \
  -H "Origin: https://<frontend>.vercel.app" \
  --cookie 'refreshToken=<value from step 3>'
# Expect: 200 with a new accessToken
```

Then in a real browser:
1. Open the Vercel URL, log in.
2. DevTools → Application → Cookies → backend domain. Confirm `refreshToken` with `SameSite=None`, `Secure`, `HttpOnly`.
3. DevTools → Network → all `/api/v1/*` calls return 200, no `(blocked:csp)` entries.
4. Hard refresh — stays logged in.
5. Idle 14 min — inactivity warning modal appears with 60s countdown.

---

## Known limitations on day one

These are deliberately deferred from the deploy-blocker fixes; track in the backlog and address when they bite:

- **No email-based forgot-password.** Admin-driven reset only — see `docs/ADMIN_PLAYBOOK.md` §3. Fine for a 5-person team; add SMTP + reset-token flow when the team grows.
- **No tests on the backend.** A frontend Playwright smoke spec exists. Before scaling out, add at least an auth + permissions integration suite.
- **Bundle is ~1.9 MB unsplit.** Acceptable on Vercel's edge for v1; revisit with `manualChunks` when pages-per-second slows perceptibly.
- **Inactivity logout cannot be disabled in dev.** Long debugging flows hit the 15-min timer. Hardcoded for now (`frontend/src/hooks/useInactivityLogout.ts`).

## Production-readiness audit history

Two QA sweeps before launch:
- 2026-04 pre-launch: 28 findings → PR #43 fixed B1/B2/B3/H1/H3/H4 + #29
- 2026-05 onboarding: 5 rounds across 5 specialist agents → 8 critical, 29 high → this PR (PR-A) ships the 10 deploy-blocking fixes

Continue running the QA sweep cadence each time a meaningful new feature lands.
