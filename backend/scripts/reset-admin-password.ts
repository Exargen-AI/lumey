/* eslint-disable no-secrets/no-secrets -- same charset-pool false-positive as
   bootstrap-super-admin.ts. These are deliberate character pools used by
   `generatePassword()`, not credentials. */

import crypto from 'crypto';
import prisma from '../src/config/database';
import { hashPassword } from '../src/utils/password';

/**
 * One-shot dev/onboarding utility: rotate the admin password to a freshly
 * generated 20-character password that satisfies the password policy
 * (10+ chars, upper + lower + digit + symbol). Prints the new value to stdout
 * exactly once. Bumps tokenVersion + revokes all refresh tokens so any old
 * sessions die immediately. Run with:
 *
 *   cd backend && npx tsx scripts/reset-admin-password.ts
 *
 * NEVER commit the printed password. NEVER run on production without
 * coordinating with whoever holds the current admin creds.
 */

function generatePassword(): string {
  // Layout: 4 lower + 4 upper + 4 digit + 2 symbol + 6 random alnum.
  // Shuffle so the structure isn't predictable to a casual onlooker.
  const lower = 'abcdefghijkmnpqrstuvwxyz'; // skip ambiguous l/o
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // skip ambiguous I/O
  const digit = '23456789';                 // skip ambiguous 0/1
  const symbol = '!@#$%&*?';                // safe in shells, URLs, JSON
  const alnum = lower + upper + digit;

  const pick = (charset: string, count: number) => {
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = crypto.randomInt(0, charset.length);
      out.push(charset[idx]);
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
  // Fisher-Yates with crypto-strength randomness.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function main() {
  const email = process.argv[2] || 'admin@exargen.in';
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email "${email}". Aborting.`);
    process.exit(2);
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  console.log('');
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │  Password rotated.                                │');
  console.log('  ├──────────────────────────────────────────────────┤');
  console.log(`  │  email:     ${email.padEnd(38)}│`);
  console.log(`  │  password:  ${password.padEnd(38)}│`);
  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Copy this password into your password manager NOW.');
  console.log('  This is the ONLY time it is printed.');
  console.log('  All existing sessions for this account have been revoked.');
  console.log('');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('reset-admin-password failed:', err);
  process.exit(1);
});
