import { Flame } from 'lucide-react';
import { cn } from '@/lib/cn';

type Day = { date: string; submitted: boolean; mood: string | null };

// Mood → fill colour. Greens for "submitted + healthy", amber/red for "submitted
// but flagged". Empty cells are a near-invisible panel tint.
const MOOD_INTENSITY: Record<string, string> = {
  GREAT:      'bg-emerald-500',
  GOOD:       'bg-emerald-400',
  NEUTRAL:    'bg-emerald-300 dark:bg-emerald-400/70',
  STRUGGLING: 'bg-amber-400',
  BLOCKED:    'bg-rose-500',
};

function formatLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function StreakHeatmap({
  recentDays,
  currentStreak,
  longestStreak,
}: {
  recentDays: Day[];
  currentStreak: number;
  longestStreak: number;
}) {
  const submittedCount = recentDays.filter((d) => d.submitted).length;
  const submissionRate = recentDays.length > 0 ? Math.round((submittedCount / recentDays.length) * 100) : 0;

  return (
    <div className={cn(
      'rounded-2xl border p-5 shadow-soft dark:shadow-soft-dark',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'animate-fade-in-up',
    )}>
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-obsidian-fg flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-md bg-orange-500/10 dark:bg-orange-500/15 items-center justify-center">
              <Flame size={13} className="text-orange-500" />
            </span>
            Daily Updates
          </h3>
          <p className="text-xs text-gray-500 dark:text-obsidian-muted mt-1.5">
            Last 30 days · <span className="text-gray-700 dark:text-obsidian-fg font-medium">{submittedCount}</span> submitted
            <span className="text-gray-400 dark:text-obsidian-faded"> ({submissionRate}%)</span>
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-baseline gap-1.5 justify-end">
            <span className="text-2xl font-bold tracking-tight text-orange-500 tabular-nums">{currentStreak}</span>
            <span className="text-xs text-gray-500 dark:text-obsidian-muted">day streak</span>
          </div>
          {longestStreak > currentStreak && (
            <p className="text-[10px] text-gray-400 dark:text-obsidian-faded mt-0.5">best: {longestStreak} days</p>
          )}
        </div>
      </div>

      {/* Heatmap — 30 cells, dense grid that fills available width */}
      <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1">
        {recentDays.map((day) => {
          const dayLabel = formatLabel(day.date);
          const baseClass = 'aspect-square rounded-[3px] transition-all duration-150 hover:scale-[1.18] hover:ring-2 hover:ring-brand-400/40 cursor-default';
          if (!day.submitted) {
            return (
              <div
                key={day.date}
                className={cn(baseClass, 'bg-gray-100 dark:bg-obsidian-raised')}
                title={`${dayLabel} — no update`}
              />
            );
          }
          const fill = day.mood ? MOOD_INTENSITY[day.mood] : 'bg-emerald-400';
          return (
            <div
              key={day.date}
              className={cn(baseClass, fill)}
              title={`${dayLabel} — ${day.mood?.replace('_', ' ').toLowerCase() || 'submitted'}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-4 text-[10px] text-gray-400 dark:text-obsidian-faded">
        <span>fewer</span>
        <div className="flex gap-0.5">
          <div className="w-2.5 h-2.5 rounded-[2px] bg-gray-100 dark:bg-obsidian-raised" />
          <div className="w-2.5 h-2.5 rounded-[2px] bg-emerald-300 dark:bg-emerald-400/70" />
          <div className="w-2.5 h-2.5 rounded-[2px] bg-emerald-400" />
          <div className="w-2.5 h-2.5 rounded-[2px] bg-emerald-500" />
        </div>
        <span>more</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-[2px] bg-amber-400" /> stuck</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-[2px] bg-rose-500" /> blocked</span>
        </div>
      </div>
    </div>
  );
}
