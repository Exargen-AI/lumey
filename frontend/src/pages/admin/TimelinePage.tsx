import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GanttChart, Diamond } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { getMilestones } from '@/api/milestones';
import { HEALTH_COLORS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/formatters';
import { DesktopHint } from '@/components/ui';

export function TimelinePage() {
  const { data: projects, isLoading: projectsLoading } = useProjects();

  // Fetch milestones for all projects
  const projectIds = useMemo(() => (projects ?? []).map((p: any) => p.id), [projects]);

  const { data: milestonesMap, isLoading: milestonesLoading } = useQuery({
    queryKey: ['all-milestones', projectIds],
    queryFn: async () => {
      const results: Record<string, any[]> = {};
      await Promise.all(
        projectIds.map(async (id: string) => {
          try {
            const milestones = await getMilestones(id);
            results[id] = milestones ?? [];
          } catch {
            results[id] = [];
          }
        }),
      );
      return results;
    },
    enabled: projectIds.length > 0,
  });

  const isLoading = projectsLoading || milestonesLoading;

  // Calculate timeline range
  const allMilestones = useMemo(() => {
    if (!milestonesMap) return [];
    return Object.entries(milestonesMap).flatMap(([projectId, milestones]) =>
      milestones.map((m: any) => ({ ...m, projectId })),
    );
  }, [milestonesMap]);

  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (allMilestones.length === 0) {
      const now = new Date();
      const threeMonthsLater = new Date(now);
      threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);
      return { minDate: now, maxDate: threeMonthsLater, totalDays: 90 };
    }

    const dates = allMilestones.map((m) => new Date(m.date).getTime());
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    // Add some padding
    min.setDate(min.getDate() - 14);
    max.setDate(max.getDate() + 14);
    const days = Math.max(1, Math.ceil((max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24)));
    return { minDate: min, maxDate: max, totalDays: days };
  }, [allMilestones]);

  const getPosition = (date: string) => {
    const d = new Date(date).getTime();
    const start = minDate.getTime();
    return Math.max(0, Math.min(100, ((d - start) / (totalDays * 24 * 60 * 60 * 1000)) * 100));
  };

  // Generate month markers
  const monthMarkers = useMemo(() => {
    const markers: { label: string; position: number }[] = [];
    const current = new Date(minDate);
    current.setDate(1);
    current.setMonth(current.getMonth() + 1);
    while (current <= maxDate) {
      markers.push({
        label: current.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        position: getPosition(current.toISOString()),
      });
      current.setMonth(current.getMonth() + 1);
    }
    return markers;
  }, [minDate, maxDate, totalDays]);

  // Today marker
  const todayPosition = getPosition(new Date().toISOString());

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Portfolio Timeline</h1>
        <div className="h-96 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DesktopHint
        dismissKey="timeline"
        reason="The Gantt timeline spans many months along the X axis — it needs a wide viewport to read without horizontal scrolling. Try desktop for the full picture."
      />
      <div className="flex items-center gap-3">
        <GanttChart size={24} className="text-brand-600" />
        <h1 className="text-2xl font-bold text-gray-900">Portfolio Timeline</h1>
      </div>

      {!projects?.length ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No projects to display.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          {/* Legend */}
          <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-200 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Diamond size={10} className="text-green-600" fill="currentColor" /> Completed
            </span>
            <span className="flex items-center gap-1">
              <Diamond size={10} className="text-blue-600" fill="currentColor" /> Upcoming
            </span>
            <span className="flex items-center gap-1">
              <Diamond size={10} className="text-red-600" fill="currentColor" /> Missed
            </span>
          </div>

          <div className="min-w-[800px]">
            {/* Month headers */}
            <div className="relative h-8 border-b border-gray-200 bg-gray-50">
              {monthMarkers.map((marker, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full border-l border-gray-200 flex items-center pl-2"
                  style={{ left: `${Math.max(0, Math.min(98, marker.position))}%` }}
                >
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{marker.label}</span>
                </div>
              ))}
            </div>

            {/* Project rows */}
            {projects.map((project: any) => {
              const projectMilestones = milestonesMap?.[project.id] ?? [];
              const healthColor = HEALTH_COLORS[project.healthStatus as keyof typeof HEALTH_COLORS];

              return (
                <div key={project.id} className="relative flex items-center border-b border-gray-100 hover:bg-gray-50">
                  {/* Project name column */}
                  <div className="flex-shrink-0 w-52 px-4 py-3 border-r border-gray-200">
                    <Link to={`/projects/${project.id}`} className="group flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: healthColor }} />
                      <span className="text-sm font-medium text-gray-900 group-hover:text-brand-600 truncate">
                        {project.name}
                      </span>
                    </Link>
                  </div>

                  {/* Timeline lane */}
                  <div className="flex-1 relative h-12 px-2">
                    {/* Today line */}
                    <div className="absolute top-0 bottom-0 w-px bg-brand-300 opacity-50" style={{ left: `${todayPosition}%` }} />

                    {/* Milestone diamonds */}
                    {projectMilestones.map((milestone: any) => {
                      const pos = getPosition(milestone.date);
                      const isCompleted = milestone.status === 'COMPLETED';
                      const isMissed = milestone.status === 'MISSED';
                      return (
                        <div
                          key={milestone.id}
                          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 group"
                          style={{ left: `${pos}%` }}
                        >
                          <Diamond
                            size={14}
                            className={cn(
                              'cursor-pointer',
                              isCompleted ? 'text-green-600' : isMissed ? 'text-red-600' : 'text-blue-600',
                            )}
                            fill="currentColor"
                          />
                          {/* Tooltip */}
                          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                              <div className="font-medium">{milestone.title}</div>
                              <div className="text-gray-300">{formatDate(milestone.date)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Empty state for no milestones */}
                    {projectMilestones.length === 0 && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[10px] text-gray-300">No milestones</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
