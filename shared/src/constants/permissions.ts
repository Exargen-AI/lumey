export const PERMISSIONS = {
  // Project
  PROJECT_CREATE: 'project.create',
  PROJECT_EDIT: 'project.edit',
  PROJECT_DELETE: 'project.delete',
  PROJECT_VIEW_ALL: 'project.view_all',
  PROJECT_VIEW_ASSIGNED: 'project.view_assigned',
  PROJECT_SET_HEALTH: 'project.set_health',
  PROJECT_MANAGE_MEMBERS: 'project.manage_members',

  // Task
  TASK_CREATE: 'task.create',
  // Narrower sub-permission for client-submitted task requests. Granted
  // to CLIENT by default — lets them propose work from their portal
  // kanban without inheriting the full task.create surface (which would
  // also unlock setting assignee, priority overrides on internal tasks,
  // etc.). Server forces clientVisible=true + status=BACKLOG +
  // clientRequested=true on rows created via this path. Anyone with
  // task.create also satisfies this, so internal users keep one path.
  TASK_CREATE_REQUEST: 'task.create_request',
  TASK_EDIT_ANY: 'task.edit_any',
  TASK_EDIT_OWN: 'task.edit_own',
  TASK_DELETE: 'task.delete',
  TASK_MOVE_STATUS: 'task.move_status',
  // Hand a task off to a designated reviewer (the "Request review"
  // action — explicit replacement for the legacy "swap the assignee
  // to flag handoff" anti-pattern). Granted to internal roles that
  // can do the work AND ask someone else to review it. The decide-
  // review side is gated by row-level data (task.reviewerId === actor)
  // rather than a separate permission, so it stays correct even if
  // an admin grants this permission to a role we don't expect.
  TASK_REQUEST_REVIEW: 'task.request_review',
  // Stricter sub-permission of TASK_MOVE_STATUS, specifically for transitioning
  // tasks INTO Done. Granted to every human role; denied (by default) to
  // agents. The structural defense lives at the task-service layer via a
  // userType check; this permission is the policy expression that admins
  // manage from the RBAC matrix.
  TASK_TRANSITION_DONE: 'task.transition.done',
  TASK_VIEW_INTERNAL: 'task.view_internal',
  TASK_VIEW_CLIENT_VISIBLE: 'task.view_client_visible',
  TASK_MARK_BLOCKED: 'task.mark_blocked',

  // Product (PR C feature #6) — a discrete shipping unit inside a
  // Project. VIEW is granted to every project member (clients
  // included); EDIT/DELETE stay admin + PM so the team controls the
  // taxonomy clients read back.
  PRODUCT_VIEW:   'product.view',
  PRODUCT_CREATE: 'product.create',
  PRODUCT_EDIT:   'product.edit',
  PRODUCT_DELETE: 'product.delete',

  // Milestone
  MILESTONE_CREATE: 'milestone.create',
  MILESTONE_EDIT: 'milestone.edit',
  MILESTONE_VIEW: 'milestone.view',

  // User
  USER_CREATE: 'user.create',
  USER_EDIT: 'user.edit',
  USER_DEACTIVATE: 'user.deactivate',
  USER_VIEW: 'user.view',
  RBAC_MANAGE: 'rbac.manage',

  // Analytics
  ANALYTICS_VIEW_PORTFOLIO: 'analytics.view_portfolio',
  ANALYTICS_VIEW_PROJECT: 'analytics.view_project',
  ANALYTICS_VIEW_TEAM: 'analytics.view_team',

  // Decision
  DECISION_CREATE: 'decision.create',
  DECISION_EDIT: 'decision.edit',
  DECISION_VIEW: 'decision.view',

  // Comment
  COMMENT_CREATE: 'comment.create',
  COMMENT_VIEW: 'comment.view',

  // Deliverable (sign-off workflow)
  DELIVERABLE_CREATE: 'deliverable.create',
  DELIVERABLE_EDIT: 'deliverable.edit',
  DELIVERABLE_DELETE: 'deliverable.delete',
  DELIVERABLE_SIGN_OFF: 'deliverable.sign_off',

  // Project Documents (S3-backed reference material)
  // Clients get DOCUMENT_READ only — they can browse + download what the
  // team has uploaded, but can't upload or delete. Engineers/PMs/Admins
  // get UPLOAD + READ + DELETE so anyone working on the project can
  // contribute reference material.
  DOCUMENT_UPLOAD: 'document.upload',
  DOCUMENT_READ: 'document.read',
  DOCUMENT_DELETE: 'document.delete',

  // Integrations (GitHub, Slack — third-party systems wired to a project)
  INTEGRATION_MANAGE: 'integration.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
