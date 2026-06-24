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
const CMS_PERMISSIONS = [
  'cms.project.view',
  'cms.project.create',
  'cms.project.edit',
  'cms.blog.view',
  'cms.blog.create',
  'cms.blog.edit',
  'cms.template.view',
  'cms.template.create',
  'cms.template.edit',
  'cms.media.view',
  'cms.media.upload',
];

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

export function canAccessSharedCms(permissions: string[] = []): boolean {
  return hasAnyPermission(permissions, CMS_PERMISSIONS);
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
      if (hasPermission('analytics.view_project')) return '/activity';
      if (hasPermission('user.view')) return '/users';
      if (hasPermission('project.create')) return '/projects/new';
      return '/projects';
    case UserRole.PRODUCT_MANAGER:
      if (hasPermission('analytics.view_portfolio')) return '/dashboard';
      if (canAccessSharedProjects(permissions)) return '/projects';
      if (canAccessSharedCms(permissions)) return '/cms';
      if (hasPermission('project.view_assigned')) return '/pm/dashboard';
      if (hasPermission('analytics.view_team')) return '/pm/team';
      if (hasPermission('analytics.view_project') || hasPermission('analytics.view_portfolio')) return '/pm/activity';
      return '/pm/dashboard';
    case UserRole.ENGINEER:
      if (hasPermission('analytics.view_portfolio')) return '/dashboard';
      if (canAccessSharedProjects(permissions)) return '/projects';
      if (canAccessSharedAnalytics(permissions)) return '/analytics';
      if (canAccessSharedActivity(permissions)) return '/activity';
      if (canAccessSharedCms(permissions)) return '/cms';
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
    // Combined Approvals — timesheets always, plus Leave tab for SUPER_ADMIN.
    // The earlier "Approvals" + "Leave Approvals" pair is gone; both live
    // inside the single page under tabs.
    { label: 'Approvals', path: '/approvals', icon: 'ClipboardCheck', permission: 'analytics.view_team' },
    { label: 'People', path: '/users', icon: 'UsersRound', permission: 'user.view' },
    { label: 'Compliance', path: '/compliance/courses', icon: 'ShieldCheck' },
    { label: 'Onboarding Status', path: '/compliance/enrollments', icon: 'ClipboardCheck' },
    { label: 'Content', path: '/cms', icon: 'BookOpen', permissions: CMS_PERMISSIONS },
    // Combined personal page — was previously "Timesheet" + "Leave" entries
    // for engineers, just "Leave" for everyone else. One link, two tabs.
    { label: 'My Time', path: '/my-time', icon: 'CalendarClock' },
  ],
  superAdmin: [
    // Founder-only nav. The "Leave Approvals" entry that used to live here
    // is now folded into the shared `Approvals` page under a Leave tab.
    { label: 'Access', path: '/rbac', icon: 'Shield', permission: 'rbac.manage' },
    // Pulse — employee productivity tracker + device health. Telemetry is
    // SUPER_ADMIN-only by contract (backend double-gates); the sidebar
    // entry follows the same boundary.
    { label: 'Pulse', path: '/pulse', icon: 'Activity' },
    // Pulse Reports — Wave 6 surface for the multi-signal composite
    // score (separate page so the device-health view stays clean).
    // Same SUPER_ADMIN-only boundary, triple-gated on the backend.
    { label: 'Reports', path: '/pulse/reports', icon: 'BarChart3' },
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
    // Single approvals link — points at the shared `/approvals` page
    // (PMs land on the Timesheets tab; the Leave tab is hidden for them).
    { label: 'Approvals', path: '/approvals', icon: 'ClipboardCheck', permission: 'analytics.view_team' },
    { label: 'Content', path: '/cms', icon: 'BookOpen', permissions: CMS_PERMISSIONS },
    { label: 'My Time', path: '/my-time', icon: 'CalendarClock' },
  ],
  engineer: [
    { label: 'Dashboard', path: '/eng/dashboard', icon: 'LayoutDashboard' },
    { label: 'Today', path: '/today', icon: 'Sunrise' },
    { label: 'My Tasks', path: '/eng/my-tasks', icon: 'CheckSquare' },
    // "Timesheet" + "Leave" collapsed into one personal page.
    { label: 'My Time', path: '/my-time', icon: 'CalendarClock' },
    { label: 'Projects', path: '/projects', icon: 'FolderKanban', permissions: PROJECT_VIEW_PERMISSIONS },
    // Activity entry dropped — consolidated with Today at /today.
    { label: 'Analytics', path: '/analytics', icon: 'BarChart3', permissions: ANALYTICS_PERMISSIONS },
    { label: 'Standup', path: '/standup', icon: 'Sun', permission: 'analytics.view_team' },
    { label: 'Team', path: '/team', icon: 'Users', permission: 'analytics.view_team' },
    { label: 'Approvals', path: '/approvals', icon: 'ClipboardCheck', permission: 'analytics.view_team' },
    { label: 'Content', path: '/cms', icon: 'BookOpen', permissions: CMS_PERMISSIONS },
  ],
};
