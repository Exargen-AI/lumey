import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email';

/**
 * normalizeEmail is small but lives on the auth hot path — every login + every
 * user create runs through it. Tests pin down the cases that have bitten us in
 * the past (mixed-case typo, leading whitespace from a copy-paste) plus the
 * defensive paths (null, undefined, number) so a regression here surfaces
 * loudly rather than as a "why can't I log in" report from a customer.
 */
describe('normalizeEmail', () => {
  it('lowercases ASCII emails', () => {
    expect(normalizeEmail('John@Exargen.in')).toBe('john@exargen.in');
    expect(normalizeEmail('JANE.DOE@EXAMPLE.COM')).toBe('jane.doe@example.com');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeEmail('  user@x.com  ')).toBe('user@x.com');
    expect(normalizeEmail('\tuser@x.com\n')).toBe('user@x.com');
  });

  it('combines trim + lowercase', () => {
    expect(normalizeEmail('   John@Exargen.IN   ')).toBe('john@exargen.in');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('John@X.com');
    const twice = normalizeEmail(once);
    expect(once).toBe(twice);
    expect(twice).toBe('john@x.com');
  });

  it('handles null / undefined defensively (returns empty string)', () => {
    // Callers shouldn't pass these, but if they do we don't want a TypeError
    // — the downstream prisma.findUnique({ email: '' }) will simply miss
    // and the auth path returns its generic "Invalid email or password".
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('coerces non-string inputs', () => {
    expect(normalizeEmail(123)).toBe('123');
  });

  it('does NOT strip Gmail-style plus tags or dots', () => {
    // Deliberately NOT doing provider-specific canonicalization. See the
    // doc comment in utils/email.ts for rationale.
    expect(normalizeEmail('Foo+work@gmail.com')).toBe('foo+work@gmail.com');
    expect(normalizeEmail('Foo.bar@gmail.com')).toBe('foo.bar@gmail.com');
  });
});
