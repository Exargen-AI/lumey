import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, FolderTree, Eye } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { HEALTH_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { Can } from '@/components/auth/Can';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ProjectTimeline } from '@/components/timeline/ProjectTimeline';
import { DecisionList } from '@/components/decisions/DecisionList';
import { SprintBoard } from '@/components/sprints/SprintBoard';
import { EpicList } from '@/components/epics/EpicList';
import { CustomFieldDefinitionEditor } from '@/components/customFields/CustomFieldDefinitionEditor';
import { DeleteProjectMenu } from '@/components/projects/DeleteProjectMenu';
import { GitHubIntegrationCard } from '@/components/integrations/GitHubIntegrationCard';
import { ProjectAcknowledgmentGate } from '@/components/security/ProjectAcknowledgmentGate';
import { AcknowledgmentAuditPanel } from '@/components/security/AcknowledgmentAuditPanel';
import { DeliverablesPanel } from '@/components/deliverables/DeliverablesPanel';
import { ClientAccessPanel } from '@/components/projects/ClientAccessPanel';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { ProductsTab } from '@/components/products/ProductsTab';
import { DevelopmentOpsTab } from '@/components/devops/DevelopmentOpsTab';
import { useTasks } from '@/hooks/useTasks';
import { useProjectAnalytics } from '@/hooks/useAnalytics';

const TABS = ['Board', 'Sprints', 'Epics', 'Products', 'Timeline', 'Deliverables', 'Decisions', 'DevelopmentOps', 'Analytics', 'Settings'] as const;

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<typeof TABS[number]>('Board');
  const { data: project, isLoading } = useProject(id!);
  // Slide-over state for the task detail. Lives on the page so the Kanban
  // and the Sprint board both target the same panel and J/K nav can walk
  // across the same visible task list.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const { data: visibleTasks } = useTasks(id!);
  const taskSiblings = (visibleTasks ?? []).map((t: any) => t.id);

  if (isLoading) return <div className="text-center py-12 text-gray-400">Loading project...</div>;
  if (!project) return <div className="text-center py-12 text-gray-500">Project not found.</div>;

  const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];
  const categoryColor = CATEGORY_COLORS[project.category as keyof typeof CATEGORY_COLORS];

  return (
    <ProjectAcknowledgmentGate projectId={id!} projectName={project.name} refuseRedirect="/projects">
    {/*
      Layout note (compression pass): the previous version stacked Header
      → Team band → Tabs as three separate sections separated by `space-y-6`
      (24px each), eating ~250px before any content rendered. The header
      is now a single dense row with metadata + team avatars + actions
      inline; team is shown as overlapped avatar stack with a hover-to-list
      tooltip rather than a row of full pills. Vertical rhythm tightened to
      `space-y-3` so users get content above the fold even on 13" laptops.
    */}
    <div className="space-y-3">
      {/* ─── Compact one-line header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/projects')}
            className="p-1.5 -ml-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 dark:text-obsidian-muted shrink-0"
            aria-label="Back to projects"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">{project.name}</h1>
            <span
              className={cn('w-2.5 h-2.5 rounded-full shrink-0', project.healthStatus === 'RED' && 'animate-pulse')}
              style={{ backgroundColor: healthColor }}
              aria-label={`Health: ${project.healthStatus}`}
            />
            <span
              className="px-2 py-0.5 text-[11px] font-medium rounded-full shrink-0"
              style={{ backgroundColor: categoryColor + '20', color: categoryColor }}
            >
              {CATEGORY_LABELS[project.category as keyof typeof CATEGORY_LABELS]}
            </span>
            <span className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-muted shrink-0">
              {PHASE_LABELS[project.phase as keyof typeof PHASE_LABELS]}
            </span>
            {project.startDate && (
              <span className="text-[11px] text-gray-400 dark:text-obsidian-faded shrink-0 hidden md:inline">
                · Started {formatDate(project.startDate)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* Team avatar stack — overlapping circles + count for any
              overflow. Saves the entire row that the team-pill band used to
              occupy. Names still surface via title-tooltip on each avatar. */}
          {project.members && project.members.length > 0 && (
            <div className="flex -space-x-1.5">
              {project.members.slice(0, 5).map((m: any) => (
                <div
                  key={m.id}
                  title={m.user.name}
                  className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-500/20 ring-2 ring-white dark:ring-obsidian-bg flex items-center justify-center text-[11px] font-medium text-brand-700 dark:text-brand-300"
                >
                  {m.user.name.charAt(0)}
                </div>
              ))}
              {project.members.length > 5 && (
                <div
                  title={`+${project.members.length - 5} more`}
                  className="w-7 h-7 rounded-full bg-gray-100 dark:bg-obsidian-raised ring-2 ring-white dark:ring-obsidian-bg flex items-center justify-center text-[10px] font-medium text-gray-600 dark:text-obsidian-muted"
                >
                  +{project.members.length - 5}
                </div>
              )}
            </div>
          )}
          <Can permission="project.edit">
            <button
              type="button"
              onClick={() => navigate(`/projects/${id}/ingest`)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-panel text-gray-700 dark:text-obsidian-fg text-[13px] rounded-md hover:border-brand-300 dark:hover:border-brand-500/40 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
              title="Ingest a markdown plan as Epics → Sprints → Tasks"
            >
              <FolderTree size={14} /> Ingest plan
            </button>
          </Can>
          <Can permission="task.create">
            <button
              onClick={() => navigate(`/projects/${id}/tasks/new`)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-[13px] rounded-md transition-colors"
            >
              <Plus size={14} /> New Task
            </button>
          </Can>
          <button
            type="button"
            onClick={() => navigate(`/client/projects/${id}`)}
            className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 dark:text-obsidian-muted"
            title="View as client — see exactly what the client sees on their dashboard"
            aria-label="View as client"
          >
            <Eye size={16} />
          </button>
          <Can permission="project.edit">
            <button
              type="button"
              onClick={() => navigate(`/projects/${id}/edit`)}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 dark:text-obsidian-muted"
              title="Edit project"
            >
              <Pencil size={16} />
            </button>
          </Can>
          <Can permission="project.delete">
            <DeleteProjectMenu projectId={id!} projectName={project.name} />
          </Can>
        </div>
      </div>

      {/* ─── Tabs (no surrounding gap; content drops directly below) ─── */}
      <div className="border-b border-gray-200 dark:border-obsidian-border">
        <nav className="flex gap-5 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn('pb-2.5 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab
                  ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                  : 'border-transparent text-gray-500 dark:text-obsidian-muted hover:text-gray-700 dark:hover:text-obsidian-fg')}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'Board' && <KanbanBoard projectId={id!} onTaskClick={(taskId) => setOpenTaskId(taskId)} />}
      {activeTab === 'Sprints' && <SprintBoard projectId={id!} onTaskClick={(taskId) => setOpenTaskId(taskId)} />}
      {activeTab === 'Epics' && <EpicList projectId={id!} />}
      {activeTab === 'Products' && <ProductsTab projectId={id!} projectSlug={project.slug} />}
      {activeTab === 'Timeline' && <ProjectTimeline projectId={id!} />}
      {activeTab === 'Deliverables' && <DeliverablesPanel projectId={id!} manage />}
      {activeTab === 'Decisions' && <DecisionList projectId={id!} />}
      {activeTab === 'DevelopmentOps' && <DevelopmentOpsTab projectId={id!} />}
      {activeTab === 'Analytics' && <ProjectAnalyticsTab projectId={id!} />}
      {activeTab === 'Settings' && (
        <div className="space-y-6">
          {/* SUPER_ADMIN-only: grant a CLIENT member full internal access to
              THIS project (tasks + decisions + comments). Self-gates — renders
              nothing for non-super-admins. */}
          <ClientAccessPanel projectId={id!} />
          <CustomFieldDefinitionEditor projectId={id!} />
          {/* Integrations sit under custom fields on the Settings tab.
              GitHub is the only kind today; Slack / Linear will follow
              the same card pattern when we ship them. */}
          <GitHubIntegrationCard projectId={id!} />
          {/* Compliance audit — who has signed the NDA on this project.
              Owners are exempt and intentionally absent from the list
              (the panel footer explains why). */}
          <AcknowledgmentAuditPanel projectId={id!} />
        </div>
      )}

      {/* Slide-over for task detail. Closes on Esc / backdrop / X. The siblings
          list comes from the project's task pool so J/K cycle through every
          task in the project, regardless of which tab opened the panel. */}
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
    </ProjectAcknowledgmentGate>
  );
}

function ProjectAnalyticsTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useProjectAnalytics(projectId);

  if (isLoading) return <div className="space-y-3 animate-pulse"><div className="h-32 bg-gray-100 rounded-lg" /><div className="h-32 bg-gray-100 rounded-lg" /></div>;
  if (!data) return <div className="text-center py-8 text-gray-400">No analytics data.</div>;

  const statuses = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];
  const statusLabels: Record<string, string> = { BACKLOG: 'Backlog', TODO: 'To Do', IN_PROGRESS: 'In Progress', IN_REVIEW: 'In Review', DONE: 'Done' };
  const statusColors: Record<string, string> = { BACKLOG: '#94a3b8', TODO: '#f59e0b', IN_PROGRESS: '#6366f1', IN_REVIEW: '#8b5cf6', DONE: '#22c55e' };
  const total = statuses.reduce((sum, s) => sum + (data.tasksByStatus?.[s] || 0), 0);
  const doneCount = data.tasksByStatus?.DONE || 0;
  const completionPct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Task Distribution</h3>
        <div className="space-y-3">
          {statuses.map((status) => {
            const count = data.tasksByStatus?.[status] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={status}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-gray-600">{statusLabels[status]}</span>
                  <span className="text-gray-900 font-medium">{count} ({pct}%)</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className="rounded-full h-2 transition-all" style={{ width: `${pct}%`, backgroundColor: statusColors[status] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-2">Completion</h3>
          <div className="flex items-end gap-3">
            <span className="text-4xl font-bold text-gray-900">{completionPct}%</span>
            <span className="text-sm text-gray-500 mb-1">{doneCount} of {total} tasks done</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 mt-3">
            <div className="bg-green-500 rounded-full h-3 transition-all" style={{ width: `${completionPct}%` }} />
          </div>
        </div>
        {data.overdueTasks > 0 && (
          <div className="bg-red-50 rounded-xl border border-red-200 p-6">
            <h3 className="font-semibold text-red-800 mb-1">Overdue Tasks</h3>
            <span className="text-3xl font-bold text-red-700">{data.overdueTasks}</span>
            <p className="text-sm text-red-600 mt-1">tasks past their due date</p>
          </div>
        )}
      </div>
    </div>
  );
}
