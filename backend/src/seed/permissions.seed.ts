import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { PERMISSIONS } from '@exargen/shared';
import { DEFAULT_ROLE_PERMISSIONS } from '@exargen/shared';

const PERMISSION_DEFINITIONS = [
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
  // Project Documents (S3-backed reference material)
  { key: PERMISSIONS.DOCUMENT_UPLOAD, label: 'Upload Project Documents', category: 'document' },
  { key: PERMISSIONS.DOCUMENT_READ,   label: 'Read Project Documents',   category: 'document' },
  { key: PERMISSIONS.DOCUMENT_DELETE, label: 'Delete Project Documents', category: 'document' },
  // Products
  { key: PERMISSIONS.PRODUCT_VIEW,    label: 'View Products',   category: 'product' },
  { key: PERMISSIONS.PRODUCT_CREATE,  label: 'Create Products', category: 'product' },
  { key: PERMISSIONS.PRODUCT_EDIT,    label: 'Edit Products',   category: 'product' },
  { key: PERMISSIONS.PRODUCT_DELETE,  label: 'Delete Products', category: 'product' },
  { key: PERMISSIONS.CMS_PROJECT_CREATE, label: 'Create CMS Projects', category: 'cms' },
  { key: PERMISSIONS.CMS_PROJECT_EDIT, label: 'Edit CMS Projects', category: 'cms' },
  { key: PERMISSIONS.CMS_PROJECT_DELETE, label: 'Delete CMS Projects', category: 'cms' },
  { key: PERMISSIONS.CMS_PROJECT_VIEW, label: 'View CMS Projects', category: 'cms' },
  { key: PERMISSIONS.CMS_BLOG_CREATE, label: 'Create CMS Blogs', category: 'cms' },
  { key: PERMISSIONS.CMS_BLOG_EDIT, label: 'Edit CMS Blogs', category: 'cms' },
  { key: PERMISSIONS.CMS_BLOG_DELETE, label: 'Delete CMS Blogs', category: 'cms' },
  { key: PERMISSIONS.CMS_BLOG_PUBLISH, label: 'Publish CMS Blogs', category: 'cms' },
  { key: PERMISSIONS.CMS_BLOG_VIEW, label: 'View CMS Blogs', category: 'cms' },
  { key: PERMISSIONS.CMS_TEMPLATE_CREATE, label: 'Create CMS Templates', category: 'cms' },
  { key: PERMISSIONS.CMS_TEMPLATE_EDIT, label: 'Edit CMS Templates', category: 'cms' },
  { key: PERMISSIONS.CMS_TEMPLATE_DELETE, label: 'Delete CMS Templates', category: 'cms' },
  { key: PERMISSIONS.CMS_TEMPLATE_VIEW, label: 'View CMS Templates', category: 'cms' },
  { key: PERMISSIONS.CMS_MEDIA_VIEW, label: 'View CMS Media', category: 'cms' },
  { key: PERMISSIONS.CMS_MEDIA_UPLOAD, label: 'Upload CMS Media', category: 'cms' },
  { key: PERMISSIONS.CMS_MEDIA_DELETE, label: 'Delete CMS Media', category: 'cms' },
  { key: PERMISSIONS.CMS_APIKEY_VIEW, label: 'View Project API Key', category: 'cms' },
  { key: PERMISSIONS.CMS_APIKEY_MANAGE, label: 'Manage Project API Key (regenerate, scopes)', category: 'cms' },
  { key: PERMISSIONS.LEADS_VIEW, label: 'View Leads', category: 'leads' },
  { key: PERMISSIONS.LEADS_MANAGE, label: 'Manage Leads', category: 'leads' },
  { key: PERMISSIONS.LEADS_INGEST, label: 'Ingest Leads (API)', category: 'leads' },
  { key: PERMISSIONS.DEVOPS_READ, label: 'View DevelopmentOps', category: 'devops' },
  { key: PERMISSIONS.DEVOPS_MANAGE, label: 'Manage DevelopmentOps', category: 'devops' },
];

export async function seedPermissions() {
  console.log('Seeding permissions...');

  // Upsert all permission definitions
  for (const perm of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      create: perm,
      update: { label: perm.label, category: perm.category },
    });
  }

  // Fetch all permissions to get IDs
  const allPerms = await prisma.permission.findMany();
  const permMap = new Map(allPerms.map((p) => [p.key, p.id]));

  // Create role-permission mappings for each role
  for (const role of Object.values(UserRole)) {
    const grantedKeys = DEFAULT_ROLE_PERMISSIONS[role as keyof typeof DEFAULT_ROLE_PERMISSIONS] || [];

    for (const perm of allPerms) {
      const granted = grantedKeys.includes(perm.key as any);
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role, permissionId: perm.id } },
        create: { role, permissionId: perm.id, granted },
        update: { granted },
      });
    }
  }

  console.log(`Seeded ${PERMISSION_DEFINITIONS.length} permissions with role mappings`);
}
