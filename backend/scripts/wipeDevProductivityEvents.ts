/**
 * Wipe synthetic productivity events created by the dev seed.
 *
 * Use this on the production database (carefully) to remove the
 * `dev-seed-…` synthetic events introduced during Pulse Wave 7-12
 * testing, before flipping the FEATURE_PULSE_COMPOSITE_SCORE_BETA
 * flag on for real. After the wipe, the worker recomputes scores
 * from the legitimate event stream only.
 *
 * The synthetic events are identifiable by their `sourceId` prefix:
 *
 *     sourceId LIKE 'dev-seed-%'
 *
 * Real events (clock sessions, github webhook deliveries, daily
 * updates, etc.) have legitimate source IDs (UUIDs of the source
 * row, github delivery IDs, etc.) so this LIKE pattern cannot
 * collide with real data.
 *
 * Safety rails:
 *
 *   1. Default mode is **dry-run**. Reports what would be deleted,
 *      then exits without touching the DB. `--apply` actually runs
 *      the deletes.
 *
 *   2. Refuses to run with `NODE_ENV=production` unless the operator
 *      passes `--allow-production` AS WELL AS `--apply`. Three flags
 *      is intentional friction — this is a production cleanup, not
 *      an automation.
 *
 *   3. Runs inside a single transaction so a mid-delete crash
 *      doesn't leave events deleted but scores stale, or vice versa.
 *
 *   4. After wiping the events, ALSO clears the
 *      `employee_productivity_scores` rows for the affected users.
 *      The Wave 14 worker would do this on next recompute (it
 *      deletes orphan rows for users with 0 events), but we do it
 *      eagerly here so the Reports page reflects truth the instant
 *      the wipe completes — no waiting on a debounced recompute.
 *
 * Usage:
 *
 *     # Local dev (dry-run by default)
 *     bun run backend/scripts/wipeDevProductivityEvents.ts
 *
 *     # Local dev — actually delete
 *     bun run backend/scripts/wipeDevProductivityEvents.ts --apply
 *
 *     # Production (Railway): paste all three flags so muscle-memory
 *     # `bun run …` can't accidentally wipe prod.
 *     NODE_ENV=production bun run backend/scripts/wipeDevProductivityEvents.ts \
 *       --apply --allow-production
 */

import prisma from '../src/config/database';

function parseFlags(argv: string[]) {
  return {
    apply: argv.includes('--apply'),
    allowProduction: argv.includes('--allow-production'),
    quiet: argv.includes('--quiet'),
  };
}

function log(...args: unknown[]): void {
  console.log(...args);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const isProd = process.env.NODE_ENV === 'production';

  log('═══════════════════════════════════════════════════════');
  log('  Pulse — wipe synthetic dev-seed productivity events');
  log('═══════════════════════════════════════════════════════');
  log(`  Mode:        ${flags.apply ? 'APPLY (will delete rows)' : 'DRY-RUN (no changes)'}`);
  log(`  NODE_ENV:    ${process.env.NODE_ENV ?? '<unset>'}`);
  log(`  Target:      sourceId LIKE 'dev-seed-%'`);
  log('───────────────────────────────────────────────────────');

  if (isProd && (!flags.apply || !flags.allowProduction)) {
    log('');
    log('REFUSING to delete on a production database without BOTH');
    log('  --apply --allow-production');
    log('');
    log('This is intentional friction. If you really mean to wipe');
    log('synthetic events on prod, re-run with both flags:');
    log('');
    log('  NODE_ENV=production bun run backend/scripts/wipeDevProductivityEvents.ts \\');
    log('    --apply --allow-production');
    log('');
    process.exit(1);
  }

  // ── 1. Survey what's there ──────────────────────────────────────

  const eventCount = await prisma.productivityEvent.count({
    where: { sourceId: { startsWith: 'dev-seed-' } },
  });

  if (eventCount === 0) {
    log('No dev-seed events found. Nothing to do.');
    return;
  }

  const affectedUsers = await prisma.productivityEvent.findMany({
    where: { sourceId: { startsWith: 'dev-seed-' } },
    select: { userId: true },
    distinct: ['userId'],
  });
  const userIds = affectedUsers.map((u) => u.userId);

  const scoreRowCount = await prisma.employeeProductivityScore.count({
    where: { userId: { in: userIds } },
  });

  log(`  Found:`);
  log(`    ${eventCount} productivity_events with sourceId LIKE 'dev-seed-%'`);
  log(`    ${userIds.length} distinct affected users`);
  log(`    ${scoreRowCount} employee_productivity_scores rows for those users`);
  log('───────────────────────────────────────────────────────');

  if (!flags.apply) {
    log('Dry-run. Re-run with --apply to actually delete.');
    return;
  }

  // ── 2. Do the deletes inside one transaction ────────────────────

  log('Applying deletes (one transaction)…');
  const result = await prisma.$transaction(async (tx) => {
    const events = await tx.productivityEvent.deleteMany({
      where: { sourceId: { startsWith: 'dev-seed-' } },
    });
    const scores = await tx.employeeProductivityScore.deleteMany({
      where: { userId: { in: userIds } },
    });
    return { eventsDeleted: events.count, scoresDeleted: scores.count };
  });

  log(`  Deleted ${result.eventsDeleted} productivity_events`);
  log(`  Deleted ${result.scoresDeleted} employee_productivity_scores`);
  log('───────────────────────────────────────────────────────');
  log('Done. The worker will repopulate scores from real events on');
  log('the next recompute cycle (5-min poll). If the feature flag is');
  log('OFF, scores will simply stay empty until the flag is enabled.');
}

main()
  .catch((err) => {
    console.error('[wipeDevProductivityEvents] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
