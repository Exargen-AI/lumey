import { useMemo } from 'react';
import { Diamond, GanttChart } from 'lucide-react';
import { useTasks } from '@/hooks/useTasks';
import { useQuery } from '@tanstack/react-query';
import { getMilestones } from '@/api/milestones';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';

// Match the Kanban column dot palette so the same status reads the same colour
// across Board and Timeline tabs.
const STATUS_COLORS: Record<string, string> = {
  BACKLOG:     '#94a3b8', // slate-400
  TODO:        '#3b82f6', // blue-500
  IN_PROGRESS: '#8b5cf6', // brand-500 (violet)
  IN_REVIEW:   '#f59e0b', // amber-500
  DONE:        '#10b981', // emerald-500
};

const STATUS_LABELS: Record<string, string> = {
  BACKLOG:     'Backlog',
  TODO:        'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW:   'In Review',
  DONE:        'Done',
};

const MILESTONE_COLORS: Record<string, string> = {
  UPCOMING:  '#8b5cf6', // brand violet
  COMPLETED: '#10b981', // emerald
  MISSED:    '#f43f5e', // rose
};

export function ProjectTimeline({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading: tasksLoading } = useTasks(projectId);
  const { data: milestones, isLoading: milestonesLoading } = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => getMilestones(projectId),
    enabled: !!projectId,
  });

  const isLoading = tasksLoading || milestonesLoading;

  const { timelineItems, minDate, maxDate, totalDays } = useMemo(() => {
    if (!tasks?.length) return { timelineItems: [], minDate: new Date(), maxDate: new Date(), totalDays: 1 };

    const now = new Date();
    const items: any[] = [];

    tasks.forEach((t: any) => {
      if (t.dueDate || t.createdAt) {
        items.push({
          type: 'task',
          id: t.id,
          title: t.title,
          status: t.status,
          isBlocked: t.isBlocked,
          startDate: new Date(t.createdAt),
          endDate: t.dueDate ? new Date(t.dueDate) : now,
          assignee: t.assignee?.name,
          priority: t.priority,
        });
      }
    });

    milestones?.forEach((m: any) => {
      items.push({
        type: 'milestone',
        id: m.id,
        title: m.title,
        status: m.status,
        date: new Date(m.date),
      });
    });

    if (!items.length) return { timelineItems: [], minDate: now, maxDate: now, totalDays: 1 };

    const allDates = items.flatMap((item) =>
      item.type === 'milestone' ? [item.date] : [item.startDate, item.endDate]
    );
    const min = new Date(Math.min(...allDates.map((d: Date) => d.getTime())));
    const max = new Date(Math.max(...allDates.map((d: Date) => d.getTime()), now.getTime()));
    min.setDate(min.getDate() - 3);
    max.setDate(max.getDate() + 7);
    const total = Math.max(1, Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24)));

    return { timelineItems: items, minDate: min, maxDate: max, totalDays: total };
  }, [tasks, milestones]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="skeleton h-3 w-32 rounded" />
            <div className="skeleton h-6 flex-1 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!timelineItems.length) {
    return (
      <div className={cn(
        'rounded-2xl border-2 border-dashed py-16 text-center',
        'border-gray-200 dark:border-obsidian-border',
        'bg-white/40 dark:bg-obsidian-panel/40',
      )}>
        <GanttChart size={36} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
        <p className="text-sm text-gray-500 dark:text-obsidian-muted">No tasks with dates to show on the timeline.</p>
        <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">Add a due date to a task to see it here.</p>
      </div>
    );
  }

  const getPosition = (date: Date) => {
    const daysSinceStart = (date.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.min(100, (daysSinceStart / totalDays) * 100));
  };

  const todayPos = getPosition(new Date());
  const taskItems = timelineItems.filter((i: any) => i.type === 'task');
  const milestoneItems = timelineItems.filter((i: any) => i.type === 'milestone');

  return (
    <div className="space-y-5">
      {/* Legend */}
      <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-obsidian-muted flex-wrap">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className="w-3 h-2 rounded-sm" style={{ backgroundColor: color }} />
            <span>{STATUS_LABELS[status]}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-auto">
          <Diamond size={10} className="text-brand-500 dark:text-brand-400" fill="currentColor" />
          <span>Milestone</span>
        </div>
      </div>

      {/* Timeline header with month markers + today */}
      <div className={cn(
        'relative h-9 rounded-lg border overflow-hidden',
        'bg-gray-50 border-gray-200 dark:bg-obsidian-sunken dark:border-obsidian-border',
      )}>
        {generateMonthMarkers(minDate, maxDate, totalDays).map((marker, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-gray-200 dark:border-obsidian-border text-[10px] text-gray-400 dark:text-obsidian-faded pl-1.5 pt-1.5 font-medium"
            style={{ left: `${marker.position}%` }}
          >
            {marker.label}
          </div>
        ))}
        {/* Today marker — gradient ribbon with label */}
        <div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: `${todayPos}%` }}>
          <div className="w-0.5 h-full bg-rose-400 dark:bg-rose-500" />
          <span className="absolute top-0 left-1.5 text-[9px] text-rose-500 dark:text-rose-400 font-semibold whitespace-nowrap">Today</span>
        </div>
      </div>

      {/* Milestone row */}
      {milestoneItems.length > 0 && (
        <div className="relative h-10">
          {milestoneItems.map((m: any) => {
            const pos = getPosition(m.date);
            const color = MILESTONE_COLORS[m.status] || '#8b5cf6';
            return (
              <div
                key={m.id}
                className="absolute -translate-x-1/2 group"
                style={{ left: `${pos}%`, top: 0 }}
                title={`${m.title} — ${formatDate(m.date)}`}
              >
                <div className="relative">
                  <Diamond size={16} fill={color} className="text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]" />
                  {/* Soft glow on hover */}
                  <div
                    className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity blur-md"
                    style={{ backgroundColor: color }}
                  />
                </div>
                <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-500 dark:text-obsidian-muted whitespace-nowrap max-w-[90px] truncate font-medium">
                  {m.title}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Task bars */}
      <div className="space-y-1">
        {taskItems.map((task: any) => {
          const startPos = getPosition(task.startDate);
          const endPos = getPosition(task.endDate);
          const width = Math.max(1, endPos - startPos);
          const barColor = STATUS_COLORS[task.status] || '#94a3b8';

          return (
            <div key={task.id} className="flex items-center gap-3 group h-8 rounded-md px-1 hover:bg-gray-50 dark:hover:bg-obsidian-raised/60 transition-colors">
              <span className="text-[12px] text-gray-700 dark:text-obsidian-fg w-44 truncate shrink-0" title={task.title}>
                {task.title}
              </span>
              <div className="relative flex-1 h-6 rounded bg-gray-50 dark:bg-obsidian-sunken">
                <div
                  className={cn(
                    'absolute h-6 rounded transition-all duration-150 group-hover:shadow-lift dark:group-hover:shadow-lift-dark',
                    task.isBlocked && 'bg-stripes',
                  )}
                  style={{
                    left: `${startPos}%`,
                    width: `${width}%`,
                    backgroundColor: barColor,
                    minWidth: '6px',
                  }}
                  title={`${task.title} (${STATUS_LABELS[task.status]})\n${formatDate(task.startDate)} → ${formatDate(task.endDate)}${task.assignee ? `\nAssigned to ${task.assignee}` : ''}`}
                >
                  {width > 8 && task.assignee && (
                    <span className="absolute inset-0 flex items-center px-2 text-[10px] text-white font-medium truncate">
                      {task.assignee}
                    </span>
                  )}
                </div>
                {/* Today line through the row */}
                <div className="absolute top-0 bottom-0 w-px bg-rose-300/60 dark:bg-rose-500/40 pointer-events-none" style={{ left: `${todayPos}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        .bg-stripes {
          background-image: repeating-linear-gradient(
            45deg, transparent, transparent 4px, rgba(255,255,255,0.25) 4px, rgba(255,255,255,0.25) 8px
          );
        }
      `}</style>
    </div>
  );
}

// Month/year labels positioned along the timeline. Skips months that would
// land outside the visible range.
function generateMonthMarkers(minDate: Date, maxDate: Date, totalDays: number) {
  const markers: { position: number; label: string }[] = [];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const current = new Date(minDate);
  current.setDate(1);
  current.setMonth(current.getMonth() + 1);

  while (current <= maxDate) {
    const daysSinceStart = (current.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    const position = (daysSinceStart / totalDays) * 100;
    if (position >= 0 && position <= 100) {
      markers.push({ position, label: `${months[current.getMonth()]} ${current.getFullYear()}` });
    }
    current.setMonth(current.getMonth() + 1);
  }

  return markers;
}
