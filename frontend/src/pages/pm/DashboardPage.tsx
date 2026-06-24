import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, FolderKanban, ArrowUpRight } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { HEALTH_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';

export function PMDashboardPage() {
  const { data: projects, isLoading } = useProjects();
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] || 'there';

  const summary = projects
    ? {
        total: projects.length,
        healthy: projects.filter((p: any) => p.healthStatus === 'GREEN').length,
        atRisk: projects.filter((p: any) => p.healthStatus === 'YELLOW').length,
        critical: projects.filter((p: any) => p.healthStatus === 'RED').length,
        totalTasks: projects.reduce((sum: number, p: any) => sum + (p.taskCounts?.total ?? p._count?.tasks ?? 0), 0),
        inProgress: projects.reduce((sum: number, p: any) => sum + (p.taskCounts?.inProgress ?? 0), 0),
        blocked: projects.reduce((sum: number, p: any) => sum + (p.taskCounts?.blocked ?? 0), 0),
      }
    : null;

  return (
    <div className="space-y-7">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Your <span className="bg-gradient-to-r from-brand-500 to-brand-300 bg-clip-text text-transparent">portfolio</span>, {firstName}
          </h1>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1.5">
            {summary?.total ?? '—'} {summary?.total === 1 ? 'project' : 'projects'} under your care
          </p>
        </div>
      </div>

      {/* ─── Summary stats ─── */}
      <div className="stagger-fade grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<FolderKanban size={16} />}
          tone="brand"
          label="Total"
          value={summary?.total}
          loading={isLoading}
        />
        <StatCard
          icon={<CheckCircle2 size={16} />}
          tone="success"
          label="Healthy"
          value={summary?.healthy}
          loading={isLoading}
        />
        <StatCard
          icon={<Clock size={16} />}
          tone="warning"
          label="At Risk"
          value={summary?.atRisk}
          loading={isLoading}
        />
        <StatCard
          icon={<AlertTriangle size={16} />}
          tone="danger"
          label="Blocked"
          value={summary?.blocked}
          loading={isLoading}
        />
      </div>

      {/* ─── Project list ─── */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-obsidian-muted">Projects</h2>
          {projects?.length ? (
            <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {projects.length}
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl border bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border p-5">
                <div className="skeleton h-5 rounded w-3/4 mb-3" />
                <div className="skeleton h-4 rounded w-1/2 mb-4" />
                <div className="skeleton h-3 rounded w-full" />
              </div>
            ))}
          </div>
        ) : !projects?.length ? (
          <EmptyProjects />
        ) : (
          <div className="stagger-fade grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((project: any) => (
              <PMProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stat card with tonal accent ───

function StatCard({ icon, label, value, loading, tone }: {
  icon: React.ReactNode; label: string; value?: number | string; loading?: boolean;
  tone: 'brand' | 'success' | 'warning' | 'danger';
}) {
  const iconStyles: Record<string, string> = {
    brand:   'bg-brand-500/10 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400 ring-brand-500/20',
    success: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 ring-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400 ring-amber-500/20',
    danger:  'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400 ring-rose-500/20',
  };

  return (
    <div className={cn(
      'rounded-xl border p-5 hover-lift',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark hover:shadow-lift dark:hover:shadow-lift-dark',
    )}>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className={cn('w-7 h-7 rounded-lg ring-1 inline-flex items-center justify-center', iconStyles[tone])}>
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">{label}</span>
      </div>
      {loading ? (
        <div className="skeleton h-9 rounded w-1/2" />
      ) : (
        <p className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg tabular-nums">
          {value ?? 0}
        </p>
      )}
    </div>
  );
}

// ─── Project card ───

function PMProjectCard({ project }: { project: any }) {
  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const categoryColor = CATEGORY_COLORS[project.category as keyof typeof CATEGORY_COLORS];
  const totalTasks = project.taskCounts?.total ?? project._count?.tasks ?? 0;
  const doneTasks = project.taskCounts?.done ?? 0;
  const blockedTasks = project.taskCounts?.blocked ?? 0;
  const inProgressTasks = project.taskCounts?.inProgress ?? 0;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const healthLabel = project.healthStatus === 'GREEN' ? 'Healthy' : project.healthStatus === 'YELLOW' ? 'At risk' : 'Critical';

  return (
    <Link
      to={`/pm/projects/${project.id}`}
      className={cn(
        'group relative block rounded-2xl border p-5 transition-all duration-200',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'hover:shadow-lift dark:hover:shadow-lift-dark hover:border-brand-300/60 dark:hover:border-brand-500/30',
        'hover:-translate-y-0.5',
      )}
    >
      {/* Hover halo (top-right) */}
      <span className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-brand-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Title row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">{project.name}</h3>
          <span
            className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-md"
            style={{ backgroundColor: categoryColor + '20', color: categoryColor }}
          >
            {CATEGORY_LABELS[project.category as keyof typeof CATEGORY_LABELS]}
          </span>
        </div>
        {/* Health pill */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium shrink-0"
          style={{ backgroundColor: healthColor + '15', color: healthColor }}
        >
          <span
            className={cn('w-1.5 h-1.5 rounded-full', project.healthStatus === 'RED' && 'animate-pulse')}
            style={{ backgroundColor: healthColor }}
          />
          {healthLabel}
        </div>
      </div>

      {/* Phase + meta */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] mb-4">
        <span className="px-2 py-0.5 rounded-md text-gray-600 dark:text-obsidian-muted bg-gray-100 dark:bg-obsidian-raised">
          {PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]}
        </span>
        <span className="text-gray-500 dark:text-obsidian-muted">{totalTasks} tasks</span>
        {inProgressTasks > 0 && (
          <span className="text-brand-600 dark:text-brand-400 font-medium">{inProgressTasks} in progress</span>
        )}
        {blockedTasks > 0 && (
          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-medium">
            <AlertTriangle size={11} /> {blockedTasks} blocked
          </span>
        )}
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-[10px] mb-1.5">
          <span className="text-gray-500 dark:text-obsidian-muted uppercase tracking-wider font-medium">Progress</span>
          <span className="text-gray-700 dark:text-obsidian-fg font-semibold tabular-nums">{progressPct}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-700 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Footer: avatars + last activity + open arrow */}
      <div className="flex items-center justify-between">
        <div className="flex items-center -space-x-1.5">
          {project.members?.slice(0, 4).map((member: any) => (
            <div
              key={member.id}
              className="w-6 h-6 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 ring-2 ring-white dark:ring-obsidian-panel flex items-center justify-center text-[10px] font-semibold text-white"
              title={member.user.name}
            >
              {member.user.name.charAt(0).toUpperCase()}
            </div>
          ))}
          {project.members?.length > 4 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-obsidian-raised ring-2 ring-white dark:ring-obsidian-panel flex items-center justify-center text-[10px] text-gray-600 dark:text-obsidian-muted font-medium">
              +{project.members.length - 4}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {project.updatedAt && (
            <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">{formatRelative(project.updatedAt)}</span>
          )}
          <ArrowUpRight size={14} className="text-gray-300 dark:text-obsidian-faded group-hover:text-brand-500 dark:group-hover:text-brand-400 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </Link>
  );
}

// ─── Empty state ───

function EmptyProjects() {
  return (
    <div className={cn(
      'rounded-2xl border-2 border-dashed py-16 text-center',
      'border-gray-200 dark:border-obsidian-border',
      'bg-white/40 dark:bg-obsidian-panel/40',
    )}>
      <FolderKanban size={36} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
      <p className="text-sm text-gray-500 dark:text-obsidian-muted">No projects assigned to you yet.</p>
      <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">Once you're added to a project, it'll show up here.</p>
    </div>
  );
}
