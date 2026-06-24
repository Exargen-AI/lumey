import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { hashPassword } from '../utils/password';

const SEED_USERS = [
  { name: 'Exargen', email: 'admin@exargen.in', role: UserRole.SUPER_ADMIN, company: null },
  { name: 'Anil K', email: 'anil@exargen.in', role: UserRole.ADMIN, company: null },
  { name: 'Ravi Kumar', email: 'ravi@exargen.in', role: UserRole.PRODUCT_MANAGER, company: null },
  { name: 'Karthik S', email: 'karthik@exargen.in', role: UserRole.ENGINEER, company: null },
  { name: 'Priya M', email: 'priya@exargen.in', role: UserRole.ENGINEER, company: null },
  { name: 'Suresh R', email: 'suresh@exargen.in', role: UserRole.ENGINEER, company: null },
  { name: 'HPCL PM', email: 'pm@hpcl.co.in', role: UserRole.CLIENT, company: 'HPCL' },
  { name: 'VC Partner', email: 'investor@fund.in', role: UserRole.CLIENT, company: 'Venture Fund' },
];

export async function seedUsers(): Promise<Map<string, string>> {
  console.log('Seeding users...');
  // Seed password must satisfy the production password policy
  // (10+ chars, upper + lower + digit + symbol — see auth.schema.ts).
  // Pre-launch finding #29: the previous `Admin@123` was 9 chars, which
  // meant a seed user who changed their password and tried to set it back
  // got rejected by `change-password` validation. The new value satisfies
  // every existing rule.
  const passwordHash = await hashPassword('Admin@1234');
  const userMap = new Map<string, string>();

  for (const userData of SEED_USERS) {
    // Idempotent on password too: if a seed user already exists in the dev
    // DB and got their password changed (or pre-dates the Admin@1234 bump),
    // re-running the seed brings them back to the documented baseline so
    // the smoke spec keeps working without manual DB poking. Only the
    // seed-data flag distinguishes these users from real ones, so this is
    // safe for any environment where seed runs — production never does.
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      create: { ...userData, passwordHash, isSeedData: true },
      update: { passwordHash, isSeedData: true },
    });
    userMap.set(userData.email, user.id);
  }

  console.log(`Seeded ${SEED_USERS.length} users`);
  return userMap;
}
