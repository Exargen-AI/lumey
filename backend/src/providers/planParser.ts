import { env } from '../config/env';
import { AppError, ValidationError } from '../utils/errors';

/**
 * LLM-based markdown → ParsedPlan parser ("Smart Parse").
 *
 * Pluggable so we can switch providers without touching the ingestion
 * service. The default Anthropic adapter uses Claude Haiku 4.5 (cheapest
 * frontier model) with prompt caching on the system prompt and tool_use
 * to force a strictly-shaped JSON response.
 *
 * The LLM produces *shape-only* output — titles, descriptions, dates,
 * priorities, AC, subtasks. The ingestion service decorates the result
 * with hashes, colors, and warnings. Keeping side-effects out of the
 * provider makes it trivial to swap implementations or test offline.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

/** Shape the LLM is forced to produce. Hashes / colors / re-import dedup
 *  are added by the ingestion service, not the model. */
export interface LLMTask {
  title: string;
  description: string | null;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  storyPoints: number | null;
  taskType: 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE';
  assigneeName: string | null;
  dueDate: string | null;
  labels: string[];
  acceptanceCriteria: Array<{ text: string; done: boolean }>;
  subtasks: Array<{ text: string; done: boolean }>;
}

export interface LLMSprint {
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  tasks: LLMTask[];
}

export interface LLMEpic {
  title: string;
  description: string | null;
  sprints: LLMSprint[];
  backlogTasks: LLMTask[];
}

export interface LLMPlan {
  projectName: string | null;
  projectDescription: string | null;
  epics: LLMEpic[];
  rootBacklogTasks: LLMTask[];
  warnings: string[];
}

export interface PlanParserUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  estimatedCostUsd: number;
}

export interface PlanParserResult {
  plan: LLMPlan;
  usage: PlanParserUsage;
  model: string;
  provider: string;
  durationMs: number;
}

export interface IPlanParser {
  parse(markdown: string): Promise<PlanParserResult>;
}

// ─── Shared schema ────────────────────────────────────────────────────────

/** JSON Schema for the structured-output tool. Both providers share this
 *  so a switch can't accidentally drift one shape from the other. */
const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    projectName: { type: ['string', 'null'] },
    projectDescription: { type: ['string', 'null'] },
    epics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: ['string', 'null'] },
          sprints: { type: 'array', items: { $ref: '#/definitions/sprint' } },
          backlogTasks: { type: 'array', items: { $ref: '#/definitions/task' } },
        },
        required: ['title', 'description', 'sprints', 'backlogTasks'],
      },
    },
    rootBacklogTasks: { type: 'array', items: { $ref: '#/definitions/task' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['projectName', 'projectDescription', 'epics', 'rootBacklogTasks', 'warnings'],
  definitions: {
    sprint: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        goal: { type: ['string', 'null'] },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD' },
        tasks: { type: 'array', items: { $ref: '#/definitions/task' } },
      },
      required: ['name', 'goal', 'startDate', 'endDate', 'tasks'],
    },
    task: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: ['string', 'null'] },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        storyPoints: { type: ['integer', 'null'] },
        taskType: { type: 'string', enum: ['FEATURE', 'BUG', 'CHORE', 'SPIKE'] },
        assigneeName: { type: ['string', 'null'] },
        dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
        labels: { type: 'array', items: { type: 'string' } },
        acceptanceCriteria: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              done: { type: 'boolean' },
            },
            required: ['text', 'done'],
          },
        },
        subtasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              done: { type: 'boolean' },
            },
            required: ['text', 'done'],
          },
        },
      },
      required: ['title', 'description', 'priority', 'storyPoints', 'taskType', 'assigneeName', 'dueDate', 'labels', 'acceptanceCriteria', 'subtasks'],
    },
  },
} as const;

/** Stable system prompt — extracted as a constant so the prompt-caching
 *  key doesn't churn between requests. Any edit invalidates the cached
 *  prefix; keep edits rare.
 *
 *  Length matters: Haiku 4.5's minimum cacheable prefix is empirically
 *  ~4096 tokens (higher than older Haiku models — the docs cite 2048,
 *  but Haiku 4.5 doesn't actually start writing to cache until well
 *  past that). The current prompt + tools schema gives ~5500 tokens of
 *  cacheable prefix, leaving comfortable headroom. Shrinking this
 *  prompt below ~4500 tokens would silently disable caching and roughly
 *  double the per-parse input cost. If you need to trim, verify caching
 *  still kicks in via `scripts/smoke-smart-parse.ts`. */
const SYSTEM_PROMPT = `You convert markdown project plans into structured Epic / Sprint / Task trees for a project-management tool called "Command Center". The tree you produce will be committed to a Postgres database, displayed on a Kanban board, and tracked through completion — so accuracy matters more than fluency.

# How the tree is shaped

A plan contains one or more EPICS (the top-level units of work). Each epic optionally contains:
- SPRINTS — time-boxed, dated containers for tasks. Each sprint has a startDate and endDate.
- BACKLOG TASKS — untimed tasks attached to the epic but not inside any sprint.

Tasks at the project root (no epic, no sprint) go in \`rootBacklogTasks\`. They are the "unsorted inbox" of the plan.

The downstream service inserts the entire tree in a single transaction — partial failures roll back. Be conservative: **NEVER discard a task.** If you cannot decide where a task belongs, place it in the most likely parent's backlog and add a note to the \`warnings\` array.

# Field rules (per task)

| Field | Type | Rules |
|---|---|---|
| \`title\` | string, max 200 chars | Strip leading bullets/dashes/asterisks/numbers/checkboxes from the source line. Truncate with "…" if over 200 chars. |
| \`description\` | string \\| null | Prose context for the task (a paragraph or two). Strip the title line and any tag/section markers. Use \`null\` if nothing useful remains. |
| \`priority\` | "P0"\\|"P1"\\|"P2"\\|"P3" | Default \`P2\` if unstated. Recognize: "P0"/"Critical"/"Blocker"/"Launch blocker" → P0. "P1"/"High"/"Important" → P1. "P2"/"Medium"/"Normal" → P2. "P3"/"Low"/"Nice to have"/"Eventually" → P3. |
| \`storyPoints\` | int \\| null | T-shirt sizing: XS→1, S→2, M→5, L→13, XL→21, XXL→34. Plain integers pass through (clamp to 1..100). Use \`null\` if unstated — do NOT guess. |
| \`taskType\` | "FEATURE"\\|"BUG"\\|"CHORE"\\|"SPIKE" | Default \`FEATURE\`. CHORE for: infrastructure, CI/CD, deploys, docs, refactoring, dependency bumps, cleanup, technical debt. BUG for: defect fixes, regressions, "broken X" wording. SPIKE for: research, investigation, prototype, proof-of-concept, "explore" / "evaluate" wording. |
| \`assigneeName\` | string \\| null | Raw name string only — "Sarath", "Karthik S", "John D.". If the markdown gives an email or "@handle", extract just the human name (or use \`null\` if no name is obvious). Don't try to match a real user; the service does that. |
| \`dueDate\` | YYYY-MM-DD \\| null | Only set if EXPLICITLY stated ("due 2026-06-15", "by end of Q2", "deadline: ..."). Do NOT infer due dates from sprint endDate. |
| \`labels\` | string[] | Tags like \`["backend", "frontend", "ux", "ios", "design"]\`. Lowercase, no spaces (use hyphens). Empty array if none. Cap at 20 entries. |
| \`acceptanceCriteria\` | {text, done}[] | Items from "AC:", "DoD:", "Definition of Done:", "Acceptance:", "Done when:". Each item is \`{text, done}\`. Set \`done: true\` ONLY if the markdown shows \`[x]\` or \`[X]\` next to it; otherwise \`done: false\`. |
| \`subtasks\` | {text, done}[] | Items from "Subtasks:", "Steps:", "Tasks:", or sub-bullets directly under the task heading. Same \`{text, done}\` shape as AC. |

# Sprint date parsing

Recognize and normalize all of these forms to \`YYYY-MM-DD\`:

- \`(2026-05-12 → 2026-05-25)\` or \`->\` or \`–\` (en-dash) as separator → \`startDate: "2026-05-12"\`, \`endDate: "2026-05-25"\`
- \`Sprint 1: May 12 – May 25\` → infer the year from surrounding context (other dates in the doc), or use the current year (which the user can correct in the preview)
- \`Week of June 3\` → \`startDate\` = Monday of that week, \`endDate\` = Friday of that week
- \`Sprint 1 (5/12/2026 - 5/25/2026)\` → \`"2026-05-12"\` / \`"2026-05-25"\` (US-style \`MM/DD/YYYY\`)
- \`May 12 → May 25, 2026\` → same year applied to both ends

If a sprint heading has NO parseable dates, **do not create a sprint**. Instead, place its tasks in the parent epic's \`backlogTasks\` and add a warning: \`"Sprint 'X' has no dates — moved tasks to epic backlog."\`

If a sprint's startDate > endDate, keep both dates as given but add a warning so the user can fix it in the preview before committing.

# Stories vs sprints

A \`### Story X.X: Title\` heading (often seen in Agile templates) groups related tasks but is NOT a sprint — stories don't have dates. Put tasks listed under a Story heading into the parent epic's \`backlogTasks\`, and add the story title as a \`label\` on each task (lowercased, hyphenated) so the grouping survives. Example: under \`### Story 2.1: User signup flow\`, every nested task gets \`labels: ["user-signup-flow", ...]\`.

# Markdown tables

Tables are first-class task containers. A row like \`| Add login | AC text | M | P0 | Sarath |\` is one task. Map column headers case-insensitively:

- \`Task\` / \`Title\` / \`Name\` / \`Item\` → \`title\`
- \`AC\` / \`Criteria\` / \`Done When\` / \`Acceptance\` / \`Definition of Done\` → \`acceptanceCriteria\` (split the cell on newlines or semicolons, one entry per item, all with \`done: false\`)
- \`Est\` / \`Estimate\` / \`Pts\` / \`Points\` / \`Size\` / \`SP\` → \`storyPoints\` (apply T-shirt mapping)
- \`Pri\` / \`Priority\` / \`P\` → \`priority\`
- \`Type\` / \`Kind\` / \`Category\` → \`taskType\`
- \`Notes\` / \`Description\` / \`Desc\` / \`Details\` → \`description\`
- \`Assignee\` / \`Owner\` / \`Who\` / \`Lead\` → \`assigneeName\`
- \`Deps\` / \`Depends On\` / \`Blocks\` → add to \`description\` as a "Depends on: …" line (the dependency graph isn't modeled yet)
- \`Labels\` / \`Tags\` → \`labels\` (split on commas)

Cells with empty content map to the field's default (\`null\` for nullable fields, \`[]\` for arrays).

# Project metadata

The first \`# H1\` heading is the project name. If you see \`# Project: <name>\` or \`# <name>\`, extract \`<name>\` as \`projectName\`. Prose immediately under the project heading (until the first \`##\`) is the \`projectDescription\` — collapse whitespace, strip leading \`>\` blockquote markers, keep it under 10000 chars.

# Warnings — populate \`warnings\`, never throw

The \`warnings\` array surfaces parser observations to the user without failing the import. Add warnings (don't fail) when:

- A line looks like task content but you couldn't classify it: \`"Ignored line at 'Storefront work': 'TODO: figure out search'"\`
- A date is malformed or outside a reasonable range (< 2020 or > 2030): \`"Date '9999-99-99' on task 'X' is unreasonable — set to null."\`
- A sprint has \`startDate\` > \`endDate\`: \`"Sprint 'X' end before start — kept dates as given for review."\`
- A task has no extractable title (very rare): \`"Task at 'X' had no title — used 'Untitled task'."\`
- The markdown contains a section you couldn't map to anything (\`## Risks\`, \`## Open Questions\`): \`"Section 'Risks' was not imported — no task structure to capture."\`

Cap each warning at 500 chars; cap the array at 500 entries.

# Anti-patterns — what NOT to do

- **Do not invent fields** the markdown doesn't have. Empty/null is better than wrong.
- **Do not collapse similar tasks.** If the markdown has both "Add login" and "Polish login UX", emit both as separate tasks.
- **Do not add tasks that aren't in the markdown.** If the source says "(more tasks TBD)", don't fill in tasks — emit a warning.
- **Do not guess priorities or types from your own opinion of importance.** Use the markdown's explicit signals.
- **Do not produce empty strings** for nullable fields — use \`null\`.
- **Do not output any text, markdown, or acknowledgment** outside the \`submit_parsed_plan\` tool call.
- **Do not call the tool more than once.** Build the entire tree in a single tool invocation.

# Worked example

Input:

\`\`\`
# ML pipeline — Q2 launch

A streaming + batch hybrid ingest layer for the analytics warehouse.

## Data plane
Sprint 1 — Jun 1 to Jun 14:
- Set up S3 bucket (P0, S)
- Ingest CSV → Parquet (P0, M, Sarath)
- Schema validation (P1, S) — needs Avro schema first

Backlog (no sprint yet):
- Backfill historical data (P2, L)

## Observability
- Add OTel exporter (CHORE, M)
- Dashboard in Grafana (CHORE, S)
\`\`\`

Expected output (abbreviated):

\`\`\`json
{
  "projectName": "ML pipeline — Q2 launch",
  "projectDescription": "A streaming + batch hybrid ingest layer for the analytics warehouse.",
  "epics": [
    {
      "title": "Data plane",
      "description": null,
      "sprints": [
        {
          "name": "Sprint 1",
          "goal": null,
          "startDate": "2026-06-01",
          "endDate": "2026-06-14",
          "tasks": [
            { "title": "Set up S3 bucket", "priority": "P0", "storyPoints": 2, "taskType": "FEATURE", ... },
            { "title": "Ingest CSV → Parquet", "priority": "P0", "storyPoints": 5, "assigneeName": "Sarath", ... },
            { "title": "Schema validation", "priority": "P1", "storyPoints": 2, "description": "needs Avro schema first", ... }
          ]
        }
      ],
      "backlogTasks": [
        { "title": "Backfill historical data", "priority": "P2", "storyPoints": 13, ... }
      ]
    },
    {
      "title": "Observability",
      "description": null,
      "sprints": [],
      "backlogTasks": [
        { "title": "Add OTel exporter", "taskType": "CHORE", "storyPoints": 5, ... },
        { "title": "Dashboard in Grafana", "taskType": "CHORE", "storyPoints": 2, ... }
      ]
    }
  ],
  "rootBacklogTasks": [],
  "warnings": []
}
\`\`\`

# Second worked example — markdown table input

Input:

\`\`\`
# Mobile onboarding redo

## Auth flow refresh

| Task                          | AC                                              | Pts | Pri | Type    | Owner   |
| ----------------------------- | ----------------------------------------------- | --- | --- | ------- | ------- |
| Replace email-OTP with magic link | Sign-in completes in < 8s on flaky 3G; resend after 30s; expires after 10 min | M   | P0  | FEATURE | Anika   |
| Update sign-in screen layout      | New Figma applied; pixel-diff < 2px vs spec      | S   | P0  | FEATURE | Hari    |
| Migrate stored auth tokens        | Existing sessions stay alive after upgrade       | L   | P0  | CHORE   | Sarath  |
| Dark-mode pass on /signin       |                                                  | S   | P2  | CHORE   |         |
\`\`\`

Expected output (abbreviated, showing the key transformations):

\`\`\`json
{
  "projectName": "Mobile onboarding redo",
  "projectDescription": null,
  "epics": [
    {
      "title": "Auth flow refresh",
      "description": null,
      "sprints": [],
      "backlogTasks": [
        {
          "title": "Replace email-OTP with magic link",
          "description": null,
          "priority": "P0",
          "storyPoints": 5,
          "taskType": "FEATURE",
          "assigneeName": "Anika",
          "acceptanceCriteria": [
            { "text": "Sign-in completes in < 8s on flaky 3G", "done": false },
            { "text": "resend after 30s", "done": false },
            { "text": "expires after 10 min", "done": false }
          ],
          "subtasks": [],
          "labels": [],
          "dueDate": null
        },
        {
          "title": "Update sign-in screen layout",
          "priority": "P0", "storyPoints": 2, "taskType": "FEATURE", "assigneeName": "Hari",
          "acceptanceCriteria": [{ "text": "New Figma applied; pixel-diff < 2px vs spec", "done": false }],
          ...
        },
        {
          "title": "Migrate stored auth tokens",
          "priority": "P0", "storyPoints": 13, "taskType": "CHORE", "assigneeName": "Sarath",
          "acceptanceCriteria": [{ "text": "Existing sessions stay alive after upgrade", "done": false }],
          ...
        },
        {
          "title": "Dark-mode pass on /signin",
          "priority": "P2", "storyPoints": 2, "taskType": "CHORE", "assigneeName": null,
          "acceptanceCriteria": [],
          ...
        }
      ]
    }
  ],
  "rootBacklogTasks": [],
  "warnings": []
}
\`\`\`

Note: in the table-form example, the AC column was split on semicolons into multiple criteria; the empty AC cell mapped to \`[]\`; and the empty Owner cell mapped to \`null\` for \`assigneeName\`. Empty cells always map to the field default, not the empty string.

# Third worked example — freeform notes with no structure

Sometimes you'll get truly freeform input that doesn't even look like a project plan. Best-effort it: extract whatever you can, place orphan tasks in \`rootBacklogTasks\`, and surface anything you couldn't classify in \`warnings\`.

Input:

\`\`\`
Brain dump — need to do before Friday:

- demo deck for the board (urgent, half a day)
- review Sarath's PR on auth-tokens (high pri, hour or two)
- write the post-mortem for last week's outage
- order new laptops for the design team (P3, can wait)

Also need to figure out: when do we actually run the next user-research session? Not blocking anything yet.
\`\`\`

Expected output (abbreviated):

\`\`\`json
{
  "projectName": null,
  "projectDescription": "Brain dump — need to do before Friday.",
  "epics": [],
  "rootBacklogTasks": [
    { "title": "Demo deck for the board", "priority": "P0", "storyPoints": null, ... },
    { "title": "Review Sarath's PR on auth-tokens", "priority": "P1", "storyPoints": null, "description": "hour or two", ... },
    { "title": "Write the post-mortem for last week's outage", "priority": "P2", ... },
    { "title": "Order new laptops for the design team", "priority": "P3", ... }
  ],
  "warnings": [
    "Open question captured as note (not a task): 'when do we actually run the next user-research session?'"
  ]
}
\`\`\`

# Edge cases you'll occasionally see

- **HTML in markdown**: \`<details><summary>...</summary>...</details>\` blocks. Treat them as prose — the summary becomes the description preamble; the inner content is part of the description body. Don't try to parse HTML structure.
- **Nested lists**: \`- foo\\n  - sub-foo\` — the indented item is a subtask of the parent. Apply this only ONE level deep; deeper nesting becomes part of the description.
- **Inline code in titles**: \`Add \\\`/v2/auth\\\` endpoint\` — keep the backticks in the title verbatim. Don't strip them.
- **Emoji prefixes**: \`🚀 Ship the feature\` — keep the emoji in the title. Don't translate emojis to text.
- **Multiple H1s**: only the FIRST \`# heading\` is the project name. Subsequent H1s are treated as section labels and ignored (with a warning: "Multiple top-level # headings — used the first as project name").
- **Time-of-day in dates**: \`2026-06-15 17:00 UTC\` — strip the time, keep just the date. We don't model time-of-day.
- **Quarter notation**: \`Q2 2026\` — emit a warning ("Quarter 'Q2 2026' is not a parseable due date — set to null") and leave the dueDate as \`null\`.
- **Range in title**: \`Refactor auth (2 days)\` — the parenthetical is a duration estimate; map to \`storyPoints\` if you can (2 days ≈ M ≈ 5 points). Keep the title clean: \`Refactor auth\`.

# Output protocol

Call \`submit_parsed_plan\` EXACTLY ONCE with the parsed tree. Output no text, no markdown, no acknowledgment — just the tool call. The tool's JSON schema is enforced; missing required fields cause a hard error and the user sees a failure they can't easily debug. If the markdown is truly empty or unparseable, still call the tool with an empty plan (\`{ epics: [], rootBacklogTasks: [], warnings: ["..."] }\`) — the user prefers a tool-call-with-warning over no call at all.`;

// ─── Anthropic adapter (default) ──────────────────────────────────────────

class AnthropicPlanParser implements IPlanParser {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    // Default to Haiku 4.5 — cheapest current Claude, ~5x cheaper than Opus
    // for input and ~5x for output, fast enough for the ingest wizard.
    this.model = model || 'claude-haiku-4-5';
  }

  async parse(markdown: string): Promise<PlanParserResult> {
    const started = Date.now();

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 16384,
        // System prompt is large + stable → cache it. Subsequent parses
        // within the 5-minute TTL pay ~10% of input cost for this slice.
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        tools: [
          {
            name: 'submit_parsed_plan',
            description: 'Submit the parsed project plan tree (epics, sprints, tasks).',
            input_schema: PLAN_JSON_SCHEMA,
          },
        ],
        // Force the model to call our tool — guarantees structured output.
        tool_choice: { type: 'tool', name: 'submit_parsed_plan' },
        messages: [{ role: 'user', content: markdown }],
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as any;
      const detail = body?.error?.message ?? '';
      if (response.status === 401) {
        throw new AppError(502, 'AI_AUTH_ERROR', `Anthropic API key invalid. (${detail})`);
      }
      if (response.status === 429) {
        throw new AppError(429, 'AI_RATE_LIMIT', 'Anthropic rate limit reached. Try again shortly.');
      }
      if (response.status === 529 || response.status === 503) {
        throw new AppError(503, 'AI_OVERLOADED', 'Anthropic is temporarily overloaded. Try again shortly.');
      }
      throw new AppError(502, 'AI_PROVIDER_ERROR', `Anthropic ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as any;
    const toolUse = (data?.content || []).find((b: any) => b?.type === 'tool_use' && b?.name === 'submit_parsed_plan');
    if (!toolUse) {
      throw new AppError(502, 'AI_INVALID_RESPONSE', 'Model did not call submit_parsed_plan. Try again or use the standard parser.');
    }

    const plan = validateLLMPlan(toolUse.input);

    const usage = data?.usage || {};
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;
    const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;

    return {
      plan,
      usage: {
        inputTokens,
        outputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        estimatedCostUsd: estimateAnthropicCost(this.model, inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens),
      },
      model: this.model,
      provider: 'anthropic',
      durationMs: Date.now() - started,
    };
  }
}

// ─── OpenAI adapter (fallback for users who prefer GPT) ───────────────────

class OpenAIPlanParser implements IPlanParser {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o-mini';
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
  }

  async parse(markdown: string): Promise<PlanParserResult> {
    const started = Date.now();

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 16384,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: markdown },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'submit_parsed_plan',
              description: 'Submit the parsed project plan tree.',
              parameters: PLAN_JSON_SCHEMA,
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'submit_parsed_plan' } },
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as any;
      const detail = body?.error?.message ?? '';
      throw new AppError(502, 'AI_PROVIDER_ERROR', `OpenAI ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as any;
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      throw new AppError(502, 'AI_INVALID_RESPONSE', 'Model did not call submit_parsed_plan.');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(call.function.arguments);
    } catch {
      throw new AppError(502, 'AI_INVALID_RESPONSE', 'Model returned malformed JSON arguments.');
    }
    const plan = validateLLMPlan(raw);

    const usage = data?.usage || {};
    return {
      plan,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cacheReadInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheCreationInputTokens: 0,
        estimatedCostUsd: 0, // Skipped — OpenAI pricing varies too much by model.
      },
      model: this.model,
      provider: 'openai',
      durationMs: Date.now() - started,
    };
  }
}

// ─── Validation ───────────────────────────────────────────────────────────

const PRIORITY_VALUES = new Set(['P0', 'P1', 'P2', 'P3']);
const TASK_TYPE_VALUES = new Set(['FEATURE', 'BUG', 'CHORE', 'SPIKE']);

/** Validate the LLM's tool input matches LLMPlan shape. Throws AppError on
 *  any structural issue. The model usually complies with the JSON-schema
 *  enforcement, but we don't trust untyped input — coerce + validate. */
function validateLLMPlan(raw: unknown): LLMPlan {
  if (!raw || typeof raw !== 'object') {
    throw new AppError(502, 'AI_INVALID_RESPONSE', 'Model output is not an object.');
  }
  const obj = raw as Record<string, any>;

  const projectName = strOrNull(obj.projectName);
  const projectDescription = strOrNull(obj.projectDescription);
  const epics = Array.isArray(obj.epics) ? obj.epics.map(validateLLMEpic) : [];
  const rootBacklogTasks = Array.isArray(obj.rootBacklogTasks) ? obj.rootBacklogTasks.map(validateLLMTask) : [];
  const warnings = Array.isArray(obj.warnings) ? obj.warnings.filter((s: any) => typeof s === 'string') : [];

  return { projectName, projectDescription, epics, rootBacklogTasks, warnings };
}

function validateLLMEpic(raw: any): LLMEpic {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('Smart Parse produced an invalid epic node.');
  }
  return {
    title: requireStr(raw.title, 'epic.title'),
    description: strOrNull(raw.description),
    sprints: Array.isArray(raw.sprints) ? raw.sprints.map(validateLLMSprint) : [],
    backlogTasks: Array.isArray(raw.backlogTasks) ? raw.backlogTasks.map(validateLLMTask) : [],
  };
}

function validateLLMSprint(raw: any): LLMSprint {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('Smart Parse produced an invalid sprint node.');
  }
  return {
    name: requireStr(raw.name, 'sprint.name'),
    goal: strOrNull(raw.goal),
    startDate: requireStr(raw.startDate, 'sprint.startDate'),
    endDate: requireStr(raw.endDate, 'sprint.endDate'),
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(validateLLMTask) : [],
  };
}

function validateLLMTask(raw: any): LLMTask {
  if (!raw || typeof raw !== 'object') {
    throw new ValidationError('Smart Parse produced an invalid task node.');
  }
  const priority = typeof raw.priority === 'string' && PRIORITY_VALUES.has(raw.priority) ? raw.priority : 'P2';
  const taskType = typeof raw.taskType === 'string' && TASK_TYPE_VALUES.has(raw.taskType) ? raw.taskType : 'FEATURE';
  const storyPoints =
    typeof raw.storyPoints === 'number' && Number.isFinite(raw.storyPoints) ? Math.trunc(raw.storyPoints) : null;

  return {
    title: requireStr(raw.title, 'task.title'),
    description: strOrNull(raw.description),
    priority: priority as LLMTask['priority'],
    storyPoints,
    taskType: taskType as LLMTask['taskType'],
    assigneeName: strOrNull(raw.assigneeName),
    dueDate: strOrNull(raw.dueDate),
    labels: Array.isArray(raw.labels) ? raw.labels.filter((s: any) => typeof s === 'string') : [],
    acceptanceCriteria: Array.isArray(raw.acceptanceCriteria) ? raw.acceptanceCriteria.map(validateChecklist) : [],
    subtasks: Array.isArray(raw.subtasks) ? raw.subtasks.map(validateChecklist) : [],
  };
}

function validateChecklist(raw: any): { text: string; done: boolean } {
  return {
    text: typeof raw?.text === 'string' ? raw.text : String(raw?.text ?? ''),
    done: raw?.done === true,
  };
}

function strOrNull(v: any): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function requireStr(v: any, label: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new ValidationError(`Smart Parse omitted required field: ${label}.`);
  }
  return v.trim();
}

// ─── Pricing (anthropic only — used for the UI cost-estimate badge) ──────

/** $/1M tokens. Add new Claude models here as they ship. */
const ANTHROPIC_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-7': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
};

function estimateAnthropicCost(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): number {
  const p = ANTHROPIC_PRICING[model];
  if (!p) return 0;
  // Anthropic returns these as three separate buckets — `input_tokens` is
  // already the fresh (non-cached) input; `cache_read_input_tokens` and
  // `cache_creation_input_tokens` are NOT subsets of input_tokens. Earlier
  // versions of this code subtracted them, which silently under-billed
  // the fresh portion by ~10% when caching was active.
  const total =
    (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1_000_000;
  return Math.round(total * 100_000) / 100_000; // 5 decimal places
}

// ─── Factory ──────────────────────────────────────────────────────────────

/** Returns a parser based on env. Throws if no API key is configured. */
export function createPlanParser(): IPlanParser {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      503,
      'AI_NOT_CONFIGURED',
      'Smart Parse needs AI_API_KEY in the backend env. Use the standard parser, or ask an admin to enable AI.',
    );
  }
  // Per-capability model override so the parser can stay on cheap Haiku
  // while the content engine runs on Opus/Sonnet.
  const model = env.INGEST_PARSER_MODEL || undefined;

  if (env.AI_PROVIDER === 'openai') {
    return new OpenAIPlanParser(apiKey, model, env.AI_BASE_URL);
  }
  return new AnthropicPlanParser(apiKey, model);
}
