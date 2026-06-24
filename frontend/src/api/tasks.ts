import api from './client';

export async function getTasks(projectId: string, params?: Record<string, string>) {
  const { data } = await api.get(`/projects/${projectId}/tasks`, { params });
  return data.data;
}

/**
 * Per-status counts for a project. Powers the kanban column-header pills
 * and the BoardPage status strip — needs to reflect totals across all
 * pages, not just the loaded ones. Cheap groupBy server-side.
 */
export async function getTaskCounts(
  projectId: string,
  params?: Record<string, string>,
): Promise<Record<string, number>> {
  const { data } = await api.get(`/projects/${projectId}/tasks/counts`, { params });
  return data.data;
}

/**
 * Flat id list for a single column — used by "Select all in column" so
 * bulk ops cover tasks that haven't been paged into the UI yet.
 */
export async function getTaskIds(
  projectId: string,
  params?: Record<string, string>,
): Promise<string[]> {
  const { data } = await api.get(`/projects/${projectId}/tasks/ids`, { params });
  return data.data;
}

export async function getTask(id: string) {
  const { data } = await api.get(`/tasks/${id}`);
  return data.data;
}

export async function createTask(projectId: string, input: any) {
  const { data } = await api.post(`/projects/${projectId}/tasks`, input);
  return data.data;
}

/**
 * Update a task. The optional `expectedUpdatedAt` precondition
 * (backend PR #128) is forwarded as part of `input` so the backend
 * service can refuse the write when the server has moved on since
 * the caller's last read.
 *
 * On a 409 Conflict the caller must surface a "task changed —
 * refresh and reapply" prompt to the user. The error body contains
 * the server's current `updatedAt` for diagnostics; callers can
 * choose to auto-refetch or prompt manually.
 */
export async function updateTask(id: string, input: any) {
  const { data } = await api.put(`/tasks/${id}`, input);
  return data.data;
}

export async function deleteTask(id: string) {
  const { data } = await api.delete(`/tasks/${id}`);
  return data.data;
}

export async function moveTask(id: string, status: string, sortOrder?: number, expectedUpdatedAt?: string) {
  const { data } = await api.patch(`/tasks/${id}/status`, { status, sortOrder, expectedUpdatedAt });
  return data.data;
}

// ─── Bulk ops ────────────────────────────────────────────────────────────
//
// Both endpoints return per-task results so we can show "21 succeeded, 2
// failed (Not a member)" rather than all-or-nothing.

export interface BulkResult {
  taskId: string;
  ok: boolean;
  error?: string;
}
export interface BulkResponse {
  results: BulkResult[];
  succeeded: number;
  failed: number;
}

export interface BulkChange {
  sprintId?: string | null;
  epicId?: string | null;
  assigneeId?: string | null;
  status?: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
  isBlocked?: boolean;
  blockerNote?: string | null;
}

/**
 * Server validator caps a single bulk request at 200 ids (per-request safety
 * net — keeps individual transactions bounded). Now that select-all-in-column
 * can pick up 500+ ids on busy backlogs, we chunk client-side and merge the
 * per-chunk `BulkResponse`s back into one. Chunks run sequentially so we can
 * stop early on a hard server error (network down, auth expired) rather than
 * fire-and-forget a thousand parallel requests.
 */
const BULK_CHUNK_SIZE = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function bulkRequest(
  taskIds: string[],
  send: (ids: string[]) => Promise<BulkResponse>,
): Promise<BulkResponse> {
  const merged: BulkResponse = { results: [], succeeded: 0, failed: 0 };
  for (const slice of chunk(taskIds, BULK_CHUNK_SIZE)) {
    const r = await send(slice);
    merged.results.push(...r.results);
    merged.succeeded += r.succeeded;
    merged.failed += r.failed;
  }
  return merged;
}

export async function bulkUpdateTasks(taskIds: string[], change: BulkChange): Promise<BulkResponse> {
  return bulkRequest(taskIds, async (ids) => {
    const { data } = await api.patch('/tasks/bulk', { taskIds: ids, change });
    return data.data as BulkResponse;
  });
}

export async function bulkDeleteTasks(taskIds: string[]): Promise<BulkResponse> {
  return bulkRequest(taskIds, async (ids) => {
    const { data } = await api.post('/tasks/bulk-delete', { taskIds: ids });
    return data.data as BulkResponse;
  });
}

export interface BulkDeletePreview {
  taskCount: number;
  comments: number;
  timeEntries: number;       // count of TimeEntry rows that get unlinked (NOT deleted — set to taskId=null)
  loggedHours: number;       // sum of hours on those rows
  externalLinks: number;     // linked GitHub PRs etc. — cascade-deleted
  taskLinks: number;         // task↔task references — cascade-deleted
  statusHistory: number;     // status-change rows — cascade-deleted
}

export async function previewBulkDeleteCascade(taskIds: string[]): Promise<BulkDeletePreview> {
  // Same per-request cap applies to the preview endpoint. Chunk + sum so the
  // dialog can show truthful cascade impact for a 1,000-task delete.
  const slices = chunk(taskIds, BULK_CHUNK_SIZE);
  const totals: BulkDeletePreview = {
    taskCount: 0, comments: 0, timeEntries: 0, loggedHours: 0,
    externalLinks: 0, taskLinks: 0, statusHistory: 0,
  };
  for (const slice of slices) {
    const { data } = await api.post('/tasks/bulk-delete/preview', { taskIds: slice });
    const p = data.data as BulkDeletePreview;
    totals.taskCount      += p.taskCount;
    totals.comments       += p.comments;
    totals.timeEntries    += p.timeEntries;
    totals.loggedHours    += p.loggedHours;
    totals.externalLinks  += p.externalLinks;
    totals.taskLinks      += p.taskLinks;
    totals.statusHistory  += p.statusHistory;
  }
  return totals;
}

export async function getMyTasks() {
  const { data } = await api.get('/my-tasks');
  return data.data;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export async function updateSubtasks(taskId: string, items: ChecklistItem[]) {
  const { data } = await api.patch(`/tasks/${taskId}/subtasks`, { subtasks: items });
  return data.data;
}

export async function updateAcceptanceCriteria(taskId: string, items: ChecklistItem[]) {
  const { data } = await api.patch(`/tasks/${taskId}/acceptance-criteria`, { acceptanceCriteria: items });
  return data.data;
}

// ─── Review workflow ────────────────────────────────────────────────
//
// requestReview hands the task off to a designated reviewer (may be
// any project member, including the client). The server forces the
// task to IN_REVIEW + creates a Comment from `note` if supplied.
//
// decideReview is row-level authorised: only the reviewer (or an
// admin) can call it. APPROVE → DONE, REQUEST_CHANGES → IN_PROGRESS.
// A comment is required when requesting changes.

export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES';

export async function requestReview(taskId: string, reviewerId: string, note?: string) {
  const { data } = await api.post(`/tasks/${taskId}/request-review`, { reviewerId, note });
  return data.data;
}

export async function decideReview(taskId: string, decision: ReviewDecision, comment?: string) {
  const { data } = await api.post(`/tasks/${taskId}/review-decision`, { decision, comment });
  return data.data;
}

// ─── Task subscriptions (backend PR #130) ───────────────────────────
//
// Users "follow" a task to receive notifications on new comments and
// significant edits. Auto-subscribed when assigned / reviewing /
// creating / @-mentioned; explicitly opt-in for everyone else via
// these endpoints.

export type TaskSubscriptionSource =
  | 'AUTO_ASSIGNEE'
  | 'AUTO_REVIEWER'
  | 'AUTO_CREATOR'
  | 'AUTO_MENTIONED'
  | 'MANUAL';

export interface TaskSubscriber {
  userId: string;
  source: TaskSubscriptionSource;
  createdAt: string;
  user: { id: string; name: string; role: string };
}

export async function subscribeToTask(taskId: string): Promise<void> {
  await api.post(`/tasks/${taskId}/subscribe`);
}

export async function unsubscribeFromTask(taskId: string): Promise<{ removed: number }> {
  const { data } = await api.delete(`/tasks/${taskId}/subscribe`);
  return data.data;
}

export async function listTaskSubscribers(taskId: string): Promise<TaskSubscriber[]> {
  const { data } = await api.get(`/tasks/${taskId}/subscribers`);
  return data.data;
}

// ─── Nudge (backend PR #130) ────────────────────────────────────────
//
// Politely poke the task's current assignee. Optional message
// (≤500 chars). Backend enforces a 24h cooldown per (task, sender);
// the FE should surface the cooldown error from the 409 response so
// the user understands why a second nudge isn't accepted.

export async function nudgeTask(taskId: string, message?: string): Promise<void> {
  await api.post(`/tasks/${taskId}/nudge`, message ? { message } : {});
}
