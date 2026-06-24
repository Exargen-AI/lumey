import { SprintStatus, TaskStatus, UserRole } from '@prisma/client';
import type {
  CurrentSprintResponse,
  CurrentSprintSnapshot,
  SprintPace,
} from '@exargen/shared';
import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';
import { canViewProjectInternal } from './rbac.service';

/**
 * Snapshot of the project's currently-active sprint, plus the stats the
 * client status page renders inline. Returns `{ sprint: null }` when no
 * sprint is ACTIVE — the card on the page self-hides on null.
 *
 * Resolution rules:
 *   - Only sprints with status === ACTIVE are considered.
 *   - If multiple are concurrently ACTIVE (rare), the one ending soonest
 *     wins (most relevant deadline to surface).
 *   - "Work progress" is computed over the sprint's **client-visible**
 *     tasks only for a regular client — internal tasks aren't their
 *     concern. A CLIENT member granted per-project full access
 *     (ProjectMember.fullAccess), and any internal staff role, get the
 *     progress computed over the FULL task set instead.
 *
 * Pace verdict (advisory only):
 *   on pace      → completionPct ≥ timeElapsedPct − 10
 *   behind       → completionPct ≥ timeElapsedPct − 25
 *   off pace     → otherwise
 *   too early    → timeElapsedPct < 20 (sprint just started; verdict is noise)
 */

const PACE_ON_TRACK_BUFFER = 10;   // % under time-elapsed and still "on pace"
const PACE_BEHIND_BUFFER = 25;     // % under and still "behind" rather than "off pace"
const PACE_TOO_EARLY_BELOW = 20;   // skip verdict while sprint is in first 20% of duration

export async function getCurrentSprint(
  projectId: string,
  viewer: { id?: string; role: UserRole },
): Promise<CurrentSprintResponse> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new NotFoundError('Project');

  // Per-project visibility: staff (role grant) and CLIENT members granted
  // full access (ProjectMember.fullAccess) see sprint progress over the FULL
  // task set; a regular client sees only client-visible tasks. Same gate the
  // board + milestones use, so the sprint numbers agree with the board.
  const canViewInternal = await canViewProjectInternal(viewer, projectId);

  // Find candidate active sprints. We pull all ACTIVE ones in case more
  // than one is concurrently active; client UI shows the one with the
  // nearest endDate.
  const actives = await prisma.sprint.findMany({
    where: { projectId, status: 'ACTIVE' as SprintStatus },
    orderBy: { endDate: 'asc' },
    select: {
      id: true,
      name: true,
      goal: true,
      startDate: true,
      endDate: true,
      tasks: {
        where: canViewInternal ? undefined : { clientVisible: true },
        select: { storyPoints: true, status: true },
      },
    },
  });

  if (actives.length === 0) return { sprint: null };
  const sprint = actives[0]; // earliest-ending active sprint

  const snapshot = computeSnapshot(sprint, new Date());
  return { sprint: snapshot };
}

/** Pure: given a sprint row + tasks + `now`, produce the snapshot. Exported
 *  for unit tests (we don't want time-dependent assertions hitting "Date.now()"). */
export function computeSnapshot(
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    startDate: Date;
    endDate: Date;
    tasks: Array<{ storyPoints: number | null; status: TaskStatus }>;
  },
  now: Date,
): CurrentSprintSnapshot {
  // ── Time progress ──
  const msPerDay = 24 * 60 * 60 * 1000;
  const totalDays = Math.max(
    1,
    Math.round((sprint.endDate.getTime() - sprint.startDate.getTime()) / msPerDay) + 1,
  );
  const rawElapsed = Math.floor((now.getTime() - sprint.startDate.getTime()) / msPerDay) + 1;
  const daysElapsed = Math.max(0, rawElapsed);
  const isOverdue = daysElapsed > totalDays;
  const timeElapsedPct = Math.min(100, Math.round((daysElapsed / totalDays) * 100));

  // ── Work progress (client-visible only) ──
  const tasksTotal = sprint.tasks.length;
  const tasksDone = sprint.tasks.filter((t) => t.status === ('DONE' as TaskStatus)).length;
  const pointsTotal = sprint.tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  const pointsDone = sprint.tasks
    .filter((t) => t.status === ('DONE' as TaskStatus))
    .reduce((n, t) => n + (t.storyPoints ?? 0), 0);

  // Prefer story-point completion as the headline number — fall back to
  // task-count completion when the sprint has zero scored work.
  const completionPct =
    pointsTotal > 0
      ? Math.round((pointsDone / pointsTotal) * 100)
      : tasksTotal > 0
        ? Math.round((tasksDone / tasksTotal) * 100)
        : 0;

  // ── Pace verdict ──
  let pace: SprintPace;
  if (timeElapsedPct < PACE_TOO_EARLY_BELOW) {
    pace = 'TOO_EARLY';
  } else if (completionPct >= timeElapsedPct - PACE_ON_TRACK_BUFFER) {
    pace = 'ON_PACE';
  } else if (completionPct >= timeElapsedPct - PACE_BEHIND_BUFFER) {
    pace = 'BEHIND';
  } else {
    pace = 'OFF_PACE';
  }

  return {
    sprintId: sprint.id,
    name: sprint.name,
    goal: sprint.goal,
    startDate: toISODate(sprint.startDate),
    endDate: toISODate(sprint.endDate),
    daysElapsed,
    totalDays,
    timeElapsedPct,
    isOverdue,
    tasksTotal,
    tasksDone,
    pointsTotal,
    pointsDone,
    completionPct,
    pace,
  };
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
