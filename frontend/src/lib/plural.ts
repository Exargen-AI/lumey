/**
 * Tiny pluralization helper. We do this everywhere as ad-hoc ternaries which
 * gradually drift out of sync ("1 tasks", "0 task"). Centralize the rule.
 *
 * Usage:
 *   pluralize(1, 'task')                  → '1 task'
 *   pluralize(0, 'task')                  → '0 tasks'
 *   pluralize(2, 'task')                  → '2 tasks'
 *   pluralize(1, 'epic')                  → '1 epic'
 *   pluralize(3, 'sprint')                → '3 sprints'
 *   pluralize(1, 'story', 'stories')      → '1 story'
 *   pluralize(2, 'story', 'stories')      → '2 stories'
 *   pluralize(5, 'point', undefined, true) → '5 pts'  (compact form, manual plural)
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  const word = count === 1 ? singular : plural ?? `${singular}s`;
  return `${count} ${word}`;
}

/** Just the word, without the count — useful inside richer phrases. */
export function pluralWord(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}
