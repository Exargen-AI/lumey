import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, Users, FolderKanban, TrendingUp, TrendingDown, Shield, Plus, ArrowUpRight } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { usePortfolioAnalytics } from '@/hooks/useAnalytics';
import { useAuthStore } from '@/stores/authStore';
import { Can } from '@/components/auth/Can';
import { Button } from '@/components/ui';
import { HEALTH_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import api from '@/api/client';

async function getPMDashboard() {
  const { data } = await api.get('/analytics/pm-dashboard');
  return data.data;
}

export function AdminDashboardPage() {
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: analytics } = usePortfolioAnalytics();
  const { data: pmData, isLoading: pmLoading } = useQuery({ queryKey: ['pm-dashboard'], queryFn: getPMDashboard, refetchInterval: 60000 });
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] || 'there';

  const metrics = analytics?.metrics;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-7">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            {greeting}, <span className="bg-gradient-to-r from-brand-500 to-brand-300 bg-clip-text text-transparent">{firstName}</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1.5">
            Portfolio overview across all projects
          </p>
        </div>
      </div>

      {/* ─── Top metrics ─── */}
      <div className="stagger-fade grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          tone="success"
          icon={<CheckCircle2 size={16} />}
          title="Active Tasks"
          value={metrics?.totalActiveTasks}
        />
        <MetricCard
          tone="info"
          icon={<TrendingUp size={16} />}
          title="Completed This Week"
          value={metrics?.tasksCompletedThisWeek}
          trend={metrics ? metrics.tasksCompletedThisWeek - metrics.tasksCompletedLastWeek : undefined}
        />
        <MetricCard
          tone="danger"
          icon={<AlertTriangle size={16} />}
          title="Blocked Tasks"
          value={pmData?.blockedTasks?.length}
          highlight={pmData?.blockedTasks?.length > 0}
        />
        <MetricCard
          tone="brand"
          icon={<FolderKanban size={16} />}
          title="Total Projects"
          value={pmData?.totalProjects}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Left column: Blockers + At-Risk + Projects grid ─── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Blockers */}
          <Panel
            title="Active Blockers"
            icon={<AlertTriangle size={14} className="text-rose-500" />}
            count={pmData?.blockedTasks?.length}
            countTone="danger"
          >
            {pmLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-lg" />)}
              </div>
            ) : !pmData?.blockedTasks?.length ? (
              <div className="flex items-center gap-2.5 py-6 justify-center text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={18} /> <span className="text-sm font-medium">No active blockers</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {pmData.blockedTasks.map((b: any) => (
                  <div
                    key={b.id}
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-lg transition-colors',
                      'bg-rose-50/70 hover:bg-rose-50 border border-rose-100',
                      'dark:bg-rose-500/[0.06] dark:hover:bg-rose-500/[0.10] dark:border-rose-500/20',
                    )}
                  >
                    <AlertTriangle size={14} className="text-rose-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{b.title}</p>
                      <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5">
                        {b.projectName}{b.assigneeName ? ` · ${b.assigneeName}` : ''}
                      </p>
                      {b.blockerNote && <p className="text-[11px] text-rose-600 dark:text-rose-300 mt-1 leading-relaxed">{b.blockerNote}</p>}
                    </div>
                    <span className={cn(
                      'text-[11px] font-bold tabular-nums shrink-0 px-2 py-0.5 rounded-md',
                      b.daysBlocked > 3
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                    )}>
                      {b.daysBlocked}d
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* At-Risk Projects */}
          {pmData?.atRiskProjects?.length > 0 && (
            <Panel
              title="Projects at Risk"
              icon={<Shield size={14} className="text-amber-500" />}
              count={pmData.atRiskProjects.length}
              countTone="warning"
            >
              <div className="space-y-1">
                {pmData.atRiskProjects.map((p: any) => {
                  const isCritical = p.healthStatus === 'RED';
                  return (
                    <Link
                      key={p.id}
                      to={`/projects/${p.id}`}
                      className="group flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-obsidian-raised transition-colors"
                    >
                      <span
                        className={cn('w-2 h-2 rounded-full shrink-0', isCritical && 'animate-pulse')}
                        style={{ backgroundColor: HEALTH_COLORS[p.healthStatus as keyof typeof HEALTH_COLORS] }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{p.name}</p>
                        <p className="text-[11px] text-gray-500 dark:text-obsidian-muted">{PHASE_LABELS[p.phase as keyof typeof PHASE_LABELS]}</p>
                      </div>
                      <span className={cn(
                        'text-[10px] font-medium px-2 py-0.5 rounded-md shrink-0',
                        isCritical
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
                      )}>
                        {isCritical ? 'Critical' : 'At Risk'}
                      </span>
                      <ArrowUpRight size={12} className="text-gray-300 dark:text-obsidian-faded group-hover:text-brand-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* All Projects grid */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-obsidian-muted">All Projects</h2>
                {projects?.length ? (
                  <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    {projects.length}
                  </span>
                ) : null}
              </div>
              <Can permission="project.create">
                <Button variant="primary" size="sm" leadingIcon={<Plus size={14} />} onClick={() => { window.location.href = '/projects/new'; }}>
                  New Project
                </Button>
              </Can>
            </div>
            {projectsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton h-32 rounded-xl" />
                ))}
              </div>
            ) : !projects?.length ? (
              <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-obsidian-border py-12 text-center">
                <FolderKanban size={32} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-2" />
                <p className="text-sm text-gray-500 dark:text-obsidian-muted">No projects yet.</p>
              </div>
            ) : (
              <div className="stagger-fade grid grid-cols-1 md:grid-cols-2 gap-4">
                {projects.map((project: any) => <CompactProjectCard key={project.id} project={project} />)}
              </div>
            )}
          </div>
        </div>

        {/* ─── Right column: EOD + Health + Quick stats + links ─── */}
        <div className="space-y-6">

          {/* EOD Status */}
          <Panel
            title="Today's EOD Status"
            icon={<Clock size={14} className="text-brand-500 dark:text-brand-400" />}
          >
            {pmLoading ? (
              <div className="skeleton h-20 rounded-lg" />
            ) : (
              <>
                {/* Progress ring */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative w-16 h-16">
                    <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-100 dark:text-obsidian-raised" />
                      {pmData?.eodStatus?.total > 0 && (
                        <circle
                          cx="18" cy="18" r="14" fill="none"
                          stroke="url(#eod-grad)" strokeWidth="3"
                          strokeDasharray={`${(pmData.eodStatus.submitted / pmData.eodStatus.total) * 88} 88`}
                          strokeLinecap="round"
                          className="transition-all duration-700"
                        />
                      )}
                      <defs>
                        <linearGradient id="eod-grad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#10b981" />
                          <stop offset="100%" stopColor="#34d399" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">
                        {pmData?.eodStatus?.submitted ?? 0}/{pmData?.eodStatus?.total ?? 0}
                      </span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">{pmData?.eodStatus?.submitted ?? 0} submitted</p>
                    <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5">{pmData?.eodStatus?.missing?.length ?? 0} pending</p>
                  </div>
                </div>

                {pmData?.eodStatus?.missing?.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 dark:text-obsidian-faded uppercase tracking-wider font-semibold mb-2">
                      Not yet submitted
                    </p>
                    <div className="space-y-1.5">
                      {pmData.eodStatus.missing.map((u: any) => (
                        <div key={u.id} className="flex items-center gap-2 text-[13px]">
                          <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-gray-700 dark:text-obsidian-fg">{u.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </Panel>

          {/* Health Overview */}
          <Panel title="Project Health">
            <div className="space-y-3">
              {[
                { label: 'Healthy',  color: '#22c55e', count: pmData?.health?.GREEN ?? 0 },
                { label: 'At Risk',  color: '#eab308', count: pmData?.health?.YELLOW ?? 0 },
                { label: 'Critical', color: '#ef4444', count: pmData?.health?.RED ?? 0 },
              ].map((h) => (
                <div key={h.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: h.color }} />
                    <span className="text-[13px] text-gray-600 dark:text-obsidian-muted">{h.label}</span>
                  </div>
                  <span className="text-[13px] font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">{h.count}</span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Quick Stats */}
          <Panel title="Quick Stats">
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-obsidian-muted">Overdue tasks</span>
                <span className={cn(
                  'font-semibold tabular-nums',
                  (pmData?.overdueTasks ?? 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400',
                )}>
                  {pmData?.overdueTasks ?? 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-obsidian-muted">Team balance</span>
                <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">
                  {metrics?.teamUtilization?.balanced ?? 0} balanced
                </span>
              </div>
            </div>
          </Panel>

          {/* Quick links */}
          <div className="space-y-2">
            <Can permission="analytics.view_team">
              <QuickLink to="/standup" icon={<Users size={15} className="text-brand-500 dark:text-brand-400" />}>
                View Team Standup
              </QuickLink>
            </Can>
            <Can permission="analytics.view_team">
              <QuickLink to="/approvals" icon={<CheckCircle2 size={15} className="text-emerald-500 dark:text-emerald-400" />}>
                Timesheet Approvals
              </QuickLink>
            </Can>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable: Panel (titled card with optional count pill) ───

function Panel({ title, icon, count, countTone = 'neutral', children }: {
  title: string; icon?: React.ReactNode; count?: number; countTone?: 'neutral' | 'danger' | 'warning'; children: React.ReactNode;
}) {
  const countToneClass: Record<string, string> = {
    neutral: 'bg-gray-100 text-gray-700 dark:bg-obsidian-raised dark:text-obsidian-muted',
    danger:  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  };
  return (
    <div className={cn(
      'rounded-2xl border p-5',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <div className="flex items-center gap-2 mb-4">
        {icon && <span className="shrink-0">{icon}</span>}
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className={cn('text-[10px] font-bold rounded-full px-2 py-0.5', countToneClass[countTone])}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Compact project card (admin grid — 2 columns, denser than PM dashboard) ───

function CompactProjectCard({ project }: { project: any }) {
  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const categoryColor = CATEGORY_COLORS[project.category as keyof typeof CATEGORY_COLORS];

  return (
    <Link
      to={`/projects/${project.id}`}
      className={cn(
        'group block rounded-xl p-4 transition-all duration-200',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'hover:shadow-lift dark:hover:shadow-lift-dark hover:border-brand-300/60 dark:hover:border-brand-500/30 hover:-translate-y-0.5',
      )}
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        <h3 className="text-[14px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">{project.name}</h3>
        <span
          className={cn('w-2 h-2 rounded-full shrink-0 mt-1.5', project.healthStatus === 'RED' && 'animate-pulse')}
          style={{ backgroundColor: healthColor }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-md" style={{ backgroundColor: categoryColor + '20', color: categoryColor }}>
          {CATEGORY_LABELS[project.category as keyof typeof CATEGORY_LABELS]}
        </span>
        <span className="px-1.5 py-0.5 text-[10px] rounded-md text-gray-600 dark:text-obsidian-muted bg-gray-100 dark:bg-obsidian-raised">
          {PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-obsidian-muted">
        <span>{project.taskCounts?.total ?? 0} tasks</span>
        {project.taskCounts?.blocked > 0 && (
          <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium">
            <AlertTriangle size={11} /> {project.taskCounts.blocked}
          </span>
        )}
      </div>
    </Link>
  );
}

// ─── Quick link card ───

function QuickLink({ to, icon, children }: { to: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px] transition-colors',
        'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'text-gray-700 dark:text-obsidian-fg',
        'hover:bg-gray-50 dark:hover:bg-obsidian-raised hover:border-brand-300/40 dark:hover:border-brand-500/30',
      )}
    >
      {icon}
      <span className="flex-1">{children}</span>
      <ArrowUpRight size={13} className="text-gray-300 dark:text-obsidian-faded group-hover:text-brand-500 dark:group-hover:text-brand-400 group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}

// ─── Top metric card ───

function MetricCard({ icon, title, value, trend, tone, highlight }: {
  icon: React.ReactNode; title: string; value?: number | string; trend?: number;
  tone: 'success' | 'info' | 'danger' | 'brand'; highlight?: boolean;
}) {
  const iconStyles: Record<string, string> = {
    success: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 ring-emerald-500/20',
    info:    'bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 ring-blue-500/20',
    danger:  'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400 ring-rose-500/20',
    brand:   'bg-brand-500/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400 ring-brand-500/20',
  };
  return (
    <div className={cn(
      'rounded-xl border p-5 hover-lift',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark hover:shadow-lift dark:hover:shadow-lift-dark',
      // When highlight (e.g. blockers > 0), pulse a subtle rose ring to draw the eye
      highlight && 'ring-1 ring-rose-300/60 dark:ring-rose-500/30',
    )}>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className={cn('w-7 h-7 rounded-lg ring-1 inline-flex items-center justify-center', iconStyles[tone])}>
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">{title}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg tabular-nums">
          {value ?? '—'}
        </span>
        {trend !== undefined && trend !== 0 && (
          <span className={cn(
            'flex items-center text-[11px] font-medium tabular-nums',
            trend > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}>
            {trend > 0 ? <TrendingUp size={11} className="mr-0.5" /> : <TrendingDown size={11} className="mr-0.5" />}
            {Math.abs(trend)}
          </span>
        )}
      </div>
    </div>
  );
}

