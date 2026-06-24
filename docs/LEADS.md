# Leads

External-website form submissions, ingested into the Command Center under the
same per-project API key that powers the CMS. One key per content project,
two surfaces: blogs (read) and leads (write). Inside the app, leads live
under each CMS project alongside Blogs — created on the same branch as the
CMS rebrand to **Content**.

---

## 1. Why it lives next to CMS

A `CmsContentProject` already represents an external website (Furix, etc.)
and already owns the public-API key those sites use to fetch blogs. When the
same site needs to POST a contact / demo form, reusing that key is the right
boundary:

- One project, one secret. Rotate once, blogs *and* lead-ingest cut over
  atomically.
- The admin UI's mental model stays clean: pick the project → manage its
  Blogs and its Leads. No second "Leads project" registry to keep in sync.
- Scopes on the key (`apiKeyScopes: string[]`) decide which surfaces the
  key may hit, so a key can be downgraded to read-only without rotating.

The Content sidebar entry (was "CMS") covers both.

---

## 2. Data model

`backend/prisma/schema.prisma`:

```prisma
model CmsContentProject {
  id           String   @id @default(uuid())
  apiKey       String   @unique
  apiKeyScopes String[] @default([])  // [] = legacy "all allowed"
  // ...blogs, mediaAssets, templates...
  leads        Lead[]
}

enum LeadStatus { NEW CONTACTED CLOSED }

model Lead {
  id         String     @id @default(uuid())
  projectId  String
  website    String?    // human-friendly label, defaulted from project.name
  formType   String     // "contact" | "demo" | whatever the site sends
  name       String?
  email      String?
  phone      String?
  company    String?
  message    String?    @db.Text
  sourcePage String?    // URL the form was on
  metadata   Json?      // utm tags, custom fields, anything
  status     LeadStatus @default(NEW)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt
  project    CmsContentProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, email])
  @@map("leads")
}
```

Migration: `backend/prisma/migrations/20260602070723_add_leads/`.

`apiKeyScopes` semantics:
- `[]` — legacy / "everything allowed" (default for projects created before
  the leads work landed). Blogs read **and** leads ingest both succeed.
- non-empty array — strict allowlist. `leads.ingest` must be present for the
  ingest endpoint to accept a payload, otherwise `403 INSUFFICIENT_SCOPE`.
- `blogs.read` is always implicitly granted (the public blogs endpoint
  does not enforce scopes — backward compat with sites already deployed).

---

## 3. Backend surface

### Public ingest (no auth, keyed by `:apiKey`)

```
POST /api/v1/public/:apiKey/leads
```

Body (Zod-validated, `backend/src/validators/lead.schema.ts`):

```ts
{
  formType:    string,          // required, trimmed
  name?:       string,
  email?:      string,          // RFC email if present
  phone?:      string,
  company?:    string,
  message?:    string,
  sourcePage?: string,          // must be a URL if present
  metadata?:   any              // freeform
}
```

Behaviour (`backend/src/services/lead.service.ts`):

1. Resolve project by `apiKey` (`isActive: true`, `deletedAt: null`).
   Bad key → `403 INVALID_API_KEY`.
2. If `apiKeyScopes` is non-empty and missing `leads.ingest` →
   `403 INSUFFICIENT_SCOPE`.
3. Duplicate suppression: if the same `email` + `formType` already exists
   for this project within the last 7 days, return the existing lead with
   `{ duplicate: true }` and a `200`. New leads return `201`.
4. Fire-and-forget `activity.log` entry (`action: 'lead_ingested'`).

Rate limiting: shares the `publicCmsLimiter` middleware so abusive sites
can't drown the ingest endpoint.

### Admin (authenticated, RBAC-gated)

```
GET  /api/v1/leads?projectId=&page=&limit=     leads.view
GET  /api/v1/leads/:id                          leads.view
PUT  /api/v1/leads/:id/status   {status}        leads.manage
```

`projectId` is optional on list — omit it to get every project's leads
(used by the project-scoped page when not filtered, and reserved for any
future global inbox).

---

## 4. RBAC

Permission keys (`shared/src/constants/permissions.ts`):

| Key                  | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `leads.view`         | Read leads in the UI / via admin GET endpoints.  |
| `leads.manage`       | Change a lead's status (NEW → CONTACTED → CLOSED). |
| `leads.ingest`       | Scope on the project's API key — gates public POST. |
| `cms.apikey.view`    | See the API key chip and copy it.                |
| `cms.apikey.manage`  | Regenerate the key and toggle key scopes.        |

Defaults in `shared/src/constants/roles.ts`:

- `SUPER_ADMIN` — gets all via `Object.values(PERMISSIONS)`.
- `ADMIN` — `leads.view` + `leads.manage` + `cms.apikey.view` + `cms.apikey.manage`.
- `PRODUCT_MANAGER` — same as admin (they own external sites end-to-end).
- `ENGINEER` / `CLIENT` — none by default; can be granted per-user via the
  Access page.

Seeded on bootstrap by `backend/src/services/permissionSync.service.ts`
(same path as every other permission — no special migration needed).

---

## 5. Frontend layout

The Content sidebar entry (was "CMS") opens the project list. Picking a
project shows two cards — **Blogs** and **Leads** — plus an API-key chip
beside the project name with copy + regenerate icons.

| Route                                       | Page                  |
| ------------------------------------------- | --------------------- |
| `/cms`                                      | Project list / detail (CmsPage) |
| `/cms/projects/:projectId/blogs`            | ProjectBlogsPage      |
| `/cms/projects/:projectId/leads`            | ProjectLeadsPage      |
| `/cms/projects/:projectId/settings`         | ProjectSettingsPage (API key + scope toggles) |
| `/leads/:leadId`                            | LeadDetailPage        |
| `/admin/leads`                              | redirects → `/cms`    |

The project Settings page hosts the `leads.ingest` scope toggle. `blogs.read`
is shown as locked-on (informational only — see §2).

---

## 6. Integrating leads into a website

Each external site already calls the CMS for blogs. The same API key now
also accepts form submissions. Steps to wire it up:

### 6.1 Grab the project's API key

In the Command Center, open **Content → your project**. Copy the key from
the chip next to the project name. Confirm in **Settings → Key Permissions
(scopes)** that `leads.ingest` is **on** (default).

### 6.2 POST from the website's form handler

Plain `fetch` is enough. The endpoint takes JSON; no signed headers, no
preflight beyond CORS, no auth header — the URL path carries the key.

```ts
// On the website, e.g. on form submit:
async function submitContactForm(values) {
  const res = await fetch(
    `${CMS_ORIGIN}/api/v1/public/${API_KEY}/leads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formType: 'contact',          // or 'demo', 'newsletter', etc.
        name:     values.name,
        email:    values.email,
        phone:    values.phone,
        company:  values.company,
        message:  values.message,
        sourcePage: window.location.href,
        metadata: {
          utm_source:   new URLSearchParams(location.search).get('utm_source'),
          utm_medium:   new URLSearchParams(location.search).get('utm_medium'),
          utm_campaign: new URLSearchParams(location.search).get('utm_campaign'),
        },
      }),
    }
  );

  if (!res.ok) {
    // 400 = validation error, 403 = bad key / wrong scope, 429 = rate limited
    throw new Error(`Lead submit failed: ${res.status}`);
  }

  const { data, duplicate } = await res.json();
  return { leadId: data.id, duplicate };
}
```

Where:
- `CMS_ORIGIN` — the Command Center API origin (same one the blogs fetcher
  already uses).
- `API_KEY` — the project's API key. **Treat it like any public anon key**:
  it's fine to ship in the browser bundle (it can only POST leads and read
  published blogs), but rotate it if a site is decommissioned.

### 6.3 HTML-form-only (no JS framework)

If the marketing site posts directly from a `<form>`, do the request
server-side from whatever lightweight handler the site already has
(Next.js Route Handler, a Vercel Function, a Cloudflare Worker, etc.).
Don't `action=""` the form straight at the API — the response is JSON
and the user would land on raw text.

### 6.4 What you'll see in the Command Center

- New rows show up immediately in **Content → your project → Manage Leads**
  with status **NEW**.
- Same email + `formType` within 7 days collapses into the existing lead
  (the API returns `duplicate: true`); use a different `formType`
  (`contact` vs `demo`) to distinguish form intents on the same site.
- Status moves NEW → CONTACTED → CLOSED via the row buttons. Status changes
  require `leads.manage`.

### 6.5 Locking down the key to leads-only or blogs-only

If a site only needs to submit leads (not fetch blogs), or vice versa,
open **Settings → Key Permissions** and toggle `leads.ingest`. Untoggling
writes `apiKeyScopes: ['blogs.read']` — a non-empty allowlist that
excludes leads — and the public POST will return `403 INSUFFICIENT_SCOPE`.

Re-enabling writes `[]` (legacy "all allowed") so blogs and leads both
work again.

---

## 6.6 Copy-paste prompt for an AI assistant in the website repo

Hand this to Copilot / Claude / Cursor inside the **website** project (not
this one) when you want it to wire up lead submission. Fill in the two
`<<…>>` placeholders before sending.

```
You are working in a website repository that needs to forward its contact /
demo / newsletter form submissions to the Exargen Command Center "Leads"
API. Integrate it end-to-end.

Endpoint
  POST <<CMS_ORIGIN>>/api/v1/public/<<API_KEY>>/leads
  Content-Type: application/json
  No auth header — the API key is part of the URL path.
  The key may be shipped in the browser bundle (it can only POST leads
  and read published blogs). Read it from an env var, never hard-code.

Request body (JSON, validated server-side with Zod)
  {
    "formType":   string   // REQUIRED, e.g. "contact" | "demo" | "newsletter"
    "name":       string?  // optional
    "email":      string?  // optional, must be RFC email if present
    "phone":      string?  // optional
    "company":    string?  // optional
    "message":    string?  // optional
    "sourcePage": string?  // optional, must be a URL if present (use window.location.href)
    "metadata":   any?     // optional freeform — put utm_* tags + any extra fields here
  }

Responses
  201 { success: true, data: { id, status: "NEW", ... } }      // new lead created
  200 { success: true, duplicate: true, data: { ... } }        // same email+formType in last 7 days
  400 { success: false, error: <zod issues> }                  // validation failed
  403 { success: false, error: "INVALID_API_KEY" }             // bad/revoked key or project inactive
  403 { success: false, error: "INSUFFICIENT_SCOPE" }          // key has scopes and leads.ingest not granted
  429                                                           // rate-limited (shared public limiter)

What I want you to do
  1. Add two env vars to the project's standard env handling
     (.env.example, README, runtime config — match this repo's conventions):
       NEXT_PUBLIC_CMS_API_ORIGIN=<<CMS_ORIGIN>>
       NEXT_PUBLIC_CMS_API_KEY=<<API_KEY>>
     (Rename the prefix to match the framework — VITE_, PUBLIC_, etc.)
  2. Create a single typed client function `submitLead(payload)` in the
     existing api / lib / services folder (look at how blogs are fetched
     and mirror that file's location + style). It should:
       - Read CMS_ORIGIN + API_KEY from env.
       - POST JSON, include sourcePage = window.location.href on the client.
       - Auto-attach utm_source/utm_medium/utm_campaign/utm_term/utm_content
         from the current URL into `metadata`.
       - Return { id, duplicate } on success; throw a typed error on failure
         with the server's error code/message when available.
  3. Wire `submitLead` into every existing form that should generate a lead.
     Search the repo for form components (contact / demo / book a call /
     newsletter / pricing). For each:
       - Pick a stable `formType` slug per form (contact, demo, etc.) and
         keep them distinct — the 7-day duplicate window groups by
         (email, formType), so a user hitting Contact then Demo correctly
         produces two leads.
       - Show a success state on 201 or `duplicate: true`. Don't treat
         duplicate as an error.
       - Show a user-readable error on 4xx/5xx without exposing internals.
       - Disable the submit button while in flight.
  4. Do NOT post directly from a plain <form action=""> — the response is
     JSON. If the site has no JS at all, add a tiny server-side handler
     (Route Handler / Vercel Function / Worker — whatever this repo already
     uses) that forwards to the endpoint and then redirects to a thank-you
     page. Otherwise use fetch from the client.
  5. Add a brief section to the repo's README explaining the env vars and
     where leads land (Exargen Command Center → Content → <project> →
     Manage Leads).
  6. If the repo has tests, add one happy-path and one validation-failure
     test for `submitLead`, mocking fetch. Match the test runner already
     in use.

Constraints
  - Do not introduce a new HTTP client library if the project already has one.
  - Do not add retries or queueing — a single attempt is correct; the
    endpoint is idempotent within its 7-day duplicate window.
  - Do not log the API key. Do not commit a real key — only the
    NEXT_PUBLIC_CMS_API_KEY=<<API_KEY>> in .env.example as a placeholder.
  - Keep changes minimal and match the surrounding code style.

When you're done, summarize: which forms you wired up, which formType
each one uses, and any forms you intentionally skipped.
```

Why this prompt is shaped the way it is:
- It states the contract (endpoint, body, responses) upfront so the
  assistant doesn't have to guess from the curl example.
- The "What I want you to do" list is ordered the way the work actually
  has to land — env vars → client function → form wiring → docs/tests —
  so the assistant doesn't half-finish a step.
- The constraints block prevents the common Copilot reflexes (adding axios,
  adding exponential-backoff retries, logging the key for "debugging").

---

## 7. Failure modes & how they surface

| Symptom                                  | Likely cause                                         |
| ---------------------------------------- | ---------------------------------------------------- |
| `403 INVALID_API_KEY`                    | Key revoked, project soft-deleted, or `isActive: false`. |
| `403 INSUFFICIENT_SCOPE`                 | `leads.ingest` scope toggled off in Settings.        |
| `400` with Zod error array               | Missing `formType`, malformed `email`, non-URL `sourcePage`. |
| `429`                                    | `publicCmsLimiter` tripped — usually a stuck retry loop. |
| Lead doesn't appear in UI but POST → 200 | `duplicate: true` — check the existing row, or vary `formType`. |
| Admin GET `/leads` returns empty         | `projectId` query missing on a filtered list and the user's UI is calling it wrong, or the user lacks `leads.view`. |

---

## 8. Files touched (for future reviewers)

Backend
- `backend/prisma/schema.prisma` — `Lead`, `LeadStatus`, `apiKeyScopes`.
- `backend/prisma/migrations/20260602070723_add_leads/`
- `backend/src/handlers/leadHandlers.ts`
- `backend/src/routes/lead.routes.ts`
- `backend/src/services/lead.service.ts`
- `backend/src/validators/lead.schema.ts`
- `backend/src/index.ts` — mount `leadRoutes`.
- `backend/src/services/permissionSync.service.ts`,
  `backend/src/seed/permissions.seed.ts` — new permission rows.
- `backend/src/services/cmsService.ts`, `backend/src/handlers/cmsHandlers.ts`
  — accept `apiKeyScopes` on `updateContentProject`.
- `backend/src/routes/cms.routes.ts` — regenerate route now gated by
  `cms.apikey.manage`.

Shared
- `shared/src/constants/permissions.ts` — `LEADS_*`, `CMS_APIKEY_*`.
- `shared/src/constants/roles.ts` — defaults for ADMIN + PM.

Frontend
- `frontend/src/api/leads.ts`
- `frontend/src/api/cms.ts` — `apiKeyScopes` on the type + update payload.
- `frontend/src/pages/CmsPage.tsx` — API key chip, Blogs/Leads cards.
- `frontend/src/pages/cms/ProjectLeadsPage.tsx`
- `frontend/src/pages/cms/ProjectBlogsPage.tsx` — Leads button in header.
- `frontend/src/pages/cms/ProjectSettingsPage.tsx` — scope toggles, key gate.
- `frontend/src/pages/admin/LeadDetailPage.tsx`
- `frontend/src/App.tsx` — routes + `/admin/leads` redirect.
- `frontend/src/lib/constants.ts`,
  `frontend/src/components/layout/MobileBottomNav.tsx` — sidebar
  renamed CMS → Content.
