/**
 * "Shipped this week" — curated, top-N client-visible tasks completed
 * recently. Produced by `recentProgress.service.ts`, consumed by the
 * card on the client project status page.
 *
 * Ranking (descending priority order):
 *   1. storyPoints DESC          — bigger ships first
 *   2. taskPriority asc (P0,P1)  — same size? higher priority wins
 *   3. completedAt DESC          — newest tie-breaker
 *
 * The endpoint returns the top N (default 3) so clients see a curated
 * highlight reel rather than a full activity log.
 */

export interface RecentProgressItem {
  taskId: string;
  /** Task title — already trimmed by the parser at create-time. */
  title: string;
  /** ISO timestamp the task transitioned to DONE (from TaskStatusHistory). */
  completedAt: string;
  /** Story points at the moment of completion. May be null if unscored. */
  storyPoints: number | null;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  taskType: 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE';
}

export interface RecentProgressResponse {
  /** Top N items by rank (default 3). */
  items: RecentProgressItem[];
  /** Total client-visible tasks completed in the window — used for the
   *  "View all 12 →" footer link. */
  totalThisWindow: number;
  /** The window the response covers, in days. Echoed from the request
   *  query string (default 7). */
  windowDays: number;
}
