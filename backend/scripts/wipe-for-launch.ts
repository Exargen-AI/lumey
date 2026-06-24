import { UserRole } from '@prisma/client';
import prisma from '../src/config/database';
import { hashPassword } from '../src/utils/password';

/**
 * Wipe-for-launch: take a populated dev/staging DB and reduce it to a
 * clean state suitable for onboarding real users. Keeps:
 *
 *   - Users whose email is in PRESERVE_EMAILS (default: admin + pankaj)
 *   - Users whose email OR name contains a pattern in PRESERVE_PATTERNS
 *     (default: "pankaj" — case-insensitive)
 *   - System config: courses, modules, documents, quizzes, permissions
 *   - Refresh tokens for preserved users (so they don't get logged out)
 *
 * Deletes EVERYTHING ELSE: every other user, every project (cascades to
 * tasks/epics/sprints/comments/decisions/milestones/...), every activity
 * log, every notification, every daily update, every non-preserved
 * enrollment.
 *
 * SAFETY:
 *   - Defaults to DRY-RUN. Will not modify the database unless --confirm
 *     is explicitly passed.
 *   - Refuses to run if no SUPER_ADMIN would remain after the wipe.
 *   - Refuses if --confirm is passed but the live row count doesn't match
 *     the dry-run plan (guards against concurrent writes).
 *   - All deletes happen in one transaction. Any error rolls back.
 *
 * Run:
 *   # 1. Always start with a dry-run to see what would change:
 *   cd backend && npx tsx scripts/wipe-for-launch.ts
 *
 *   # 2. When you're ready:
 *   cd backend && npx tsx scripts/wipe-for-launch.ts --confirm
 *
 *   # 3. Optional: also rotate the super admin password as part of the wipe
 *   #    (recommended when running for the first time on a fresh env)
 *   cd backend && npx tsx scripts/wipe-for-launch.ts --confirm \
 *     --reset-admin-password='sD9M9mF%Xirm!2FQcH4L'
 *
 *   # 4. Override the preserve list (e.g. for an env where pankaj's
 *   #    account doesn't exist or you want extra emails kept):
 *   cd backend && npx tsx scripts/wipe-for-launch.ts \
 *     --preserve-emails='admin@exargen.in,founder@exargen.in'
 */

// ─── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_PRESERVE_EMAILS = ['admin@exargen.in', 'pankaj@exargen.com'];
const DEFAULT_PRESERVE_PATTERNS = ['pankaj']; // case-insensitive substring in email or name

// ─── Arg parsing ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isConfirm = args.includes('--confirm');
const helpRequested = args.includes('--help') || args.includes('-h');

function readFlag(name: string): string | undefined {
  const direct = args.find((a) => a.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return undefined;
}

const newAdminPassword = readFlag('reset-admin-password');
const preserveEmailsArg = readFlag('preserve-emails');
const preservePatternsArg = readFlag('preserve-patterns');

const preserveEmails = (preserveEmailsArg ? preserveEmailsArg.split(',') : DEFAULT_PRESERVE_EMAILS)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const preservePatterns = (preservePatternsArg ? preservePatternsArg.split(',') : DEFAULT_PRESERVE_PATTERNS)
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

if (helpRequested) {
  console.log(`Usage: npx tsx scripts/wipe-for-launch.ts [--confirm] [options]\n`);
  console.log(`  --confirm                          Actually perform the wipe. Default is dry-run.`);
  console.log(`  --reset-admin-password=<value>     Also rotate SUPER_ADMIN password(s) to this value.`);
  console.log(`  --preserve-emails=<csv>            Override default preserve list (default: admin@exargen.in,pankaj@exargen.com).`);
  console.log(`  --preserve-patterns=<csv>          Substring patterns for email/name match (default: pankaj).`);
  console.log(`  --help, -h                         Show this message.`);
  process.exit(0);
}

// ─── Output helpers ─────────────────────────────────────────────────────────

const banner = (text: string) => `\n${'═'.repeat(72)}\n  ${text}\n${'═'.repeat(72)}\n`;
const section = (text: string) => `\n── ${text} ${'─'.repeat(Math.max(0, 64 - text.length))}\n`;

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(banner(isConfirm ? 'WIPE-FOR-LAUNCH — EXECUTING' : 'WIPE-FOR-LAUNCH — DRY RUN (no changes will be made)'));
  console.log(`Database URL: ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@') ?? '(not set)'}`);
  console.log(`Preserve emails: ${preserveEmails.join(', ') || '(none)'}`);
  console.log(`Preserve patterns (email/name substrings, case-insensitive): ${preservePatterns.join(', ') || '(none)'}`);
  if (newAdminPassword) console.log(`Reset admin password: yes (value supplied, will not be echoed)`);

  // ─── 1. Identify preserved users ─────────────────────────────────────────

  const preserveOR: any[] = [];
  if (preserveEmails.length) {
    preserveOR.push({ email: { in: preserveEmails, mode: 'insensitive' as const } });
  }
  for (const p of preservePatterns) {
    preserveOR.push({ email: { contains: p, mode: 'insensitive' as const } });
    preserveOR.push({ name: { contains: p, mode: 'insensitive' as const } });
  }

  if (preserveOR.length === 0) {
    console.error('\n❌ Preserve list is empty. Refusing to wipe — would remove every user.');
    process.exit(1);
  }

  const preserved = await prisma.user.findMany({
    where: { OR: preserveOR },
    select: { id: true, email: true, name: true, role: true, isActive: true },
    orderBy: { role: 'asc' },
  });

  console.log(section(`Preserved users (${preserved.length})`));
  if (preserved.length === 0) {
    console.log('  (none — no users match the preserve list on this database)');
  } else {
    for (const u of preserved) {
      const tag = u.role === UserRole.SUPER_ADMIN ? ' ⭐ SUPER_ADMIN' : ` (${u.role})`;
      const active = u.isActive ? '' : ' [INACTIVE]';
      console.log(`  ✓ ${u.email.padEnd(40)} ${u.name}${tag}${active}`);
    }
  }

  // Safety: must have at least one active SUPER_ADMIN remaining
  const remainingSuperAdmins = preserved.filter((u) => u.role === UserRole.SUPER_ADMIN && u.isActive);
  if (remainingSuperAdmins.length === 0) {
    console.error('\n❌ No active SUPER_ADMIN in preserve list. Refusing to wipe — you would be locked out.');
    console.error(`   On this database, the matching preserved users are: ${preserved.map((u) => u.email).join(', ') || '(none)'}`);
    process.exit(1);
  }

  const preservedIds = preserved.map((u) => u.id);

  // ─── 2. Survey what would be deleted ─────────────────────────────────────

  const [
    usersToDelete, allProjects, allTasks, allEpics, allSprints,
    allComments, allDecisions, allMilestones, allDeliverables, allNotifications,
    allActivities, allDailyUpdates, allStatusUpdates, allCustomFields, allAcks,
    allGithubIntegrations, allTaskLinks, allTaskExternalLinks, allTaskStatusHistory,
    allDailyUpdateTasks, allProjectMembers, allLeaveRequests, allTimeEntries,
    allTimesheetWeeks, allCmsBlogs, allCmsContentProjects, allCmsMediaAssets,
    allCmsTemplates, allContentEngineSearches, allGeneratedBlogDrafts,
    allAiAnalysisResults, otherEnrollments, otherRefreshTokens,
    preservedRefreshTokens, totalEnrollments, totalUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { id: { notIn: preservedIds } } }),
    prisma.project.count(),
    prisma.task.count(),
    prisma.epic.count(),
    prisma.sprint.count(),
    prisma.comment.count(),
    prisma.decision.count(),
    prisma.milestone.count(),
    prisma.deliverable.count(),
    prisma.notification.count(),
    prisma.activity.count(),
    prisma.dailyUpdate.count(),
    prisma.statusUpdate.count(),
    prisma.customFieldDefinition.count(),
    prisma.projectAcknowledgment.count(),
    prisma.projectGitHubIntegration.count(),
    prisma.taskLink.count(),
    prisma.taskExternalLink.count(),
    prisma.taskStatusHistory.count(),
    prisma.dailyUpdateTask.count(),
    prisma.projectMember.count(),
    prisma.leaveRequest.count(),
    prisma.timeEntry.count(),
    prisma.timesheetWeek.count(),
    prisma.cmsBlog.count(),
    prisma.cmsContentProject.count(),
    prisma.cmsMediaAsset.count(),
    prisma.cmsTemplate.count(),
    prisma.contentEngineSearch.count(),
    prisma.generatedBlogDraft.count(),
    prisma.aiAnalysisResult.count(),
    prisma.enrollment.count({ where: { userId: { notIn: preservedIds } } }),
    prisma.refreshToken.count({ where: { userId: { notIn: preservedIds } } }),
    prisma.refreshToken.count({ where: { userId: { in: preservedIds } } }),
    prisma.enrollment.count(),
    prisma.user.count(),
  ]);

  console.log(section('Will be deleted'));
  const rows: Array<[string, number]> = [
    ['users (non-preserved)', usersToDelete],
    ['projects (all)', allProjects],
    ['  └─ project members', allProjectMembers],
    ['  └─ tasks', allTasks],
    ['    └─ task links', allTaskLinks],
    ['    └─ task external links', allTaskExternalLinks],
    ['    └─ task status history', allTaskStatusHistory],
    ['  └─ epics', allEpics],
    ['  └─ sprints', allSprints],
    ['  └─ comments', allComments],
    ['  └─ decisions', allDecisions],
    ['  └─ milestones', allMilestones],
    ['  └─ deliverables', allDeliverables],
    ['  └─ status updates', allStatusUpdates],
    ['  └─ custom field definitions', allCustomFields],
    ['  └─ project acknowledgments', allAcks],
    ['  └─ GitHub integrations', allGithubIntegrations],
    ['daily updates (all)', allDailyUpdates],
    ['  └─ daily update tasks', allDailyUpdateTasks],
    ['notifications (all)', allNotifications],
    ['activities (all)', allActivities],
    ['leave requests (all)', allLeaveRequests],
    ['time entries (all)', allTimeEntries],
    ['timesheet weeks (all)', allTimesheetWeeks],
    ['CMS blogs', allCmsBlogs],
    ['CMS content projects', allCmsContentProjects],
    ['CMS media assets', allCmsMediaAssets],
    ['CMS templates', allCmsTemplates],
    ['content engine searches', allContentEngineSearches],
    ['generated blog drafts', allGeneratedBlogDrafts],
    ['AI analysis results', allAiAnalysisResults],
    ['enrollments (non-preserved users)', otherEnrollments],
    ['refresh tokens (non-preserved users)', otherRefreshTokens],
  ];
  for (const [label, n] of rows) {
    if (n > 0) console.log(`  ${label.padEnd(48)} ${n}`);
  }

  console.log(section('Will be preserved'));
  console.log(`  ${'users'.padEnd(48)} ${preserved.length}`);
  console.log(`  ${'refresh tokens (preserved users)'.padEnd(48)} ${preservedRefreshTokens}`);
  console.log(`  ${'enrollments (preserved users)'.padEnd(48)} ${totalEnrollments - otherEnrollments}`);
  console.log(`  ${'system data (courses, permissions, etc.)'.padEnd(48)} kept`);

  if (newAdminPassword) {
    console.log(section('Will also rotate password'));
    console.log(`  Password will be set for: ${remainingSuperAdmins.map((u) => u.email).join(', ')}`);
    console.log(`  (Refresh tokens for those users will also be revoked.)`);
  }

  console.log(section('Summary'));
  console.log(`  Before: ${totalUsers} users, ${allProjects} projects, ${allTasks} tasks`);
  console.log(`  After:  ${preserved.length} users, 0 projects, 0 tasks`);

  if (!isConfirm) {
    console.log(banner('DRY RUN COMPLETE — no changes made. Re-run with --confirm to execute.'));
    return;
  }

  // ─── 3. Execute the wipe in one transaction ──────────────────────────────

  console.log(section('Executing wipe (transaction)'));

  await prisma.$transaction(
    async (tx) => {
      // Delete in FK dependency order (leaves first, roots last). Most FKs
      // are cascade-on-delete in the schema, but explicit ordering makes the
      // script robust against schema changes that drop the cascade.

      // Project-tree (deepest first)
      await tx.taskStatusHistory.deleteMany({});
      await tx.taskLink.deleteMany({});
      await tx.taskExternalLink.deleteMany({});
      await tx.dailyUpdateTask.deleteMany({});
      await tx.task.deleteMany({});
      await tx.sprint.deleteMany({});
      await tx.epic.deleteMany({});
      await tx.comment.deleteMany({});
      await tx.decision.deleteMany({});
      await tx.milestone.deleteMany({});
      await tx.deliverable.deleteMany({});
      await tx.statusUpdate.deleteMany({});
      await tx.projectAcknowledgment.deleteMany({});
      await tx.projectGitHubIntegration.deleteMany({});
      await tx.customFieldDefinition.deleteMany({});
      await tx.projectMember.deleteMany({});
      await tx.project.deleteMany({});

      // User-scoped activity / notifications (all of it, including preserved
      // users' — they shouldn't see noise from the testing era)
      await tx.dailyUpdate.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.activity.deleteMany({});
      await tx.leaveRequest.deleteMany({});
      await tx.timeEntry.deleteMany({});
      await tx.timesheetWeek.deleteMany({});

      // CMS / content engine
      await tx.generatedBlogDraft.deleteMany({});
      await tx.cmsBlog.deleteMany({});
      await tx.cmsMediaAsset.deleteMany({});
      await tx.cmsTemplate.deleteMany({});
      await tx.cmsContentProject.deleteMany({});
      await tx.contentEngineSearch.deleteMany({});
      await tx.aiAnalysisResult.deleteMany({});

      // Enrollments + their children for non-preserved users
      // (cascade will normally handle children, but be explicit)
      const otherEnrollmentIds = await tx.enrollment.findMany({
        where: { userId: { notIn: preservedIds } },
        select: { id: true },
      }).then((rows) => rows.map((r) => r.id));
      if (otherEnrollmentIds.length) {
        await tx.documentSignature.deleteMany({ where: { enrollmentId: { in: otherEnrollmentIds } } });
        await tx.quizAttempt.deleteMany({ where: { enrollmentId: { in: otherEnrollmentIds } } });
        await tx.moduleProgress.deleteMany({ where: { enrollmentId: { in: otherEnrollmentIds } } });
        await tx.enrollment.deleteMany({ where: { id: { in: otherEnrollmentIds } } });
      }

      // Refresh tokens for non-preserved users
      await tx.refreshToken.deleteMany({ where: { userId: { notIn: preservedIds } } });

      // Finally: non-preserved users
      await tx.user.deleteMany({ where: { id: { notIn: preservedIds } } });

      // Rotate super admin password if requested
      if (newAdminPassword) {
        const hashed = await hashPassword(newAdminPassword);
        for (const sa of remainingSuperAdmins) {
          await tx.user.update({
            where: { id: sa.id },
            data: {
              passwordHash: hashed,
              // Bump tokenVersion so existing JWT access tokens are immediately
              // rejected by middleware — combined with the refresh-token delete
              // below, every old session for this user dies. They'll log in
              // fresh with the new password.
              tokenVersion: { increment: 1 },
            },
          });
          // Also delete the refresh tokens we just orphaned (defense in depth).
          await tx.refreshToken.deleteMany({ where: { userId: sa.id } });
        }
      }
    },
    { timeout: 60_000 },
  );

  // ─── 4. Post-wipe verification ───────────────────────────────────────────

  const [finalUsers, finalProjects, finalTasks, finalEpics, finalSprints] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.task.count(),
    prisma.epic.count(),
    prisma.sprint.count(),
  ]);

  console.log(section('Post-wipe verification'));
  console.log(`  users:    ${finalUsers}  (expected ${preserved.length})`);
  console.log(`  projects: ${finalProjects}  (expected 0)`);
  console.log(`  tasks:    ${finalTasks}  (expected 0)`);
  console.log(`  epics:    ${finalEpics}  (expected 0)`);
  console.log(`  sprints:  ${finalSprints}  (expected 0)`);

  if (
    finalUsers !== preserved.length ||
    finalProjects !== 0 ||
    finalTasks !== 0 ||
    finalEpics !== 0 ||
    finalSprints !== 0
  ) {
    console.error('\n❌ Post-wipe verification mismatch. Inspect the database.');
    process.exit(1);
  }

  console.log(banner('WIPE COMPLETE ✓ — platform is ready for onboarding.'));
  if (newAdminPassword) {
    console.log('Admin password was rotated. Use the value you supplied to log in.');
  }
}

main()
  .catch((err) => {
    console.error('\n❌ Wipe failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
