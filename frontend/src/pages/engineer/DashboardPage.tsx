import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, DragOverlay, useDroppable, useDraggable,
  PointerSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { Pencil, CheckCircle2, Flame, TrendingUp, TrendingDown, GripVertical, ArrowUpRight } from 'lucide-react';
import { useMyTasks, useMoveTask } from '@/hooks/useTasks';
import { useMyProductivity, useMyStreak, useTodayStatus } from '@/hooks/useDailyUpdates';
import { useAuthStore } from '@/stores/authStore';
import { PRIORITY_COLORS, PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/constants';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { Button, Badge } from '@/components/ui';
import { StreakHeatmap } from '@/components/engineer/StreakHeatmap';
import { EncouragementBanner } from '@/components/engineer/EncouragementBanner';

export function EngDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { data: tasks } = useMyTasks();
  const { data: stats } = useMyProductivity(7);
  const { data: streak } = useMyStreak();
  const { data: todayStatus } = useTodayStatus();
  const moveTask = useMoveTask();
  const [activeTask, setActiveTask] = useState<any>(null);

  const firstName = user?.name?.split(' ')[0] || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const completedThisWeek = stats?.tasksCompletedThisWeek ?? 0;
  const completedLastWeek = stats?.tasksCompletedLastWeek ?? 0;
  const weekDiff = completedThisWeek - completedLastWeek;
  const currentStreak = streak?.currentStreak ?? 0;

  const activeTasks = tasks?.filter((t: any) => t.status !== 'DONE') ?? [];
  const doneTasks = tasks?.filter((t: any) => t.status === 'DONE') ?? [];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks?.find((t: any) => t.id === event.active.id);
    if (task) setActiveTask(task);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const task = tasks?.find((t: any) => t.id === taskId);
    if (!task) return;

    if (over.id === 'done-zone' && task.status !== 'DONE') {
      moveTask.mutate({ id: taskId, status: 'DONE' });
    } else if (over.id === 'active-zone' && task.status === 'DONE') {
      moveTask.mutate({ id: taskId, status: 'IN_PROGRESS' });
    }
  };

  const dailyCounts = stats?.dailyCompletionCounts ?? [];
  const maxDaily = Math.max(...dailyCounts.map((d: any) => d.count), 1);
  const todayCount = (() => {
    const todayKey = new Date().toDateString();
    return dailyCounts.find((d: any) => new Date(d.date).toDateString() === todayKey)?.count || 0;
  })();

  // Compute the "Today's Focus" — highest-priority active task that isn't blocked.
  // Stable: same input → same pick. P0 wins over P1 wins over due-soon over recently created.
  const todayFocus = (() => {
    if (!activeTasks.length) return null;
    const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    const sorted = [...activeTasks]
      .filter((t: any) => !t.isBlocked)
      .sort((a: any, b: any) => {
        const pr = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
        if (pr !== 0) return pr;
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return ad - bd;
      });
    return sorted[0] || null;
  })();

  return (
    <div className="space-y-7">
      {/* ─── Greeting row ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            {greeting}, <span className="bg-gradient-to-r from-brand-500 to-brand-300 bg-clip-text text-transparent">{firstName}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {currentStreak > 0 && (
            <Badge tone="warning">
              <Flame size={12} className="text-orange-500" />
              <span>{currentStreak} day streak</span>
            </Badge>
          )}
          {todayStatus?.submitted ? (
            <Badge tone="success" dot>EOD done</Badge>
          ) : (
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Pencil size={14} />}
              onClick={() => navigate('/eng/eod-update')}
            >
              EOD Update
            </Button>
          )}
        </div>
      </div>

      {/* ─── Encouraging banner ─── */}
      <EncouragementBanner
        firstName={firstName}
        stats={{
          currentStreak,
          longestStreak: streak?.longestStreak ?? 0,
          submittedToday: !!todayStatus?.submitted,
          completedToday: todayCount,
          completedThisWeek,
          completedLastWeek,
          activeTaskCount: activeTasks.length,
        }}
      />

      {/* ─── Today's focus ─── */}
      {todayFocus && (
        <button
          onClick={() => navigate(`/eng/projects/${todayFocus.projectId || todayFocus.project?.id}/tasks/${todayFocus.id}`)}
          className={cn(
            'group w-full text-left relative overflow-hidden rounded-2xl border p-5',
            'bg-gradient-to-br from-brand-500/[0.08] via-transparent to-fuchsia-500/[0.05]',
            'border-brand-200/60 dark:border-brand-500/20',
            'bg-white dark:bg-obsidian-panel',
            'shadow-soft dark:shadow-soft-dark hover:shadow-lift dark:hover:shadow-lift-dark hover-lift',
            'animate-fade-in-up',
          )}
        >
          {/* Subtle accent halo on hover */}
          <span className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full bg-brand-500/15 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-white dark:bg-obsidian-raised ring-1 ring-brand-500/20 dark:ring-brand-400/25 flex items-center justify-center text-xl shrink-0">
              🎯
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-600 dark:text-brand-400">Today's focus</p>
              <p className="mt-1 text-[15px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{todayFocus.title}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[11px] text-gray-500 dark:text-obsidian-muted">{todayFocus.project?.name}</span>
                <span className="text-[10px] font-bold rounded px-1.5 py-0.5"
                  style={{
                    backgroundColor: PRIORITY_COLORS[todayFocus.priority as keyof typeof PRIORITY_COLORS] + '20',
                    color: PRIORITY_COLORS[todayFocus.priority as keyof typeof PRIORITY_COLORS],
                  }}>
                  {PRIORITY_LABELS[todayFocus.priority as keyof typeof PRIORITY_LABELS]}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-obsidian-muted">{TASK_STATUS_LABELS[todayFocus.status as keyof typeof TASK_STATUS_LABELS]}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 text-[12px] font-medium text-brand-600 dark:text-brand-400 shrink-0 group-hover:translate-x-0.5 transition-transform">
              Open <ArrowUpRight size={14} />
            </div>
          </div>
        </button>
      )}

      {/* ─── Streak heatmap ─── */}
      {streak?.recentDays && (
        <StreakHeatmap
          recentDays={streak.recentDays}
          currentStreak={currentStreak}
          longestStreak={streak.longestStreak ?? 0}
        />
      )}

      {/* ─── Split view: Active / Done ─── */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5" style={{ minHeight: '420px' }}>
          <DroppableZone id="active-zone" title="Active" count={activeTasks.length} accent="brand">
            {activeTasks.length === 0 ? (
              <EmptyZone icon={<CheckCircle2 size={28} className="text-emerald-500/70" />} text="All caught up!" />
            ) : (
              <div className="stagger-fade space-y-1.5">
                {activeTasks.map((task: any) => (
                  <DraggableTaskCard key={task.id} task={task} onClick={() => {
                    const projId = task.projectId || task.project?.id;
                    if (projId) navigate(`/eng/projects/${projId}/tasks/${task.id}`);
                  }} />
                ))}
              </div>
            )}
          </DroppableZone>

          <DroppableZone id="done-zone" title="Completed" count={doneTasks.length} accent="emerald">
            {doneTasks.length === 0 ? (
              <EmptyZone icon={<CheckCircle2 size={28} className="text-gray-300 dark:text-obsidian-faded" />} text="Drag tasks here when done" />
            ) : (
              <div className="stagger-fade space-y-1.5">
                {doneTasks.slice(0, 10).map((task: any) => (
                  <DraggableTaskCard key={task.id} task={task} isDone onClick={() => {
                    const projId = task.projectId || task.project?.id;
                    if (projId) navigate(`/eng/projects/${projId}/tasks/${task.id}`);
                  }} />
                ))}
                {doneTasks.length > 10 && (
                  <p className="text-xs text-gray-400 dark:text-obsidian-faded text-center py-2">+{doneTasks.length - 10} more completed</p>
                )}
              </div>
            )}
          </DroppableZone>
        </div>

        <DragOverlay>
          {activeTask ? <DragOverlayCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>

      {/* ─── Stats row ─── */}
      <div className="stagger-fade grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="This Week"
          value={completedThisWeek}
          unit="completed"
          trend={weekDiff !== 0 ? (
            <Badge tone={weekDiff > 0 ? 'success' : 'danger'} size="xs">
              {weekDiff > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {weekDiff > 0 ? '+' : ''}{weekDiff}
            </Badge>
          ) : null}
        />
        <StatCard
          label="Velocity"
          value={stats?.avgTasksPerWeek ?? 0}
          unit="/week"
        />
        <StatCard
          label="Last 7 days"
          custom={
            dailyCounts.length > 0 ? (
              <div className="flex items-end gap-1 h-9 mt-2.5">
                {dailyCounts.map((day: any, i: number) => {
                  const isToday = new Date(day.date).toDateString() === new Date().toDateString();
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end">
                      <div
                        className={cn(
                          'w-full rounded-sm transition-all duration-200',
                          isToday
                            ? 'bg-brand-500'
                            : day.count > 0
                              ? 'bg-brand-300/70 dark:bg-brand-500/40'
                              : 'bg-gray-100 dark:bg-obsidian-raised',
                        )}
                        style={{ height: `${Math.max(4, (day.count / maxDaily) * 32)}px` }}
                        title={`${day.date}: ${day.count}`}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <span className="text-3xl font-semibold text-gray-300 dark:text-obsidian-faded mt-2">—</span>
            )
          }
        />
      </div>
    </div>
  );
}

// ─── Stat card ───

function StatCard({ label, value, unit, trend, custom }: {
  label: string; value?: number; unit?: string; trend?: React.ReactNode; custom?: React.ReactNode;
}) {
  return (
    <div className={cn(
      'rounded-xl border p-5 hover-lift',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark hover:shadow-lift dark:hover:shadow-lift-dark',
    )}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-obsidian-muted">{label}</p>
        {trend}
      </div>
      {custom ? (
        custom
      ) : (
        <p className="text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg mt-3 tabular-nums">
          {value}
          {unit && <span className="text-sm font-normal text-gray-400 dark:text-obsidian-faded ml-1.5">{unit}</span>}
        </p>
      )}
    </div>
  );
}

// ─── Droppable Zone ───

function DroppableZone({ id, title, count, accent, children }: {
  id: string; title: string; count: number; accent: 'brand' | 'emerald'; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const headerColor = accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-brand-600 dark:text-brand-400';
  const countBg = accent === 'emerald'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
    : 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300';
  const overRing = accent === 'emerald'
    ? 'ring-2 ring-emerald-400/60 bg-emerald-50/40 dark:bg-emerald-500/[0.04]'
    : 'ring-2 ring-brand-400/60 bg-brand-50/40 dark:bg-brand-500/[0.04]';

  return (
    <div ref={setNodeRef} className={cn(
      'rounded-2xl border p-4 min-h-[300px] transition-all duration-200',
      'bg-white/70 border-gray-200 dark:bg-obsidian-panel/60 dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
      isOver && overRing,
    )}>
      <div className="flex items-center gap-2 mb-4 px-1">
        <h2 className={cn('text-[11px] font-semibold uppercase tracking-[0.12em]', headerColor)}>{title}</h2>
        <span className={cn('text-[11px] font-bold rounded-full px-2 py-0.5', countBg)}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function EmptyZone({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="py-14 text-center text-gray-400 dark:text-obsidian-faded flex flex-col items-center gap-2">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}

// ─── Draggable Task Card ───

function DraggableTaskCard({ task, isDone, onClick }: { task: any; isDone?: boolean; onClick?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const wasDragging = useRef(false);
  if (isDragging) wasDragging.current = true;

  const handleClick = () => {
    if (wasDragging.current) { wasDragging.current = false; return; }
    onClick?.();
  };

  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS];

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onClick={handleClick}
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-150 cursor-grab active:cursor-grabbing',
        'border border-transparent',
        isDragging && 'opacity-40',
        isDone
          ? 'bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-500/[0.05] dark:hover:bg-emerald-500/[0.08]'
          : task.isBlocked
            ? 'bg-rose-50/70 hover:bg-rose-100/60 dark:bg-rose-500/[0.06] dark:hover:bg-rose-500/[0.10] hover:border-rose-200 dark:hover:border-rose-500/30'
            : 'bg-gray-50 hover:bg-white dark:bg-obsidian-bg/60 dark:hover:bg-obsidian-raised hover:border-gray-200 dark:hover:border-obsidian-border-strong',
      )}>
      <div className="text-gray-300 dark:text-obsidian-faded group-hover:text-gray-500 dark:group-hover:text-obsidian-muted shrink-0 transition-colors">
        {isDone ? <CheckCircle2 size={16} className="text-emerald-500" /> : <GripVertical size={14} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-[13px] font-medium leading-snug',
          isDone
            ? 'text-gray-500 dark:text-obsidian-muted line-through'
            : 'text-gray-900 dark:text-obsidian-fg',
        )}>{task.title}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-gray-400 dark:text-obsidian-faded truncate">{task.project?.name}</span>
          {!isDone && (
            <>
              <span className="text-[10px] font-semibold rounded px-1.5 py-0.5"
                style={{ backgroundColor: priorityColor + '15', color: priorityColor }}>
                {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
              </span>
              {task.isBlocked && <span className="text-[10px] font-semibold bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 rounded px-1.5 py-0.5">Blocked</span>}
              <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">{TASK_STATUS_LABELS[task.status as keyof typeof TASK_STATUS_LABELS]}</span>
            </>
          )}
          {isDone && task.updatedAt && (
            <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">{formatRelative(task.updatedAt)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Drag Overlay Card ───

function DragOverlayCard({ task }: { task: any }) {
  return (
    <div className="bg-white dark:bg-obsidian-raised border border-brand-300 dark:border-brand-500/40 rounded-lg px-3 py-2.5 shadow-pop dark:shadow-pop-dark rotate-2 w-80">
      <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg">{task.title}</p>
      <p className="text-[10px] text-gray-400 dark:text-obsidian-faded mt-0.5">{task.project?.name}</p>
    </div>
  );
}
