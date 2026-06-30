import api from './client';

export interface ActivityFeedComment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; role: string } | null;
}

export interface ActivityFeedTask {
  id: string;
  title: string;
  taskNumber: number;
  taskType: string;
  priority: string;
  storyPoints: number | null;
  project: { id: string; name: string; slug: string };
  /** ISO timestamp. For today + shipped sections: when it hit DONE.
   *  For inFocus: when it was last touched. */
  timestamp: string;
  /** Current status of the task. Relevant for inFocus where the
   *  section mixes IN_PROGRESS + IN_REVIEW. */
  status: string;
  actor: { id: string; name: string; role: string } | null;
  comments: ActivityFeedComment[];
}

export interface ActivityFeedGroup {
  project: { id: string; name: string; slug: string };
  tasks: ActivityFeedTask[];
}

/** A row from the activity log, hydrated for rendering.
 *  Covers every mutation the platform records (created_task,
 *  moved_task, created_comment, review_requested, …). The renderer
 *  uses `action` to pick the icon + label and reads optional fields
 *  off `details` (e.g. from/to status). */
export interface ActivityEvent {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string; role: string } | null;
  /** Immutable audit attribution: who performed the action when it happened. */
  actorType: 'HUMAN' | 'AGENT';
  project: { id: string; name: string; slug: string } | null;
  task: { id: string; title: string; taskNumber: number } | null;
  details: Record<string, unknown> | null;
}

export interface ActivityFeedResponse {
  date: string; // YYYY-MM-DD
  today: {
    /** Highlight: tasks that closed today. Rendered as a compact callout. */
    doneTasks: ActivityFeedGroup[];
    /** Full activity log for the day — every comment, status change,
     *  blocker, review request, sign-off, etc. Chronological, newest first. */
    events: ActivityEvent[];
  };
  thisWeek: {
    startDate: string;
    endDate: string;
    inFocus: ActivityFeedTask[];
    shippedGroups: ActivityFeedGroup[];
  };
}

export interface ActivityFeedParams {
  /** YYYY-MM-DD. Defaults to today (per `tz`). */
  date?: string;
  /** Restrict to tasks the current user transitioned themselves. Doesn't
   *  apply to the in-focus list (always team-wide). */
  mine?: boolean;
  /** Narrow to one project — used by the client portal. */
  projectId?: string;
}

/**
 * Fetch the combined "what's happening" feed:
 *   - today.groups: tasks closed today + comments
 *   - thisWeek.inFocus: currently active tasks (IN_PROGRESS, IN_REVIEW)
 *   - thisWeek.shippedGroups: tasks closed in the prior 6 days
 *
 * Visibility is computed server-side from the caller's role + project
 * memberships; clients see only client-visible tasks on their projects.
 *
 * The `tz` query is `Date.prototype.getTimezoneOffset()` (minutes WEST
 * of UTC) so the server can expand the focal date into a local-day
 * window without us computing UTC boundaries on this side.
 */
export async function getActivityFeed(params: ActivityFeedParams = {}): Promise<ActivityFeedResponse> {
  const tz = new Date().getTimezoneOffset();
  const query: Record<string, string> = { tz: String(tz) };
  if (params.date) query.date = params.date;
  if (params.mine) query.mine = 'true';
  if (params.projectId) query.projectId = params.projectId;
  const { data } = await api.get('/today', { params: query });
  return data.data;
}

// ─── Back-compat aliases ─────────────────────────────────────────────
// Some older imports referenced these. New code should use
// `ActivityFeedResponse` and `getActivityFeed`.
export type DoneTodayComment = ActivityFeedComment;
export type DoneTodayTask = ActivityFeedTask;
export type DoneTodayGroup = ActivityFeedGroup;
/** @deprecated use ActivityFeedResponse */
export type DoneTodayResponse = ActivityFeedResponse;
/** @deprecated use ActivityFeedParams */
export type DoneTodayParams = ActivityFeedParams;
/** @deprecated use getActivityFeed */
export const getDoneToday = getActivityFeed;
