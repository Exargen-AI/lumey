import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, KanbanSquare, GitBranch, Lightbulb, Layers, Eye } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { HEALTH_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { Can } from '@/components/auth/Can';
import { Button, Tabs, type TabItem } from '@/components/ui';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ProjectTimeline } from '@/components/timeline/ProjectTimeline';
import { DecisionList } from '@/components/decisions/DecisionList';
import { EpicList } from '@/components/epics/EpicList';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { useTasks } from '@/hooks/useTasks';
import { ProjectAcknowledgmentGate } from '@/components/security/ProjectAcknowledgmentGate';

type TabId = 'Board' | 'Epics' | 'Timeline' | 'Decisions';

const TABS: TabItem<TabId>[] = [
  { id: 'Board',     label: 'Board',     icon: KanbanSquare },
  { id: 'Epics',     label: 'Epics',     icon: Layers },
  { id: 'Timeline',  label: 'Timeline',  icon: GitBranch },
  { id: 'Decisions', label: 'Decisions', icon: Lightbulb },
];

export function PMProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('Board');
  const { data: project, isLoading } = useProject(id!);
  // Slide-over state shared by Board / Epics so J/K nav walks the whole project.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const { data: visibleTasks } = useTasks(id!);
  const taskSiblings = (visibleTasks ?? []).map((t: any) => t.id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-10 w-1/3 rounded" />
        <div className="skeleton h-6 w-1/4 rounded" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }
  if (!project) return <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">Project not found.</div>;

  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const categoryColor = CATEGORY_COLORS[project.category as keyof typeof CATEGORY_COLORS];
  const healthLabel = project.healthStatus === 'GREEN' ? 'Healthy' : project.healthStatus === 'YELLOW' ? 'At risk' : 'Critical';

  return (
    <ProjectAcknowledgmentGate projectId={id!} projectName={project.name} refuseRedirect="/pm/projects">
      <div className="space-y-6">
        {/* ─── Header ─── */}
        <div className="flex items-start justify-between gap-4 animate-fade-in-down">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <button
              onClick={() => navigate('/pm/projects')}
              className="mt-1 p-2 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel transition-colors shrink-0"
              title="Back to projects"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">{project.name}</h1>
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
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span
                  className="px-2 py-0.5 text-[10px] font-semibold rounded-md"
                  style={{ backgroundColor: categoryColor + '20', color: categoryColor }}
                >
                  {CATEGORY_LABELS[project.category as keyof typeof CATEGORY_LABELS]}
                </span>
                <span className="px-2 py-0.5 text-[10px] rounded-md bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted">
                  {PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]}
                </span>
                {project.startDate && (
                  <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">
                    Started {formatDate(project.startDate)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Eye size={14} />}
            onClick={() => navigate(`/client/projects/${id}`)}
            title="View as client — see exactly what the client sees on their dashboard"
          >
            View as client
          </Button>
          <Can permission="task.create">
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Plus size={14} />}
              onClick={() => navigate(`/pm/projects/${id}/tasks/new`)}
            >
              New Task
            </Button>
          </Can>
        </div>

        {/* ─── Members row ─── */}
        {project.members?.length > 0 && (
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mr-1">Team</span>
            {project.members.map((member: any) => (
              <div
                key={member.id}
                className={cn(
                  'flex items-center gap-2 pl-1 pr-3 py-1 rounded-full text-[12px]',
                  'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
                  'hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors',
                )}
              >
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-[10px] font-semibold text-white">
                  {member.user.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-gray-700 dark:text-obsidian-fg">{member.user.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* ─── Tabs ─── */}
        <Tabs items={TABS} active={activeTab} onChange={setActiveTab} />

        {/* ─── Tab content ─── */}
        <div className="animate-fade-in" key={activeTab}>
          {activeTab === 'Board' && <KanbanBoard projectId={id!} onTaskClick={(taskId) => setOpenTaskId(taskId)} />}
          {activeTab === 'Epics' && <EpicList projectId={id!} />}
          {activeTab === 'Timeline' && <ProjectTimeline projectId={id!} />}
          {activeTab === 'Decisions' && <DecisionList projectId={id!} />}

          {openTaskId && (
            <TaskDetailModal
              taskId={openTaskId}
              projectId={id!}
              onClose={() => setOpenTaskId(null)}
              siblings={taskSiblings}
              onNavigate={(newId) => setOpenTaskId(newId)}
            />
          )}
        </div>
      </div>
    </ProjectAcknowledgmentGate>
  );
}
