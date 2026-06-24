/**
 * Dev-only synthetic-events seed for the Pulse productivity score.
 *
 * Used to populate `productivity_events` so the Reports page has
 * something to render in local development. NEVER run in production
 * — these events are not the real audit trail; they're shaped to
 * exercise every scorer + cadence end-to-end.
 *
 * Usage:
 *   bun run backend/scripts/seedDevProductivityEvents.ts
 *
 * What it does:
 *   1. Bails immediately if NODE_ENV === 'production'.
 *   2. Picks the first 10 active users.
 *   3. Emits 30 days of synthetic events per user covering all 7
 *      signals (STANDUP/EXECUTION/CODE/COMMUNICATION/PRESENCE/
 *      DEEP_WORK/DEVICE_HYGIENE) at a believable density.
 *   4. Uses `processedAt = NULL` so the running recompute worker
 *      will pick them up on its next cycle.
 */

import prisma from '../src/config/database';
import { randomUUID } from 'node:crypto';

const SIGNAL_TEMPLATES: Array<{
  signal: 'STANDUP' | 'EXECUTION' | 'CODE' | 'COMMUNICATION' | 'PRESENCE' | 'DEEP_WORK' | 'DEVICE_HYGIENE';
  eventType: string;
  source: string;
  /** Mean events per working day per user (jittered ±50%). */
  perDay: number;
  payload: (i: number, day: Date) => Record<string, unknown>;
}> = [
  {
    signal: 'STANDUP',
    eventType: 'standup.submitted',
    source: 'daily_updates',
    perDay: 1,
    payload: (i, day) => ({
      date: day.toISOString().slice(0, 10),
      bodyLength: 120 + Math.floor(Math.random() * 200),
      bodyHash: `hash-${randomUUID()}`,
    }),
  },
  {
    signal: 'EXECUTION',
    eventType: 'task.closed',
    source: 'tasks',
    perDay: 1.5,
    payload: () => ({
      ageHours: 24 + Math.floor(Math.random() * 96),
      hadComments: true,
      pointsEstimate: [1, 2, 3, 5, 8][Math.floor(Math.random() * 5)],
    }),
  },
  // CODE has FOUR emit paths. Seed two of the highest-value ones so the
  // CODE scorer has something to chew on; commits + reviews are common
  // enough that the sub-scores look plausible.
  {
    signal: 'CODE',
    eventType: 'github.pr_merged',
    source: 'github',
    perDay: 0.4,
    payload: () => ({
      additions: 50 + Math.floor(Math.random() * 400),
      deletions: Math.floor(Math.random() * 100),
      hasDescription: true,
      reviewers: Math.random() > 0.2 ? 1 : 0,
    }),
  },
  {
    signal: 'CODE',
    eventType: 'github.commit',
    source: 'github',
    perDay: 1.5,
    payload: () => ({
      additions: 10 + Math.floor(Math.random() * 200),
      deletions: Math.floor(Math.random() * 50),
    }),
  },
  {
    signal: 'COMMUNICATION',
    eventType: 'comment.created',
    source: 'comments',
    perDay: 3,
    payload: () => ({
      bodyLength: 40 + Math.floor(Math.random() * 200),
      mentions: Math.random() > 0.5 ? 1 : 0,
    }),
  },
  // PRESENCE has TWO emit paths that the scorer dedupes:
  //   - clock.session_closed (from clockSession.service)
  //   - pulse.daily_presence (from the Windows agent snapshot)
  // We emit both so the dedup logic gets exercised in dev.
  {
    signal: 'PRESENCE',
    eventType: 'clock.session_closed',
    source: 'clock_sessions',
    perDay: 1,
    payload: (_i, day) => ({
      date: day.toISOString().slice(0, 10),
      // 7–9 hours per day, jittered.
      durationSeconds: Math.floor((7 + Math.random() * 2) * 3600),
    }),
  },
  {
    signal: 'PRESENCE',
    eventType: 'pulse.daily_presence',
    source: 'device_snapshots',
    perDay: 1,
    payload: (_i, day) => ({
      date: day.toISOString().slice(0, 10),
      activeSeconds: Math.floor((6 + Math.random() * 2) * 3600),
      idleSeconds: Math.floor(Math.random() * 1800),
      lockedSeconds: Math.floor(Math.random() * 600),
      hasTamper: false,
      // Login hour 09 jittered ±1.
      loginSessionStartHour: 9 + Math.round((Math.random() - 0.5) * 2),
    }),
  },
  // Wave 8 — use the SAME event types the real Windows agent emits via
  // `ingestSnapshot → emitPulseProductivityEvents`. The pre-Wave-8 seed
  // used invented `focus.block` / `device.healthy` types that no scorer
  // reads, which is why the Reports drawer rendered "0/100 — no data"
  // for DEEP_WORK + DEVICE_HYGIENE on a freshly-seeded dev DB.
  {
    signal: 'DEEP_WORK',
    eventType: 'pulse.daily_focus',
    source: 'device_snapshots',
    perDay: 1,
    payload: (_i, day) => {
      const activeSeconds = (5 + Math.random() * 3) * 3600; // 5-8 active hours
      const productiveRatio = 0.4 + Math.random() * 0.55; // 40-95% productive
      const productiveSeconds = Math.floor(activeSeconds * productiveRatio);
      return {
        date: day.toISOString().slice(0, 10),
        productiveSeconds,
        activeSeconds: Math.floor(activeSeconds),
        focusBlocks: Math.floor(productiveSeconds / (25 * 60)),
        contextSwitches: 5 + Math.floor(Math.random() * 25),
        distractionBurstMinutes: Math.floor(Math.random() * 10),
        tamperMinutes: 0,
        // Wave 8 — denser focus signal + proportional tamper penalty.
        productiveRatio: Number(productiveRatio.toFixed(2)),
        tamperRatio: 0,
      };
    },
  },
  {
    signal: 'DEVICE_HYGIENE',
    eventType: 'pulse.daily_hygiene',
    source: 'device_snapshots',
    perDay: 1,
    payload: (_i, day) => ({
      date: day.toISOString().slice(0, 10),
      defenderEnabledRatio: 1,
      firewallEnabledRatio: 1,
      bitlockerEnabled: true,
      rebootPendingDays: Math.floor(Math.random() * 2),
      unsupportedOs: false,
      criticalPatchCount: 0,
      importantPatchCount: Math.floor(Math.random() * 3),
      agentOfflineHours: 0,
    }),
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seedDevProductivityEvents] refusing to run in production');
    process.exit(1);
  }

  // Wave 13 SECURITY: exclude CLIENT users from the dev seed. CLIENTs
  // are not employees and should never have productivity events
  // (they'd otherwise show up on the SUPER_ADMIN Reports page with
  // synthetic scores). Pre-Wave-13 this dev seed quietly emitted
  // events for the Demo Client + VC Partner CLIENT accounts every
  // time it ran, polluting `productivity_events` with ~1400 rows.
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER'] },
    },
    select: { id: true, name: true },
    take: 10,
    orderBy: { createdAt: 'asc' },
  });
  if (users.length === 0) {
    console.error('[seedDevProductivityEvents] no active users — nothing to seed');
    return;
  }
  console.log(
    `[seedDevProductivityEvents] seeding ${users.length} users × 7 signals × 30 days`,
  );

  const now = new Date();
  const rows: Array<{
    id: string;
    userId: string;
    signal: typeof SIGNAL_TEMPLATES[number]['signal'];
    eventType: string;
    occurredAt: Date;
    rawPayload: Record<string, unknown>;
    source: string;
    sourceId: string;
  }> = [];

  for (const user of users) {
    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - dayOffset);
      // Skip weekends for working-day signals.
      const dow = day.getUTCDay();
      const isWeekend = dow === 0 || dow === 6;

      for (const tpl of SIGNAL_TEMPLATES) {
        const jitter = 0.5 + Math.random();
        const count = Math.round(tpl.perDay * jitter);
        if (isWeekend && tpl.signal !== 'DEVICE_HYGIENE') continue;
        for (let i = 0; i < count; i++) {
          const occurredAt = new Date(day);
          occurredAt.setUTCHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60));
          rows.push({
            id: randomUUID(),
            userId: user.id,
            signal: tpl.signal,
            eventType: tpl.eventType,
            occurredAt,
            rawPayload: tpl.payload(i, day),
            source: tpl.source,
            sourceId: `dev-seed-${randomUUID()}`,
          });
        }
      }
    }
  }

  // De-dupe on (source, sourceId, eventType) since the unique key
  // enforces it — randomUUID guarantees uniqueness here.
  console.log(`[seedDevProductivityEvents] inserting ${rows.length} events`);
  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.productivityEvent.createMany({
      data: chunk,
      skipDuplicates: true,
    });
  }

  console.log('[seedDevProductivityEvents] done. Trigger recompute-all from the UI to see scores.');
}

main()
  .catch((err) => {
    console.error('[seedDevProductivityEvents] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
