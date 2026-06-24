import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from './password';

/**
 * Phase 0 of the baseline hardening plan: this file's job is to prove
 * Vitest is wired correctly end-to-end (config, resolve aliases, TS
 * compile, coverage capture). It also happens to test real behavior —
 * `password.ts` is two lines of bcrypt glue, so a smoke spec for it
 * is the cheapest unit test in the entire codebase.
 *
 * Phase 2 expands this pattern across all 9 util files + all 47
 * service files. For now, one passing spec keeps the runner green
 * and gives Phase 2 a template to copy.
 */
describe('password utils', () => {
  it('hashes a password to a bcrypt string', async () => {
    const hash = await hashPassword('Admin@1234');
    // bcrypt hashes always start with $2a$, $2b$, or $2y$ and are 60 chars.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(hash).toHaveLength(60);
  });

  it('returns true when the password matches the hash', async () => {
    const hash = await hashPassword('Admin@1234');
    await expect(comparePassword('Admin@1234', hash)).resolves.toBe(true);
  });

  it('returns false when the password does not match the hash', async () => {
    const hash = await hashPassword('Admin@1234');
    await expect(comparePassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('produces different hashes for the same password (salt randomness)', async () => {
    const a = await hashPassword('Admin@1234');
    const b = await hashPassword('Admin@1234');
    expect(a).not.toBe(b);
    // Both should still verify.
    await expect(comparePassword('Admin@1234', a)).resolves.toBe(true);
    await expect(comparePassword('Admin@1234', b)).resolves.toBe(true);
  });
});
