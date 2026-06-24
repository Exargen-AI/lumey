/**
 * Minimal server-side HTML sanitization.
 *
 * We don't want a DOMPurify-on-the-server dependency for the only place we
 * need this (custom-field TEXT values), but we DO want belt-and-braces
 * coverage in case a downstream consumer (a CSV export, an email body, a
 * future widget) ever renders these strings as HTML without escaping.
 *
 * Round 2 finding R4: TEXT custom fields accepted `<script>alert(1)</script>`
 * and stored it verbatim. The React UI happens to render the value through
 * a text node so it's safe in-app today, but the trail of "stored as raw
 * HTML" is exactly the kind of latent footgun that bites the next person
 * who builds an export, an admin panel, or a Slack notifier.
 *
 * Strategy: strip every tag (open, close, self-closing, comment, CDATA),
 * neutralize `javascript:` / `data:` URI schemes that survived as bare
 * text, and collapse the result. The TEXT field is plain text by
 * definition (multiline at most — see `CustomFieldConfig.multiline`); no
 * legitimate value contains markup.
 */

// Strip tag-like sequences. Greedy `.*?` bounded by the next `>` so we don't
// span across HTML, and the `s` flag means newlines inside an attribute can't
// hide a closing bracket. We also kill `<!-- ... -->` comments and `<![CDATA[
// ... ]]>` blocks by treating them as tags.
const TAG_RE = /<\/?[a-zA-Z!?][^>]*>/gs;
// Opening fragments without a matching `>` (e.g. `<script` followed by EOF or
// a newline) — the regex above misses these, but they're still suspicious.
const PARTIAL_TAG_RE = /<[a-zA-Z!?][^<>]*$/g;
// `javascript:` / `data:` / `vbscript:` — case-insensitive, tolerate
// whitespace + tabs that browsers ignore when resolving URL schemes.
const JS_SCHEME_RE = /\b(?:j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t|d\s*a\s*t\s*a|v\s*b\s*s\s*c\s*r\s*i\s*p\s*t)\s*:/gi;

/**
 * Sanitize a plain-text value: strip HTML tags and obvious script-URI
 * payloads. Idempotent — running it twice yields the same result. Returns
 * the trimmed string. Pass `null`/`undefined` and you get back the input
 * unchanged (the caller's required-field guard runs separately).
 */
export function sanitizePlainText(value: string): string {
  if (typeof value !== 'string') return '';
  let out = value;

  // Decode the most common HTML entities once so an attacker can't sneak a
  // tag past us via `&lt;script&gt;`. We only decode the four basics — full
  // entity decoding belongs in a real HTML parser, and decoding everything
  // would risk turning innocent escapes (`&amp;`) into something else mid-
  // pipeline.
  out = out
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");

  // Repeatedly strip tags until stable. One pass isn't enough because
  // `<<script>script>` collapses to `<script>` after the first pass.
  let prev: string;
  do {
    prev = out;
    out = out.replace(TAG_RE, '');
    out = out.replace(PARTIAL_TAG_RE, '');
  } while (out !== prev);

  // Defang surviving script schemes. We don't reject — that would be too
  // strict for legitimate content like "see https://example.com about
  // javascript: protocol handlers" — we just neutralize the colon.
  out = out.replace(JS_SCHEME_RE, (match) => match.replace(/:/g, '∶'));

  return out.trim();
}
