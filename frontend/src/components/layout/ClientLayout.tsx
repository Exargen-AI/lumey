import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ClientSidebar } from './ClientSidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { NotificationBell } from '@/components/notifications/NotificationBell';

/**
 * Layout for the client-facing portal.
 *
 * Desktop (>= lg): collapsible sidebar on the left + slim top bar with
 * dark-mode toggle. Same chrome the portal has shipped with since
 * Phase 1.
 *
 * Mobile (< lg): the desktop sidebar is hidden; <MobileBottomNav>
 * renders Overview / Board / Documents + More when the user is inside
 * a project (`/client/projects/:id/*`), and hides entirely on the
 * multi-project landing (`/client/dashboard`). The page itself gets
 * `pb-20` so the last content row clears the bar's h-14 + safe-area.
 *
 * Width offset matches `useUIStore.sidebarOpen` only at lg+; mobile
 * mains have no offset. The flag is shared with the admin sidebar via
 * the same store — one flip applies everywhere the same user goes.
 */
export function ClientLayout() {
  const { darkMode, toggleDarkMode, sidebarOpen } = useUIStore();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  return (
    <div className="min-h-[100dvh] bg-[#fafbfc] dark:bg-obsidian-deep transition-colors">
      <div className="hidden lg:block">
        <ClientSidebar />
      </div>

      {/* Main content shifted right by the sidebar's width — only at lg+.
          transition-[margin] lands the collapse animation in lockstep
          with the sidebar's width animation. */}
      <div className={cn(
        'transition-[margin] duration-300 ease-out',
        sidebarOpen ? 'lg:ml-64' : 'lg:ml-16',
      )}>
        {/* Slim top bar — notifications + dark-mode toggle on the right. No
            brand duplication; the sidebar owns identity chrome. The bell lets
            a client see when a task is assigned to them (e.g. the team needs
            their decision) and when an engineer posts a client update. */}
        <header className="h-14 px-4 sm:px-6 lg:px-8 flex items-center justify-end border-b border-gray-200/60 dark:border-obsidian-border/60 bg-white/60 dark:bg-obsidian-bg/40 backdrop-blur-xl">
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Tooltip content={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} side="bottom">
              <button
                onClick={toggleDarkMode}
                className="w-9 h-9 inline-flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel transition-colors"
                aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </Tooltip>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 pb-20 lg:pb-8">
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
