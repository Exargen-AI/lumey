/**
 * "Current sprint snapshot" — the active sprint on a project, plus the
 * stats the client status page renders inline. Produced by
 * `currentSprint.service.ts`.
 *
 * One sprint per response (the active one). If multiple sprints are
 * somehow ACTIVE concurrently, the service picks the one ending soonest.
 * Returns null when no sprint is active (page hides the card).
 */

export type SprintPace =
  /** completion% ≥ timeElapsed% − 10 → on pace */
  | 'ON_PACE'
  /** completion% ≥ timeElapsed% − 25 → slipping but recoverable */
  | 'BEHIND'
  /** completion% < timeElapsed% − 25 → falling behind significantly */
  | 'OFF_PACE'
  /** Not enough signal to label (e.g. sprint just started) */
  | 'TOO_EARLY';

export interface CurrentSprintSnapshot {
  sprintId: string;
  name: string;
  goal: string | null;
  /** ISO YYYY-MM-DD start date. */
  startDate: string;
  /** ISO YYYY-MM-DD end date. */
  endDate: string;

  // ── Time progress ──
  /** Whole days elapsed since start. May exceed `totalDays` if overrunning. */
  daysElapsed: number;
  /** Whole calendar days in the sprint (endDate − startDate + 1). */
  totalDays: number;
  /** 0..100. Capped at 100 once the sprint runs past its end. */
  timeElapsedPct: number;
  /** True when daysElapsed > totalDays (sprint should have ended). */
  isOverdue: boolean;

  // ── Work progress (client-visible only) ──
  tasksTotal: number;
  tasksDone: number;
  pointsTotal: number;
  pointsDone: number;
  /** 0..100. completion of story points (preferred) or tasks if 0 points. */
  completionPct: number;

  // ── Pace verdict ──
  pace: SprintPace;
}

export interface CurrentSprintResponse {
  /** Null when no sprint is currently active on the project. */
  sprint: CurrentSprintSnapshot | null;
}
