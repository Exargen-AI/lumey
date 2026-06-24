import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FolderKanban, CheckSquare, Users, BarChart3, Clock, FileText, ArrowRight, Command, ClipboardCheck } from 'lucide-react';
import { useMyTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { useAuthStore } from '@/stores/authStore';
import { getDefaultRoute, getProjectRoute, getProjectWorkspaceRoute, getTaskRoute } from '@/lib/constants';
import { cn } from '@/lib/cn';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: typeof Search;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const canViewProjects = permissions.some((permission) => ['project.view_all', 'project.view_assigned'].includes(permission));

  const { data: tasks } = useMyTasks();
  const { data: projects } = useProjects(undefined, { enabled: canViewProjects });

  // Ctrl+K to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Focus input when opened. Cleanup the timeout if the palette closes (or
  // unmounts) before the 50ms tick — otherwise focus could fire on an unmounted
  // input and React would warn.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  if (!open || !user) return null;

  const go = (path: string) => { navigate(path); setOpen(false); };
  const isAdminLike = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
  const isPM = user.role === 'PRODUCT_MANAGER';
  const dashboardPath = getDefaultRoute(user.role, permissions);
  const projectsPath = getProjectWorkspaceRoute(user.role, permissions);
  const analyticsPath = isPM ? '/pm/analytics' : '/analytics';
  const standupPath = isPM ? '/pm/standup' : '/standup';
  const activityPath = isPM ? '/pm/activity' : '/activity';

  // Build command list
  const commands: CommandItem[] = [
    { id: 'dashboard', label: 'Dashboard', description: 'Go to your dashboard', icon: BarChart3, action: () => go(dashboardPath), category: 'Navigation' },
  ];

  if (user.role === 'ENGINEER') {
    commands.push(
      { id: 'eod', label: 'Submit EOD Update', description: 'Log your daily progress', icon: FileText, action: () => go('/eng/eod-update'), category: 'Actions' },
      // Both subcommands route to the combined "My Time" page with a tab
      // hint so the user lands on the right view directly.
      { id: 'timesheet', label: 'Open Timesheet', description: 'Log hours for the week', icon: Clock, action: () => go('/my-time?tab=timesheet'), category: 'Actions' },
      { id: 'my-tasks', label: 'My Tasks', description: 'View all assigned tasks', icon: CheckSquare, action: () => go('/eng/my-tasks'), category: 'Actions' },
    );
  }

  // "My Time" is a personal page available to everyone — surfacing it in
  // the palette gives non-engineers (PMs, admins) a quick way to file a
  // leave request or check their hours without hunting through the sidebar.
  commands.push(
    { id: 'my-time', label: 'My Time', description: 'Timesheet and leave', icon: Clock, action: () => go('/my-time'), category: 'Navigation' },
    { id: 'apply-leave', label: 'Apply for Leave', description: 'File a new leave request', icon: Clock, action: () => go('/my-time?tab=leave'), category: 'Actions' },
  );

  if ((isAdminLike || isPM) && canViewProjects) {
    commands.push({ id: 'projects', label: 'Projects', description: 'Browse all projects', icon: FolderKanban, action: () => go(projectsPath), category: 'Navigation' });
  }

  if (permissions.some((permission) => ['analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team'].includes(permission))) {
    commands.push({ id: 'analytics', label: 'Analytics', description: 'View analytics', icon: BarChart3, action: () => go(analyticsPath), category: 'Navigation' });
  }

  if (permissions.includes('analytics.view_team')) {
    commands.push({ id: 'standup', label: 'Team Standup', description: 'View team updates', icon: Users, action: () => go(standupPath), category: 'Navigation' });
  }

  if (permissions.some((permission) => ['analytics.view_portfolio', 'analytics.view_project'].includes(permission))) {
    commands.push({ id: 'activity', label: 'Activity Feed', description: 'Real-time team activity', icon: ArrowRight, action: () => go(activityPath), category: 'Navigation' });
  }

  if (permissions.includes('analytics.view_team')) {
    commands.push({ id: 'team', label: 'Team Capacity', description: 'Review team utilization', icon: Users, action: () => go(isPM ? '/pm/team' : '/team'), category: 'Navigation' });
  }

  if (permissions.includes('analytics.view_team')) {
    // Combined approvals page — PM lands on Timesheets tab; SUPER_ADMIN
    // sees both Timesheets and Leave tabs there. No more split URLs.
    commands.push({ id: 'approvals', label: 'Approvals', description: 'Review timesheets and leave requests', icon: ClipboardCheck, action: () => go('/approvals'), category: 'Navigation' });
  }

  if (permissions.includes('user.view')) {
    commands.push({ id: 'users', label: 'User Management', description: 'Manage team members', icon: Users, action: () => go('/users'), category: 'Navigation' });
  }

  // Add projects as searchable items
  projects?.forEach((p: any) => {
    commands.push({
      id: `project-${p.id}`, label: p.name, description: `${p.category} · ${p.phase}`,
      icon: FolderKanban, action: () => go(getProjectRoute(user.role, p.id, permissions)), category: 'Projects',
    });
  });

  // Add tasks as searchable items
  tasks?.slice(0, 15).forEach((t: any) => {
    commands.push({
      id: `task-${t.id}`, label: t.title, description: `${t.project?.name} · ${t.status}`,
      icon: CheckSquare, action: () => {
        const projId = t.projectId || t.project?.id;
        if (projId) go(getTaskRoute(user.role, projId, t.id, permissions));
      }, category: 'Tasks',
    });
  });

  // Filter
  const filtered = query.trim()
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()) || c.description?.toLowerCase().includes(query.toLowerCase()))
    : commands;

  // Group by category
  const grouped = new Map<string, CommandItem[]>();
  filtered.forEach((c) => {
    if (!grouped.has(c.category)) grouped.set(c.category, []);
    grouped.get(c.category)!.push(c);
  });

  const flatFiltered = Array.from(grouped.values()).flat();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, flatFiltered.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flatFiltered[selectedIndex]) { flatFiltered[selectedIndex].action(); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        style={{ animation: 'scaleIn 0.12s ease-out' }}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search size={18} className="text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, actions..."
            className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5 font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {flatFiltered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No results for "{query}"</p>
          ) : (
            Array.from(grouped.entries()).map(([category, items]) => (
              <div key={category}>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider px-4 pt-3 pb-1">{category}</p>
                {items.map((item) => {
                  const globalIndex = flatFiltered.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                      className={cn('w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors',
                        isSelected ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-gray-50')}
                    >
                      <Icon size={16} className={isSelected ? 'text-brand-500' : 'text-gray-400'} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.label}</p>
                        {item.description && <p className="text-xs text-gray-400 truncate">{item.description}</p>}
                      </div>
                      {isSelected && <ArrowRight size={14} className="text-brand-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400">
          <span>Navigate with <kbd className="bg-gray-200 rounded px-1 mx-0.5 font-mono">↑↓</kbd> and <kbd className="bg-gray-200 rounded px-1 mx-0.5 font-mono">Enter</kbd></span>
          <span><kbd className="bg-gray-200 rounded px-1 mx-0.5 font-mono">Ctrl+K</kbd> to toggle</span>
        </div>
      </div>

      <style>{`
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
