import { UserRole } from '@prisma/client';
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type PermissionKey } from '@exargen/shared';
import prisma from '../config/database';
import { invalidateCache } from './rbac.service';

// Single source of truth for the permission table contents. When a new
// permission is added in shared/constants/permissions.ts, list it here too —
// then this service will upsert it on every server boot, so production
// gets new permissions without needing a manual `npm run db:seed`.
//
// Categories are purely cosmetic (used by the RBAC UI to group rows).
const PERMISSION_DEFINITIONS: Array<{ key: string; label: string; category: string }> = [
  { key: PERMISSIONS.PROJECT_CREATE, label: 'Create Projects', category: 'project' },
  { key: PERMISSIONS.PROJECT_EDIT, label: 'Edit Projects', category: 'project' },
  { key: PERMISSIONS.PROJECT_DELETE, label: 'Delete Projects', category: 'project' },
  { key: PERMISSIONS.PROJECT_VIEW_ALL, label: 'View All Projects', category: 'project' },
  { key: PERMISSIONS.PROJECT_VIEW_ASSIGNED, label: 'View Assigned Projects', category: 'project' },
  { key: PERMISSIONS.PROJECT_SET_HEALTH, label: 'Set Project Health', category: 'project' },
  { key: PERMISSIONS.PROJECT_MANAGE_MEMBERS, label: 'Manage Project Members', category: 'project' },
  { key: PERMISSIONS.TASK_CREATE, label: 'Create Tasks', category: 'task' },
  { key: PERMISSIONS.TASK_CREATE_REQUEST, label: 'Submit Task Requests (client)', category: 'task' },
  { key: PERMISSIONS.TASK_EDIT_ANY, label: 'Edit Any Task', category: 'task' },
  { key: PERMISSIONS.TASK_EDIT_OWN, label: 'Edit Own Tasks', category: 'task' },
  { key: PERMISSIONS.TASK_DELETE, label: 'Delete Tasks', category: 'task' },
  { key: PERMISSIONS.TASK_MOVE_STATUS, label: 'Move Task Status', category: 'task' },
  { key: PERMISSIONS.TASK_REQUEST_REVIEW, label: 'Request Review on a Task', category: 'task' },
  { key: PERMISSIONS.TASK_TRANSITION_DONE, label: 'Transition Tasks to Done', category: 'task' },
  { key: PERMISSIONS.TASK_VIEW_INTERNAL, label: 'View Internal Tasks', category: 'task' },
  { key: PERMISSIONS.TASK_VIEW_CLIENT_VISIBLE, label: 'View Client-Visible Tasks', category: 'task' },
  { key: PERMISSIONS.TASK_MARK_BLOCKED, label: 'Mark Task as Blocked', category: 'task' },
  { key: PERMISSIONS.MILESTONE_CREATE, label: 'Create Milestones', category: 'milestone' },
  { key: PERMISSIONS.MILESTONE_EDIT, label: 'Edit Milestones', category: 'milestone' },
  { key: PERMISSIONS.MILESTONE_VIEW, label: 'View Milestones', category: 'milestone' },
  { key: PERMISSIONS.USER_CREATE, label: 'Create Users', category: 'user' },
  { key: PERMISSIONS.USER_EDIT, label: 'Edit Users', category: 'user' },
  { key: PERMISSIONS.USER_DEACTIVATE, label: 'Deactivate Users', category: 'user' },
  { key: PERMISSIONS.USER_VIEW, label: 'View Users', category: 'user' },
  { key: PERMISSIONS.RBAC_MANAGE, label: 'Manage RBAC', category: 'user' },
  { key: PERMISSIONS.ANALYTICS_VIEW_PORTFOLIO, label: 'View Portfolio Analytics', category: 'analytics' },
  { key: PERMISSIONS.ANALYTICS_VIEW_PROJECT, label: 'View Project Analytics', category: 'analytics' },
  { key: PERMISSIONS.ANALYTICS_VIEW_TEAM, label: 'View Team Workload', category: 'analytics' },
  { key: PERMISSIONS.DECISION_CREATE, label: 'Create Decisions', category: 'decision' },
  { key: PERMISSIONS.DECISION_EDIT, label: 'Edit Decisions', category: 'decision' },
  { key: PERMISSIONS.DECISION_VIEW, label: 'View Decisions', category: 'decision' },
  { key: PERMISSIONS.COMMENT_CREATE, label: 'Create Comments', category: 'comment' },
  { key: PERMISSIONS.COMMENT_VIEW, label: 'View Comments', category: 'comment' },
  { key: PERMISSIONS.DELIVERABLE_CREATE, label: 'Create Deliverables', category: 'deliverable' },
  { key: PERMISSIONS.DELIVERABLE_EDIT, label: 'Edit Deliverables', category: 'deliverable' },
  { key: PERMISSIONS.DELIVERABLE_DELETE, label: 'Delete Deliverables', category: 'deliverable' },
  { key: PERMISSIONS.DELIVERABLE_SIGN_OFF, label: 'Sign Off Deliverables', category: 'deliverable' },
  { key: PERMISSIONS.INTEGRATION_MANAGE, label: 'Manage Integrations', category: 'integration' },
  // Products (PR C feature #6)
  { key: PERMISSIONS.PRODUCT_VIEW,   label: 'View Products',   category: 'product' },
  { key: PERMISSIONS.PRODUCT_CREATE, label: 'Create Products', category: 'product' },
  { key: PERMISSIONS.PRODUCT_EDIT,   label: 'Edit Products',   category: 'product' },
  { key: PERMISSIONS.PRODUCT_DELETE, label: 'Delete Products', category: 'product' },
];

/**
 * Idempotently upserts the permission catalog and DEFAULT role-permission
 * grants. Safe to run on every server boot — uses Prisma upsert so existing
 * rows are unchanged unless their label/category drifts.
 *
 * IMPORTANT: this only populates DEFAULTS for grants that don't yet exist.
 * Once an admin tweaks role permissions through the RBAC UI, those custom
 * values are preserved across restarts (we don't overwrite existing
 * RolePermission rows here).
 */
export async function syncPermissionDefinitions(): Promise<{ inserted: number; total: number }> {
  let inserted = 0;

  // Phase 1: upsert permission catalog rows
  for (const def of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { key: def.key },
      create: def,
      update: { label: def.label, category: def.category },
    });
  }

  // Phase 2: ensure DEFAULT role grants exist for newly-introduced permissions.
  // We insert {role, permissionId, granted} rows ONLY when missing — we never
  // overwrite a row an admin may have toggled in the RBAC UI.
  const allPerms = await prisma.permission.findMany();
  for (const role of Object.values(UserRole)) {
    const grantedKeys = new Set<PermissionKey>(
      DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] || []
    );
    for (const perm of allPerms) {
      const existing = await prisma.rolePermission.findUnique({
        where: { role_permissionId: { role, permissionId: perm.id } },
      });
      if (!existing) {
        await prisma.rolePermission.create({
          data: { role, permissionId: perm.id, granted: grantedKeys.has(perm.key as PermissionKey) },
        });
        inserted += 1;
      }
    }
  }

  if (inserted > 0) {
    invalidateCache();
  }

  return { inserted, total: PERMISSION_DEFINITIONS.length };
}
