/**
 * Starter templates for project plan ingestion. Each one is a complete,
 * valid markdown plan that round-trips through the parser cleanly.
 *
 * Templates use relative-date tokens (`{{D+0}}`, `{{D+13}}`, etc.)
 * that get resolved to real YYYY-MM-DD strings at pick-time
 * (`materializeTemplate`). QA I-M9: previously the templates had
 * literal `YYYY-MM-DD` placeholders that threw "must be valid date"
 * if the user clicked Parse without editing first. Now an unedited
 * template parses cleanly out of the box.
 */

export interface IngestionTemplate {
  id: string;
  label: string;
  description: string;
  /** Source markdown with `{{D+N}}` tokens (N = days from today). */
  markdown: string;
}

/**
 * Replace `{{D+N}}` tokens with real YYYY-MM-DD dates. Uses local-date
 * components (not UTC) so users east of UTC don't see yesterday on a
 * fresh template open before 05:30 IST.
 */
export function materializeTemplate(template: string, today = new Date()): string {
  return template.replace(/\{\{D\+(-?\d+)\}\}/g, (_m, days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + Number(days));
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  });
}

export const INGESTION_TEMPLATES: IngestionTemplate[] = [
  {
    id: 'saas_feature',
    label: 'SaaS feature (2 sprints)',
    description: 'A single product capability shipped across two sprints with QA + rollout.',
    markdown: `# Project: <feature name>
> Short pitch. Why this exists, who it's for.

## Epic: Backend
> Server-side scaffolding, schema, and service layer.
**Color:** #6366f1

### Sprint: Sprint 1 — foundations ({{D+0}} → {{D+13}})
> Goal: schema + service layer ready, no UI yet.

#### Task: Define the data model
**Priority:** P1
**Points:** 3
**Type:** CHORE

**Description:**
Decide on the Prisma model for this feature. Document tradeoffs in
the project's Decisions tab.

**Acceptance Criteria:**
- [ ] Schema reviewed with one other engineer
- [ ] Migration drafted (not yet applied)
- [ ] Indexes covering the hot-path queries

#### Task: Service-layer endpoints (create / list / update / delete)
**Priority:** P0
**Points:** 5
**Type:** FEATURE

**Acceptance Criteria:**
- [ ] All four endpoints behind authn + correct authz
- [ ] Wire-format documented in the README
- [ ] Tests for the auth gate on each

**Subtasks:**
- [ ] create
- [ ] list
- [ ] update
- [ ] delete

### Sprint: Sprint 2 — UI + polish ({{D+14}} → {{D+27}})
> Goal: feature is usable end-to-end and can ship to a beta cohort.

#### Task: List + detail UI
**Priority:** P0
**Points:** 5
**Type:** FEATURE

**Acceptance Criteria:**
- [ ] Empty state when no items exist
- [ ] Pagination handles 1000+ items without lag
- [ ] Keyboard shortcut to create

#### Task: Edit + delete flow
**Priority:** P1
**Points:** 3
**Type:** FEATURE

#### Task: Wire analytics events
**Priority:** P2
**Points:** 2
**Type:** CHORE

## Epic: QA + rollout
> Tests, docs, gradual rollout.
**Color:** #14b8a6

#### Task: End-to-end tests
**Priority:** P1
**Points:** 3
**Type:** CHORE

#### Task: Beta cohort + feedback loop
**Priority:** P1
**Points:** 2
**Type:** CHORE

**Description:**
Pick 5 friendly customers. Ship behind a flag. Set up a 2-week feedback window.
`,
  },

  {
    id: 'mobile_launch',
    label: 'Mobile app launch (alpha → GA)',
    description: 'A phased product launch — alpha to closed beta to public GA.',
    markdown: `# Project: <app name>
> Phased rollout from alpha to public GA.

## Epic: Alpha (internal)
> Self-test only. Backend stub + skeleton screens.
**Color:** #ef4444

### Sprint: Alpha sprint ({{D+0}} → {{D+13}})
> Goal: app boots, fake data, no crashes on the happy path.

#### Task: Onboarding screens
**Priority:** P0
**Points:** 5
**Type:** FEATURE

#### Task: Auth + session restore
**Priority:** P0
**Points:** 5
**Type:** FEATURE

#### Task: Crash + analytics SDK wiring
**Priority:** P1
**Points:** 3
**Type:** CHORE

## Epic: Closed beta
> Invite cohort: 50 users. Real backend. Push notifications.
**Color:** #f59e0b

### Sprint: Beta sprint 1 ({{D+14}} → {{D+27}})
> Goal: invite list, real auth, push notifications.

#### Task: Invite-code redemption flow
**Priority:** P0
**Points:** 5
**Type:** FEATURE

**Acceptance Criteria:**
- [ ] Code is one-time-use
- [ ] Expired codes show a clear message
- [ ] Daily admin report of redemptions

#### Task: Push notification opt-in
**Priority:** P1
**Points:** 3
**Type:** FEATURE

### Sprint: Beta sprint 2 ({{D+28}} → {{D+41}})
> Goal: react to beta feedback, fix top 5 P0/P1 bugs.

#### Task: Triage + fix backlog
**Priority:** P0
**Points:** 8
**Type:** BUG

## Epic: GA launch
> Public release.
**Color:** #10b981

#### Task: App store submissions (iOS + Android)
**Priority:** P0
**Points:** 3
**Type:** CHORE

**Acceptance Criteria:**
- [ ] iOS review notes drafted
- [ ] Android internal track tested
- [ ] Marketing site live

#### Task: Launch day comms
**Priority:** P0
**Points:** 2
**Type:** CHORE
**Labels:** launch, marketing

#### Task: Post-launch monitoring + on-call rota
**Priority:** P0
**Points:** 2
**Type:** CHORE
`,
  },

  {
    id: 'api_service',
    label: 'API service (scaffold → production)',
    description: 'A backend service from scaffold to production deployment.',
    markdown: `# Project: <service name>
> New microservice. From repo scaffolding to production deploy.

## Epic: Foundations
> Repo scaffolding, CI, conventions.
**Color:** #6366f1

#### Task: Repo + CI scaffolding
**Priority:** P0
**Points:** 2
**Type:** CHORE

**Acceptance Criteria:**
- [ ] CI runs lint + tests on every PR
- [ ] Pre-commit hook for formatting

#### Task: Logging + tracing baseline
**Priority:** P1
**Points:** 3
**Type:** CHORE

**Acceptance Criteria:**
- [ ] Structured JSON logs
- [ ] OpenTelemetry tracer initialised on boot

## Epic: Core API
> The service's primary endpoints.
**Color:** #14b8a6

### Sprint: Sprint 1 — happy path ({{D+0}} → {{D+13}})
> Goal: read + write endpoints behind authentication.

#### Task: GET /resource/:id
**Priority:** P0
**Points:** 3
**Type:** FEATURE

#### Task: POST /resource
**Priority:** P0
**Points:** 5
**Type:** FEATURE

**Acceptance Criteria:**
- [ ] Schema validation rejects bad inputs with 400 + per-field detail
- [ ] Duplicate payloads return 409
- [ ] Audit-log row written on every create

#### Task: PATCH /resource/:id
**Priority:** P0
**Points:** 3
**Type:** FEATURE

#### Task: DELETE /resource/:id
**Priority:** P1
**Points:** 2
**Type:** FEATURE

### Sprint: Sprint 2 — listing + filters ({{D+14}} → {{D+27}})
> Goal: paginated listing + filters that match the consumer's UX.

#### Task: GET /resource (paginated)
**Priority:** P0
**Points:** 5
**Type:** FEATURE

**Acceptance Criteria:**
- [ ] Cursor-based pagination
- [ ] Filter by 3+ fields composable via query string
- [ ] Stable ordering even when filtered

## Epic: Production readiness
> Everything between "works on my laptop" and "we got paged."
**Color:** #f43f5e

#### Task: Rate limiting per API key
**Priority:** P0
**Points:** 3
**Type:** CHORE

#### Task: Health check + readiness probe
**Priority:** P0
**Points:** 1
**Type:** CHORE

#### Task: Backup + restore runbook
**Priority:** P1
**Points:** 3
**Type:** CHORE

#### Task: Load test + capacity baseline
**Priority:** P1
**Points:** 5
**Type:** SPIKE

**Description:**
Run a load test at 1x, 3x, and 10x expected RPS. Document p50/p95/p99
latencies and the bottleneck encountered at each rung.
`,
  },
];
