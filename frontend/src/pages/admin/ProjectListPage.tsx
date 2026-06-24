import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { HEALTH_COLORS, CATEGORY_LABELS, CATEGORY_COLORS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { Can } from '@/components/auth/Can';

export function ProjectListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');

  const params: Record<string, string> = {};
  if (search) params.search = search;
  if (categoryFilter) params.category = categoryFilter;
  if (phaseFilter) params.phase = phaseFilter;
  if (healthFilter) params.health = healthFilter;

  const { data: projects, isLoading } = useProjects(Object.keys(params).length > 0 ? params : undefined);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Projects</h1>
        <Can permission="project.create">
          <Link to="/projects/new" className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700">
            <Plus size={16} /> New Project
          </Link>
        </Can>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm">
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm">
          <option value="">All Phases</option>
          {Object.entries(PHASE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={healthFilter} onChange={(e) => setHealthFilter(e.target.value)} className="px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg text-sm">
          <option value="">All Health</option>
          <option value="GREEN">Green</option><option value="YELLOW">Yellow</option><option value="RED">Red</option>
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : !projects?.length ? (
        <div className="text-center py-12 text-gray-500">No projects found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p: any) => (
            <div
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5 hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">{p.name}</h3>
                <span className={cn('w-2.5 h-2.5 rounded-full shrink-0 ml-2', p.healthStatus === 'RED' && 'animate-pulse')}
                  style={{ backgroundColor: HEALTH_COLORS[p.healthStatus as keyof typeof HEALTH_COLORS] }} />
              </div>
              <div className="flex gap-2 mb-3">
                <span className="px-2 py-0.5 text-xs rounded-full"
                  style={{ backgroundColor: (CATEGORY_COLORS[p.category as keyof typeof CATEGORY_COLORS] || '#6b7280') + '20', color: CATEGORY_COLORS[p.category as keyof typeof CATEGORY_COLORS] }}>
                  {CATEGORY_LABELS[p.category as keyof typeof CATEGORY_LABELS]}
                </span>
                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                  {PHASE_LABELS[p.phase as keyof typeof PHASE_LABELS]}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{p.taskCounts?.total ?? p._count?.tasks ?? 0} tasks</span>
                <span>{p.members?.length ?? 0} members</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
