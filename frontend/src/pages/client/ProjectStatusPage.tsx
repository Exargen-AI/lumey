import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarClock, Diamond, Activity as ActivityIcon,
} from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { getStatusUpdates } from '@/api/statusUpdates';
import { getMilestones } from '@/api/milestones';
import { HEALTH_COLORS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatRelative, formatDate } from '@/lib/formatters';
import { ProjectAcknowledgmentGate } from '@/components/security/ProjectAcknowledgmentGate';
import { ClientActionsCallout } from '@/components/projects/ClientActionsCallout';
import { PulsePanel } from '@/components/projects/PulsePanel';

/**
 * Client portal — Overview.
 *
 * The page is the at-a-glance answer to "is my project on track?"
 * Structure:
 *
 *   1. Action callout — only when the client has something waiting.
 *   2. Project hero — name + description + current health pill.
 *   3. **Project Pulse panel** — the actual analytics. Schedule
 *      confidence, completion, velocity (with trend arrow) up top;
 *      burn-up area chart vs. ideal trajectory in the middle;
 *      velocity sparkline + next-milestone chip below. Replaces the
 *      old four-tile Tier 1 scorecard (4 facts, no story) with one
 *      integrated visualization.
 *   4. Two compact preview panels: recent activity + next milestones,
 *      each linking to its full section.
 *
 * Sidebar handles the back-to-portfolio navigation, so there's no
 * back link at the top.
 */
export function ClientProjectStatusPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading, isError: projectFailed } = useProject(id!);
  const { data: statusUpdates } = useQuery({
    queryKey: ['status-updates', id],
    queryFn: () => getStatusUpdates(id!),
    enabled: !!id,
  });
  // Milestones are also pulled by PulsePanel; react-query dedupes the
  // call so we don't fire it twice.
  const { data: milestones } = useQuery({
    queryKey: ['milestones', id],
    queryFn: () => getMilestones(id!),
    enabled: !!id,
  });

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-72 rounded-2xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-48 rounded-2xl" />
          <div className="skeleton h-48 rounded-2xl" />
        </div>
      </div>
    );
  }

  // Distinguish a real "no such project" (404) from a transient load
  // failure (500 / dropped network). Showing "not found" on a transient
  // error reads to a client as "your project was deleted" — alarming and
  // wrong. The error path offers a refresh instead.
  if (projectFailed) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-gray-600 dark:text-obsidian-muted">
          We couldn’t load this project right now.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          Refresh to try again
        </button>
      </div>
    );
  }

  if (!project) {
    return <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">Project not found.</div>;
  }

  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const healthLabel =
    project.healthStatus === 'GREEN' ? 'Healthy'
    : project.healthStatus === 'YELLOW' ? 'At risk'
    : 'Critical';

  const sortedUpdates = (statusUpdates ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Upcoming milestones, in chronological order. Two-week history window +
  // future shows the "where we were → where we're going" story even on quiet
  // weeks. Visibility is already gated by the backend per project access, so
  // we don't re-filter by `clientVisible` (that would hide internal
  // milestones from a full-access client).
  const sortedMilestones = (milestones ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const upcomingMilestones = sortedMilestones
    .filter((m: any) => m.status !== 'COMPLETED' || new Date(m.date).getTime() > Date.now() - 14 * 86_400_000)
    .slice(0, 4);

  return (
    <ProjectAcknowledgmentGate projectId={id!} projectName={project.name} refuseRedirect="/client/dashboard">
      <div className="space-y-7">
        {/* ─── "Your action needed" callout (self-hides when nothing pending) ─── */}
        <ClientActionsCallout projectId={id!} />

        {/* ─── Project hero ─── Slim header with name + description +
             health pill. The forecast story moved into PulsePanel so
             the hero stays clean and identity-focused. */}
        <div className={cn(
          'relative overflow-hidden rounded-2xl border p-6 sm:p-7',
          'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
          'shadow-soft dark:shadow-soft-dark',
          'animate-fade-in-up',
        )}>
          <span
            aria-hidden
            className="pointer-events-none absolute -top-20 -right-20 w-64 h-64 rounded-full bg-brand-500/[0.06] dark:bg-brand-500/[0.08] blur-3xl"
          />

          <div className="relative flex items-start justify-between gap-5">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">{project.name}</h1>
              {project.clientDescription && (
                <p className="text-sm text-gray-600 dark:text-obsidian-muted mt-2 max-w-2xl leading-relaxed">
                  {project.clientDescription}
                </p>
              )}
            </div>
            <div className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center ring-1',
                  project.healthStatus === 'RED' && 'animate-pulse',
                )}
                style={{
                  backgroundColor: healthColor + '15',
                  boxShadow: `inset 0 0 0 1px ${healthColor}30`,
                }}
              >
                <div className="w-5 h-5 rounded-full" style={{ backgroundColor: healthColor }} />
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
                {healthLabel}
              </span>
            </div>
          </div>
        </div>

        {/* ─── PROJECT PULSE ─── The integrated analytics panel. */}
        <PulsePanel projectId={id!} />

        {/* ─── Recent activity + Upcoming milestones preview ───
            Two compact panels sit below the pulse so the Overview keeps
            reading "well, what's the team actually doing?" without
            forcing the client into another tab. */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PreviewPanel
            title="Recent activity"
            icon={<ActivityIcon size={14} className="text-brand-500 dark:text-brand-400" />}
            ctaLabel="See full activity"
            ctaHref={`/client/projects/${id}/activity`}
            emptyLine="The team hasn't posted a status update yet."
            isEmpty={sortedUpdates.length === 0}
          >
            <ul className="space-y-3">
              {sortedUpdates.slice(0, 3).map((update: any) => (
                <li key={update.id} className="flex items-start gap-3">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand-500 dark:bg-brand-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">
                      {update.title || 'Status update'}
                    </p>
                    {update.content && (
                      <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5 leading-snug line-clamp-2">
                        {update.content}
                      </p>
                    )}
                    <p className="text-[10.5px] text-gray-400 dark:text-obsidian-faded mt-1">
                      {formatRelative(update.createdAt)}
                      {update.author?.name && ` · ${update.author.name}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </PreviewPanel>

          <PreviewPanel
            title="Next milestones"
            icon={<CalendarClock size={14} className="text-indigo-500 dark:text-indigo-400" />}
            ctaLabel="Open roadmap"
            ctaHref={`/client/projects/${id}/roadmap`}
            emptyLine="No milestones set yet. The team will add them as the roadmap firms up."
            isEmpty={upcomingMilestones.length === 0}
          >
            <ul className="space-y-3">
              {upcomingMilestones.map((m: any) => {
                const ms = new Date(m.date).getTime();
                const daysOut = Math.ceil((ms - Date.now()) / 86_400_000);
                const isPast = ms < Date.now();
                const isCompleted = m.status === 'COMPLETED';
                const accent =
                  isCompleted ? 'emerald'
                  : isPast ? 'rose'
                  : daysOut <= 7 ? 'amber'
                  : 'indigo';
                const accentDot: Record<string, string> = {
                  emerald: 'bg-emerald-500',
                  rose:    'bg-rose-500',
                  amber:   'bg-amber-500',
                  indigo:  'bg-indigo-500',
                };
                const accentText: Record<string, string> = {
                  emerald: 'text-emerald-600 dark:text-emerald-400',
                  rose:    'text-rose-600 dark:text-rose-400',
                  amber:   'text-amber-600 dark:text-amber-400',
                  indigo:  'text-gray-500 dark:text-obsidian-muted',
                };
                return (
                  <li key={m.id} className="flex items-start gap-3">
                    <Diamond size={9} className={cn('mt-1.5 shrink-0', accentText[accent])} fill="currentColor" />
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        'text-[13px] font-medium truncate',
                        isCompleted ? 'text-gray-500 dark:text-obsidian-muted' : 'text-gray-900 dark:text-obsidian-fg',
                      )}>
                        {m.title}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5">
                        {formatDate(m.date)}
                        {' · '}
                        <span className={cn('font-medium', accentText[accent])}>
                          {isCompleted ? 'Done' : isPast ? 'Past due' : daysOut === 0 ? 'Today' : daysOut === 1 ? 'Tomorrow' : `in ${daysOut} days`}
                        </span>
                      </p>
                    </div>
                    <span aria-hidden className={cn('w-1.5 h-1.5 rounded-full mt-2 shrink-0', accentDot[accent])} />
                  </li>
                );
              })}
            </ul>
          </PreviewPanel>
        </section>
      </div>
    </ProjectAcknowledgmentGate>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   PreviewPanel — small inline panel with header + content + linked CTA.
   Self-handles the empty state so a brand-new project page doesn't show
   two blank boxes.
   ───────────────────────────────────────────────────────────────────────── */
function PreviewPanel({
  title, icon, ctaLabel, ctaHref, emptyLine, isEmpty, children,
}: {
  title: string;
  icon: React.ReactNode;
  ctaLabel: string;
  ctaHref: string;
  emptyLine: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-5 flex flex-col',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted truncate">
            {title}
          </h2>
        </div>
        <Link
          to={ctaHref}
          className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 inline-flex items-center gap-1 shrink-0 transition-colors"
        >
          {ctaLabel}
          <ArrowRight size={11} />
        </Link>
      </div>
      {isEmpty ? (
        <p className="text-[12.5px] text-gray-400 dark:text-obsidian-faded py-4 flex-1">
          {emptyLine}
        </p>
      ) : (
        <div className="flex-1">{children}</div>
      )}
    </div>
  );
}
