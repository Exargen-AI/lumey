# Project Plan Ingestion — Markdown Spec

**TL;DR.** Write your implementation plan as markdown using the headings + tags below. Paste it into **Project → Settings → Ingest Plan**. The parser turns it into Epics → Sprints → Tasks (with AC + subtasks + assignees) and commits atomically. Re-running the same plan is safe — duplicates are skipped via heading-hash dedup.

Two modes are available on the Ingest screen:
- **Standard parser** (default) — deterministic, free, instant. Implements this spec exactly.
- **Smart Parse** (opt-in, AI) — sends the markdown to Claude Haiku 4.5 (or your configured LLM) which produces the same tree. Use it for plans that don't follow this grammar — Notion exports, ChatGPT drafts, freeform notes. See **§8 Two parsing modes** for cost and trade-offs.

This grammar is still the source of truth that both humans and the LLM produce — if you hand a Claude / GPT prompt your raw notes, asking it to emit this format and letting the standard parser handle the rest is the cheapest, most reproducible path.

---

## 1. Document anatomy

A plan is a single markdown document with **strict heading levels**. Levels matter — they determine parent/child relationships. Use `#`, `##`, `###`, `####` (no skipping levels).

```markdown
# Project: <name>                  ← optional; sets/updates project description
## Epic: <title>                   ← creates an Epic
### Sprint: <name> (<from> → <to>) ← creates a Sprint within the surrounding Epic's project
#### Task: <title>                 ← creates a Task within the surrounding Sprint (or Epic backlog)
```

A `## Epic:` may contain tasks directly (no sprint) — those land in the project backlog with `epicId` set. A `### Sprint:` may contain tasks directly under it (no need for a wrapping Epic).

You can have any number of epics, any number of sprints per epic, any number of tasks per sprint.

---

## 2. Heading conventions

### `# Project: <name>`
- Optional. The ingestion target is already chosen by the URL (`/projects/:id/ingest`); this heading is informational.
- The body paragraph (everything until the next heading) updates the project's `description`. Use a `> ` blockquote to mark it as the description; non-blockquote prose under the project heading is ignored.

### `## Epic: <title>`
- Title is everything after `Epic:`.
- Body before the next sub-heading becomes the epic `description`.
- Optional tag line: `**Color:** #6366f1` — sets the epic chip color. Defaults to the next color in the palette.

### `### Sprint: <name> (<startDate> → <endDate>)`
- Date format: `YYYY-MM-DD`. Either `→`, `->`, or `–` (en-dash) accepted as the range separator.
- Examples that all parse:
  - `### Sprint: Sprint 1 (2026-05-13 → 2026-05-26)`
  - `### Sprint: Onboarding sprint (2026-06-01 -> 2026-06-14)`
- Body before the next sub-heading becomes the sprint `goal`.
- Sprint **number** is auto-assigned per project (next available number).

### `#### Task: <title>`
- Title is everything after `Task:`.
- Body becomes the task `description` until the first **tag line** or **section** (see below).

---

## 3. Task tags

Inside a task block, before any sections, you can declare key/value tags. **One per line**, in any order. All optional.

| Tag | Format | Maps to | Example |
|---|---|---|---|
| `**Priority:**` | `P0` / `P1` / `P2` / `P3` | `task.priority` | `**Priority:** P0` |
| `**Points:**` | integer 1..100 | `task.storyPoints` | `**Points:** 5` |
| `**Type:**` | `FEATURE` / `BUG` / `CHORE` / `SPIKE` | `task.taskType` | `**Type:** SPIKE` |
| `**Assignee:**` | display name OR email | `task.assigneeId` | `**Assignee:** Karthik S` |
| `**Due:**` | `YYYY-MM-DD` | `task.dueDate` | `**Due:** 2026-05-30` |
| `**Labels:**` | comma-separated | `task.labels` | `**Labels:** auth, p0` |

Assignee matching: case-insensitive against active project members. If no match, the task lands unassigned and the warning shows up in the preview ("3 assignees not matched: …"). Names that match a non-member return the same warning — admins can add the member then re-import.

---

## 4. Task sections

After tags, a task can carry these sections. Order doesn't matter. Anything outside these sections is **ignored**.

### `**Description:**`
Free-form markdown. Stored as-is in `task.description` (HTML-rendered in the detail page).

### `**Acceptance Criteria:**`
A `- [ ]` bullet list. `[x]` for already-done, `[ ]` for open. Each bullet → one AC item.

```markdown
**Acceptance Criteria:**
- [ ] microVM boots in under 500ms
- [ ] All existing agent contracts still pass
- [x] Review with platform team
```

### `**Subtasks:**`
Same `- [ ]` bullet syntax as AC. Maps to `task.subtasks`.

---

## 5. Full example

```markdown
# Project: Furix AI Launch
> Internal launch plan for the Firecracker-backed agent runtime.

## Epic: Sandbox Runtime
> Replace the current container runtime with Firecracker microVMs.
**Color:** #ef4444

### Sprint: Sprint 1 (2026-05-13 → 2026-05-26)
> Goal: Boot a sandbox in <500ms.

#### Task: Migrate sandboxed agent runtime to Firecracker microVMs
**Priority:** P0
**Points:** 5
**Type:** FEATURE
**Assignee:** Ravi Kumar

**Description:**
Replace our current container runtime with Firecracker microVMs to drop
boot latency below 500ms.

**Acceptance Criteria:**
- [ ] microVM boots in under 500ms
- [ ] All existing agent contracts still pass
- [ ] No regression in throughput

**Subtasks:**
- [ ] Set up Firecracker dev environment
- [ ] Port agent harness to use vsock
- [ ] Update CI to run microVM tests

#### Task: Audit log: PII scrubbing leaves email patterns in error stacks
**Priority:** P1
**Points:** 3
**Type:** BUG

### Sprint: Sprint 2 (2026-05-27 → 2026-06-09)
> Goal: Inference pipeline GA.

#### Task: Add streaming response support to /chat endpoint
**Priority:** P1
**Points:** 5
**Assignee:** Karthik S

## Epic: Observability
> Wire up tracing + metrics across the agent and inference pipelines.

#### Task: Add OpenTelemetry exporter for agent runtime
**Priority:** P2
**Points:** 3
**Assignee:** Priya M
```

---

## 6. Re-import safety (idempotency)

Each Epic / Sprint / Task gets a stable hash from its `(parent path, normalized title)`. On re-import:
- A node whose hash already exists in the project is **skipped** with a `skipped_existing` warning.
- Edits to titles produce a new hash → a new Epic/Sprint/Task. Use the in-app editor for edits, not re-imports.
- Re-running the same plan twice produces **zero** new rows.

This means: paste your plan, hit Import, fix things in the UI. If you ever overhaul the plan and re-paste, only the genuinely new sections land.

---

## 7. What's deliberately NOT supported (yet)

- **Cross-epic task references** (`#### Task: FURIX-7 (related)`). Out of v1.
- **Milestones inside markdown.** Use the Milestones page after import.
- **Custom fields.** Use the inline editor; the schema for the per-project custom-field map is too dynamic to fit cleanly into markdown without a brittle convention.
- **Per-task client visibility.** Defaults to `false`. Toggle in the detail page.
- **AI Smart Parse.** Architectural seam is in place — the `/parse` endpoint accepts markdown and returns the JSON tree. v2 swaps the deterministic parser for an LLM call without UI changes. Today, ask Claude or GPT to convert your prose into the spec above; the deterministic parser handles the rest.

---

## 8. Two parsing modes

The Ingest screen offers two modes for turning your markdown into the
tree. They produce the same `ParsedPlan` shape, so the downstream commit
step (atomic insert, re-import dedup, validation) is identical either
way — they only differ in **how the markdown is read**.

### Standard parser (default)

A regex-based parser that implements the grammar above exactly. Free,
instant, deterministic — the same input always produces the same output.

Use it when:
- Your plan follows this spec (or close to it).
- You want reproducible imports — same plan run twice = same tree.
- You don't want any external API calls during parse.

### Smart Parse (LLM, opt-in)

Sends the markdown to an LLM (default: **Claude Haiku 4.5** — the
cheapest current Claude) which produces the same `ParsedPlan` tree.
Useful when the standard parser drops fields because your plan is in a
different shape — Notion exports, ChatGPT drafts, freeform notes.

The LLM is instructed via a fixed system prompt to:
- Map T-shirt sizes (S/M/L/XL) to story points (2/5/13/21).
- Default priority to P2 and type to FEATURE when unstated.
- Surface anything it couldn't classify into `warnings` rather than
  dropping it silently.
- Call a single `submit_parsed_plan` tool with JSON conforming to a
  fixed schema (so structured output is enforced, not requested).

Use it when:
- Your scope doc doesn't fit the grammar and rewriting it is annoying.
- The standard parser left fields empty or surfaced "ignored line"
  warnings on content you wanted captured.
- You want the LLM to infer reasonable defaults rather than fail.

**Cost** (Haiku 4.5, approximate):
- Small scope (~5 KB): ~$0.005 per parse, ~$0.001 on cache hit.
- Medium plan (~20 KB): ~$0.015 / ~$0.003 cached.
- Large plan (~50 KB): ~$0.04 / ~$0.01 cached.

The system prompt is prompt-cached (5-minute TTL), so repeat parses
within five minutes are ~10× cheaper on the input side.

**Caveats:**
- Smart Parse is not deterministic. Two runs of the same plan may
  produce slightly different titles or descriptions. Hashes are
  computed from titles, so non-trivial title drift can cause re-import
  dedup to miss matches.
- The 16K-token output ceiling means very large plans (hundreds of
  tasks) may truncate. The standard parser handles those reliably.
- Smart Parse is only available when the server has `AI_API_KEY` set
  and `INGEST_PARSER_ENABLED=true` (the default). When not configured,
  the toggle is hidden — the standard parser is always available.

### How to pick

| Scenario | Use |
|---|---|
| You wrote the plan to this spec | Standard |
| You ran the standard parser and it warned about dropped lines | Smart Parse |
| Your plan is a Notion export / Claude draft / freeform notes | Smart Parse |
| You need byte-identical re-imports | Standard |
| You're hitting the 500 KB cap | Split the plan; standard parser handles bigger files reliably |
| The platform is offline / no AI key set | Standard (it's the only option) |

---

## 9. Why this grammar

It's verbose on purpose. Three reasons:

1. **Round-trip safe.** A human reading the markdown gets the full picture without running the parser. An LLM emitting the markdown can be told "use this exact format" and produce something testable.
2. **Heading-driven.** Most markdown editors give you good outline / TOC support — the parser piggybacks on that natural hierarchy.
3. **Tags are obvious.** `**Priority:** P0` is universally legible; no `metadata: { priority: P0 }` JSON-in-markdown awkwardness.

The grammar itself is a contract. The parser is just an implementation of it.
