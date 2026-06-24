/**
 * The canonical list of notification types the platform fires, plus
 * UI-friendly metadata for the preferences page.
 *
 * Why this lives here (not in Prisma):
 *
 *   New notification types ship in nearly every feature PR. Encoding
 *   them as a Prisma enum would require a schema migration per type,
 *   which is too much ceremony for a string the FE consumes verbatim.
 *   Instead we declare them as a TS const array — the validator
 *   refuses unknown types at the route boundary (so a typo can't
 *   silently persist in `notification_preferences.type`) and the FE
 *   imports the same source via the shared package.
 *
 *   When you add a new notification type:
 *     1. Append it here with a label + category.
 *     2. Pick a category from the existing set, or add a new one to
 *        NOTIFICATION_CATEGORIES below.
 *     3. The Profile preferences page will auto-render the new toggle
 *        on next deploy — no FE code change needed.
 *
 * Default-on policy:
 *
 *   Every type defaults to UNMUTED. Users explicitly opt out of
 *   anything they don't want. New types are unmuted-by-default
 *   because we WANT users to find out about new features; they can
 *   mute later if they don't care.
 */

export const NOTIFICATION_CATEGORIES = {
  task_lifecycle: { label: 'Task lifecycle', description: 'Assignments, priority + due-date changes, deletions, carry-overs.' },
  reviews: { label: 'Reviews', description: 'Review requests + decisions on your tasks.' },
  comments_and_mentions: { label: 'Comments + @-mentions', description: 'New comments on tasks you follow, and @-mentions of you anywhere.' },
  encouragement: { label: 'Encouragement + nudges', description: 'Friendly bumps from teammates + completion encouragement.' },
  blockers: { label: 'Blockers', description: 'Tasks that have been flagged as blocked.' },
  project_membership: { label: 'Project membership', description: 'Adds, removes, role changes, project deletions.' },
  milestones: { label: 'Milestones', description: 'Completion, deletion, and upcoming due-dates.' },
  sprints: { label: 'Sprints', description: 'Sprint start, completion, and carried-over tasks.' },
  timesheets: { label: 'Timesheets', description: 'Submissions awaiting your approval, approvals + rejections of yours.' },
  leads: { label: 'Leads', description: 'New form submissions ingested from external websites.' },
} as const;

export type NotificationCategory = keyof typeof NOTIFICATION_CATEGORIES;

interface NotificationTypeMeta {
  type: string;
  label: string;
  description: string;
  category: NotificationCategory;
}

/**
 * Every notification type the platform fires, in stable display order.
 * Strings MUST match the `type` field used in
 * `notification.service.ts` — the validator cross-checks them.
 */
export const NOTIFICATION_TYPES: readonly NotificationTypeMeta[] = [
  // ── Task lifecycle ────────────────────────────────────────────────
  { type: 'task_assigned', label: 'Task assigned to me', description: 'When someone assigns a task to you.', category: 'task_lifecycle' },
  { type: 'task_priority_changed', label: 'Task priority changed', description: 'When the priority on a task you follow changes.', category: 'task_lifecycle' },
  { type: 'task_due_date_changed', label: 'Task due-date changed', description: 'When the due date on a task you follow changes.', category: 'task_lifecycle' },
  { type: 'task_deleted', label: 'Task deleted', description: 'When a task you were involved in is deleted.', category: 'task_lifecycle' },
  { type: 'task_carried_over', label: 'Task carried over', description: 'When a task you own moves to the next sprint.', category: 'task_lifecycle' },
  { type: 'tasks_orphaned', label: 'Tasks orphaned (PM heads-up)', description: 'When someone leaves the project and their tasks need re-assignment.', category: 'task_lifecycle' },

  // ── Reviews ──────────────────────────────────────────────────────
  { type: 'review_requested', label: 'Review requested', description: 'Someone asked you to review their task.', category: 'reviews' },
  { type: 'review_approved', label: 'Review approved', description: 'Your reviewer approved your work.', category: 'reviews' },
  { type: 'review_changes_requested', label: 'Review changes requested', description: 'Your reviewer requested changes on your task.', category: 'reviews' },

  // ── Comments + @-mentions ────────────────────────────────────────
  { type: 'task_comment_subscriber', label: 'Comments on tasks I follow', description: 'New comments on tasks you subscribe to.', category: 'comments_and_mentions' },
  { type: 'task_edit_subscriber', label: 'Edits on tasks I follow', description: 'Significant edits (status, priority, due-date, etc.) on tasks you subscribe to.', category: 'comments_and_mentions' },

  // ── Encouragement + nudges ───────────────────────────────────────
  { type: 'task_nudge', label: 'Nudges from teammates', description: 'When a teammate sends you a friendly bump on a task.', category: 'encouragement' },
  { type: 'task_completion_encouragement', label: 'Completion encouragement', description: 'Celebratory ping when you finish a task — extra fanfare on streaks.', category: 'encouragement' },

  // ── Blockers ─────────────────────────────────────────────────────
  { type: 'blocker_alert', label: 'Blocker flagged', description: 'When a task you care about gets flagged as blocked.', category: 'blockers' },

  // ── Project membership ───────────────────────────────────────────
  { type: 'project_member_added', label: 'Added to a project', description: 'When you are added to a project.', category: 'project_membership' },
  { type: 'project_member_removed', label: 'Removed from a project', description: 'When you are removed from a project.', category: 'project_membership' },
  { type: 'project_role_changed', label: 'Project role changed', description: 'When your role on a project changes.', category: 'project_membership' },
  { type: 'project_deleted', label: 'Project deleted', description: 'When a project you were on gets deleted.', category: 'project_membership' },

  // ── Milestones ───────────────────────────────────────────────────
  { type: 'milestone_completed', label: 'Milestone completed', description: 'When a milestone you care about is marked complete.', category: 'milestones' },
  { type: 'milestone_deleted', label: 'Milestone deleted', description: 'When a milestone you care about is deleted.', category: 'milestones' },
  { type: 'milestone_due', label: 'Milestone due soon', description: 'Reminders for upcoming milestone deadlines.', category: 'milestones' },

  // ── Sprints ──────────────────────────────────────────────────────
  { type: 'sprint_started', label: 'Sprint started', description: 'When a sprint kicks off in your project.', category: 'sprints' },
  { type: 'sprint_completed', label: 'Sprint completed', description: 'When a sprint wraps up in your project.', category: 'sprints' },

  // ── Timesheets ───────────────────────────────────────────────────
  { type: 'timesheet_submitted', label: 'Timesheet submitted (for approvers)', description: 'When an engineer on your team submits their week for approval.', category: 'timesheets' },
  { type: 'timesheet_approved', label: 'My timesheet approved', description: 'When your manager approves your week.', category: 'timesheets' },
  { type: 'timesheet_rejected', label: 'My timesheet rejected', description: 'When your manager rejects your week with feedback.', category: 'timesheets' },

  // ── Leads ────────────────────────────────────────────────────────
  { type: 'lead_ingested', label: 'New lead submitted', description: 'When a website form submission lands as a new lead in one of your projects.', category: 'leads' },
];

export const KNOWN_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(
  NOTIFICATION_TYPES.map((t) => t.type),
);

export function isKnownNotificationType(t: string): boolean {
  return KNOWN_NOTIFICATION_TYPES.has(t);
}
