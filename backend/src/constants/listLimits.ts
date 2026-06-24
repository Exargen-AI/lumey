/**
 * Defensive result-set ceilings for list queries (2026-06-01 hardening).
 *
 * Background — the enterprise audit flagged a class of `findMany()` calls
 * that return a plain array with NO upper bound. Most are scoped to a
 * single project/user/task and stay small in practice, but the bound is
 * implicit: nothing in the code stops a single response from materialising
 * tens of thousands of rows (plus their `include`d relations) into memory
 * if the underlying table grows. That's a latent DoS / OOM surface.
 *
 * The fix is deliberately conservative: a hard `take:` ceiling set FAR
 * above any realistic legitimate result, applied to the array-returning
 * list endpoints. This:
 *   • preserves the response SHAPE (still a bare array — no FE changes),
 *   • never truncates a real-world response (the caps are 10–100× current
 *     realistic maxima),
 *   • caps worst-case memory so a runaway table or a hostile data-shape
 *     can't wedge the process.
 *
 * These are a safety NET, not real pagination. Endpoints that genuinely
 * need to page large sets (public CMS blog list) already do skip/take with
 * a total count — those are untouched. When an endpoint's natural size
 * actually approaches a cap here, that's the signal to give it real
 * cursor pagination rather than to bump the number.
 */

// General ceiling for admin/member list endpoints (projects, users,
// deliverables, epics, courses, …). An org with 1000 active projects or
// users is already well past the point where an unpaginated table view is
// the right UI — but the response won't silently drop rows below that.
export const LIST_QUERY_CAP = 1000;

// Comment threads on a single task/project. Ordered oldest-first, so the
// cap keeps the start of the thread; a thread exceeding 1000 comments is
// pathological and degraded display beats unbounded memory.
export const COMMENT_LIST_CAP = 1000;

// Public CMS taxonomy aggregation (tag/category/author cloud) scans
// published posts to build its facets. Public (API-key) endpoint, so the
// highest-exposure scan. We aggregate over the most-recent N posts, which
// is accurate for any realistic content volume while bounding the scan.
export const CMS_TAXONOMY_SCAN_CAP = 5000;
