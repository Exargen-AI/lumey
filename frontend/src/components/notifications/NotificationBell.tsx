import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
} from '@/hooks/useNotifications';
import { cn } from '@/lib/cn';
import { Z } from '@/lib/zIndex';
import { formatRelative } from '@/lib/formatters';

const TYPE_ICONS: Record<string, string> = {
  task_assigned: '📋',
  blocker_alert: '🚨',
  milestone_due: '💎',
  eod_reminder: '⏰',
  leave_request: '✈️',
  leave_approved: '✅',
  leave_rejected: '❌',
  leave_revoked: '↩️',
  leave_cancelled: '🚫',
  // CC features added 2026-05-20 (PR #130) + visibility audits.
  mention: '@',
  task_deleted: '🗑️',
  task_priority_changed: '⚡',
  task_due_date_changed: '📅',
  task_carried_over: '➡️',
  task_comment_subscriber: '💬',
  task_edit_subscriber: '✏️',
  task_nudge: '👋',
  task_completion_encouragement: '🎉',
  sprint_started: '🏃',
  sprint_completed: '🏁',
  milestone_completed: '🎯',
  milestone_deleted: '🗑️',
  project_deleted: '🗑️',
  project_member_added: '➕',
  project_member_removed: '➖',
  project_role_changed: '👥',
  tasks_orphaned: '⚠️',
  timesheet_submitted: '📝',
  timesheet_approved: '✅',
  timesheet_rejected: '❗',
  comment_deleted: '🗑️',
  // Engineer posted a structured progress update against a client task.
  story_update: '📊',
};

/**
 * Notification bell + dropdown.
 *
 * Bug history fixed in this rewrite:
 *
 *  - Dark-mode bleed-through: every surface, divider, and text colour was
 *    light-mode-only (`bg-white`, `text-gray-*`, `border-gray-*`). On a dark
 *    dashboard the panel looked like it was overlapping/transparent because
 *    the white panel sat over dark cards with no contrast contract. Every
 *    class now has a `dark:` pair using the `obsidian-*` palette the rest of
 *    the app uses.
 *
 *  - Hardcoded anchor (`top-12`): broke if the topbar height changed.
 *    Replaced with `top-full mt-2` which always sits below the trigger.
 *
 *  - Fixed `w-96` width: overflowed off-screen on mobile. Now
 *    `w-[22rem] max-w-[calc(100vw-1.5rem)]` — desktop unchanged, mobile
 *    fits within the viewport with margins.
 *
 *  - Static `max-h-96` (384px) regardless of viewport: tall-feed users on
 *    short screens couldn't scroll. Now `max-h-[min(28rem,70vh)]`.
 *
 *  - z-index drift: hardcoded `z-50` matched the modal layer, so an open
 *    notification panel could obscure / be obscured-by a modal. Centralised
 *    in `Z.popover` (45) below the modal layer (50).
 *
 *  - Missing keyboard dismiss (Escape) and outside-scroll dismiss.
 *
 * Anchor / portal note: this is still rendered in-flow (relative parent on
 * the bell itself) rather than via React Portal. That's intentional —
 * portals would solve overflow:hidden ancestor clipping but introduce focus
 * management complexity, and no current ancestor of the topbar uses
 * overflow:hidden. If a future refactor adds one, switch to a portal.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  const { data: unreadData } = useUnreadCount();
  const { data: notifData } = useNotifications({ limit: 15 });
  const markRead = useMarkAsRead();
  const markAllRead = useMarkAllAsRead();
  // CC feature 2026-05-20 (backend PR #125) — delete-notification
  // closes the inbox-graveyard gap. Each row now has a small X.
  const deleteNotif = useDeleteNotification();

  const unreadCount = unreadData?.count ?? 0;
  const notifications = notifData?.notifications ?? [];

  // Click-outside dismiss. Uses `mousedown` so the click that triggers the
  // close lands BEFORE the underlying element's click handler — feels
  // snappier than `click`.
  //
  // Note: the panel itself is rendered via React Portal into document.body
  // (see render below), so `wrapperRef.contains(target)` would falsely
  // report "outside" even when the user clicks INSIDE the panel. We test
  // both refs — wrapper (the bell button area) and panelRef (the portaled
  // panel) — and dismiss only if the click lands outside both.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inWrapper = wrapperRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      if (!inWrapper && !inPanel) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Keyboard dismiss. Returns focus to the trigger so the user lands back
  // at the bell, not at <body>. Accessibility win + a11y baseline.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  const handleNotificationClick = (notif: any) => {
    if (!notif.read) markRead.mutate(notif.id);
    if (notif.link) {
      navigate(notif.link);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          'relative w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors',
          'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
          'dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ''}`}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full',
              'bg-rose-500 text-white text-[10px] font-bold',
              'flex items-center justify-center',
              'ring-2 ring-white dark:ring-obsidian-bg', // separates badge from button background
              'animate-pulse',
            )}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Notifications"
          // Positioning: `fixed` + viewport-anchored. Width caps to
          // `calc(100vw - 1.5rem)` so even on iPhone SE-narrow viewports
          // the panel sits inside the visible area with 12px margins.
          //
          // Portal: the panel is rendered into document.body via
          // createPortal. Why: the TopBar uses `backdrop-blur-xl` which
          // creates a CSS stacking context, trapping any descendant's
          // z-index inside that context. With the panel rendered in-flow
          // inside TopBar, z=45 only competed within TopBar — the
          // sidebar (z=30, in document root) was rendering ABOVE the
          // panel at the overlap zone on narrow viewports. Portaling to
          // body puts the panel in the document root stacking context
          // alongside the sidebar, where z=45 actually beats z=30.
          //
          // This also fixes the parallel risk of any future dashboard
          // card that uses `transform`, `filter`, or `will-change`
          // creating its own stacking context — those would have clipped
          // or trapped the in-flow panel too.
          //
          // Solid surface on both themes — no transparency that could
          // make it look like the panel is bleeding into the page.
          className={cn(
            'fixed top-14 right-3',
            'w-[22rem] max-w-[calc(100vw-1.5rem)]',
            'rounded-xl overflow-hidden',
            'bg-white border border-gray-200 shadow-xl',
            'dark:bg-obsidian-panel dark:border-obsidian-border dark:shadow-pop-dark',
            'animate-fade-in',
          )}
          style={{ zIndex: Z.popover }}
        >
          {/* Header */}
          <div className={cn(
            'flex items-center justify-between px-4 py-3',
            'border-b border-gray-100 dark:border-obsidian-border/70',
            'bg-gray-50/50 dark:bg-obsidian-sunken/50',
          )}>
            <h3 className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-medium transition-colors',
                  'text-brand-600 hover:text-brand-700',
                  'dark:text-brand-400 dark:hover:text-brand-300',
                )}
              >
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>

          {/* List — viewport-relative max height so short displays still scroll */}
          <div className="overflow-y-auto" style={{ maxHeight: 'min(28rem, 70vh)' }}>
            {notifications.length === 0 ? (
              <div className="py-12 text-center px-4">
                <Bell size={26} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-2" />
                <p className="text-[13px] text-gray-500 dark:text-obsidian-muted font-medium">All caught up</p>
                <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-1">
                  Notifications about tasks, leave, and approvals will land here.
                </p>
              </div>
            ) : (
              notifications.map((notif: any) => (
                // Row is a flex container — clickable button on the left,
                // delete X on the right. Previously the entire row was a
                // single <button>, which made nesting the delete control
                // an a11y problem (buttons-inside-buttons). Switched to a
                // wrapper <div> with two interactive children.
                <div
                  key={notif.id}
                  className={cn(
                    'w-full flex gap-3 items-start group',
                    'border-b border-gray-50 last:border-b-0',
                    'dark:border-obsidian-border/40',
                    'transition-colors',
                    'hover:bg-gray-50 dark:hover:bg-obsidian-raised/60',
                    !notif.read && 'bg-brand-50/60 dark:bg-brand-500/[0.08]',
                  )}
                >
                  <button
                    onClick={() => handleNotificationClick(notif)}
                    className="flex-1 text-left px-4 py-3 flex gap-3 items-start min-w-0"
                  >
                    <span className="text-base shrink-0 mt-0.5 leading-none" aria-hidden>
                      {TYPE_ICONS[notif.type] || '🔔'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          'text-[13px] leading-snug truncate',
                          !notif.read
                            ? 'font-semibold text-gray-900 dark:text-obsidian-fg'
                            : 'text-gray-700 dark:text-obsidian-muted',
                        )}>
                          {notif.title}
                        </p>
                        {!notif.read && (
                          <span
                            className="w-1.5 h-1.5 bg-brand-500 dark:bg-brand-400 rounded-full shrink-0 mt-1.5"
                            aria-label="Unread"
                          />
                        )}
                      </div>
                      {notif.body && (
                        <p className="text-[12px] text-gray-500 dark:text-obsidian-muted/90 mt-0.5 line-clamp-2">
                          {notif.body}
                        </p>
                      )}
                      <p className="text-[10px] text-gray-400 dark:text-obsidian-faded mt-1 tabular-nums">
                        {formatRelative(notif.createdAt)}
                      </p>
                    </div>
                  </button>
                  {/* Delete (CC feature 2026-05-20, backend #125).
                      Only revealed on hover/focus to keep the row clean
                      at rest. `group-hover` + `focus-within` together
                      cover mouse + keyboard navigation. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // don't trigger row click
                      deleteNotif.mutate(notif.id);
                    }}
                    className={cn(
                      'self-stretch px-2.5 flex items-center justify-center',
                      'opacity-0 group-hover:opacity-100 focus:opacity-100',
                      'text-gray-400 hover:text-rose-500',
                      'dark:text-obsidian-faded dark:hover:text-rose-400',
                      'transition-opacity',
                    )}
                    aria-label="Delete notification"
                    title="Delete"
                    disabled={deleteNotif.isPending}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
