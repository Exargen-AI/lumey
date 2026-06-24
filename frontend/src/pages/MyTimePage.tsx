import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Clock, Plane } from 'lucide-react';
import { TimesheetPage } from '@/pages/engineer/TimesheetPage';
import { LeavesPage } from '@/pages/LeavesPage';
import { cn } from '@/lib/cn';

/**
 * "My Time" — combined personal page. Replaces the previously-separate
 * `/eng/timesheet` and `/leaves` entries in the sidebar so users have one
 * place for "what hours did I log" + "am I off this week".
 *
 * The two existing pages are reused in `embedded` mode (they suppress
 * their own headers and let this parent own the title + tabs). That way
 * the timesheet and leave logic stays in one file each, no duplication,
 * and the standalone routes still work for legacy bookmarks via redirect.
 *
 * Tab is persisted in the URL (`?tab=timesheet|leave`) so a deep link
 * lands on the right view and the back button feels right. Default is
 * the timesheet tab — that's the daily workflow; leave is occasional.
 */

type Tab = 'timesheet' | 'leave';
const TABS: { id: Tab; label: string; icon: typeof Clock; description: string }[] = [
  { id: 'timesheet', label: 'Timesheet', icon: Clock, description: 'Hours logged this week' },
  { id: 'leave', label: 'Leave', icon: Plane, description: 'Apply for and track time off' },
];

export function MyTimePage() {
  const [params, setParams] = useSearchParams();
  // Read once per render. `useMemo` not strictly needed but avoids parsing
  // the search-string on every interaction.
  const tab: Tab = useMemo(() => {
    const v = params.get('tab');
    return v === 'leave' ? 'leave' : 'timesheet';
  }, [params]);

  const setTab = (next: Tab) => {
    // `replace: true` — switching tabs shouldn't pollute back-button history.
    // The user thinks of the whole page as one screen.
    setParams((prev) => {
      const np = new URLSearchParams(prev);
      np.set('tab', next);
      return np;
    }, { replace: true });
  };

  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <CalendarClock size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">My Time</h1>
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
              {active.description}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-obsidian-raised w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                isActive
                  ? 'bg-white dark:bg-obsidian-bg text-gray-900 dark:text-obsidian-fg shadow-sm'
                  : 'text-gray-500 dark:text-obsidian-muted hover:text-gray-700 dark:hover:text-obsidian-fg',
              )}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ─── Active tab body ─── */}
      <div>
        {tab === 'timesheet' ? <TimesheetPage embedded /> : <LeavesPage embedded />}
      </div>
    </div>
  );
}
