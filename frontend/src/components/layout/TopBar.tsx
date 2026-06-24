import { useState, useRef, useEffect } from 'react';
import { Moon, Sun, Search, LogOut, UserCircle, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Tooltip, UserAvatar, useConfirm } from '@/components/ui';
import { ROLE_LABELS, UserRole } from '@exargen/shared';
import { cn } from '@/lib/cn';
import { Z } from '@/lib/zIndex';

export function TopBar() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { darkMode, toggleDarkMode } = useUIStore();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Synthesize Cmd+K so the existing CommandPalette (which owns its own state
  // and listens for that shortcut) can stay untouched.
  const openCommandPalette = () => {
    const event = new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: true, bubbles: true });
    document.dispatchEvent(event);
  };

  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  // Dismiss the account menu on outside-click + Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setMenuOpen(false);
    if (await confirm({
      title: 'Sign out?',
      body: 'You will need to sign in again to access the Command Center.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
      tone: 'brand',
    })) {
      clearAuth();
      navigate('/login');
    }
  };

  const menuItem = 'w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-md transition-colors text-left';

  return (
    <header className="h-14 flex items-center justify-between gap-4 px-5 shrink-0 bg-white/85 dark:bg-obsidian-bg/85 backdrop-blur-xl border-b border-gray-200 dark:border-obsidian-border transition-colors">
      {/* Search trigger — Obsidian-style ⌘K affordance */}
      <button
        onClick={openCommandPalette}
        className="group flex items-center gap-2.5 h-8 px-3 max-w-md w-full rounded-md
                   bg-gray-100 hover:bg-gray-200/80 dark:bg-obsidian-panel dark:hover:bg-obsidian-raised
                   border border-transparent hover:border-gray-200 dark:hover:border-obsidian-border-strong
                   text-gray-500 dark:text-obsidian-muted transition-colors"
        title="Open command palette"
      >
        <Search size={14} className="shrink-0" />
        <span className="text-[13px] flex-1 text-left">Search or jump to…</span>
        <kbd className="ml-2 hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono font-medium text-gray-400 dark:text-obsidian-faded shrink-0">
          <span className="px-1 h-4 rounded bg-white dark:bg-obsidian-sunken border border-gray-200 dark:border-obsidian-border inline-flex items-center">{isMac ? '⌘' : 'Ctrl'}</span>
          <span className="px-1 h-4 rounded bg-white dark:bg-obsidian-sunken border border-gray-200 dark:border-obsidian-border inline-flex items-center">K</span>
        </kbd>
      </button>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        <Tooltip content={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} side="bottom">
          <button
            onClick={toggleDarkMode}
            className="w-8 h-8 inline-flex items-center justify-center rounded-md
                       text-gray-500 hover:text-gray-900 hover:bg-gray-100
                       dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel
                       transition-colors"
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </Tooltip>

        {isAuthenticated && <NotificationBell />}

        {user && (
          <div className="relative ml-1" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-1 rounded-full p-0.5 hover:bg-gray-100 dark:hover:bg-obsidian-panel transition-colors"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              <UserAvatar user={user} size="md" ring />
              <ChevronDown size={13} className={cn('text-gray-400 dark:text-obsidian-faded transition-transform', menuOpen && 'rotate-180')} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-60 rounded-xl overflow-hidden bg-white dark:bg-obsidian-panel border border-gray-200 dark:border-obsidian-border shadow-pop dark:shadow-pop-dark animate-scale-in origin-top-right"
                style={{ zIndex: Z.popover }}
              >
                {/* Identity header */}
                <div className="flex items-center gap-2.5 px-3 py-3 border-b border-gray-100 dark:border-obsidian-border/70">
                  <UserAvatar user={user} size="lg" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{user.name}</p>
                    <p className="text-[11px] text-gray-500 dark:text-obsidian-muted truncate">{user.email}</p>
                  </div>
                </div>

                <div className="p-1.5">
                  <span className="block px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-obsidian-faded">
                    {ROLE_LABELS[user.role as UserRole]}
                  </span>
                  <button
                    onClick={() => go('/account')}
                    className={cn(menuItem, 'text-gray-700 dark:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised')}
                    role="menuitem"
                  >
                    <UserCircle size={16} className="text-gray-400 dark:text-obsidian-muted" />
                    Your profile &amp; settings
                  </button>
                  <button
                    onClick={toggleDarkMode}
                    className={cn(menuItem, 'justify-between text-gray-700 dark:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised')}
                    role="menuitem"
                  >
                    <span className="flex items-center gap-2.5">
                      {darkMode ? <Sun size={16} className="text-gray-400 dark:text-obsidian-muted" /> : <Moon size={16} className="text-gray-400 dark:text-obsidian-muted" />}
                      Theme
                    </span>
                    <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">{darkMode ? 'Dark' : 'Light'}</span>
                  </button>
                </div>

                <div className="p-1.5 border-t border-gray-100 dark:border-obsidian-border/70">
                  <button
                    onClick={handleLogout}
                    className={cn(menuItem, 'text-danger-600 dark:text-danger-500 hover:bg-danger-50 dark:hover:bg-danger-500/10')}
                    role="menuitem"
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
