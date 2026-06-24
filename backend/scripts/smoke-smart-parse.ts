/**
 * Smoke test for Smart Parse — calls the LLM provider directly with a
 * deliberately non-spec markdown to prove the injection chain works:
 *
 *   .env → env.ts → createPlanParser() → AnthropicPlanParser →
 *   Anthropic API → tool_use response → validator → LLMPlan
 *
 * Run: `npx tsx scripts/smoke-smart-parse.ts`
 *
 * Not committed to the test suite — this is a one-shot manual probe.
 */
import { createPlanParser } from '../src/providers/planParser';

// Deliberately NOT in the spec format. No `## Epic:`, no `### Sprint:`,
// no `**Priority:**` tags. The regex parser would mostly miss this.
// Smart Parse should figure it out and produce a sensible tree.
const SAMPLE_MARKDOWN = `# Photo-share app — 2-week MVP

A simple way to upload photos and share them with friends. Two-week build.

## Storefront work

Sprint 1 — May 13 to May 26:

- Homepage with photo grid (P0, M)
- Upload form with drag-drop (P0, L, Sarath)
- Auth via Google OAuth (P0, M)

Sprint 2 — May 27 to June 9:

- Likes + comments (P1, M)
- Profile pages (P1, S)
- Email notifications on like (P2, S)

## Infra & ops

These don't have sprints, just need to ship before launch:

- CI on GitHub Actions (CHORE, S)
- Postgres on Railway (CHORE, S)
- Sentry for error tracking (CHORE, XS)
`;

async function main() {
  console.log('─── Smart Parse smoke test ──────────────────────────────────');
  console.log(`Markdown size: ${SAMPLE_MARKDOWN.length} chars\n`);

  const parser = createPlanParser();
  const started = Date.now();
  const result = await parser.parse(SAMPLE_MARKDOWN);
  const elapsed = Date.now() - started;

  console.log(`✓ Parsed in ${elapsed}ms via ${result.provider}/${result.model}`);
  console.log(`  tokens: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  console.log(`  cache:  ${result.usage.cacheReadInputTokens} read / ${result.usage.cacheCreationInputTokens} write`);
  console.log(`  cost:   ~$${result.usage.estimatedCostUsd.toFixed(5)}\n`);

  const plan = result.plan;
  console.log(`Project name:        ${JSON.stringify(plan.projectName)}`);
  console.log(`Project description: ${plan.projectDescription ? plan.projectDescription.slice(0, 80) + (plan.projectDescription.length > 80 ? '…' : '') : 'null'}\n`);

  console.log(`Epics: ${plan.epics.length}`);
  for (const epic of plan.epics) {
    console.log(`  • ${epic.title}`);
    if (epic.sprints.length) {
      for (const sprint of epic.sprints) {
        console.log(`    └─ Sprint: ${sprint.name} (${sprint.startDate} → ${sprint.endDate}) · ${sprint.tasks.length} task(s)`);
        for (const t of sprint.tasks) {
          console.log(`        · [${t.priority}/${t.taskType}/${t.storyPoints ?? '-'}] ${t.title}${t.assigneeName ? ` (→ ${t.assigneeName})` : ''}`);
        }
      }
    }
    if (epic.backlogTasks.length) {
      console.log(`    └─ Backlog: ${epic.backlogTasks.length} task(s)`);
      for (const t of epic.backlogTasks) {
        console.log(`        · [${t.priority}/${t.taskType}/${t.storyPoints ?? '-'}] ${t.title}`);
      }
    }
  }

  if (plan.rootBacklogTasks.length) {
    console.log(`\nRoot backlog: ${plan.rootBacklogTasks.length} task(s)`);
    for (const t of plan.rootBacklogTasks) {
      console.log(`  · [${t.priority}/${t.taskType}/${t.storyPoints ?? '-'}] ${t.title}`);
    }
  }

  if (plan.warnings.length) {
    console.log(`\nWarnings (${plan.warnings.length}):`);
    for (const w of plan.warnings) console.log(`  ! ${w}`);
  }

  // Run it a second time to verify prompt caching kicks in. The system
  // prompt is the dominant input share — second call should show non-zero
  // cacheReadInputTokens and a cheaper estimated cost.
  console.log('\n─── Second call (caching probe) ─────────────────────────────');
  const r2 = await parser.parse(SAMPLE_MARKDOWN);
  console.log(`  tokens: ${r2.usage.inputTokens} in / ${r2.usage.outputTokens} out`);
  console.log(`  cache:  ${r2.usage.cacheReadInputTokens} read / ${r2.usage.cacheCreationInputTokens} write`);
  console.log(`  cost:   ~$${r2.usage.estimatedCostUsd.toFixed(5)}`);
  if (r2.usage.cacheReadInputTokens > 0) {
    console.log(`  ✓ Prompt caching is working — ${r2.usage.cacheReadInputTokens} tokens read from cache.`);
  } else {
    console.log(`  ⚠ No cache read on the second call — caching may not be enabled on this account/version.`);
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
