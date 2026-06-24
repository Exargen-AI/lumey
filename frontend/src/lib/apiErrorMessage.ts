/**
 * Pure extractor that turns a thrown / rejected value (axios error, plain
 * Error, or anything else) into a single user-facing string.
 *
 * Lives apart from any specific feature so the same shape can be reused
 * wherever a mutation's `onError` needs to surface a server reason to the
 * UI. Critical assumption: the backend's error contract is
 *
 *     { success: false, error: { code: '…', message: '…' } }
 *
 * (see backend/src/middleware/errorHandler — the response body shape every
 * service throws through). Axios wraps that under `response.data`.
 *
 * Order of preference:
 *   1. The backend's `error.message` (what the user actually needs)
 *   2. The Error's own `message` (network failure, "Network Error" etc.)
 *   3. The caller-supplied fallback
 *
 * The extractor is pure — no side effects, no React, no DOM. Trivial to
 * unit-test, and that pinning is exactly what catches regressions like
 * "kanban silently rolls back" (PR #147): the extractor's contract is
 * what every surface relies on; if it drifts, every consumer drifts.
 */
export function extractApiErrorMessage(
  err: unknown,
  fallback = 'Something went wrong.',
): string {
  if (err == null) return fallback;

  // Axios error shape — the common case when a server rejection lands in
  // an `onError` callback or a `mutateAsync` rejection.
  const fromAxiosResponse = (err as any)?.response?.data?.error?.message;
  if (typeof fromAxiosResponse === 'string' && fromAxiosResponse.length > 0) {
    return fromAxiosResponse;
  }

  // Some legacy endpoints (and some FE thrown errors) put the message
  // one level shallower. Tolerate it so we don't regress to the
  // fallback in those cases.
  const fromAxiosData = (err as any)?.response?.data?.message;
  if (typeof fromAxiosData === 'string' && fromAxiosData.length > 0) {
    return fromAxiosData;
  }

  // Plain Error / network-level failure.
  if (err instanceof Error && err.message) return err.message;

  // Anything with a string-like `.message` (e.g. plain object thrown via
  // `throw { message: '…' }`). Defensive — should be rare.
  const m = (err as any)?.message;
  if (typeof m === 'string' && m.length > 0) return m;

  return fallback;
}
