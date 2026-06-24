import { Navigate, Link } from 'react-router-dom';
import {
  ArrowUpRight, FolderOpen, ShieldCheck, AlertTriangle, Flame,
  Target, CalendarClock, Activity,
} from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { HEALTH_COLORS, PHASE_LABELS, PHASE_ORDER } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

/**
 * Client portal — multi-project landing.
 *
 * Single-project clients (the common case) auto-redirect into their
 * project Overview, so this page only renders for clients with two or
 * more engagements. Those tend to be larger accounts who want a one-page
 * answer to "how are all my projects doing?" — so the v2 rework adds:
 *
 *   1. **Portfolio pulse strip** — total, healthy, at risk, critical
 *      tiles at the top so the headline read takes ~3 seconds.
 *   2. **Sort by health** — surface RED projects first by default; the
 *      one needing the conversation today shouldn't be hiding below the
 *      fold.
 *   3. **Denser cards** — phase + delivery target + a one-line latest
 *      signal next to the existing phase rail.
 *
 * Everything else (animations, hover halo, gradient text) is kept;
 * we're refining the page, not replacing the visual language.
 */
export function ClientDashboardPage() {
  const { data: projects, isLoading } = useProjects();
  const user = useAuthStore((s) => s.user);
  const firstName = user?.name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 rounded w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1, 2].map((i) => <div key={i} className="skeleton h-56 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // Single-project clients land directly on their project — no need for a chooser.
  if (projects?.length === 1) {
    return <Navigate to={`/client/projects/${projects[0].id}`} replace />;
  }

  // ─── Portfolio counts ───
  const total = projects?.length ?? 0;
  const counts = {
    GREEN:  (projects ?? []).filter((p: any) => p.healthStatus === 'GREEN').length,
    YELLOW: (projects ?? []).filter((p: any) => p.healthStatus === 'YELLOW').length,
    RED:    (projects ?? []).filter((p: any) => p.healthStatus === 'RED').length,
  };

  // Default ordering: RED first, then YELLOW, then GREEN, then everything
  // else alphabetically — surfaces the conversation-this-week project up
  // top without needing user-controlled sort.
  const healthRank: Record<string, number> = { RED: 0, YELLOW: 1, GREEN: 2 };
  const sortedProjects = (projects ?? []).slice().sort((a: any, b: any) => {
    const ra = healthRank[a.healthStatus] ?? 3;
    const rb = healthRank[b.healthStatus] ?? 3;
    if (ra !== rb) return ra - rb;
    return (a.name || '').localeCompare(b.name || '');
  });

  return (
    <div className="space-y-8">
      {/* ─── Header ─── */}
      <div className="animate-fade-in-down">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          {greeting}, <span className="bg-gradient-to-r from-brand-500 to-brand-300 bg-clip-text text-transparent">{firstName}</span>
        </h1>
        <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1.5">
          {total === 0
            ? 'Your project portfolio'
            : `${total} ${total === 1 ? 'project' : 'projects'} in flight — the ones needing attention surface first.`}
        </p>
      </div>

      {/* ─── Portfolio pulse strip ─── */}
      {total > 0 && (
        <section
          aria-label="Portfolio pulse"
          className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in-up"
        >
          <PortfolioTile
            label="Active projects"
            value={total}
            icon={<FolderOpen size={16} className="text-gray-500 dark:text-obsidian-muted" />}
            tone="neutral"
          />
          <PortfolioTile
            label="Healthy"
            value={counts.GREEN}
            icon={<ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />}
            tone="emerald"
          />
          <PortfolioTile
            label="At risk"
            value={counts.YELLOW}
            icon={<AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />}
            tone="amber"
          />
          <PortfolioTile
            label="Critical"
            value={counts.RED}
            icon={<Flame size={16} className="text-rose-600 dark:text-rose-400" />}
            tone="rose"
          />
        </section>
      )}

      {/* ─── Project list ─── */}
      {total === 0 ? (
        <EmptyState />
      ) : (
        <div className="stagger-fade grid grid-cols-1 md:grid-cols-2 gap-6">
          {sortedProjects.map((project: any) => <ClientProjectCard key={project.id} project={project} />)}
        </div>
      )}
    </div>
  );
}

/* ─── Portfolio tile ─── */
function PortfolioTile({
  label, value, icon, tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'neutral' | 'emerald' | 'amber' | 'rose';
}) {
  const accent: Record<string, string> = {
    neutral: 'text-gray-700 dark:text-obsidian-fg',
    emerald: 'text-emerald-700 dark:text-emerald-300',
    amber:   'text-amber-700 dark:text-amber-300',
    rose:    'text-rose-700 dark:text-rose-300',
  };
  const bar: Record<string, string> = {
    neutral: 'bg-gray-300 dark:bg-obsidian-faded',
    emerald: 'bg-emerald-500',
    amber:   'bg-amber-500',
    rose:    'bg-rose-500',
  };
  return (
    <div className={cn(
      'relative overflow-hidden rounded-2xl border p-4',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', bar[tone])} />
      <div className="ml-2">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
            {label}
          </span>
        </div>
        <p className={cn('text-[26px] font-semibold tabular-nums leading-none', accent[tone])}>
          {value}
        </p>
      </div>
    </div>
  );
}

/* ─── Empty state ─── */
function EmptyState() {
  return (
    <div className={cn(
      'rounded-2xl border-2 border-dashed py-16 text-center',
      'border-gray-200 dark:border-obsidian-border',
      'bg-white/40 dark:bg-obsidian-panel/40',
    )}>
      <FolderOpen size={36} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
      <p className="text-sm text-gray-500 dark:text-obsidian-muted">No projects available yet.</p>
      <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">Your team will set up project access for you.</p>
    </div>
  );
}

/* ─── Project card ─── */
function ClientProjectCard({ project }: { project: any }) {
  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const phaseIndex = PHASE_ORDER.indexOf(project.phase);
  const phasePct = phaseIndex >= 0 ? Math.round(((phaseIndex + 1) / PHASE_ORDER.length) * 100) : 0;
  const healthLabel = project.healthStatus === 'GREEN' ? 'Healthy' : project.healthStatus === 'YELLOW' ? 'At risk' : 'Critical';

  // Tiny secondary signal — surface a delivery target or a "started X" line
  // so each card has at least one piece of fresh-feeling text beyond the
  // phase rail. Without this the cards looked identical in screenshots.
  const targetIso = project.targetDate;
  const daysToTarget = targetIso
    ? Math.ceil((new Date(targetIso).getTime() - Date.now()) / 86_400_000)
    : null;
  const targetCue =
    daysToTarget == null ? null
    : daysToTarget < 0 ? { tone: 'rose' as const, text: `${-daysToTarget} days past target` }
    : daysToTarget <= 14 ? { tone: 'amber' as const, text: `${daysToTarget} ${daysToTarget === 1 ? 'day' : 'days'} to target` }
    : { tone: 'neutral' as const, text: `${daysToTarget} days to target` };

  return (
    <Link
      to={`/client/projects/${project.id}`}
      className={cn(
        'group relative block rounded-2xl border p-6 transition-all duration-200',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'hover:shadow-lift dark:hover:shadow-lift-dark hover:border-brand-300/60 dark:hover:border-brand-500/30',
        'hover:-translate-y-0.5',
      )}
    >
      {/* Hover halo */}
      <span className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full bg-brand-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* Title + health */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">{project.name}</h3>
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium shrink-0"
          style={{ backgroundColor: healthColor + '15', color: healthColor }}
        >
          <span
            className={cn('w-1.5 h-1.5 rounded-full', project.healthStatus === 'RED' && 'animate-pulse')}
            style={{ backgroundColor: healthColor }}
          />
          {healthLabel}
        </div>
      </div>

      {project.clientDescription && (
        <p className="text-sm text-gray-600 dark:text-obsidian-muted mb-5 line-clamp-2 leading-relaxed">
          {project.clientDescription}
        </p>
      )}

      {/* Phase progress */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-[11px] mb-2">
          <span className="text-gray-500 dark:text-obsidian-muted uppercase tracking-wider font-medium">Phase</span>
          <span className="text-gray-700 dark:text-obsidian-fg font-medium">{PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]}</span>
        </div>
        <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-700 ease-out"
            style={{ width: `${phasePct}%` }}
          />
        </div>
        {/* Phase dots — gives a sense of "where we are in the journey" */}
        <div className="flex justify-between mt-1.5">
          {PHASE_ORDER.map((phase, i) => (
            <div
              key={phase}
              className={cn(
                'w-1.5 h-1.5 rounded-full transition-colors',
                i <= phaseIndex
                  ? 'bg-brand-500 dark:bg-brand-400'
                  : 'bg-gray-200 dark:bg-obsidian-raised',
              )}
              title={PHASE_LABELS[phase]}
            />
          ))}
        </div>
      </div>

      {/* Mini fact strip — three small signals so the card carries more
          information per pixel without becoming a wall of text. */}
      <div className="grid grid-cols-3 gap-2 mb-4 text-[11px]">
        <MiniFact
          icon={<CalendarClock size={11} />}
          label="Started"
          value={project.startDate ? formatDate(project.startDate) : '—'}
        />
        <MiniFact
          icon={<Target size={11} />}
          label="Target"
          value={project.targetDate ? formatDate(project.targetDate) : 'TBD'}
          tone={targetCue?.tone}
          accent={targetCue?.text}
        />
        <MiniFact
          icon={<Activity size={11} />}
          label="Status"
          value={healthLabel}
        />
      </div>

      {/* View link */}
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-brand-600 dark:text-brand-400 group-hover:gap-2 transition-all">
        <span>View status</span>
        <ArrowUpRight size={14} />
      </div>
    </Link>
  );
}

/* ─── Tiny key-value pair for the card fact strip ─── */
function MiniFact({
  icon, label, value, tone, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'neutral' | 'amber' | 'rose';
  accent?: string;
}) {
  const valueTone: Record<string, string> = {
    neutral: 'text-gray-800 dark:text-obsidian-fg',
    amber:   'text-amber-700 dark:text-amber-400',
    rose:    'text-rose-700 dark:text-rose-400',
  };
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-obsidian-faded">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </p>
      <p className={cn('mt-0.5 font-medium truncate', valueTone[tone ?? 'neutral'])}>
        {value}
      </p>
      {accent && (
        <p className={cn('text-[10px] truncate', valueTone[tone ?? 'neutral'])}>
          {accent}
        </p>
      )}
    </div>
  );
}
