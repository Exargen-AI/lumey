/**
 * Definition of Ready for AGENT pickup.
 *
 * A work item an autonomous agent can act on must be a *contract*: it has to
 * declare a checkable "done". Without at least one acceptance criterion the
 * agent has nothing to verify its work against — it would grind on an
 * under-specified task and either give up or, worse, declare success it can't
 * prove. That's a poison task; the readiness gate keeps the agent task-picker
 * from ever handing one out.
 *
 * Humans are unaffected — they have the full kanban UI and their own judgement.
 * This gate is specifically the entry contract for agent execution.
 */

interface AcceptanceCriterion {
  text: string;
}

/**
 * Coerce the `Task.acceptanceCriteria` Json column (untyped at the DB layer)
 * into criteria we can reason about. Anything that isn't an array of objects
 * with a string `text` is treated as "no criteria" rather than throwing — a
 * malformed value must fail closed (not ready), never crash the picker.
 */
function parseCriteria(raw: unknown): AcceptanceCriterion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) =>
    c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
      ? [{ text: (c as { text: string }).text }]
      : [],
  );
}

export interface AgentReadiness {
  readonly ready: boolean;
  /** Human-readable cause when not ready; `null` when ready. */
  readonly reason: string | null;
}

/**
 * Evaluate whether a task is ready for an agent to pick up. The contract today
 * is a single rule — at least one acceptance criterion with non-empty text —
 * and is intentionally small so it's easy to reason about; repo-linkage and
 * scope checks layer on as run-start guards (M2) without changing this gate.
 */
export function evaluateAgentReadiness(task: { acceptanceCriteria: unknown }): AgentReadiness {
  const hasCheckableCriterion = parseCriteria(task.acceptanceCriteria).some(
    (c) => c.text.trim().length > 0,
  );
  return hasCheckableCriterion
    ? { ready: true, reason: null }
    : { ready: false, reason: 'no acceptance criteria — task has no checkable definition of done' };
}
