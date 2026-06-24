import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Diamond } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { getMilestones } from '@/api/milestones';
import { PHASE_LABELS, PHASE_ORDER } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { ProjectTimeline } from '@/components/timeline/ProjectTimeline';

/**
 * Client portal — Timeline tab. Split out of the old combined "Sprint &
 * Roadmap" page so the client nav mirrors the engineer board's dedicated
 * Sprints / Timeline tabs. This page is the roadmap-focused half:
 *
 *   1. Project phase rail — where we are in IDEA → ... → LAUNCHED
 *   2. Milestone timeline — every milestone with date, status, and the
 *      backend task-rollup progress
 *
 * Milestone visibility is gated by the backend per project access (client-
 * visible-only for a regular client, all milestones for staff + full-access
 * members), so we don't re-filter by `clientVisible` here.
 */
export function ClientTimelinePage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const { data: milestones } = useQuery({
    queryKey: ['milestones', id],
    queryFn: () => getMilestones(id!),
    enabled: !!id,
  });

  if (projectLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="skeleton h-20 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }
  if (!project) return null;

  const phaseIndex = PHASE_ORDER.indexOf(project.phase);

  // No client-side `clientVisible` re-filter — the backend already gates
  // milestone visibility per project access. `.slice()` before sort avoids
  // mutating the react-query cache array in place.
  const clientMilestones = (milestones ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="space-y-7 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Timeline
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          The project's phase and its milestones — what's been delivered, what's coming, and how each is tracking.
        </p>
      </header>

      {/* ─── Project phase rail ─── */}
      <Panel title="Project Phase">
        <div className="flex items-center justify-between text-[11px] mb-3">
          <span className="text-gray-500 dark:text-obsidian-muted uppercase tracking-wider font-semibold">Current phase</span>
          <span className="font-medium text-gray-700 dark:text-obsidian-fg">{PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]}</span>
        </div>
        <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-700 ease-out"
            style={{ width: `${((phaseIndex + 1) / PHASE_ORDER.length) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-2.5">
          {PHASE_ORDER.map((phase, i) => {
            const reached = i <= phaseIndex;
            return (
              <div key={phase} className="flex flex-col items-center" style={{ width: `${100 / PHASE_ORDER.length}%` }}>
                <div className={cn(
                  'w-2.5 h-2.5 rounded-full border-2 transition-colors',
                  reached
                    ? 'bg-brand-500 border-brand-500 dark:bg-brand-400 dark:border-brand-400'
                    : 'bg-white border-gray-300 dark:bg-obsidian-bg dark:border-obsidian-border-strong',
                )} />
                <span className={cn(
                  'text-[10px] mt-1.5',
                  reached
                    ? 'text-brand-600 dark:text-brand-400 font-semibold'
                    : 'text-gray-400 dark:text-obsidian-faded',
                )}>
                  {PHASE_LABELS[phase]}
                </span>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ─── Schedule (Gantt) ─── The same timeline visualization the team
          sees on the admin Timeline tab: milestones + task bars across the
          project window. Reuses ProjectTimeline, which reads the same
          per-project-gated task + milestone data. */}
      <div>
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted mb-3">
          Schedule
        </h2>
        <ProjectTimeline projectId={id!} />
      </div>

      {/* ─── Milestone timeline ─── */}
      <Panel title="Milestones">
        {clientMilestones.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-obsidian-faded py-4">No milestones set yet.</p>
        ) : (
          <div className="relative">
            <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200 dark:bg-obsidian-border" />
            <div className="space-y-5">
              {clientMilestones.map((milestone: any) => {
                const isCompleted = milestone.status === 'COMPLETED';
                const isMissed = milestone.status === 'MISSED';
                return (
                  <div key={milestone.id} className="relative pl-10">
                    <div
                      className={cn(
                        'absolute left-0.5 top-0.5 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-white dark:ring-obsidian-panel',
                        isCompleted ? 'bg-emerald-100 dark:bg-emerald-500/20'
                          : isMissed ? 'bg-rose-100 dark:bg-rose-500/20'
                          : 'bg-gray-100 dark:bg-obsidian-raised',
                      )}
                    >
                      <Diamond
                        size={9}
                        className={cn(
                          isCompleted ? 'text-emerald-600 dark:text-emerald-400'
                            : isMissed ? 'text-rose-600 dark:text-rose-400'
                            : 'text-gray-400 dark:text-obsidian-faded',
                        )}
                        fill="currentColor"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          'text-[13px] font-medium',
                          isCompleted ? 'text-gray-500 dark:text-obsidian-muted' : 'text-gray-900 dark:text-obsidian-fg',
                        )}>{milestone.title}</span>
                        {isCompleted && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Done</span>}
                        {isMissed && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Missed</span>}
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">{formatDate(milestone.date)}</span>
                      {milestone.description && <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-1 leading-relaxed">{milestone.description}</p>}
                      {/* Per-milestone progress from the backend task rollup
                          (clientVisible-gated). Only shown when the milestone
                          has tasks attached and isn't already complete. */}
                      {!isCompleted && milestone.progress && milestone.progress.totalTasks > 0 && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-obsidian-faded mb-1">
                            <span>{milestone.progress.doneTasks}/{milestone.progress.totalTasks} tasks</span>
                            <span className="tabular-nums">{milestone.progress.completionPct}%</span>
                          </div>
                          <div className="w-full h-1 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised">
                            <div
                              className={cn('h-full rounded-full', isMissed ? 'bg-rose-400 dark:bg-rose-400' : 'bg-brand-500 dark:bg-brand-400')}
                              style={{ width: `${milestone.progress.completionPct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-6 bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border shadow-soft dark:shadow-soft-dark">
      {title && (
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted mb-4">{title}</h2>
      )}
      {children}
    </div>
  );
}
