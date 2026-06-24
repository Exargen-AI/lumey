import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Clock, Plane } from 'lucide-react';
import { TimesheetApprovalPage } from '@/pages/admin/TimesheetApprovalPage';
import { LeaveApprovalsPage } from '@/pages/admin/LeaveApprovalsPage';
import { useAuthStore } from '@/stores/authStore';
import { useApprovalCounts } from '@/hooks/useTimesheet';
import { useLeaveCounts } from '@/hooks/useLeaves';
import { cn } from '@/lib/cn';

/**
 * "Approvals" — combined queue. Replaces the previously-separate
 * `/approvals` (timesheets) and `/admin/leaves` (leave) pages so the
 * founder + PM have one inbox-style screen for "what needs my decision".
 *
 * Visibility:
 *   - Timesheets tab — anyone with `analytics.view_team` (PM, admin, super-admin).
 *     The route gate in App.tsx already enforces this.
 *   - Leave tab — SUPER_ADMIN only (founder approval policy). Hidden for PMs
 *     so they don't see a tab they can't action — the underlying API would
 *     reject them with 403 anyway.
 *
 * Tab badge counts share the same polling clocks as the underlying lists,
 * so "Pending (3)" stays in sync without extra fetches.
 */

type Tab = 'timesheets' | 'leave';

export function ApprovalsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === 'SUPER_ADMIN';

  // Polled by the same hooks the inner pages already use — React Query
  // dedupes by query key, so this doesn't double-fetch.
  const { data: tsCounts } = useApprovalCounts(true);
  const { data: leaveCounts } = useLeaveCounts(isSuperAdmin);

  const tabs = useMemo(() => {
    const list: { id: Tab; label: string; icon: typeof Clock; count: number }[] = [
      { id: 'timesheets', label: 'Timesheets', icon: Clock, count: tsCounts?.SUBMITTED ?? 0 },
    ];
    if (isSuperAdmin) {
      list.push({ id: 'leave', label: 'Leave', icon: Plane, count: leaveCounts?.PENDING ?? 0 });
    }
    return list;
  }, [isSuperAdmin, tsCounts?.SUBMITTED, leaveCounts?.PENDING]);

  const [params, setParams] = useSearchParams();
  const tab: Tab = useMemo(() => {
    const v = params.get('tab');
    if (v === 'leave' && isSuperAdmin) return 'leave';
    return 'timesheets';
  }, [params, isSuperAdmin]);

  const setTab = (next: Tab) => {
    setParams((prev) => {
      const np = new URLSearchParams(prev);
      np.set('tab', next);
      return np;
    }, { replace: true });
  };

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <ClipboardCheck size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">Approvals</h1>
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
              {isSuperAdmin
                ? 'Review timesheets and leave requests from your team.'
                : 'Review timesheets submitted by your team.'}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Tabs (only render when there are 2+ tabs to switch between) ─── */}
      {tabs.length > 1 && (
        <div className="flex gap-1 p-1 rounded-lg bg-gray-100 dark:bg-obsidian-raised w-fit">
          {tabs.map((t) => {
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
                {t.count > 0 && (
                  <span className={cn(
                    'ml-1 text-[10px] font-bold rounded-full px-1.5 py-0.5',
                    isActive
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-obsidian-bg dark:text-obsidian-muted',
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Active body ─── */}
      <div>
        {tab === 'leave' && isSuperAdmin
          ? <LeaveApprovalsPage embedded />
          : <TimesheetApprovalPage embedded />}
      </div>
    </div>
  );
}
