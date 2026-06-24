import { useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, UserCircle, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface MoreSheetItem {
  label: string;
  path: string;
  /** Lucide icon component. Typed `any` because lucide-react's icon type
   *  (ForwardRefExoticComponent<LucideProps>) is narrower than a plain
   *  ComponentType<{size, className}> — assigning a lucide icon to the
   *  narrow shape fails strict TS even though the runtime contract is
   *  the same. Mirrors the pattern the admin Sidebar uses. */
  Icon: React.ComponentType<any>;
  /** Optional badge / sub-label rendered to the right (e.g. "Soon"). */
  badge?: string;
  /** Optional grouping caption rendered above the item (only on first
   *  occurrence within a group). */
  group?: string;
}

interface MobileMoreSheetProps {
  open: boolean;
  onClose: () => void;
  /** Section title (e.g. "More" or "All sections"). */
  title?: string;
  /** Item list to render. Order is preserved. */
  items: MoreSheetItem[];
  /** Hide the Account + Sign out footer (used by sheets that already
   *  surface account chrome elsewhere). */
  hideAccountFooter?: boolean;
}

/**
 * Bottom-sheet overlay for the mobile navbar's "More" tab.
 *
 * Slides up from below, dims the page underneath, lists every nav
 * target that didn't make the bottom-nav primary slots. Footer carries
 * the universal Account + Sign-out affordances so the user never has
 * to dig — same contract as the desktop sidebar's user block.
 *
 * Why a bespoke sheet vs reusing <Modal>: the centred-modal primitive
 * adds a backdrop padding + max-width that fights the "full-bleed,
 * thumb-reachable" mobile pattern. The sheet is portal-light (uses
 * fixed-position siblings, not React portals) — keeps the focus +
 * accessibility story in the same React tree as the trigger.
 */
export function MobileMoreSheet({ open, onClose, title = 'More', items, hideAccountFooter }: MobileMoreSheetProps) {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();
  const confirm = useConfirm();

  // Lock body scroll while the sheet is up so swipe gestures inside
  // the sheet don't bleed into a page scroll.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Esc to close — touch-screen users can use the X / backdrop, but
  // someone testing in a desktop browser benefits from the shortcut.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      body: 'You will need to sign in again to access the Command Center.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
      tone: 'brand',
    });
    if (ok) {
      onClose();
      clearAuth();
      navigate('/login');
    }
  };

  if (!open) return null;

  // Group items in render order. We don't sort — the caller already
  // ordered them deliberately. The `group` field starts a new caption
  // when it changes (and only when it's non-empty).
  let lastGroup: string | undefined;

  return (
    <div
      className="fixed inset-0 z-[60] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-gray-900/50 dark:bg-black/60 backdrop-blur-[2px] animate-fade-in"
      />

      {/* Sheet */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0',
          'bg-white dark:bg-obsidian-panel',
          'border-t border-gray-200 dark:border-obsidian-border',
          'rounded-t-2xl shadow-pop dark:shadow-pop-dark',
          'flex flex-col max-h-[85vh]',
          // Safe-area padding so the bottom of the sheet clears the
          // iPhone home indicator.
          'pb-[env(safe-area-inset-bottom)]',
        )}
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {/* Grabber */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <span className="w-10 h-1 rounded-full bg-gray-200 dark:bg-obsidian-border" aria-hidden />
        </div>

        {/* Header */}
        <div className="px-5 pt-2 pb-3 flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-raised transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Items */}
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {items.map((item) => {
            const showGroup = item.group && item.group !== lastGroup;
            lastGroup = item.group ?? lastGroup;
            return (
              <div key={`${item.path}-${item.label}`}>
                {showGroup && (
                  <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-400 dark:text-obsidian-faded">
                    {item.group}
                  </p>
                )}
                <NavLink
                  to={item.path}
                  end={item.path === '/' || item.path.endsWith('dashboard')}
                  onClick={onClose}
                  className={({ isActive }) => cn(
                    'flex items-center gap-3 px-3 h-12 rounded-md text-[14px] font-medium transition-colors',
                    'min-h-[44px]',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-obsidian-fg dark:hover:bg-obsidian-raised',
                  )}
                >
                  <item.Icon size={18} className="shrink-0" />
                  <span className="truncate flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider rounded bg-gray-100 dark:bg-obsidian-raised text-gray-500 dark:text-obsidian-muted px-1.5 py-0.5 shrink-0">
                      {item.badge}
                    </span>
                  )}
                </NavLink>
              </div>
            );
          })}
        </nav>

        {/* Account + Sign out footer — mirrors the desktop sidebar's
            user block so the user never wonders where Account went. */}
        {!hideAccountFooter && user && (
          <div className="shrink-0 border-t border-gray-100 dark:border-obsidian-border px-2 py-2 space-y-1">
            <NavLink
              to="/account"
              onClick={onClose}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 h-12 rounded-md text-[14px] font-medium transition-colors',
                'min-h-[44px]',
                isActive
                  ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-obsidian-fg dark:hover:bg-obsidian-raised',
              )}
            >
              <UserCircle size={18} className="shrink-0" />
              <span className="truncate flex-1">
                Account
                <span className="block text-[11px] font-normal text-gray-500 dark:text-obsidian-muted truncate">
                  {user.name}
                </span>
              </span>
            </NavLink>
            <button
              type="button"
              onClick={handleLogout}
              className={cn(
                'w-full flex items-center gap-3 px-3 h-12 rounded-md text-[14px] font-medium transition-colors min-h-[44px]',
                'text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10',
              )}
            >
              <LogOut size={18} className="shrink-0" />
              Sign out
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
