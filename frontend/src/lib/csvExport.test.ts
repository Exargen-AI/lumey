/**
 * csvExport — unit tests.
 *
 * Pins the formula-injection guard so that the OWASP-class CSV
 * vulnerability (someone naming themselves `=SUM(A1:A99)` to pop a
 * formula on the SUPER_ADMIN's machine) stays patched.
 */

import { describe, it, expect } from 'vitest';
import { csvCell, csvRow } from './csvExport';

describe('csvCell — formula-injection guard', () => {
  it.each([
    ['=SUM(A1:A99)', `"'=SUM(A1:A99)"`],
    ['+1+2', `"'+1+2"`],
    ['-1-2', `"'-1-2"`],
    ['@HYPERLINK("evil.com")', `"'@HYPERLINK(""evil.com"")"`],
    // Tab character (\t) is a known dangerous lead in Excel.
    ['\teval', `"'\teval"`],
    // CR. Note this also produces a `\r` inside the body which forces
    // RFC 4180 quoting anyway.
    ['\rfoo', `"'\rfoo"`],
    // The classic CSV-injection payload — DDE attack on Excel.
    [`=cmd|'/c calc'!A1`, `"'=cmd|'/c calc'!A1"`],
  ])('prefixes %j with apostrophe and wraps in quotes', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('does NOT prefix a value that merely CONTAINS = / + / - / @ (only the first char matters)', () => {
    expect(csvCell('priya@exargen.in')).toBe('priya@exargen.in');
    expect(csvCell('1+1')).toBe('1+1');
    expect(csvCell('foo=bar')).toBe('foo=bar');
  });
});

describe('csvCell — RFC 4180 quoting', () => {
  it('wraps cells containing a comma in quotes', () => {
    expect(csvCell('Priya, M')).toBe('"Priya, M"');
  });

  it('wraps cells containing a literal double-quote in quotes and doubles the quote', () => {
    expect(csvCell('Bob "the Engineer"')).toBe('"Bob ""the Engineer"""');
  });

  it('wraps cells containing a newline in quotes', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('leaves plain ascii alone', () => {
    expect(csvCell('Priya')).toBe('Priya');
    expect(csvCell('')).toBe('');
    expect(csvCell('user-1')).toBe('user-1');
  });
});

describe('csvRow', () => {
  it('joins cells with commas, escaping each', () => {
    expect(csvRow(['Priya', 'priya@exargen.in', '80'])).toBe(
      'Priya,priya@exargen.in,80',
    );
  });

  it('escapes a malicious name in the first column without breaking the row shape', () => {
    expect(csvRow(['=BAD()', 'foo@bar.com', '42'])).toBe(
      `"'=BAD()",foo@bar.com,42`,
    );
  });
});
