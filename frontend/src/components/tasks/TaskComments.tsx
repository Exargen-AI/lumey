import { useMemo, useState } from 'react';
import { Pencil, Send, TrendingUp } from 'lucide-react';
import type { StoryUpdateData } from '@exargen/shared';
import { useTaskComments, useCreateTaskComment, useUpdateTaskComment } from '@/hooks/useComments';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { formatRelative } from '@/lib/formatters';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { MarkdownView } from '@/components/editor/MarkdownView';
import { StoryUpdateForm } from './StoryUpdateForm';
import { StoryUpdateCard } from './StoryUpdateCard';

interface TaskCommentsProps {
  taskId: string;
  projectId?: string;
  /** Kept for backwards compatibility; mentions now load from /projects/:id/members. */
  members?: any[];
}

/**
 * Comment thread with rich-text composer. Authoring uses TipTap so users get
 * markdown shortcuts, slash commands, and live `@`-mention autocomplete from
 * the project members. Stored bodies are HTML and rendered via MarkdownView,
 * which sanitizes with DOMPurify before injection.
 *
 * Story updates (Ask 1, 2026-06): engineers post a structured progress update
 * via the template composer. Those render as distinct {@link StoryUpdateCard}s
 * — never plain bubbles — and the most recent one is pinned at the top so a
 * client sees current progress without scrolling the thread.
 *
 * Editing: the author of any comment (plain or story update) can edit it in
 * place. A story-update edit re-renders the card and re-notifies the client.
 */
export function TaskComments({ taskId, projectId }: TaskCommentsProps) {
  const { data: comments, isLoading } = useTaskComments(taskId);
  const createComment = useCreateTaskComment(taskId);
  const update = useUpdateTaskComment(taskId);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showStoryForm, setShowStoryForm] = useState(false);
  // The single comment currently being edited in place (plain or story).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const canCreateComment = usePermission('comment.create');
  // Clients receive story updates; engineers/PMs/admins author them.
  const canPostStoryUpdate = canCreateComment && user?.role !== 'CLIENT';

  // The editor emits HTML; "empty" is either a literal empty string or the
  // <p></p> shell TipTap produces for an empty paragraph.
  const isBlank = !content.replace(/<p>\s*<\/p>/g, '').trim();
  const editBlank = !editContent.replace(/<p>\s*<\/p>/g, '').trim();

  // Comments arrive createdAt-ASC, so the last story update is the newest.
  // It's lifted out of the thread and pinned at the top.
  const latestStory = useMemo(() => {
    const stories = (comments ?? []).filter(
      (c: any) => c.kind === 'story_update' && c.storyData,
    );
    return stories.length ? stories[stories.length - 1] : null;
  }, [comments]);

  const threadComments = useMemo(
    () => (comments ?? []).filter((c: any) => c.id !== latestStory?.id),
    [comments, latestStory],
  );

  const cancelEdit = () => {
    setEditingId(null);
    setEditError(null);
  };

  const handleSubmit = async () => {
    if (isBlank || !canCreateComment) return;
    setError(null);
    try {
      await createComment.mutateAsync({ content });
      setContent('');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not post comment. Try again?');
    }
  };

  const handlePostStory = async (data: StoryUpdateData) => {
    setError(null);
    try {
      await createComment.mutateAsync({ kind: 'story_update', storyData: data });
      setShowStoryForm(false);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not post update. Try again?');
    }
  };

  const startEditPlain = (c: any) => {
    setEditError(null);
    setEditContent(c.content || '');
    setEditingId(c.id);
  };

  const handleEditPlain = async (c: any) => {
    if (editBlank) return;
    setEditError(null);
    try {
      await update.mutateAsync({ id: c.id, content: editContent, expectedUpdatedAt: c.updatedAt });
      setEditingId(null);
    } catch (err: any) {
      setEditError(err?.response?.data?.error?.message || 'Could not save. Refresh and try again?');
    }
  };

  const handleEditStory = async (c: any, data: StoryUpdateData) => {
    setEditError(null);
    try {
      await update.mutateAsync({ id: c.id, storyData: data, expectedUpdatedAt: c.updatedAt });
      setEditingId(null);
    } catch (err: any) {
      setEditError(err?.response?.data?.error?.message || 'Could not save. Refresh and try again?');
    }
  };

  // Renders a story_update comment — as an edit form when it's being edited,
  // otherwise as a card with an author-only edit affordance.
  const renderStory = (c: any, pinned: boolean) =>
    editingId === c.id ? (
      <div key={c.id} className="space-y-2">
        <StoryUpdateForm
          initial={c.storyData}
          submitting={update.isPending}
          onSubmit={(d) => handleEditStory(c, d)}
          onCancel={cancelEdit}
        />
        {editError && <p className="text-[11px] text-rose-600 dark:text-rose-400">{editError}</p>}
      </div>
    ) : (
      <StoryUpdateCard
        key={c.id}
        data={c.storyData}
        authorName={c.author?.name}
        createdAt={c.createdAt}
        edited={!!c.editedAt}
        pinned={pinned}
        onEdit={c.authorId === user?.id ? () => { setEditError(null); setEditingId(c.id); } : undefined}
      />
    );

  return (
    <div>
      <h4 className="text-xs font-medium text-gray-500 dark:text-obsidian-muted uppercase tracking-wide mb-3">
        Comments {comments?.length ? `(${comments.length})` : ''}
      </h4>

      {/* Pinned latest progress update — kept out of the thread below so the
          client sees current status first, never buried. */}
      {latestStory && <div className="mb-4">{renderStory(latestStory, true)}</div>}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-obsidian-raised" />
              <div className="flex-1">
                <div className="h-3 bg-gray-200 dark:bg-obsidian-raised rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-200 dark:bg-obsidian-raised rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : threadComments.length ? (
        <div className="space-y-4 mb-4">
          {threadComments.map((comment: any) => {
            if (comment.kind === 'story_update' && comment.storyData) {
              return renderStory(comment, false);
            }

            const mine = comment.authorId === user?.id;

            if (editingId === comment.id) {
              return (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-xs font-semibold text-brand-600 dark:text-brand-300 shrink-0">
                    {comment.author?.name?.charAt(0) ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <RichTextEditor
                      value={editContent}
                      onChange={setEditContent}
                      liveUpdate
                      compact
                      projectId={projectId ?? null}
                      onSubmit={() => handleEditPlain(comment)}
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleEditPlain(comment)}
                        disabled={editBlank || update.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {update.isPending ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                    {editError && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400">{editError}</p>
                    )}
                  </div>
                </div>
              );
            }

            return (
              <div key={comment.id} className="group flex gap-3">
                <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-xs font-semibold text-brand-600 dark:text-brand-300 shrink-0">
                  {comment.author?.name?.charAt(0) ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">{comment.author?.name}</span>
                    <span className="text-xs text-gray-400 dark:text-obsidian-faded">
                      {formatRelative(comment.createdAt)}
                      {comment.editedAt ? ' · edited' : ''}
                    </span>
                    {mine && (
                      <button
                        onClick={() => startEditPlain(comment)}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-brand-600 dark:text-obsidian-faded dark:hover:text-brand-300 transition-all"
                        title="Edit your comment"
                      >
                        <Pencil size={11} /> Edit
                      </button>
                    )}
                  </div>
                  <div className="mt-0.5">
                    <MarkdownView content={comment.content || ''} compact />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : !latestStory ? (
        <p className="text-sm text-gray-400 dark:text-obsidian-faded mb-4">No comments yet.</p>
      ) : null}

      {/* Composer */}
      {showStoryForm ? (
        <StoryUpdateForm
          onSubmit={handlePostStory}
          onCancel={() => setShowStoryForm(false)}
          submitting={createComment.isPending}
        />
      ) : (
        <div className="relative">
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center text-xs font-semibold text-brand-600 dark:text-brand-300 shrink-0 mt-1">
              {user?.name?.charAt(0) ?? '?'}
            </div>
            <div className="flex-1">
              {canCreateComment ? (
                <div className="space-y-2">
                  <RichTextEditor
                    value={content}
                    onChange={setContent}
                    liveUpdate
                    compact
                    projectId={projectId ?? null}
                    placeholder="Write a comment… type / for commands or @ to mention."
                    onSubmit={handleSubmit}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">
                      Markdown shortcuts work · ⌘/Ctrl-Enter to send
                    </span>
                    <div className="flex items-center gap-2">
                      {canPostStoryUpdate && (
                        <button
                          onClick={() => setShowStoryForm(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-brand-200 dark:border-brand-500/30 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors"
                          title="Post a structured progress update the client will be notified about"
                        >
                          <TrendingUp size={12} />
                          Progress update
                        </button>
                      )}
                      <button
                        onClick={handleSubmit}
                        disabled={isBlank || createComment.isPending}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Send size={12} />
                        {createComment.isPending ? 'Sending…' : 'Comment'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[12.5px] italic text-gray-400 dark:text-obsidian-faded py-2">
                  You do not have permission to comment.
                </p>
              )}
            </div>
          </div>

          {error && (
            <p className="mt-2 ml-9 text-[11px] text-rose-600 dark:text-rose-400 leading-snug">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
