/**
 * Pure helpers for reading the acceptance-criteria state off a task.
 *
 * Extracted from UnifiedTaskCard.tsx so the logic that decides "is the
 * Done-gate going to block this drag?" is unit-tested independently from
 * the 600-line card component. The kanban card + the kanban toast + the
 * task detail modal + any future surface that wants to surface AC state
 * all go through this helper.
 *
 * Backend Task model stores AC as `Json` with shape `[{ text, done }]`.
 * This helper defensively tolerates missing / non-array / partial shapes
 * so a stale cache or older payload can't crash render code.
 */

export interface AcceptanceCriterionStatus {
  /** Total AC items on the task. 0 when none defined. */
  total: number;
  /** Items where `done === true`. */
  done: number;
  /** `total - done`. Convenience for the "N still unchecked" tooltip text. */
  remaining: number;
  /** True when there are AC AND all are checked. The "ready to ship" state. */
  allChecked: boolean;
  /**
   * True when the Done-gate would currently REJECT a move to Done — i.e.
   * the task has at least one unchecked AC and is in a status from which
   * the user is realistically about to drag to Done (IN_PROGRESS or
   * IN_REVIEW). This flag drives the amber tone on the card badge.
   */
  blocksDoneFromHere: boolean;
}

export function getAcceptanceCriterionStatus(
  task: { acceptanceCriteria?: unknown; status?: string } | null | undefined,
): AcceptanceCriterionStatus {
  if (!task) {
    return { total: 0, done: 0, remaining: 0, allChecked: false, blocksDoneFromHere: false };
  }
  const ac = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [];
  const total = ac.length;
  const done = ac.filter((c: any) => c && c.done === true).length;
  const remaining = total - done;
  const allChecked = total > 0 && remaining === 0;
  const adjacentToDone = task.status === 'IN_REVIEW' || task.status === 'IN_PROGRESS';
  return {
    total,
    done,
    remaining,
    allChecked,
    blocksDoneFromHere: total > 0 && remaining > 0 && adjacentToDone,
  };
}
