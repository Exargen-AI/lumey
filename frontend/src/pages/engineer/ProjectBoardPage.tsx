import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { HEALTH_COLORS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { ProjectAcknowledgmentGate } from '@/components/security/ProjectAcknowledgmentGate';

export function EngProjectBoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(id!);

  const healthColor = project ? HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS] : undefined;
  const healthLabel = project?.healthStatus === 'GREEN' ? 'Healthy' : project?.healthStatus === 'YELLOW' ? 'At risk' : 'Critical';

  return (
    <ProjectAcknowledgmentGate projectId={id!} projectName={project?.name} refuseRedirect="/eng/dashboard">
      <div className="space-y-5">
        {/* ─── Slim header — engineer view doesn't need the full PM chrome ─── */}
        <div className="flex items-center gap-3 animate-fade-in-down">
          <button
            onClick={() => navigate('/eng/dashboard')}
            className="p-2 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel transition-colors"
            title="Back to dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
              {project?.name || 'Loading…'}
            </h1>
            {project && healthColor && (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium shrink-0"
                style={{ backgroundColor: healthColor + '15', color: healthColor }}
              >
                <span
                  className={cn('w-1.5 h-1.5 rounded-full', project.healthStatus === 'RED' && 'animate-pulse')}
                  style={{ backgroundColor: healthColor }}
                />
                {healthLabel}
              </div>
            )}
          </div>
        </div>

        <KanbanBoard projectId={id!} onTaskClick={(taskId) => navigate(`/eng/projects/${id}/tasks/${taskId}`)} />
      </div>
    </ProjectAcknowledgmentGate>
  );
}
