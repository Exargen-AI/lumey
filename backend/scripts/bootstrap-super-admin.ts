/* eslint-disable no-secrets/no-secrets -- this file contains password-charset
   constants (lowercase + uppercase alphabets with confusables removed)
   which the secret-detector flags as high-entropy strings. They are not
   secrets, just character pools for `generatePassword()`. */

import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import prisma from '../src/config/database';
import { hashPassword } from '../src/utils/password';

/**
 * Bootstrap a SUPER_ADMIN on a fresh database (or upsert into an
 * existing one). Use cases:
 *
 *   1. First-ever production deploy — no users exist yet, you need an
 *      admin to log in. `reset-admin-password.ts` only ROTATES an
 *      existing user; it can't create one.
 *   2. Onboarding the founder onto a workspace that was seeded with
 *      generic test users (`admin@exargen.in` etc.) so you don't
 *      perpetuate the documented seed credentials in production.
 *   3. Rotating the founder's own password without going through the
 *      web UI (e.g. they got locked out and you have shell access).
 *
 * Behaviour:
 *   - If no user with the given email exists → CREATE as SUPER_ADMIN.
 *   - If a user exists → UPSERT password + role + isActive=true.
 *     Bumps `tokenVersion` and revokes refresh tokens so any old
 *     sessions are killed.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-super-admin.ts <email> <name>
 *   npx tsx scripts/bootstrap-super-admin.ts <email> <name> <password>
 *
 *   When no password is supplied, a 20-char crypto-random one is
 *   generated and printed ONCE. Capture immediately.
 *
 * Run from inside the backend workspace, OR from a Railway shell:
 *   railway shell --service <backend-service>
 *   cd backend && npx tsx scripts/bootstrap-super-admin.ts pankaj@exargen.in "Pankaj Founder"
 */

function generatePassword(): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz';   // skip l, o
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // skip I, O
  const digit = '23456789';                   // skip 0, 1
  const symbol = '!@#$%&*?';
  const alnum = lower + upper + digit;

  const pick = (charset: string, count: number) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(charset[crypto.randomInt(0, charset.length)]);
    }
    return out;
  };

  const chars = [
    ...pick(lower, 4),
    ...pick(upper, 4),
    ...pick(digit, 4),
    ...pick(symbol, 2),
    ...pick(alnum, 6),
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function main() {
  const [, , email, name, suppliedPassword] = process.argv;

  if (!email || !name) {
    console.error('Usage: npx tsx scripts/bootstrap-super-admin.ts <email> <name> [password]');
    console.error('  email     login email (e.g. pankaj@exargen.in)');
    console.error('  name      display name in quotes (e.g. "Pankaj Founder")');
    console.error('  password  optional; one is generated if omitted');
    process.exit(2);
  }
  if (!email.includes('@')) {
    console.error(`"${email}" doesn't look like an email address.`);
    process.exit(2);
  }

  // Match the password policy in `auth.schema.ts` so generated AND
  // user-supplied passwords are guaranteed to satisfy the live login
  // path. If you supplied something weaker, it'll still hash here but
  // the user won't be able to /change-password to it later.
  const password = suppliedPassword || generatePassword();
  if (password.length < 10) {
    console.error('Password must be at least 10 characters. Either omit (we generate one) or pick a longer value.');
    process.exit(2);
  }

  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findUnique({ where: { email } });

  let action: 'created' | 'upserted';
  if (existing) {
    action = 'upserted';
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          role: UserRole.SUPER_ADMIN,
          passwordHash,
          isActive: true,
          // Kill every issued JWT + refresh token for this user. If the
          // founder was locked out, this guarantees a clean slate.
          tokenVersion: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  } else {
    action = 'created';
    await prisma.user.create({
      data: {
        email,
        name,
        role: UserRole.SUPER_ADMIN,
        passwordHash,
        isActive: true,
      },
    });
  }

  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log(`  │  Super Admin ${action.padEnd(43)}│`);
  console.log('  ├─────────────────────────────────────────────────────────┤');
  console.log(`  │  email:     ${email.padEnd(43)}│`);
  console.log(`  │  name:      ${name.padEnd(43)}│`);
  console.log(`  │  password:  ${password.padEnd(43)}│`);
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Copy this password into your password manager NOW.');
  console.log(suppliedPassword
    ? '  (You supplied this password yourself.)'
    : '  This is the ONLY time the generated password is printed.');
  console.log('  Any old sessions for this account have been revoked.');
  console.log('');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('bootstrap-super-admin failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
