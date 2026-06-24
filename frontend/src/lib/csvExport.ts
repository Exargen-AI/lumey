/**
 * CSV export helpers.
 *
 * Used by client-side exports (Pulse Reports → "Export CSV", etc.)
 * that want to turn an array of rows into a download blob without a
 * server round-trip.
 *
 * The cell escaper handles BOTH RFC 4180 quoting (commas, quotes,
 * newlines) AND **formula-injection** protection — Excel /
 * LibreOffice / Apple Numbers interpret a cell starting with `=`,
 * `+`, `-`, `@`, `\t`, or `\r` as the start of a live formula. A
 * user named `=SUM(A1:A99)` or `=cmd|'/c calc'!A1` could execute code
 * when the SUPER_ADMIN opens the export.
 *
 * Standard OWASP guidance: prefix the dangerous-leading cell with an
 * apostrophe (Excel treats the apostrophe as a text marker and
 * strips it from display) and THEN apply RFC 4180 quoting around it.
 * We do this even when no quoting is otherwise needed — a name like
 * `=A1` has no comma/quote/newline but would still pop on open.
 *
 * https://owasp.org/www-community/attacks/CSV_Injection
 */

const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

/** Escape a single cell value for inclusion in a CSV row. */
export function csvCell(v: string): string {
  const needsPrefix = DANGEROUS_LEAD.test(v);
  const body = needsPrefix ? `'${v}` : v;
  if (
    needsPrefix ||
    body.includes(',') ||
    body.includes('"') ||
    body.includes('\n') ||
    body.includes('\r')
  ) {
    return `"${body.replace(/"/g, '""')}"`;
  }
  return body;
}

/** Join cells with commas and rows with newlines. */
export function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * Build a Blob containing a fully-escaped CSV document and trigger a
 * browser download with the given filename. Returns nothing — the
 * side effect is the download prompt.
 *
 * Pure DOM. Returns immediately; the download happens off-thread.
 */
export function downloadCsv(filename: string, rows: string[][]): void {
  const lines = rows.map((r) => csvRow(r));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
