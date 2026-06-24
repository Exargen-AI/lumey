import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutGrid, GanttChart, Package, Lightbulb, BarChart3, FileText, Activity,
  LogOut, ChevronLeft, ChevronRight, ChevronDown, FolderOpen, KanbanSquare,
  ShieldCheck, Boxes, HelpCircle, CalendarRange,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useProjects } from '@/hooks/useProjects';
import { cn } from '@/lib/cn';
import { HEALTH_COLORS } from '@/lib/constants';
import { Tooltip, useConfirm, UserAvatar } from '@/components/ui';

/**
 * Sidebar for the client portal. Two distinct modes:
 *
 *   1. **On a project** (`/client/projects/:id/...`): shows a project switcher
 *      at the top, then a per-project section nav (Overview, Roadmap, etc).
 *      Sections are the seven slices we promised — adding more is just an
 *      entry in PROJECT_SECTIONS below + the matching route in App.tsx.
 *
 *   2. **Off a project** (`/client/dashboard`): the section nav is hidden and
 *      "All projects" is highlighted. Clicking a project from the dashboard
 *      drops the client into a project and the sidebar morphs.
 *
 * Collapse state is shared with the admin sidebar via `useUIStore.sidebarOpen`
 * — same person flipping between client and admin views shouldn't see the
 * sidebar suddenly snap open/closed. The active-row accent bar styling is
 * identical to the admin sidebar so the visual language stays consistent.
 */

type SectionItem = {
  key: string;
  label: string;
  /** Suffix appended to `/client/projects/:id`. Empty string = Overview (the root). */
  suffix: string;
  /** Lucide icon component. Typed `any` because lucide-react's icon type
   *  (ForwardRefExoticComponent<LucideProps>) is narrower than a plain
   *  ComponentType — same pattern the admin Sidebar uses. */
  Icon: React.ComponentType<any>;
};

// Ordering matters: Overview first (the at-a-glance landing), Board next
// because clients ask "what's the team doing now?" more than "what shipped?".
// Roadmap follows for the longer arc. Every section now has a real surface
// (PRs #84, #85, #86 + the Board addition).
const PROJECT_SECTIONS: SectionItem[] = [
  { key: 'overview',     label: 'Overview',         suffix: '',              Icon: LayoutGrid },
  { key: 'board',        label: 'Project Board',    suffix: '/board',        Icon: KanbanSquare },
  { key: 'products',     label: 'Products',         suffix: '/products',     Icon: Boxes },
  // Split out of the old "Sprint & Roadmap" tab so the client nav mirrors the
  // engineer board's dedicated Sprints + Timeline tabs.
  { key: 'sprints',      label: 'Sprints',          suffix: '/sprints',      Icon: GanttChart },
  { key: 'timeline',     label: 'Timeline',         suffix: '/timeline',     Icon: CalendarRange },
  { key: 'deliverables', label: 'Deliverables',     suffix: '/deliverables', Icon: Package },
  { key: 'decisions',    label: 'Decisions',        suffix: '/decisions',    Icon: Lightbulb },
  { key: 'insights',     label: 'Insights',         suffix: '/insights',     Icon: BarChart3 },
  { key: 'documents',    label: 'Documents',        suffix: '/documents',    Icon: FileText },
  { key: 'compliance',   label: 'Compliance',       suffix: '/compliance',   Icon: ShieldCheck },
  // PR 2026-05-15 collapsed Activity + the old Today wrap-up into one
  // page (today + this-week sections). URL stays /activity for
  // bookmark stability; label flips to "Today" so it matches what
  // the admin sidebar calls it.
  { key: 'activity',     label: 'Today',            suffix: '/activity',     Icon: Activity },
];

export function ClientSidebar() {
  const { user, clearAuth } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();

  // Are we inside a project? `/client/projects/:id[/whatever]` is the only
  // place we want the project switcher + section nav to surface. Anywhere
  // else (just `/client/dashboard`), we show the dashboard link only.
  const projectMatch = location.pathname.match(/^\/client\/projects\/([^/]+)/);
  const currentProjectId = projectMatch?.[1];

  if (!user) return null;

  const handleLogout = async () => {
    if (await confirm({
      title: 'Sign out?',
      body: 'You will need to sign in again to view your project.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
      tone: 'brand',
    })) {
      clearAuth();
      navigate('/login');
    }
  };


  return (
    <aside className={cn(
      'fixed left-0 top-0 h-full z-30 flex flex-col',
      'bg-white dark:bg-obsidian-sunken',
      'border-r border-gray-200 dark:border-obsidian-border',
      'transition-[width] duration-300 ease-out',
      sidebarOpen ? 'w-64' : 'w-16',
    )}>
      {/* ─── Brand + collapse toggle ─── */}
      <div className={cn(
        'h-14 flex items-center border-b border-gray-200 dark:border-obsidian-border shrink-0',
        sidebarOpen ? 'justify-between px-4' : 'justify-center px-2',
      )}>
        {sidebarOpen ? (
          <>
            <NavLink to="/client/dashboard" className="flex items-center gap-2.5 min-w-0 group">
              <div className="w-7 h-7 rounded-lg overflow-hidden ring-1 ring-black/5 dark:ring-white/10 shrink-0">
                <img src="/logo.jpeg" alt="Exargen" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg leading-none truncate">Exargen</div>
                <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted leading-none mt-1">Client Portal</div>
              </div>
            </NavLink>
            <Tooltip content="Collapse sidebar" side="right">
              <button
                onClick={toggleSidebar}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:text-obsidian-faded dark:hover:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-panel transition-colors"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft size={16} />
              </button>
            </Tooltip>
          </>
        ) : (
          <Tooltip content="Expand sidebar" side="right">
            <button
              onClick={toggleSidebar}
              className="w-9 h-9 rounded-lg overflow-hidden ring-1 ring-black/5 dark:ring-white/10 group relative"
              aria-label="Expand sidebar"
            >
              <img src="/logo.jpeg" alt="Exargen" className="w-full h-full object-cover transition-opacity group-hover:opacity-40" />
              <ChevronRight size={14} className="absolute inset-0 m-auto text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </Tooltip>
        )}
      </div>

      {/* ─── Project switcher (only when inside a project + expanded) ─── */}
      {currentProjectId && sidebarOpen && (
        <ProjectSwitcher currentProjectId={currentProjectId} />
      )}

      {/* ─── Navigation ─── */}
      <nav className="flex-1 py-3 overflow-y-auto px-2 space-y-0.5">
        {/* Always-visible: link back to portfolio view */}
        <DashboardNavRow collapsed={!sidebarOpen} />

        {/* Per-project section list (only when inside a project) */}
        {currentProjectId && (
          <>
            {sidebarOpen && (
              <div className="px-2.5 pt-4 pb-2 text-[10px] font-semibold tracking-[0.08em] uppercase text-gray-400 dark:text-obsidian-faded">
                This project
              </div>
            )}
            {!sidebarOpen && <div className="my-2 mx-2 border-t border-gray-100 dark:border-obsidian-border" />}
            {PROJECT_SECTIONS.map((section) => (
              <SectionNavItem
                key={section.key}
                to={`/client/projects/${currentProjectId}${section.suffix}`}
                Icon={section.Icon}
                label={section.label}
                collapsed={!sidebarOpen}
                /* Overview is the root; without `end`, every sub-section would
                   also mark Overview as active (NavLink treats any prefix match
                   as active by default). */
                exact={section.suffix === ''}
              />
            ))}
          </>
        )}

        {/* Always-visible help row, sits at the bottom of the nav so it's
            in muscle-memory but never competes with project sections for
            attention. Reachable from /client/dashboard and from inside any
            project. */}
        {sidebarOpen && (
          <div className="px-2.5 pt-4 pb-2 text-[10px] font-semibold tracking-[0.08em] uppercase text-gray-400 dark:text-obsidian-faded">
            Support
          </div>
        )}
        {!sidebarOpen && <div className="my-2 mx-2 border-t border-gray-100 dark:border-obsidian-border" />}
        <SectionNavItem
          to="/client/help"
          Icon={HelpCircle}
          label="Help & guide"
          collapsed={!sidebarOpen}
          exact
        />
      </nav>

      {/* ─── User block + sign out ───
          Avatar + name row links to /account. Sign-out is the second
          affordance. Matches the admin sidebar's user-block contract so
          a user flipping between portals doesn't have to relearn it. */}
      <div className={cn(
        'border-t border-gray-200 dark:border-obsidian-border shrink-0',
        sidebarOpen ? 'p-3' : 'p-2',
      )}>
        {sidebarOpen ? (
          <div className="flex items-center gap-2.5">
            <NavLink
              to="/account"
              className="rounded-full shrink-0 ring-2 ring-transparent hover:ring-brand-300 dark:hover:ring-brand-500/40 transition-shadow"
              title="Account & password"
            >
              <UserAvatar user={user} size="md" />
            </NavLink>
            <NavLink to="/account" className="min-w-0 flex-1 group">
              <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate leading-tight group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">{user.name}</p>
              {user.company && (
                <p className="text-[11px] text-gray-500 dark:text-obsidian-muted truncate leading-tight mt-0.5">{user.company}</p>
              )}
            </NavLink>
            <Tooltip content="Sign out" side="top">
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-gray-400 hover:text-danger-600 dark:text-obsidian-faded dark:hover:text-danger-500 hover:bg-gray-100 dark:hover:bg-obsidian-panel transition-colors shrink-0"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Tooltip content="Account" side="right">
              <NavLink
                to="/account"
                className="rounded-full ring-2 ring-transparent hover:ring-brand-300 dark:hover:ring-brand-500/40 transition-shadow"
                aria-label="Account"
              >
                <UserAvatar user={user} size="lg" />
              </NavLink>
            </Tooltip>
            <Tooltip content="Sign out" side="right">
              <button
                onClick={handleLogout}
                className="w-full flex justify-center items-center h-8 rounded-md text-gray-400 hover:text-danger-600 dark:text-obsidian-faded dark:hover:text-danger-500 hover:bg-gray-100 dark:hover:bg-obsidian-panel transition-colors"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Project switcher

   Sits under the brand mark, above the section nav. Click → dropdown listing
   all projects the client has access to. Hover/focus opens, click outside
   closes. Small dot indicates health.

   Why not a full Combobox?  In v1 every client has at most a handful of
   projects — a plain dropdown is sufficient. If/when clients with 20+
   projects appear, swap this for the search-as-you-type Combobox we use
   on the admin command palette.
   ───────────────────────────────────────────────────────────────────────── */
function ProjectSwitcher({ currentProjectId }: { currentProjectId: string }) {
  const { data: projects, isLoading } = useProjects();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-away close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = projects?.find((p: any) => p.id === currentProjectId);

  if (isLoading) {
    return (
      <div className="px-3 py-3 border-b border-gray-100 dark:border-obsidian-border">
        <div className="skeleton h-9 rounded-md" />
      </div>
    );
  }

  if (!current) return null;

  return (
    <div ref={ref} className="px-3 py-3 border-b border-gray-100 dark:border-obsidian-border relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-2.5 py-2 rounded-md',
          'text-left transition-colors',
          'bg-gray-50 dark:bg-obsidian-panel hover:bg-gray-100 dark:hover:bg-obsidian-raised',
          'border border-gray-200 dark:border-obsidian-border',
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <HealthDot status={current.healthStatus} />
        <span className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate flex-1 min-w-0">
          {current.name}
        </span>
        <ChevronDown size={14} className={cn(
          'text-gray-400 dark:text-obsidian-faded shrink-0 transition-transform',
          open && 'rotate-180',
        )} />
      </button>

      {open && projects && projects.length > 0 && (
        <div className="absolute left-3 right-3 top-full mt-1 z-40 max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-sunken shadow-lg py-1">
          {projects.length > 1 && (
            <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-gray-400 dark:text-obsidian-faded">
              Switch project
            </div>
          )}
          {projects.map((p: any) => (
            <NavLink
              key={p.id}
              to={`/client/projects/${p.id}`}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-2 px-3 py-2 text-[13px] transition-colors',
                isActive || p.id === currentProjectId
                  ? 'bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium'
                  : 'text-gray-700 dark:text-obsidian-muted hover:bg-gray-50 dark:hover:bg-obsidian-panel',
              )}
            >
              <HealthDot status={p.healthStatus} />
              <span className="truncate flex-1 min-w-0">{p.name}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthDot({ status }: { status: string }) {
  // HEALTH_COLORS is Record<string,string> of hex values; apply via inline
  // style so we don't need a Tailwind safelist for dynamic class names.
  const hex = HEALTH_COLORS[status as keyof typeof HEALTH_COLORS] ?? '#d1d5db';
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hex }} aria-hidden />;
}

/* ─── Top row: link back to portfolio dashboard ─── */
function DashboardNavRow({ collapsed }: { collapsed: boolean }) {
  return (
    <NavLink to="/client/dashboard" end className="block group" title={collapsed ? 'All projects' : undefined}>
      {({ isActive }) => (
        <div className={cn(
          'relative flex items-center rounded-md text-[13px] font-medium transition-colors',
          collapsed ? 'h-9 justify-center' : 'h-9 px-2.5 gap-3',
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel',
        )}>
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-brand-500 dark:bg-brand-400" />
          )}
          <FolderOpen size={17} className={cn(isActive && 'text-brand-600 dark:text-brand-400', 'shrink-0')} />
          {!collapsed && <span className="truncate flex-1">All projects</span>}
        </div>
      )}
    </NavLink>
  );
}

/* ─── Per-section nav row ─── */
function SectionNavItem({
  to, Icon, label, collapsed, exact,
}: {
  to: string;
  Icon: React.ComponentType<any>;
  label: string;
  collapsed: boolean;
  exact?: boolean;
}) {
  return (
    <NavLink to={to} end={exact} className="block group" title={collapsed ? label : undefined}>
      {({ isActive }) => (
        <div className={cn(
          'relative flex items-center rounded-md text-[13px] font-medium transition-colors',
          collapsed ? 'h-9 justify-center' : 'h-9 px-2.5 gap-3',
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel',
        )}>
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-brand-500 dark:bg-brand-400" />
          )}
          <Icon size={17} className={cn(isActive && 'text-brand-600 dark:text-brand-400', 'shrink-0')} />
          {!collapsed && <span className="truncate flex-1">{label}</span>}
        </div>
      )}
    </NavLink>
  );
}
