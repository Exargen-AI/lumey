import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, GanttChart, Users, BarChart3, UserCog, Shield, ShieldCheck, Settings, CheckSquare, Clock, Activity, ClipboardCheck, LogOut, ChevronLeft, ChevronRight, Globe, Inbox, Plane, CalendarClock, Sun, Sunrise, Waves, UsersRound, BookOpen } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';
import { SIDEBAR_NAV } from '@/lib/constants';
import { Tooltip, useConfirm, UserAvatar } from '@/components/ui';
import { ROLE_LABELS } from '@exargen/shared';
import { UserRole } from '@exargen/shared';

const iconMap: Record<string, React.ComponentType<any>> = {
  LayoutDashboard, FolderKanban, GanttChart, Users, BarChart3, UserCog, Shield, ShieldCheck, Settings, CheckSquare, Clock, Activity, ClipboardCheck, Globe, Inbox, Plane, CalendarClock, Sun, Sunrise, Waves, UsersRound, BookOpen,
};

export function Sidebar() {
  const { user, permissions, clearAuth } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const navigate = useNavigate();
  const confirm = useConfirm();

  if (!user) return null;

  // TESTING role gets the same surface as SUPER_ADMIN — it's an
  // internal QA account meant to exercise every feature.
  const isTesting = user.role === UserRole.TESTING;
  const isAdmin = user.role === UserRole.SUPER_ADMIN || user.role === UserRole.ADMIN || isTesting;
  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN || isTesting;
  const isPM = user.role === UserRole.PRODUCT_MANAGER;
  const isEngineer = user.role === UserRole.ENGINEER;

  let navItems = isAdmin ? SIDEBAR_NAV.admin : isPM ? SIDEBAR_NAV.pm : isEngineer ? SIDEBAR_NAV.engineer : [];
  const extraItems = isSuperAdmin ? SIDEBAR_NAV.superAdmin : [];
  const isAllowed = (item: any) => {
    if (item.permission) return permissions.includes(item.permission);
    if (item.permissions?.length) return item.permissions.some((permission: string) => permissions.includes(permission));
    return true;
  };

  navItems = navItems.filter(isAllowed);
  const filteredExtraItems = extraItems.filter(isAllowed);

  const handleLogout = async () => {
    if (await confirm({
      title: 'Sign out?',
      body: 'You will need to sign in again to access the Command Center.',
      confirmLabel: 'Sign out',
      cancelLabel: 'Stay signed in',
      // Brand tone (purple) — signing out is a routine confirmation, not
      // a danger or warning. Team feedback #1: the orange/amber accent
      // looked alarming for what's basically "see you tomorrow".
      tone: 'brand',
    })) {
      clearAuth();
      navigate('/login');
    }
  };

  const roleLabel = ROLE_LABELS[user.role as UserRole];

  return (
    <aside className={cn(
      'fixed left-0 top-0 h-full z-30 flex flex-col',
      'bg-white dark:bg-obsidian-sunken',
      'border-r border-gray-200 dark:border-obsidian-border',
      'transition-[width] duration-300 ease-out',
      sidebarOpen ? 'w-64' : 'w-16',
    )}>
      {/* Logo + collapse toggle */}
      <div className={cn(
        'h-14 flex items-center border-b border-gray-200 dark:border-obsidian-border shrink-0',
        sidebarOpen ? 'justify-between px-4' : 'justify-center px-2',
      )}>
        {sidebarOpen ? (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg overflow-hidden ring-1 ring-black/5 dark:ring-white/10 shrink-0 flex items-center justify-center bg-brand-600 text-white text-[13px] font-bold">
                L
              </div>
              <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">Lumey</span>
            </div>
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
              className="w-9 h-9 rounded-lg overflow-hidden ring-1 ring-black/5 dark:ring-white/10 group relative flex items-center justify-center bg-brand-600 text-white text-[15px] font-bold"
              aria-label="Expand sidebar"
            >
              <span className="transition-opacity group-hover:opacity-40">L</span>
              <ChevronRight size={14} className="absolute inset-0 m-auto text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-y-auto px-2 space-y-0.5">
        {sidebarOpen && (
          <div className="px-2.5 pt-1 pb-2 text-[10px] font-semibold tracking-[0.08em] uppercase text-gray-400 dark:text-obsidian-faded">
            Workspace
          </div>
        )}
        {navItems.map((item) => {
          const Icon = iconMap[item.icon] || LayoutDashboard;
          return (
            <NavItem
              key={item.path}
              to={item.path}
              Icon={Icon}
              label={item.label}
              collapsed={!sidebarOpen}
            />
          );
        })}

        {filteredExtraItems.length > 0 && (
          <div className="pt-4">
            {sidebarOpen && (
              <div className="px-2.5 pt-1 pb-2 text-[10px] font-semibold tracking-[0.08em] uppercase text-gray-400 dark:text-obsidian-faded">
                System
              </div>
            )}
            {filteredExtraItems.map((item) => {
              const Icon = iconMap[item.icon] || Settings;
              return <NavItem key={item.path} to={item.path} Icon={Icon} label={item.label} collapsed={!sidebarOpen} />;
            })}
          </div>
        )}
      </nav>

      {/* User block. Avatar links to /account; sign-out is the second
          affordance. The name/role row is informational only when expanded. */}
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
              <p className="text-[11px] text-gray-500 dark:text-obsidian-muted truncate leading-tight mt-0.5">{roleLabel}</p>
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

// ─── Single nav row. Active state shows a violet accent bar on the left edge,
//     keeping the row rectangle subtle — Obsidian-style. ───
function NavItem({ to, Icon, label, collapsed, showDot }: {
  to: string; Icon: React.ComponentType<any>; label: string; collapsed: boolean; showDot?: boolean;
}) {
  return (
    <NavLink to={to} className="block group" title={collapsed ? label : undefined}>
      {({ isActive }) => (
        <div className={cn(
          'relative flex items-center rounded-md text-[13px] font-medium transition-colors',
          collapsed ? 'h-9 justify-center' : 'h-9 px-2.5 gap-3',
          isActive
            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 dark:text-obsidian-muted dark:hover:text-obsidian-fg dark:hover:bg-obsidian-panel',
        )}>
          {/* Active accent bar on the left */}
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-brand-500 dark:bg-brand-400" />
          )}
          <span className="relative shrink-0">
            <Icon size={17} className={cn(isActive && 'text-brand-600 dark:text-brand-400')} />
            {showDot && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-obsidian-sunken" aria-hidden />
            )}
          </span>
          {!collapsed && (
            <span className="truncate flex-1 flex items-center gap-2">
              {label}
              {showDot && (
                <span className="text-[10px] font-semibold rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-1.5 py-0.5">
                  Action needed
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </NavLink>
  );
}
