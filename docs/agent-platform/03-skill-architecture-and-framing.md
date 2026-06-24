# Skill Architecture & Agent Framing

**Companion to** `01-vision-and-spec.md` and `02-implementation-plan.md`.
**Status:** decided. Supersedes specific sections of `01` (noted inline below).

This document captures two related corrections to the original spec, identified after Slice 1 and Slice 2 were already in production:

1. **Three-tier skill architecture.** Project-specific knowledge belongs to the project, not to the agent.
2. **No capability-rank framing.** We do not label Manjari "junior" or anything that anchors her LLM context in a hierarchy. Boundaries are described in terms of *actions she takes*, not *capabilities she lacks*.

Both shifts make the platform more reusable (any agent can work on any project that exposes its skills) and more capable (the LLM uses its full reasoning rather than self-throttling).

---

## §1 — Three-tier skill architecture

### Why the original two-tier model was wrong

The original spec (§3.4) split skills into:
- **Personal scope** — universal, mounted from `~/.claude/skills/`.
- **Project scope** — per-agent, mounted from `~/exargen/<agent-name>/skills/`.

This put project-specific knowledge inside the AGENT's home directory. Concretely, ManaCalendar's panchangam quirks would live at `~/exargen/manjari/skills/panchangam-calculation/`. Three problems:

1. **Doesn't generalize.** When we want Manjari to also help on Furix, we'd have to copy-paste 6 skill directories into her home folder. New project = new authoring effort, in the wrong place.
2. **Wrong owner.** Panchangam math evolves as the ManaCalendar codebase evolves. The PM/engineers who own ManaCalendar are the right people to update its skill files. They don't have access to Manjari's home dir; they own the project repo.
3. **Doesn't compose with future agents.** When we add a senior-coder agent (or any second agent), we'd duplicate every project skill across every agent's home directory.

### The corrected model

| Tier | Lives at | Owned by | Loaded when | Examples |
|---|---|---|---|---|
| **1. Universal** | `~/.claude/skills/` | The agent platform team (Sentiens) | Every container, every task | `commit-and-pr-conventions`, `cc-cli-protocol`, `self-review-checklist`, `escalation-decision-tree`, `deep-research` |
| **2. Agent identity** | `~/exargen/<agent-name>/` | The agent's manager | Every container that agent spawns | `PRIME_DIRECTIVE.md`, `CLAUDE.md`, **plus** any role-specific skills that are truly project-agnostic |
| **3. Project** | `<project-repo>/.cc/skills/` (committed to the project's git repo) | The project's owners (PM/engineers via PR review) | After the runtime clones `/work`, only for that one task | `codebase-conventions`, `verify`, domain-specific skills (panchangam-calculation, payment-flow, etc.) |

**The key insight:** project-specific skills are a property of the project, not the agent. ManaCalendar carries its own skill manifest. When we onboard Manjari to Furix, Furix carries its own. Both projects evolve their skills via normal PR review on their own repos. Same compounding loop, distributed correctly.

### Container mounts (revised)

```
Container mounts:
  /personal-skills   ← ~/.claude/skills/         (Tier 1, read-only)
  /context           ← ~/exargen/manjari/        (Tier 2: identity + role skills, read-only)
  /work              ← fresh git clone of <project>  (contains Tier 3 at /work/.cc/skills/)
```

The agent's preamble loader composes skill metadata from all three locations. Each tier is identical in shape (`SKILL.md` with frontmatter, plus optional `references/`, `examples/`, `scripts/`); only the source location differs. The Claude Agent SDK's skill discovery handles multiple roots natively when configured with multiple skills paths.

### What goes in each tier (revised content)

**Tier 1 — Universal personal skills** (5 skills, agent-agnostic + project-agnostic):

| Skill | What it covers |
|---|---|
| `commit-and-pr-conventions` | Branch names, commit format, PR template, Risks-section honesty rule. Works for any repo. |
| `cc-cli-protocol` | The 6 `cc` commands and the comment intent at each checkpoint. |
| `self-review-checklist` | Pre-completion quality gate — code, style, verification, communication, scope, honesty. |
| `escalation-decision-tree` | When to proceed, ask, or stop. |
| `deep-research` | The `Explore` subagent fork pattern for read-only codebase exploration. |

**Tier 2 — Manjari's identity** (thin by design):

| File | What it is |
|---|---|
| `PRIME_DIRECTIVE.md` | Locked contract — identity, pass criteria, forbidden actions, escalation triggers, truthfulness rule, confidentiality (for v1 ghost mode). |
| `CLAUDE.md` | Operating manual under 80 lines — outcome-level rules, escalation conditions, list of available skills. |

Most of what looked like "role skills" in the original spec turn out to be either universal (tier 1) or project-specific (tier 3). Tier 2 skills directory is allowed to be empty for v1; if a truly project-agnostic, role-specific skill emerges later (e.g., `engineering-task-shape` describing what an engineering task looks like vs a planning task), it lives here.

**Tier 3 — Per-project skills** (committed to each project's repo at `.cc/skills/`):

ManaCalendar's set, for example:

| Skill | What it covers |
|---|---|
| `.cc/skills/codebase-conventions/` | File layout, style, naming, framework patterns specific to ManaCalendar. |
| `.cc/skills/verify/` + `scripts/verify.sh` | The actual `npm run lint && npm test && npm run build` for this project. |
| `.cc/skills/panchangam-calculation/` (with `references/`) | Hindu calendar math, edge cases, library internals. |
| `.cc/skills/telugu-conventions/` | Script, fonts, transliteration. |
| `.cc/skills/capacitor-considerations/` | Web vs mobile, what works where, build differences. |
| `.cc/skills/test-writing-patterns/` | This project's actual test conventions (Vitest patterns, fixtures, what to test). |

When Furix gets onboarded, it commits its own `.cc/skills/codebase-conventions/`, `.cc/skills/verify/`, plus payment/POS-specific skills. When QA review reveals a gap in the project's skills, the fix is a PR to that project's `.cc/skills/`.

### Project onboarding flow (how to add Manjari to a new project)

1. The project's owner adds Manjari to the project as a `ProjectMember` (Engineer role).
2. The project's repo gains a `.cc/skills/` directory with at minimum a `verify/` skill so Manjari can run the project's tests + build.
3. Optional: `.cc/skills/codebase-conventions/`, plus any domain-specific skills the team thinks Manjari needs.
4. The runtime detects new tasks assigned to Manjari in this project, clones the repo, and the project's skills load automatically.
5. PR feedback over the first few tasks codifies into `.cc/skills/` updates — same compounding loop the original spec described, just in the right filesystem location.

### Fallback behavior

If a project doesn't have `.cc/skills/` yet, Manjari works with just:
- universal skills (tier 1)
- her identity files (tier 2)
- the project context from `GET /agents/me/knowledge-pack/:projectSlug` (the Slice 2 endpoint, which returns project metadata, recent activity, sprint tasks, decisions — but `skills: []`)

She'll be more cautious, ask more questions, and be slower to act decisively. That's fine — the friction itself is what surfaces missing skills, and the team's review feedback codifies into the project's `.cc/skills/` over the first few tasks.

### Backward compatibility with the original spec

This section supersedes the original spec at:
- **§1.3, "What we've decided"** — the bullet "Skills-first architecture: specialization comes from skills (filesystem-based)" remains correct in spirit but the filesystem layout is now three-tier rather than two-tier.
- **§3.4, "Skills architecture"** — the personal/project split is replaced with the universal/identity/project split above.
- **§5.3, "Project skills for ManaCalendar"** — those skills are moved into the manacalendar repo at `.cc/skills/`, not into `~/exargen/manjari/skills/`.

Nothing in the implementation slices already shipped (Slice 1, Slice 2) needs to change. The `GET /agents/me/knowledge-pack/:projectSlug` endpoint already returns `skills: []` and the field is reserved for a future tier of CC-managed skills (out of scope for now).

---

## §2 — Agent framing: boundaries, not capability ranks

### Why we don't call Manjari "junior"

The original spec (§5.1) framed Manjari as `role: junior-coder`, and PRIME_DIRECTIVE templates included lines like "I am a `<contributor / planner / reviewer>`, not an architect." Both anchor the LLM's self-perception in a hierarchy.

This is a mistake. Anchoring an LLM with "you are a junior X" produces self-throttled, sycophantic, defer-on-everything behavior. The model has the same reasoning capability either way; the framing changes how it deploys that capability. We want Manjari to use her full reasoning when working a task, then bound her actions externally rather than internally.

The correct shift:

| Wrong (capability-claim) | Right (action-bounded) |
|---|---|
| "I am a junior coder." | (no rank claim) |
| "I am a contributor, not an architect." | "When a task would change architecture, dependencies, or shared abstractions, I describe my proposed approach in a comment, then wait for explicit confirmation before implementing." |
| "I do not make architectural decisions." | "I do not make architectural decisions unilaterally. I describe two or three options, recommend one with reasoning, and let the team confirm." |
| "I'm not qualified to merge." | "I do not push to `main`. PRs are merged by humans after review." |

Same outcome, different framing. The first set tells the LLM to *be* less capable. The second set tells it to *do* certain things (describe, wait, ask) at certain trigger conditions.

### What we keep

Every other "boundary" the spec describes is fine — they're all action-shaped:

- **Forbidden actions** (push to main, force-push, modify CI, commit secrets, add new dependencies without approval, modify auth/RBAC code, etc.) — these are *things she does not do*, not capability claims. Keep all.
- **Escalation triggers** (acceptance criteria contradicts itself, task touches a forbidden item, would need a new dependency, stuck >30 minutes, would require an architectural alternative). These are *situations in which she stops and asks*, not capability claims. Keep all.
- **Truthfulness clause** ("if I cannot verify something works, I say so. I do not assert.") — this is a behavioral commitment, not a capability claim. Keep.
- **Verification-as-tool** (the `verify` skill with `scripts/verify.sh`) — deterministic, capability-agnostic. Keep.

### Operational impact

- **`agentRole` field on the User row.** The original seed had `agentRole: 'junior-coder'`. Renamed to `'autonomous-engineer'` (descriptive of function and mode, no rank). This field is metadata only — visible in the admin UI's Agent Configuration section, not injected into the LLM's context.
- **Future agents.** The spec lists "junior-coder, pm, senior-coder, qa, security-reviewer" as planned agent roles. We drop the senior/junior axis entirely. Future kinds become `'autonomous-engineer'`, `'autonomous-pm'`, `'autonomous-qa'`, `'autonomous-security-reviewer'` — differentiated by *what they do*, not where they sit on a ladder.
- **PRIME_DIRECTIVE template** (spec §3.2). The template line `"I am <Name>, <role> on <project>."` becomes simply `"I am <Name>."` Identity remains; rank does not. The line `"I am a <contributor / planner / reviewer>, not an architect."` is dropped entirely.
- **CLAUDE.md template** (spec §3.3). Same treatment — identity-only opening, escalation rules describe *situations*, not capability gaps.

### Backward compatibility with the original spec

This section supersedes the original spec at:
- **§1.3** — the bullet "First instance: one agent, named Manjari, role junior-coder" is rephrased to "First instance: one agent, named Manjari".
- **§3.2** — the PRIME_DIRECTIVE template's identity block drops the rank line and the "not an architect" line.
- **§5.1** — Manjari's `Role: junior-coder` is changed to `agentRole: autonomous-engineer`. The label only appears in admin UI / metadata.

Nothing the LLM sees should ever contain the words "junior", "senior", or any rank-based framing for Manjari (or any future agent). The actions, escalation triggers, and forbidden lists do all the necessary bounding.

---

## What changes in the codebase from this revision

Small. Most of the architecture lands in markdown files outside this repo (`~/.claude/skills/`, `~/exargen/manjari/`, and each project's `.cc/skills/`). Inside this repo:

- **Seed update.** `backend/src/seed/agentUsers.seed.ts`: `agentRole: 'junior-coder'` → `agentRole: 'autonomous-engineer'`. Idempotent — Manjari's row updates on next deploy.
- **Doc cross-references.** `01-vision-and-spec.md` and `02-implementation-plan.md` get short "see also `03`" headers at the affected sections (§1.3, §3.2, §3.4, §5.1, §5.3). The original text is preserved as historical record; the active interpretation lives in `03`.

That's it. The agent platform's API surface, schema, and admin UI from Slices 1+2 are unchanged.

---

## Living-document notes

- This file is the active reference for skill layout and agent framing.
- Future revisions go in subsequent numbered companion docs (`04-`, `05-`, …) so the chain of decisions stays auditable.
- The original spec at `01-vision-and-spec.md` is preserved as written; sections superseded here are noted inline.
