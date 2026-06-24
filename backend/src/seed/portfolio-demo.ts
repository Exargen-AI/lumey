/**
 * Portfolio Demo seed — populates realistic sprint + task data so the
 * Studio Portfolio /dashboard renders alive (sparklines, capacity bars,
 * attention alerts). Idempotent: skips projects that already have an
 * ACTIVE sprint.
 *
 * Run with:  npx tsx backend/src/seed/portfolio-demo.ts
 */
import { TaskStatus, TaskPriority, SprintStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';

// ─── Realistic technical task templates per product ───
// Each entry seeds 8–10 tasks for the active sprint + a few completed-in-past
// tasks to feed the velocity sparkline.
const TASK_TEMPLATES: Record<string, string[]> = {
  'furix-ai': [
    'Postgres replication lag exceeds 30s on primary failover',
    'CVE-2026-1872 — patch JWT signing library to v9.x',
    'Vector store: switch from in-memory to pgvector for >1M embeddings',
    'Multi-modal vision pipeline misclassifies dark-skin faces',
    'RAG retrieval latency p95 jumped to 1.4s after index rebuild',
    'Add streaming response support to /chat endpoint',
    'Voice-to-text: Hindi codeswitching drops accuracy 18%',
    'Migrate sandboxed agent runtime to Firecracker microVMs',
    'Audit log: PII scrubbing leaves email patterns in error stacks',
    'Long-context attention OOMs on prompts >128k tokens',
  ],
  'clawmates-adk': [
    'Tool-use loop deadlocks when nested agents share the same memory key',
    'Plugin hot-reload corrupts in-flight requests',
    'Add typed schema for agent <-> tool message contracts',
    'Memory checkpoint serialization is 4x slower than spec',
    'CLI: `clawmates init` fails on Windows path with spaces',
    'OpenTelemetry traces missing parent spans across worker boundaries',
    'Retry policy back-off math is incorrect for jitter > 1s',
    'Document the eval harness for new contributors',
  ],
  'rozcar': [
    'KYC webhook timing out on Surepass for non-Aadhaar drivers',
    'Booking conflict detection misses 30-min overlap on long routes',
    'Driver onboarding: license OCR rejects valid Maharashtra commercial format',
    'Insurance integration: Acko callback returns 502 intermittently',
    'Trip cancellation refund stuck in PENDING for >24h',
    'Search filter: vehicle type "SUV" returns sedans for some operators',
    'Notification: SMS template hits 160-char limit, gets split poorly',
    'Driver earnings dashboard shows 0 after Sunday 11:59 IST rollover',
    'Ride-share matching: greedy algorithm picks worse routes 22% of time',
  ],
  'manacalendar': [
    'Tithi calculation off by one for Krishna Paksha in March 2026',
    'Samvatsaram label missing for Plava year users',
    'Festival reminder: Janmashtami fires 24h late in PST timezone',
    'Add support for Vikram Samvat era alongside Saka',
    'Panchang widget: rahu kalam endpoints inaccurate north of 30°N',
    'iOS widget battery drain — cache panchang per day not per minute',
    'Lunar phase animation flickers on Pixel 7 Pro',
  ],
  'dhandhaphone': [
    'IVR Hindi prompts: TTS pronunciation of brand name "Reliance" is wrong',
    'Voice queue: dropped calls during festival load (>5x baseline)',
    'Number masking: outbound caller-ID shows real number on landlines',
    'Billing: per-minute roundup logic loses paise on sub-second calls',
    'Whatsapp Business API rate-limit handling: retry storm on 429',
    'Recording transcript: Tamil mixed-script breaks segmentation',
  ],
  'neerati': [
    'Water-quality sensor calibration drifts after 30 days in field',
    'LoRaWAN gateway: packet loss spikes when battery drops below 20%',
    'Dashboard: turbidity alerts firing on cleaning-cycle false positives',
    'Mobile app: offline-first sync conflicts on overlapping reading windows',
    'Add multi-tenant isolation for utility-board deployments',
  ],
  'hpcl-analytics': [
    'Vehicle telemetry ingestion: 500 trucks lag 8h due to S3 throttling',
    'Fuel theft detection: high false-positive on highway downhill stretches',
    'Driver scorecard: harsh-braking threshold needs vehicle-class tuning',
    'Geofence breach alerts double-fire when GPS accuracy <50m',
    'Compliance export: PDF rendering OOMs for fleets >200 vehicles',
  ],
  'bountipos': [
    'GST invoice: HSN code lookup fails for cross-state inter-state mix',
    'Receipt printer: thermal head overheats under sustained 120 receipts/hr',
    'UPI reconciliation: NPCI batch file format change broke parser',
    'Inventory sync: variant SKUs duplicated when merchant edits master',
    'Touch input: long-press menu blocks numeric keypad on small tablets',
    'Day-end Z-report shows zero sales when timezone offset crosses midnight',
  ],
};

const PRIORITIES = [TaskPriority.P0, TaskPriority.P1, TaskPriority.P2, TaskPriority.P2, TaskPriority.P3];
function pickPriority(idx: number): TaskPriority {
  return PRIORITIES[idx % PRIORITIES.length];
}

function pickStatus(idx: number, total: number): TaskStatus {
  // Distribute: 25% DONE, 30% IN_PROGRESS, 15% IN_REVIEW, 25% TODO, 5% BACKLOG
  const ratio = idx / total;
  if (ratio < 0.25) return TaskStatus.DONE;
  if (ratio < 0.55) return TaskStatus.IN_PROGRESS;
  if (ratio < 0.70) return TaskStatus.IN_REVIEW;
  if (ratio < 0.95) return TaskStatus.TODO;
  return TaskStatus.BACKLOG;
}

const POINTS = [1, 2, 3, 5, 8, 13];
function pickPoints(idx: number): number {
  return POINTS[idx % POINTS.length];
}

async function main() {
  console.log('🌱 Portfolio demo seed — adding sprints + tasks…\n');

  // Look up the engineers we want to assign tasks to.
  const engineers = await prisma.user.findMany({
    where: { role: { in: [UserRole.ENGINEER, UserRole.PRODUCT_MANAGER] }, isActive: true },
    select: { id: true, name: true, role: true },
  });
  if (engineers.length === 0) {
    console.error('  No active engineers/PMs found. Run the main seed first.');
    process.exit(1);
  }

  // Find admin (creator for tasks)
  const admin = await prisma.user.findFirst({
    where: { role: UserRole.SUPER_ADMIN },
    select: { id: true },
  });
  if (!admin) {
    console.error('  No super admin found. Run the main seed first.');
    process.exit(1);
  }

  const projects = await prisma.project.findMany({
    where: { slug: { in: Object.keys(TASK_TEMPLATES) } },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true } } } },
      sprints: { where: { status: SprintStatus.ACTIVE } },
    },
  });

  const now = new Date();
  const sprintStart = new Date(now); sprintStart.setDate(sprintStart.getDate() - 5); sprintStart.setHours(0, 0, 0, 0);
  const sprintEnd   = new Date(now); sprintEnd.setDate(sprintEnd.getDate() + 9); sprintEnd.setHours(23, 59, 59, 999);

  // Threshold for "blocked aging" alerts — set updatedAt 4 days back.
  const fourDaysAgo = new Date(now); fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

  for (const project of projects) {
    const titles = TASK_TEMPLATES[project.slug];
    if (!titles) continue;

    if (project.sprints.length > 0) {
      console.log(`  ⏭  ${project.name}: already has an active sprint, skipping.`);
      continue;
    }

    // Pick assignees from project members (engineers/PMs); fall back to global pool.
    const memberAssignees = project.members
      .filter((m) => m.user.role === UserRole.ENGINEER || m.user.role === UserRole.PRODUCT_MANAGER)
      .map((m) => m.user);
    const assigneePool = memberAssignees.length > 0 ? memberAssignees : engineers;

    // Find the next sprint number
    const lastSprint = await prisma.sprint.findFirst({
      where: { projectId: project.id },
      orderBy: { number: 'desc' },
    });
    const sprintNumber = (lastSprint?.number ?? 0) + 1;

    const sprint = await prisma.sprint.create({
      data: {
        projectId: project.id,
        name: `Sprint ${sprintNumber}`,
        number: sprintNumber,
        goal: `Stabilize and ship the highest-priority issues for ${project.name}.`,
        startDate: sprintStart,
        endDate: sprintEnd,
        status: SprintStatus.ACTIVE,
      },
    });

    // Bump the project's task counter so titles get unique numbers.
    let nextTaskNum = project.taskCounter + 1;

    const total = titles.length;
    let blockedThisProject = 0;
    for (let i = 0; i < total; i++) {
      const status = pickStatus(i, total);
      const priority = pickPriority(i);
      const assignee = assigneePool[(i + sprintNumber) % assigneePool.length];

      // Sprinkle blocked tasks: ~15% of in-progress tasks per project, capped at 2.
      const isBlocked = status === TaskStatus.IN_PROGRESS && blockedThisProject < 2 && i % 4 === 0;
      if (isBlocked) blockedThisProject++;

      const task = await prisma.task.create({
        data: {
          projectId: project.id,
          taskNumber: nextTaskNum++,
          title: titles[i],
          taskType: 'FEATURE',
          status,
          priority,
          storyPoints: pickPoints(i),
          sprintId: sprint.id,
          assigneeId: i % 7 === 6 ? null : assignee.id, // ~14% unassigned
          creatorId: admin.id,
          isBlocked,
          blockerNote: isBlocked ? 'Awaiting clarification from upstream service team.' : null,
          isSeedData: true,
        },
      });

      // For blocked tasks, push updatedAt back so they trigger BLOCKED_AGING.
      if (isBlocked) {
        await prisma.task.update({
          where: { id: task.id },
          data: { updatedAt: fourDaysAgo },
        });
      }
    }

    // Backfill velocity history: 12 done tasks per project, distributed across past 8 weeks.
    for (let w = 1; w <= 8; w++) {
      const weeksAgo = new Date(now); weeksAgo.setDate(weeksAgo.getDate() - 7 * w);
      const tasksThisWeek = Math.floor(2 + Math.random() * 3); // 2-4 per week
      for (let k = 0; k < tasksThisWeek; k++) {
        const title = titles[(w * 3 + k) % titles.length];
        const assignee = assigneePool[(w + k) % assigneePool.length];
        const created = await prisma.task.create({
          data: {
            projectId: project.id,
            taskNumber: nextTaskNum++,
            title: `[${w}w ago] ${title}`,
            taskType: 'FEATURE',
            status: TaskStatus.DONE,
            priority: TaskPriority.P2,
            storyPoints: pickPoints(k),
            assigneeId: assignee.id,
            creatorId: admin.id,
            isSeedData: true,
          },
        });
        // Force updatedAt into the past so it falls in the right velocity week.
        await prisma.task.update({
          where: { id: created.id },
          data: { updatedAt: weeksAgo },
        });
      }
    }

    await prisma.project.update({
      where: { id: project.id },
      data: { taskCounter: nextTaskNum - 1 },
    });

    console.log(`  ✅ ${project.name}: sprint ${sprintNumber} + ${total} active + ~24 historical tasks`);
  }

  // ─── Skip yesterday's EOD for 2 engineers (to populate MISSING_EOD alerts) ───
  // We do this by ensuring 2 engineers have NO row for yesterday — since rows
  // are only created on submit, the absence is the alert.
  const yesterday = new Date(now); yesterday.setHours(0, 0, 0, 0); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayDow = yesterday.getDay();
  if (yesterdayDow >= 1 && yesterdayDow <= 5) {
    // Make sure 3 of the 5 engineers HAVE submitted, so MISSING ones look real
    // and not just "DB is empty"
    const eng = engineers.slice(0, 3);
    for (const e of eng) {
      await prisma.dailyUpdate.upsert({
        where: { userId_date: { userId: e.id, date: yesterday } },
        create: {
          userId: e.id,
          date: yesterday,
          summary: 'Closed out the week by shipping the priority-1 issues. Plan: focus on review-queue tomorrow.',
          plans: 'Clear in-review backlog, then start the new auth refactor.',
        },
        update: {},
      });
    }
    console.log(`  ✅ Yesterday EOD: ${eng.length} engineers submitted (rest will trigger MISSING_EOD alerts)`);
  } else {
    console.log(`  ⏭  Yesterday was a weekend, skipping EOD seeding.`);
  }

  console.log('\n🎉 Portfolio demo seed complete.\n');
}

main()
  .catch((e) => {
    console.error('Portfolio demo seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
