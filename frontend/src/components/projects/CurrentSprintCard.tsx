import { CalendarClock, Target, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { useCurrentSprint } from '@/hooks/useCurrentSprint';
import type { SprintPace } from '@/api/currentSprint';
import { cn } from '@/lib/cn';

/**
 * Current-sprint snapshot card on the client project status page. Renders
 * the active sprint with day-counter, completion bar, and a pace verdict.
 * Self-hides when no sprint is currently active on the project — clients
 * don't need to see "no sprint active" as a zero-state.
 *
 * Visual story: the time bar sits behind the completion bar so the client
 * can see at a glance whether work is keeping up with elapsed time.
 */
interface Props {
  projectId: string;
}

export function CurrentSprintCard({ projectId }: Props) {
  const { data, isLoading, error } = useCurrentSprint(projectId);

  if (isLoading || error || !data || !data.sprint) return null;
  const s = data.sprint;

  const paceConfig = PACE_CONFIG[s.pace];

  return (
    <section
      className={cn(
        'rounded-2xl border p-5',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'animate-fade-in-up',
      )}
    >
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarClock size={14} className="text-brand-500 dark:text-brand-400 shrink-0" />
          <h2 className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
            {s.name}
          </h2>
          {s.pace !== 'TOO_EARLY' && (
            <span
              className={cn(
                'shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase rounded-full px-1.5 py-0.5',
                paceConfig.chip,
              )}
              title={paceConfig.tooltip}
            >
              <paceConfig.Icon size={10} />
              {paceConfig.label}
            </span>
          )}
        </div>
        <span className={cn(
          'text-[11px] shrink-0 tabular-nums',
          s.isOverdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-gray-500 dark:text-obsidian-muted',
        )}>
          {s.isOverdue
            ? `Day ${s.daysElapsed} of ${s.totalDays} (overdue)`
            : `Day ${s.daysElapsed} of ${s.totalDays}`}
        </span>
      </header>

      {s.goal && (
        <p className="text-[12px] text-gray-600 dark:text-obsidian-muted mb-4 leading-relaxed line-clamp-2">
          <Target size={11} className="inline-block -translate-y-0.5 mr-1 text-gray-400" />
          {s.goal}
        </p>
      )}

      {/* Stacked progress visualization: a thin elapsed-time bar sits behind
          a thicker completion bar. When completion ≥ elapsed-time, the
          completion bar covers the time bar entirely (looks healthy).
          When completion < elapsed-time, the time bar peeks out beyond
          completion — instant visual cue of slippage. */}
      <div className="relative w-full h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised mb-3">
        <div
          className={cn(
            'absolute top-0 left-0 h-full',
            'bg-gray-300 dark:bg-obsidian-faded/40',
          )}
          style={{ width: `${s.timeElapsedPct}%` }}
          title={`Time elapsed: ${s.timeElapsedPct}%`}
        />
        <div
          className={cn(
            'absolute top-0 left-0 h-full transition-all duration-500 ease-out rounded-full',
            paceConfig.bar,
          )}
          style={{ width: `${s.completionPct}%` }}
          title={`Work completed: ${s.completionPct}%`}
        />
      </div>

      <div className="flex items-center gap-4 text-[12px]">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">
            {s.tasksDone}/{s.tasksTotal}
          </span>
          <span className="text-gray-400 dark:text-obsidian-faded">tasks</span>
        </div>
        {s.pointsTotal > 0 && (
          <>
            <span className="text-gray-200 dark:text-obsidian-border">·</span>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">
                {s.pointsDone}/{s.pointsTotal}
              </span>
              <span className="text-gray-400 dark:text-obsidian-faded">points</span>
            </div>
          </>
        )}
        <span className="text-gray-200 dark:text-obsidian-border">·</span>
        <span className="font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums">
          {s.completionPct}% complete
        </span>
      </div>
    </section>
  );
}

const PACE_CONFIG: Record<
  SprintPace,
  {
    label: string;
    tooltip: string;
    chip: string;
    bar: string;
    Icon: typeof TrendingUp;
  }
> = {
  ON_PACE: {
    label: 'On pace',
    tooltip: 'Work completed is keeping up with time elapsed.',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
    bar: 'bg-emerald-500 dark:bg-emerald-400',
    Icon: TrendingUp,
  },
  BEHIND: {
    label: 'Behind',
    tooltip: 'Work is slipping behind elapsed time — recoverable with effort.',
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
    bar: 'bg-amber-500 dark:bg-amber-400',
    Icon: Clock,
  },
  OFF_PACE: {
    label: 'Off pace',
    tooltip: 'Significant gap between work completed and time elapsed.',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
    bar: 'bg-rose-500 dark:bg-rose-400',
    Icon: AlertTriangle,
  },
  TOO_EARLY: {
    label: 'Just started',
    tooltip: 'Sprint just started — pace verdict appears once it has some history.',
    chip: 'bg-gray-100 text-gray-700 dark:bg-obsidian-raised dark:text-obsidian-muted',
    bar: 'bg-brand-500 dark:bg-brand-400',
    Icon: Clock,
  },
};
