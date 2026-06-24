/** Comment subtype. "plain" is an ordinary thread comment; "story_update"
 * is a structured progress update rendered from the client-facing story
 * template (see {@link StoryUpdateData}). */
export type CommentKind = 'plain' | 'story_update';

/** Whether the engineer flagged a design change in this update. */
export type DesignChange = 'none' | 'changed';

/**
 * The parsed fields of a story-update comment. Mirrors the client's
 * story template:
 *   [Story Objective] [Current Task] [Reason] [Impact]
 *   [Design Change?] [Progress %] [Next Step]
 *
 * `reason`, `impact` and `nextStep` are optional so an engineer can post
 * a quick "now at 60%" update without filling every box. When
 * `designChange === 'changed'`, `designOriginal`/`designNew` describe the
 * before/after.
 */
export interface StoryUpdateData {
  objective: string;
  currentTask: string;
  reason?: string;
  impact?: string;
  designChange: DesignChange;
  designOriginal?: string;
  designNew?: string;
  /** 0–100. */
  progress: number;
  nextStep?: string;
}

export interface Comment {
  id: string;
  projectId: string;
  taskId?: string | null;
  milestoneId?: string | null;
  authorId: string;
  content: string;
  /** Defaults to "plain" for every comment posted before 2026-06. */
  kind?: CommentKind;
  /** Present only when `kind === 'story_update'`. */
  storyData?: StoryUpdateData | null;
  author?: { id: string; name: string; role: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateCommentInput {
  /** Required for a plain comment; for a story update the server renders
   * `content` from `storyData`, so it may be omitted. */
  content?: string;
  taskId?: string;
  milestoneId?: string;
  kind?: CommentKind;
  storyData?: StoryUpdateData;
}
