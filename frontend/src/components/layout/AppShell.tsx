import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileBottomNav } from './MobileBottomNav';
import { CommandPalette } from '@/components/CommandPalette';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

/**
 * Internal-portal shell. Two viewport modes:
 *
 *   - Desktop (>= lg): fixed-position sidebar on the left, main column
 *     offset by `ml-64` (sidebarOpen) or `ml-16` (collapsed).
 *   - Mobile (< lg): sidebar hidden; <MobileBottomNav> takes over
 *     navigation. The main column has no left offset and an extra
 *     `pb-16` so the last row of content isn't covered by the bar
 *     (h-14 + safe-area-inset stack to ~76px max).
 *
 * Everything pivots on Tailwind's `lg:` breakpoint (1024px) — the same
 * boundary the MobileBottomNav's matchMedia uses. Keep these in sync
 * if you ever change one.
 */
export function AppShell() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const darkMode = useUIStore((s) => s.darkMode);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#fafbfc] dark:bg-obsidian-deep transition-colors duration-300">
      {/* Desktop sidebar — hidden below lg. The mobile bottom nav owns
          navigation on smaller viewports. We hide the wrapper so the
          Sidebar's own fixed-position children never paint. */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className={cn(
        'flex-1 flex flex-col overflow-hidden transition-[margin] duration-300 ease-out',
        // Margin-left only applies at lg+; mobile gets a full-width main.
        sidebarOpen ? 'lg:ml-64' : 'lg:ml-16',
      )}>
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-[#fafbfc] dark:bg-obsidian-bg">
          {/* Trim vertical padding so dense pages (project detail, kanban,
              sprints) don't waste a quarter-screen on whitespace. Keep
              horizontal padding generous — that's what makes the layout
              feel premium on wide displays. pb-20 on mobile gives the
              bottom nav clearance; lg+ resets to the original 5. */}
          <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8 py-4 lg:py-5 pb-20 lg:pb-5">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <MobileBottomNav />
    </div>
  );
}
