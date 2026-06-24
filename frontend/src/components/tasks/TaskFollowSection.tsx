import { useState } from 'react';
import { Bell, BellOff, HandMetal } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  useTaskSubscribers,
  useSubscribeToTask,
  useUnsubscribeFromTask,
  useNudgeTask,
} from '@/hooks/useTaskSubscriptions';
import type { TaskSubscriber, TaskSubscriptionSource } from '@/api/tasks';

interface TaskFollowSectionProps {
  taskId: string;
  /** Current user's id, so we can show "subscribe" vs "unsubscribe". */
  currentUserId: string;
  /** Task's current assignee id; nudge is disabled if absent or self. */
  assigneeId: string | null;
}

/**
 * Per-task "follow + nudge" panel. Renders three things:
 *
 *   1. Subscribe / unsubscribe button reflecting the caller's
 *      current subscription state.
 *   2. Subscribers list with `source` badges (AUTO_ASSIGNEE,
 *      AUTO_REVIEWER, MANUAL, etc.) — quick read of who's
 *      watching this task and why.
 *   3. Nudge button — disabled if the task has no assignee, or
 *      the caller IS the assignee. 409 (cooldown) errors are
 *      surfaced inline so the user understands why a second nudge
 *      didn't go through.
 *
 * Designed to drop into TaskDetailModal as a compact section
 * without claiming too much vertical space — most days nobody
 * touches subscribe/nudge.
 */
export function TaskFollowSection({ taskId, currentUserId, assigneeId }: TaskFollowSectionProps) {
  const { data: subscribers, isLoading } = useTaskSubscribers(taskId);
  const subscribe = useSubscribeToTask();
  const unsubscribe = useUnsubscribeFromTask();
  const nudge = useNudgeTask();
  const [nudgeMessage, setNudgeMessage] = useState('');
  const [nudgeError, setNudgeError] = useState<string | null>(null);
  const [nudgeSent, setNudgeSent] = useState(false);
  const [showNudgeForm, setShowNudgeForm] = useState(false);

  const isSubscribed = !!subscribers?.some((s: TaskSubscriber) => s.userId === currentUserId);
  const canNudge = !!assigneeId && assigneeId !== currentUserId;

  const handleSubscribe = () => {
    if (isSubscribed) {
      unsubscribe.mutate(taskId);
    } else {
      subscribe.mutate(taskId);
    }
  };

  const handleNudge = async () => {
    setNudgeError(null);
    setNudgeSent(false);
    try {
      await nudge.mutateAsync({ taskId, message: nudgeMessage.trim() || undefined });
      setNudgeSent(true);
      setNudgeMessage('');
      setShowNudgeForm(false);
      // Auto-clear the "sent" pill after 4s so the UI doesn't get
      // stuck in a stale state.
      setTimeout(() => setNudgeSent(false), 4000);
    } catch (err: any) {
      // Backend cooldown 409 carries the message "try again in N
      // hours". Surface verbatim — it's actionable.
      const msg = err?.response?.data?.error?.message ?? 'Could not send nudge — try again.';
      setNudgeError(msg);
    }
  };

  return (
    <section
      className={cn(
        'rounded-lg border border-gray-200 dark:border-obsidian-border',
        'bg-gray-50/40 dark:bg-obsidian-sunken/40',
        'p-3 space-y-3',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-obsidian-muted">
          Following
        </h4>
        <button
          onClick={handleSubscribe}
          disabled={subscribe.isPending || unsubscribe.isPending}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
            isSubscribed
              ? 'bg-brand-100 text-brand-700 hover:bg-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:hover:bg-brand-500/25'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 dark:bg-obsidian-raised dark:text-obsidian-fg dark:border-obsidian-border dark:hover:bg-obsidian-panel',
          )}
          aria-pressed={isSubscribed}
        >
          {isSubscribed ? <Bell size={12} /> : <BellOff size={12} />}
          {isSubscribed ? 'Following' : 'Follow'}
        </button>
      </div>

      {/* Subscriber chip list. Hidden when empty so we don't show
          an awkward "0 followers" line in the common case. */}
      {!isLoading && subscribers && subscribers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {subscribers.map((sub: TaskSubscriber) => (
            <span
              key={sub.userId}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium',
                'bg-white border border-gray-200 text-gray-700',
                'dark:bg-obsidian-raised dark:border-obsidian-border dark:text-obsidian-fg',
              )}
              title={`Subscribed: ${sourceLabel(sub.source)}`}
            >
              <span>{sub.user.name}</span>
              <span className={cn(
                'inline-flex items-center px-1 rounded',
                'text-[9px] uppercase tracking-wide',
                'bg-gray-100 text-gray-500',
                'dark:bg-obsidian-panel dark:text-obsidian-muted',
              )}>
                {shortSourceLabel(sub.source)}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Nudge — separate concern; show only when nudgeable. */}
      {canNudge && (
        <div className="pt-2 border-t border-gray-100 dark:border-obsidian-border/60">
          {!showNudgeForm && !nudgeSent && (
            <button
              onClick={() => setShowNudgeForm(true)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors',
                'bg-amber-50 text-amber-700 hover:bg-amber-100',
                'dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20',
              )}
            >
              <HandMetal size={12} /> Nudge assignee
            </button>
          )}
          {nudgeSent && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
              👋 Nudge sent
            </p>
          )}
          {showNudgeForm && (
            <div className="space-y-2">
              <input
                type="text"
                value={nudgeMessage}
                onChange={(e) => setNudgeMessage(e.target.value.slice(0, 500))}
                placeholder="Optional message (e.g. 'client is waiting')"
                className={cn(
                  'w-full px-2 py-1 text-[12px] rounded border',
                  'bg-white border-gray-200 text-gray-900 placeholder-gray-400',
                  'dark:bg-obsidian-raised dark:border-obsidian-border dark:text-obsidian-fg dark:placeholder-obsidian-faded',
                )}
                maxLength={500}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setShowNudgeForm(false);
                    setNudgeMessage('');
                    setNudgeError(null);
                  }}
                  className="text-[11px] text-gray-500 hover:text-gray-700 dark:text-obsidian-muted dark:hover:text-obsidian-fg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNudge}
                  disabled={nudge.isPending}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium',
                    'bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50',
                  )}
                >
                  <HandMetal size={12} /> Send nudge
                </button>
              </div>
              {nudgeError && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">{nudgeError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Long-form label used in the chip's tooltip. */
function sourceLabel(source: TaskSubscriptionSource): string {
  switch (source) {
    case 'AUTO_ASSIGNEE':  return 'auto (assigned)';
    case 'AUTO_REVIEWER':  return 'auto (reviewer)';
    case 'AUTO_CREATOR':   return 'auto (created)';
    case 'AUTO_MENTIONED': return 'auto (mentioned)';
    case 'MANUAL':         return 'manual';
  }
}

/** Short pill label inside the chip. Title-tooltip carries the full
 *  meaning; this stays terse so a busy row doesn't get crowded. */
function shortSourceLabel(source: TaskSubscriptionSource): string {
  switch (source) {
    case 'AUTO_ASSIGNEE':  return 'assigned';
    case 'AUTO_REVIEWER':  return 'reviewer';
    case 'AUTO_CREATOR':   return 'creator';
    case 'AUTO_MENTIONED': return 'mention';
    case 'MANUAL':         return 'follows';
  }
}
