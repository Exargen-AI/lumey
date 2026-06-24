import { useMemo, useState, useEffect } from 'react';
import { BarChart3, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, FolderKanban, Users, ChevronDown, Check, Search } from 'lucide-react';
import { usePortfolioAnalytics, useTeamUtilization, useBlockerAging, useTaskDistribution } from '@/hooks/useAnalytics';
import { useProjects } from '@/hooks/useProjects';
import { usePermission } from '@/hooks/usePermission';
import { cn } from '@/lib/cn';
import { VelocityChart } from '@/components/charts/VelocityChart';
import { HealthPieChart } from '@/components/charts/HealthPieChart';
import { CompletionTrendChart } from '@/components/charts/CompletionTrendChart';
import { TaskTypeChart } from '@/components/charts/TaskTypeChart';
import { PriorityDonut } from '@/components/charts/PriorityDonut';
import { PhasePipeline } from '@/components/charts/PhasePipeline';

export function AnalyticsPage() {
  const canViewPortfolio = usePermission('analytics.view_portfolio');
  const canViewTeam = usePermission('analytics.view_team');
  const canViewProject = usePermission('analytics.view_project');

  const { data: analytics, isLoading: analyticsLoading } = usePortfolioAnalytics({ enabled: canViewPortfolio });
  const { data: team, isLoading: teamLoading } = useTeamUtilization({ enabled: canViewTeam });
  const { data: blockers, isLoading: blockersLoading } = useBlockerAging({ enabled: canViewPortfolio });
  const { data: distribution, isLoading: distLoading } = useTaskDistribution({ enabled: canViewPortfolio });
  const { data: projects, isLoading: projectsLoading } = useProjects(undefined, { enabled: canViewProject && !canViewPortfolio });

  const derivedProjectAnalytics = useMemo(() => {
    if (!projects?.length) return null;

    const metrics = projects.reduce((acc: any, project: any) => {
      acc.totalProjects += 1;
      acc.totalActiveTasks += (project.taskCounts?.total ?? 0) - (project.taskCounts?.done ?? 0);
      acc.blockedTasks += project.taskCounts?.blocked ?? 0;
      return acc;
    }, { totalProjects: 0, totalActiveTasks: 0, blockedTasks: 0 });

    const healthDistribution = projects.reduce((acc: Record<string, number>, project: any) => {
      acc[project.healthStatus] = (acc[project.healthStatus] || 0) + 1;
      return acc;
    }, { GREEN: 0, YELLOW: 0, RED: 0 });

    const phasePipeline = Object.entries(
      projects.reduce((acc: Record<string, number>, project: any) => {
        acc[project.phase] = (acc[project.phase] || 0) + 1;
        return acc;
      }, {})
    ).map(([phase, count]) => ({ phase, count }));

    return { metrics, healthDistribution, phasePipeline };
  }, [projects]);

  const metrics = canViewPortfolio ? analytics?.metrics : derivedProjectAnalytics?.metrics;
  const healthDistribution = canViewPortfolio ? analytics?.healthDistribution : derivedProjectAnalytics?.healthDistribution;
  const phasePipeline = canViewPortfolio ? distribution?.phasePipeline : derivedProjectAnalytics?.phasePipeline;
  const isMetricsLoading = canViewPortfolio ? analyticsLoading : projectsLoading;
  const pageTitle = canViewPortfolio ? 'Portfolio Analytics' : canViewProject ? 'Project Analytics' : 'Team Analytics';
  const showPortfolioSections = canViewPortfolio;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 size={24} className="text-brand-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pageTitle}</h1>
          {!canViewPortfolio && canViewProject && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Showing analytics derived from the projects you can access.
            </p>
          )}
        </div>
      </div>

      {/* Row 1: Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard icon={<CheckCircle2 size={16} className="text-green-600" />} title="Active Tasks" value={metrics?.totalActiveTasks ?? '—'} loading={isMetricsLoading} />
        <MetricCard icon={<TrendingUp size={16} className="text-blue-600" />} title="Completed This Week" value={metrics?.tasksCompletedThisWeek ?? '—'}
          trend={canViewPortfolio && metrics ? metrics.tasksCompletedThisWeek - metrics.tasksCompletedLastWeek : undefined} loading={isMetricsLoading} />
        <MetricCard icon={<AlertTriangle size={16} className="text-red-600" />} title="Blocked Tasks" value={showPortfolioSections ? (blockers?.length ?? '—') : (metrics?.blockedTasks ?? '—')}
          variant={(showPortfolioSections ? (blockers?.length ?? 0) : (metrics?.blockedTasks ?? 0)) > 0 ? 'danger' : 'default'} loading={showPortfolioSections ? blockersLoading : isMetricsLoading} />
        <MetricCard icon={<FolderKanban size={16} className="text-brand-600" />} title="Total Projects" value={metrics?.totalProjects ?? '—'} loading={isMetricsLoading} />
      </div>

      {showPortfolioSections && (
        <>
          {/* Row 2: Velocity + Completion Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Task Velocity (8 weeks)" loading={analyticsLoading}>
              <VelocityChart weeks={8} />
            </Card>
            <Card title="Completion Trend (30 days)" loading={distLoading}>
              {distribution?.completionTrend && <CompletionTrendChart data={distribution.completionTrend} />}
            </Card>
          </div>

          {/* Row 3: Type / Priority / Phase */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card title="Work Type Distribution" loading={distLoading}>
              {distribution?.byType && <TaskTypeChart data={distribution.byType} />}
            </Card>
            <Card title="Priority Breakdown" loading={distLoading}>
              {distribution?.byPriority && <PriorityDonut data={distribution.byPriority} />}
            </Card>
            <Card title="Project Phase Pipeline" loading={distLoading}>
              {distribution?.phasePipeline && <PhasePipeline data={distribution.phasePipeline} />}
            </Card>
          </div>
        </>
      )}

      {!showPortfolioSections && canViewProject && (
        <div className="grid grid-cols-1 gap-6">
          <Card title="Project Phase Pipeline" loading={projectsLoading}>
            {phasePipeline && <PhasePipeline data={phasePipeline} />}
          </Card>
        </div>
      )}

      {/* Row 4: Health + Team Utilization */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Project Health Distribution" loading={showPortfolioSections ? analyticsLoading : (canViewProject ? projectsLoading : false)}>
          {canViewPortfolio || canViewProject ? (
            <HealthPieChart data={healthDistribution} />
          ) : (
            <p className="text-sm text-gray-400 py-4 text-center">Project-level analytics access is required for health distribution.</p>
          )}
        </Card>
        <TeamUtilizationCard team={team ?? []} loading={teamLoading} canView={canViewTeam} />
      </div>

      {/* Row 5: Blocker Aging Table */}
      <Card title="Active Blockers" icon={<AlertTriangle size={16} className="text-red-500" />} loading={blockersLoading}>
        {!showPortfolioSections ? (
          <div className="flex items-center gap-3 py-6 justify-center text-gray-500">
            <AlertTriangle size={18} /> <span className="text-sm font-medium">Detailed blocker aging requires portfolio analytics access.</span>
          </div>
        ) : !blockers?.length ? (
          <div className="flex items-center gap-3 py-6 justify-center text-green-600 dark:text-green-400">
            <CheckCircle2 size={20} /> <span className="text-sm font-medium">No active blockers — great job!</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide py-2 px-3">Task</th>
                  <th className="text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide py-2 px-3">Project</th>
                  <th className="text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide py-2 px-3">Blocker</th>
                  <th className="text-right text-[10px] font-medium text-gray-500 uppercase tracking-wide py-2 px-3">Days</th>
                  <th className="text-center text-[10px] font-medium text-gray-500 uppercase tracking-wide py-2 px-3">Severity</th>
                </tr>
              </thead>
              <tbody>
                {blockers.map((b: any) => {
                  const days = b.daysBlocked ?? 0;
                  return (
                    <tr key={b.taskId} className="border-b border-gray-50 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="py-2.5 px-3 text-sm font-medium text-gray-900 dark:text-gray-100">{b.taskTitle}</td>
                      <td className="py-2.5 px-3 text-xs text-gray-500">{b.projectName}</td>
                      <td className="py-2.5 px-3 text-xs text-red-600 dark:text-red-400 max-w-xs truncate">{b.blockerNote}</td>
                      <td className="py-2.5 px-3 text-right">
                        <span className={cn('text-xs font-bold', days > 7 ? 'text-red-600' : days > 3 ? 'text-amber-600' : 'text-gray-500')}>
                          {days}d
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={cn('inline-block w-2 h-2 rounded-full',
                          days > 7 ? 'bg-red-500' : days > 3 ? 'bg-amber-500' : 'bg-green-500')} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Reusable Card Component ───

function Card({ title, icon, children, loading, headerExtras }: { title: string; icon?: React.ReactNode; children: React.ReactNode; loading?: boolean; headerExtras?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-5 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{title}</h2>
        </div>
        {headerExtras && <div className="shrink-0">{headerExtras}</div>}
      </div>
      {loading ? <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" /> : children}
    </div>
  );
}

// ─── Metric Card ───

function MetricCard({ icon, title, value, trend, variant = 'default', loading }: {
  icon: React.ReactNode; title: string; value: string | number; trend?: number; variant?: 'default' | 'danger'; loading?: boolean;
}) {
  if (loading) return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 p-4 animate-pulse">
      <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2" />
      <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
    </div>
  );

  return (
    <div className={cn('bg-white dark:bg-gray-900 rounded-xl border p-4 transition-all hover:shadow-sm',
      variant === 'danger' && Number(value) > 0 ? 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20' : 'border-gray-100 dark:border-gray-800')}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <p className="text-[11px] text-gray-500 dark:text-gray-400">{title}</p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</span>
        {trend !== undefined && trend !== 0 && (
          <span className={cn('flex items-center text-xs font-medium', trend > 0 ? 'text-green-600' : 'text-red-500')}>
            {trend > 0 ? <TrendingUp size={12} className="mr-0.5" /> : <TrendingDown size={12} className="mr-0.5" />}
            {trend > 0 ? '+' : ''}{trend}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Team Utilization card — Pankaj 2026-05-23 follow-up.
 *
 * Pre-fix the page hard-coded `team.slice(0, 8)`, which:
 *   1. Cut off the team list at 8 people regardless of team size.
 *   2. Gave admins no way to scope the chart to specific members
 *      they actually wanted to monitor (e.g. "show me just the
 *      backend engineers, not the whole org").
 *
 * Post-fix: full team visible by default, with an optional picker
 * that lets the admin pin a subset. The picker is per-user
 * persisted in localStorage — "monitor these 4 people today" stays
 * sticky across reloads. Clearing the picker reverts to "show
 * everyone".
 */
function TeamUtilizationCard({
  team, loading, canView,
}: {
  team: any[];
  loading?: boolean;
  canView: boolean;
}) {
  const LS_KEY = 'analytics.team.monitor';
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((s: unknown) => typeof s === 'string'));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(Array.from(selected)));
    } catch { /* private mode etc. */ }
  }, [selected]);

  // No selection → show all. Selection → only those.
  const visible = useMemo(() => {
    if (selected.size === 0) return team;
    return team.filter((m: any) => selected.has(m.userId));
  }, [team, selected]);

  const filtered = useMemo(() => {
    if (!search) return team;
    const s = search.toLowerCase();
    return team.filter((m: any) => (m.userName ?? '').toLowerCase().includes(s));
  }, [team, search]);

  const headerExtras = canView && team.length > 0 ? (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
          'border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400',
          'hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300',
        )}
        title="Pick which team members to monitor"
      >
        <Users size={11} />
        {selected.size === 0 ? `All ${team.length}` : `${selected.size} of ${team.length}`}
        <ChevronDown size={11} className={cn('transition-transform', pickerOpen && 'rotate-180')} />
      </button>
      {pickerOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-64 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg">
          <div className="p-2 border-b border-gray-100 dark:border-gray-800 flex items-center gap-2">
            <Search size={11} className="text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter team…"
              autoFocus
              className="flex-1 bg-transparent text-[11.5px] outline-none text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
            />
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[10px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.map((m: any) => {
              const isPicked = selected.has(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.userId)) next.delete(m.userId);
                      else next.add(m.userId);
                      return next;
                    });
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors',
                    'hover:bg-gray-50 dark:hover:bg-gray-800/60',
                    isPicked && 'bg-brand-50/60 dark:bg-brand-500/[0.08]',
                  )}
                >
                  <span className="inline-flex w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900 items-center justify-center text-[10px] font-semibold text-brand-700 dark:text-brand-300 shrink-0">
                    {(m.userName ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-200">{m.userName}</span>
                  {m.role && (
                    <span className="text-[9.5px] text-gray-400 dark:text-gray-500 capitalize shrink-0">
                      {String(m.role).toLowerCase().replace('_', ' ')}
                    </span>
                  )}
                  {isPicked && <Check size={11} className="text-brand-600 shrink-0" />}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="text-[11px] text-gray-400 text-center py-3">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <Card title="Team Utilization" loading={loading} headerExtras={headerExtras}>
      {!canView ? (
        <p className="text-sm text-gray-400 py-4 text-center">Team utilization requires team analytics access.</p>
      ) : !team?.length ? (
        <p className="text-sm text-gray-400 py-4 text-center">No team data</p>
      ) : !visible.length ? (
        <p className="text-sm text-gray-400 py-4 text-center">
          {selected.size} members selected, but none match the current team data.
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {visible.map((member: any) => {
            const activeTasks = member.totalTasks ?? 0;
            const utilization = Math.min(100, Math.round((activeTasks / 10) * 100));
            return (
              <div key={member.userId} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900 flex items-center justify-center text-[10px] font-medium text-brand-700 dark:text-brand-300 shrink-0">
                  {(member.userName ?? '?').charAt(0)}
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300 w-28 truncate" title={member.userName}>{member.userName}</span>
                <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2.5">
                  <div className={cn('rounded-full h-2.5 transition-all',
                    utilization > 80 ? 'bg-red-500' : utilization > 60 ? 'bg-yellow-500' : 'bg-green-500')}
                    style={{ width: `${utilization}%` }} />
                </div>
                <span className="text-xs text-gray-500 w-16 text-right shrink-0">{activeTasks} tasks</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
