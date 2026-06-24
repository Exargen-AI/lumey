import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { hashPassword } from '../utils/password';

// First-instance seed for the agent platform: provisions Manjari as a
// regular User row marked `userType=AGENT`, scoped to the ManaCalendar
// project as an Engineer. Idempotent — re-running on a DB where Manjari
// already exists is a no-op (we never overwrite her password or her
// identity, only ensure the row + project membership are present).
//
// Password is read from the MANJARI_PASSWORD environment variable. If unset
// we skip seeding so secrets never end up in source. The container runtime
// reads the same value from a mounted secret and uses /auth/login on
// startup.

const MANJARI_EMAIL = 'manjari@exargen.in';
const MANACALENDAR_SLUG = 'manacalendar';

export async function seedAgentUsers() {
  const password = process.env.MANJARI_PASSWORD;
  if (!password || password.length < 8) {
    console.log('  ⚠ Skipping Manjari seed — MANJARI_PASSWORD env var not set (or <8 chars).');
    return;
  }

  // Idempotent: short-circuit if Manjari already exists. Do not touch her
  // password — that's owned by whichever process minted her originally.
  const existing = await prisma.user.findUnique({
    where: { email: MANJARI_EMAIL },
    select: { id: true, userType: true, agentRole: true },
  });

  // Per docs/agent-platform/03-skill-architecture-and-framing.md §2:
  // we don't anchor Manjari with a hierarchy label like "junior-coder".
  // `agentRole` is metadata only (admin UI, not LLM context); it describes
  // function + mode without ranking. Future agent kinds follow the same
  // pattern: 'autonomous-pm', 'autonomous-qa', etc.
  const AGENT_ROLE_LABEL = 'autonomous-engineer';

  let manjariId: string;
  if (existing) {
    manjariId = existing.id;
    // Idempotent label refresh — if Manjari was seeded with the old
    // 'junior-coder' label, bring her up to date with the current naming
    // without touching her password or anything else.
    if (existing.agentRole !== AGENT_ROLE_LABEL) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { agentRole: AGENT_ROLE_LABEL },
      });
      console.log(`  ✔ Manjari exists (id=${existing.id}); updated agentRole → "${AGENT_ROLE_LABEL}".`);
    } else {
      console.log(`  ✔ Manjari already exists (id=${existing.id}, userType=${existing.userType}); leaving in place.`);
    }
  } else {
    const passwordHash = await hashPassword(password);
    const manjari = await prisma.user.create({
      data: {
        name: 'Manjari',
        email: MANJARI_EMAIL,
        passwordHash,
        role: UserRole.ENGINEER,
        company: null,
        userType: 'AGENT',
        agentRole: AGENT_ROLE_LABEL,
        agentSystemPromptPath: '~/exargen/manjari',
        agentBudgetMonthlyUsdCents: 50_000, // $500/mo default; tunable from admin UI
        agentActive: true,
      },
    });
    manjariId = manjari.id;
    console.log(`  ✔ Created Manjari (id=${manjari.id}) as agent user.`);
  }

  // Ensure project membership in ManaCalendar as ENGINEER. If the project
  // doesn't exist yet (e.g. fresh DB before projects seed), log + return —
  // re-running the seed after projects are in place picks it up.
  const project = await prisma.project.findUnique({
    where: { slug: MANACALENDAR_SLUG },
    select: { id: true, name: true },
  });
  if (!project) {
    console.log(`  ⚠ ManaCalendar project (slug="${MANACALENDAR_SLUG}") not found yet — skipping membership. Re-run the seed after projects are present.`);
    return;
  }

  await prisma.projectMember.upsert({
    where: { userId_projectId: { userId: manjariId, projectId: project.id } },
    create: {
      userId: manjariId,
      projectId: project.id,
      role: UserRole.ENGINEER,
    },
    update: {},
  });
  console.log(`  ✔ Manjari is a member of ${project.name} (Engineer).`);
}
