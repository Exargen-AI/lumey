import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import api from '@/api/client';

async function getResourceAllocation() {
  const { data } = await api.get('/analytics/resource-allocation');
  return data.data;
}

export function TeamPage() {
  const { data, isLoading } = useQuery({ queryKey: ['resource-allocation'], queryFn: getResourceAllocation });
  const [projectFilter, setProjectFilter] = useState('');

  const users = data?.users || [];
  const projects = data?.projects || [];

  const filteredUsers = projectFilter
    ? users.filter((u: any) => u.projects.some((p: any) => p.projectId === projectFilter))
    : users;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={24} className="text-brand-600" />
          <h1 className="text-2xl font-bold text-gray-900">Resource Allocation</h1>
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All Projects</option>
          {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl" />)}
        </div>
      ) : !filteredUsers.length ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
          <Users size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No team members found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredUsers.map((user: any) => {
            const isOverloaded = user.capacityPct > 100;
            const isIdle = user.totalHoursThisWeek < 10 && user.totalTasks === 0;
            return (
              <div key={user.userId} className={cn('bg-white rounded-xl border overflow-hidden',
                isOverloaded ? 'border-red-200' : isIdle ? 'border-amber-200' : 'border-gray-200')}>
                {/* Person header */}
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-sm font-semibold text-brand-600 shrink-0">
                    {user.userName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{user.userName}</p>
                      <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 capitalize">
                        {user.role.toLowerCase().replace('_', ' ')}
                      </span>
                      {isOverloaded && (
                        <span className="flex items-center gap-1 text-xs bg-red-100 text-red-700 rounded-full px-2 py-0.5">
                          <AlertTriangle size={10} /> Overloaded
                        </span>
                      )}
                      {isIdle && (
                        <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">Available</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
                      <span>{user.totalTasks} active tasks</span>
                      <span>{user.totalHoursThisWeek}h logged this week</span>
                    </div>
                  </div>
                  {/* Capacity bar */}
                  <div className="w-40 shrink-0">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-gray-500">Capacity</span>
                      <span className={cn('font-semibold', isOverloaded ? 'text-red-600' : user.capacityPct > 75 ? 'text-amber-600' : 'text-green-600')}>
                        {user.capacityPct}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={cn('rounded-full h-2.5 transition-all',
                          isOverloaded ? 'bg-red-500' : user.capacityPct > 75 ? 'bg-amber-500' : 'bg-green-500')}
                        style={{ width: `${Math.min(100, user.capacityPct)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Project allocation breakdown */}
                {user.projects.length > 0 && (
                  <div className="border-t border-gray-100 px-5 py-3 bg-gray-50/50">
                    <div className="flex gap-3 flex-wrap">
                      {user.projects.filter((p: any) => p.tasks > 0 || p.hoursThisWeek > 0).map((p: any) => (
                        <div key={p.projectId} className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                          <span className="text-xs font-medium text-gray-700">{p.projectName}</span>
                          <span className="text-[10px] text-gray-400">{p.tasks} tasks</span>
                          {p.hoursThisWeek > 0 && (
                            <span className="text-[10px] text-brand-600 font-medium">{p.hoursThisWeek}h</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
