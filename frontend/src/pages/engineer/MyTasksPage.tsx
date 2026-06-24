import { useNavigate } from 'react-router-dom';
import { CheckSquare, Inbox } from 'lucide-react';
import { useMyTasks } from '@/hooks/useTasks';
import { useAuthStore } from '@/stores/authStore';
import { getTaskRoute } from '@/lib/constants';
import { UnifiedTaskCard } from '@/components/tasks/UnifiedTaskCard';
import { cn } from '@/lib/cn';

export function MyTasksPage() {
  const navigate = useNavigate();
  const { data: tasks, isLoading } = useMyTasks();
  // Role-aware navigation. Engineers go to /eng/projects/..., PMs to
  // /pm/projects/..., admins to /projects/... — `getProjectRoute` already
  // encodes the role-to-path mapping. Team feedback #3: previously this
  // page was hard-coded `/eng/projects/...` so admins/PMs got 404 on
  // click even when they had a "My Tasks" entry point. Now the same
  // component serves all three roles.
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const taskPath = (projectId: string, taskId: string) => getTaskRoute(user?.role || 'ADMIN', projectId, taskId, permissions);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-40 rounded" />
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
      </div>
    );
  }

  // Group by project so the user sees "what's mine, by project" — easier triage
  // than one flat list when working across multiple codebases at once.
  const byProject = new Map<string, { name: string; id: string; tasks: any[] }>();
  tasks?.forEach((t: any) => {
    const key = t.project?.id || 'unknown';
    if (!byProject.has(key)) byProject.set(key, { name: t.project?.name || 'Unknown', id: key, tasks: [] });
    byProject.get(key)!.tasks.push(t);
  });

  const totalTasks = tasks?.length ?? 0;
  const activeCount = tasks?.filter((t: any) => t.status !== 'DONE').length ?? 0;

  return (
    <div className="space-y-7">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-500/10 dark:bg-brand-500/15 ring-1 ring-brand-500/20 flex items-center justify-center">
            <CheckSquare size={18} className="text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">My Tasks</h1>
            <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
              {totalTasks > 0
                ? `${activeCount} active · ${totalTasks - activeCount} done · across ${byProject.size} ${byProject.size === 1 ? 'project' : 'projects'}`
                : 'Everything assigned to you across projects'}
            </p>
          </div>
        </div>
      </div>

      {/* ─── Empty state ─── */}
      {byProject.size === 0 ? (
        <div className={cn(
          'rounded-2xl border-2 border-dashed py-16 text-center',
          'border-gray-200 dark:border-obsidian-border',
          'bg-white/40 dark:bg-obsidian-panel/40',
        )}>
          <Inbox size={36} strokeWidth={1.5} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
          <p className="text-sm text-gray-500 dark:text-obsidian-muted">No tasks assigned to you.</p>
          <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">When something's on your plate, it'll show up here.</p>
        </div>
      ) : (
        <div className="stagger-fade space-y-6">
          {Array.from(byProject.entries()).map(([projectId, { name, id, tasks: projectTasks }]) => (
            <div key={projectId}>
              {/* Project header — colored dot + name + count, matches Kanban column header pattern */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted">{name}</h2>
                <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {projectTasks.length}
                </span>
              </div>

              <div className={cn(
                'rounded-2xl overflow-hidden divide-y',
                'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
                'divide-gray-100 dark:divide-obsidian-border/60',
                'shadow-soft dark:shadow-soft-dark',
              )}>
                {projectTasks.map((task: any) => (
                  <div
                    key={task.id}
                    onClick={() => navigate(taskPath(id, task.id))}
                    className="cursor-pointer"
                  >
                    <UnifiedTaskCard task={task} variant="list" showProject={false} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
