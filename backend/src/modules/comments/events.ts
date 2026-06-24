/**
 * Domain events owned by the comments module — its public contract on the bus.
 * Other modules may subscribe to these (the notifications module does); they
 * may NOT import the comment service's internals. Importing this event type is
 * the sanctioned coupling.
 */
import type { DomainEvent } from '../../kernel';

/**
 * Fact: a comment was created. Published for every comment (task, milestone, or
 * project level); subscribers decide relevance. Carries the small set of
 * denormalised fields a consumer needs without a re-query — including
 * `mentionedUserIds`, so a fan-out can dedupe against users already pinged by
 * the inline mention notification.
 */
export interface CommentCreatedEvent extends DomainEvent {
  readonly type: 'comment.created';
  readonly commentId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly taskId: string | null;
  readonly milestoneId: string | null;
  readonly authorId: string;
  readonly authorName: string;
  /** First ~100 chars of the comment body, for notification text. */
  readonly contentSnippet: string;
  /** Users @-mentioned in this comment (already notified inline). */
  readonly mentionedUserIds: string[];
}
