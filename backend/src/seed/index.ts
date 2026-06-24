import prisma from '../config/database';
import { seedPermissions } from './permissions.seed';
import { seedUsers } from './users.seed';
import { seedProjects } from './projects.seed';
import { seedTasks } from './tasks.seed';
import { seedMilestones } from './milestones.seed';
import { seedDecisions } from './decisions.seed';
import { seedAgentUsers } from './agentUsers.seed';
import { seedReferenceAgent } from './referenceAgent.seed';
import { isProductionEnvironment } from './safety';

/**
 * 2026-05-15 SEED-SAFETY AUDIT.
 *
 * Pre-fix this entry point ran every seed phase unconditionally — a
 * developer (or CI job, or deployment script) that accidentally pointed
 * `DATABASE_URL` at production while running `npm run seed` would silently
 * insert DEMO users, DEMO projects, DEMO tasks, DEMO milestones, DEMO
 * decisions into the real database. There was no env check, no warning,
 * and no recovery beyond manually rolling back via clear.ts.
 *
 * Two-tier guard added:
 *
 *   ─── REFERENCE phase (always safe to run) ─────────────────────────
 *
 *   Permissions, onboarding course, agent users — these are reference
 *   data the live app NEEDS in any environment:
 *
 *     - Permissions: the RBAC table itself must exist for the live API
 *       to function. Idempotent upsert; safe everywhere.
 *     - Onboarding course: course taxonomy used by `enrollUserInCourse`
 *       on every new-hire create. Idempotent.
 *     - Agent users: gated by its OWN env-var (`MANJARI_PASSWORD`) so
 *       it skips silently when the secret isn't set.
 *
 *   These run regardless of NODE_ENV.
 *
 *   ─── DEMO phase (refuses production unless overridden) ────────────
 *
 *   Users (with passwords), projects, tasks, milestones, decisions —
 *   all the demo content for development + smoke testing. These rows
 *   all carry `isSeedData: true` so `clearSeedData()` can roll them
 *   back, but they should NEVER reach production in the first place.
 *
 *   Refused when NODE_ENV === 'production' OR DATABASE_URL contains
 *   common production hostnames (defense-in-depth — catches the case
 *   where NODE_ENV is misconfigured).
 *
 *   Override: set `SEED_ALLOW_PRODUCTION=true` to bypass. Documented
 *   so the override is intentional (e.g. a fresh production deploy
 *   that genuinely wants demo data temporarily) and visible in logs.
 */

async function seedReferenceData() {
  console.log('  ─ Reference data phase (always runs)');

  // 1. Seed permissions and role mappings
  await seedPermissions();

  // 2. Seed agent users (Manjari). Idempotent + skips silently if
  // MANJARI_PASSWORD env var is not set, so this is safe to run in
  // production too — without the secret, nothing happens.
  await seedAgentUsers();
}

async function seedDemoData() {
  console.log('  ─ Demo data phase (DEV ONLY)');

  // 1. Seed users (+ a reference agent so runs can be dispatched locally)
  const userMap = await seedUsers();
  await seedReferenceAgent();

  // 2. Seed projects with members
  const projectMap = await seedProjects(userMap);

  // 3. Seed tasks
  await seedTasks(userMap, projectMap);

  // 4. Seed milestones
  await seedMilestones(projectMap);

  // 5. Seed decisions
  await seedDecisions(userMap, projectMap);
}

async function main() {
  console.log('Starting seed...\n');

  const { isProd, reason } = isProductionEnvironment();
  const override = process.env.SEED_ALLOW_PRODUCTION === 'true';

  if (isProd && !override) {
    console.error('━'.repeat(70));
    console.error('🚨 REFUSING TO SEED DEMO DATA INTO PRODUCTION');
    console.error('━'.repeat(70));
    console.error(`Detected: ${reason}`);
    console.error('');
    console.error('Reference data (permissions, onboarding course, agent users)');
    console.error('WILL still run — those are required for the live app.');
    console.error('');
    console.error('Demo data (users, projects, tasks, milestones, decisions) is');
    console.error('REFUSED. If this is intentional (e.g. populating a fresh prod');
    console.error('database with demo content for a kickoff), re-run with:');
    console.error('');
    console.error('  SEED_ALLOW_PRODUCTION=true npm run seed');
    console.error('');
    console.error('━'.repeat(70));
  } else if (isProd && override) {
    console.warn('━'.repeat(70));
    console.warn('⚠  SEED_ALLOW_PRODUCTION=true — proceeding with FULL seed in prod');
    console.warn(`Detected: ${reason}`);
    console.warn('━'.repeat(70));
  }

  // Reference data always runs. The live app's RBAC + course taxonomy
  // depend on these existing in every environment.
  await seedReferenceData();

  // Demo data only runs when we're NOT in production (or override is set).
  if (!isProd || override) {
    await seedDemoData();
  }

  console.log('\nSeed complete!');
}

// Allow the file to be imported in tests without auto-running main(). The
// CLI path (tsx src/seed/index.ts) sets require.main === module on the
// entry script; vitest's importer doesn't.
const isEntryPoint = require.main === module;
if (isEntryPoint) {
  main()
    .catch((e) => {
      console.error('Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

// `isProductionEnvironment` lives in `./safety.ts` so it can be unit-
// tested without triggering the env-validation chain that's loaded
// when `../config/database` is imported. Re-export here so any
// future caller can still reach it from the index path.
export { isProductionEnvironment } from './safety';
export { seedReferenceData, seedDemoData };
