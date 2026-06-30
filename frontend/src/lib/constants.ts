export {
  PERMISSIONS,
  ROLE_LABELS,
  TASK_STATUS_ORDER,
  TASK_STATUS_LABELS,
  PHASE_ORDER,
  PHASE_LABELS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  HEALTH_COLORS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  TASK_TYPE_LABELS,
  TASK_TYPE_COLORS,
  SPRINT_STATUS_LABELS,
  STORY_POINT_OPTIONS,
  EPIC_STATUS_LABELS,
} from '@exargen/shared';

import { UserRole } from '@exargen/shared';

const PROJECT_VIEW_PERMISSIONS = ['project.view_all', 'project.view_assigned'];
const ACTIVITY_PERMISSIONS = ['analytics.view_portfolio', 'analytics.view_project'];
const ANALYTICS_PERMISSIONS = ['analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team'];

function hasAnyPermission(permissions: string[], required: string[]): boolean {
  return required.some((permission) => permissions.includes(permission));
}

export function canAccessSharedProjects(permissions: string[] = []): boolean {
  return hasAnyPermission(permissions, PROJECT_VIEW_PERMISSIONS);
}

export function canAccessSharedActivity(permissions: string[] = []): boolean {
  return hasAnyPermission(permissions, ACTIVITY_PERMISSIONS);
}

export function canAccessSharedAnalytics(permissions: string[] = []): boolean {
  return hasAnyPermission(permissions, ANALYTICS_PERMISSIONS);
}

export const ROLE_DASHBOARD_PATH: Record<string, string> = {
  [UserRole.SUPER_ADMIN]: '/dashboard',
  [UserRole.ADMIN]: '/dashboard',
  [UserRole.PRODUCT_MANAGER]: '/pm/dashboard',
  [UserRole.ENGINEER]: '/eng/dashboard',
  [UserRole.CLIENT]: '/client/dashboard',
};

// NOTE (2026-06-02): the global `extendedClientAccess` flag (and its
// `isExtendedClient` routing) was retired. Clients now ALWAYS live in the
// stripped `/client/...` portal; elevated visibility is granted per-project
// (`ProjectMember.fullAccess`) and surfaces inside the portal itself, so no
// role-based routing flip is needed.

export function getProjectWorkspaceRoute(role: string, permissions: string[] = []): string {
  switch (role) {
    case UserRole.PRODUCT_MANAGER:
      if (canAccessSharedProjects(permissions)) return '/projects';
      return '/pm/projects';
    case UserRole.ENGINEER:
      if (canAccessSharedProjects(permissions)) return '/projects';
      return '/eng/dashboard';
    case UserRole.CLIENT:
      return '/client/dashboard';
    case UserRole.SUPER_ADMIN:
    case UserRole.ADMIN:
    default:
      return '/projects';
  }
}

export function getProjectRoute(role: string, projectId: string, permissions: string[] = []): string {
  switch (role) {
    case UserRole.ENGINEER:
      if (canAccessSharedProjects(permissions)) return `/projects/${projectId}`;
      return `/eng/projects/${projectId}`;
    case UserRole.PRODUCT_MANAGER:
      if (canAccessSharedProjects(permissions)) return `/projects/${projectId}`;
      return `/pm/projects/${projectId}`;
    case UserRole.CLIENT:
      return `/client/projects/${projectId}`;
    case UserRole.SUPER_ADMIN:
    case UserRole.ADMIN:
    default:
      return `/projects/${projectId}`;
  }
}

export function getTaskRoute(role: string, projectId: string, taskId: string, permissions: string[] = []): string {
  switch (role) {
    case UserRole.ENGINEER:
      if (canAccessSharedProjects(permissions)) return `/projects/${projectId}/tasks/${taskId}`;
      return `/eng/projects/${projectId}/tasks/${taskId}`;
    case UserRole.PRODUCT_MANAGER:
      if (canAccessSharedProjects(permissions)) return `/projects/${projectId}/tasks/${taskId}`;
      return `/pm/projects/${projectId}/tasks/${taskId}`;
    case UserRole.CLIENT:
      return `/client/projects/${projectId}/tasks/${taskId}`;
    case UserRole.SUPER_ADMIN:
    case UserRole.ADMIN:
    default:
      return `/projects/${projectId}/tasks/${taskId}`;
  }
}

export function getDefaultRoute(role: string, permissions: string[] = []): string {
  const hasPermission = (permission: string) => permissions.includes(permission);

  switch (role) {
    case UserRole.SUPER_ADMIN:
    case UserRole.ADMIN:
      if (hasPermission('analytics.view_portfolio')) return '/dashboard';
      if (hasPermission('project.view_all') || hasPermission('project.view_assigned')) return '/projects';
      if (hasPermission('analytics.view_team')) return '/team';
      if (hasPermission('analytics.view_project')) return '/today';
      if (hasPermission('user.view')) return '/users';
      if (hasPermission('project.create')) return '/projects/new';
      return '/projects';
    case UserRole.PRODUCT_MANAGER:
      if (hasPermission('analytics.view_portfolio')) return '/dashboard';
      if (canAccessSharedProjects(permissions)) return '/projects';
      if (hasPermission('project.view_assigned')) return '/pm/dashboard';
      if (hasPermission('analytics.view_team')) return '/pm/team';
      if (hasPermission('analytics.view_project') || hasPermission('analytics.view_portfolio')) return '/today';
      return '/pm/dashboard';
    case UserRole.ENGINEER:
      if (hasPermission('analytics.view_portfolio')) return '/dashboard';
      if (canAccessSharedProjects(permissions)) return '/projects';
      if (canAccessSharedAnalytics(permissions)) return '/analytics';
      if (canAccessSharedActivity(permissions)) return '/today';
      return '/eng/dashboard';
    case UserRole.CLIENT:
      // Clients always land in the stripped portal; per-project full
      // access surfaces inside the portal, not via a routing flip.
      return '/client/dashboard';
    default:
      return '/dashboard';
  }
}

/**
 * Sidebar nomenclature + iconography rules:
 *   - Each label is a single noun (or short noun phrase); no acronyms when
 *     plain English exists ("Access" not "RBAC", "Content" not "CMS").
 *   - No two visible nav items share an icon. Standup vs Team — both
 *     people-related — split into Sun (morning sync) and Users (capacity).
 *   - "People" is administrative (CRUD users); "Team" is analytical
 *     (capacity, utilization). Naming makes the distinction at a glance.
 *   - "Triage" replaces "Inbox" because the page IS a triage queue.
 */
export const SIDEBAR_NAV = {
  admin: [
    { label: 'Dashboard', path: '/dashboard', icon: 'LayoutDashboard', permission: 'analytics.view_portfolio' },
    { label: 'Today', path: '/today', icon: 'Sunrise' },
    { label: 'Triage', path: '/inbox', icon: 'Inbox', permission: 'analytics.view_portfolio' },
    // HITL agent inbox — runs waiting on a human (questions + approvals). Empty
    // for viewers who can't see agents, so it's harmless to show broadly.
    { label: 'Agent Inbox', path: '/agent-inbox', icon: 'Bot' },
    // Fleet console — every agent run across the system.
    { label: 'Fleet', path: '/fleet', icon: 'Radio', permission: 'analytics.view_portfolio' },
    // Model tiers + routing (local / self-hosted / frontier).
    { label: 'Models', path: '/models', icon: 'Cpu', permission: 'analytics.view_portfolio' },
    // Admins/super-admins also get assigned tasks (PR triage tasks etc.) and
    // need a place to find them. Team feedback #3.
    { label: 'My Tasks', path: '/my-tasks', icon: 'CheckSquare' },
    { label: 'Projects', path: '/projects', icon: 'FolderKanban', permissions: PROJECT_VIEW_PERMISSIONS },
    { label: 'Standup', path: '/standup', icon: 'Sun', permission: 'analytics.view_team' },
    // "Activity" was a sibling entry to "Today" that pointed at the
    // mutation log. PR 2026-05-15 folded both into one page at /today;
    // /activity redirects there. Dropped from the sidebar so users
    // don't see duplicate "what's happening" entries.
    { label: 'Timeline', path: '/timeline', icon: 'GanttChart', permissions: PROJECT_VIEW_PERMISSIONS },
    { label: 'Team', path: '/team', icon: 'Users', permission: 'analytics.view_team' },
    { label: 'Analytics', path: '/analytics', icon: 'BarChart3', permissions: ['analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team'] },
    { label: 'People', path: '/users', icon: 'UsersRound', permission: 'user.view' },
  ],
  superAdmin: [
    { label: 'Access', path: '/rbac', icon: 'Shield', permission: 'rbac.manage' },
    { label: 'System', path: '/settings', icon: 'Settings' },
  ],
  pm: [
    { label: 'Dashboard', path: '/pm/dashboard', icon: 'LayoutDashboard' },
    { label: 'Today', path: '/today', icon: 'Sunrise' },
    // PMs are routinely assigned planning + review tasks; same need for
    // a "what's mine" view as engineers (team feedback #3).
    { label: 'My Tasks', path: '/pm/my-tasks', icon: 'CheckSquare' },
    { label: 'Projects', path: '/pm/projects', icon: 'FolderKanban' },
    { label: 'Standup', path: '/pm/standup', icon: 'Sun', permission: 'analytics.view_team' },
    // Activity entry dropped — consolidated with Today at /today.
    { label: 'Team', path: '/pm/team', icon: 'Users', permission: 'analytics.view_team' },
    { label: 'Analytics', path: '/pm/analytics', icon: 'BarChart3', permissions: ['analytics.view_portfolio', 'analytics.view_project', 'analytics.view_team'] },
  ],
  engineer: [
    { label: 'Dashboard', path: '/eng/dashboard', icon: 'LayoutDashboard' },
    { label: 'Today', path: '/today', icon: 'Sunrise' },
    { label: 'My Tasks', path: '/eng/my-tasks', icon: 'CheckSquare' },
    { label: 'Projects', path: '/projects', icon: 'FolderKanban', permissions: PROJECT_VIEW_PERMISSIONS },
    // Activity entry dropped — consolidated with Today at /today.
    { label: 'Analytics', path: '/analytics', icon: 'BarChart3', permissions: ANALYTICS_PERMISSIONS },
    { label: 'Standup', path: '/standup', icon: 'Sun', permission: 'analytics.view_team' },
    { label: 'Team', path: '/team', icon: 'Users', permission: 'analytics.view_team' },
  ],
};
