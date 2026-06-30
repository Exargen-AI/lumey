/**
 * Audit export — a downloadable, compliance-grade record of who did what, when.
 * It reads the activity log (which now carries an immutable `actorType`, P4.3)
 * into a flat, scoped, date-filtered table and serializes it as CSV or JSON.
 *
 * Scope is admin-first (the route gates on a portfolio permission), then narrowed
 * the same way as the rest of the app: `project.view_all` sees every project,
 * otherwise the viewer's memberships. And the agent-visibility directive is
 * upheld even in an export — a viewer who can't see agents never gets
 * agent-authored rows.
 */
import prisma from '../config/database';
import { checkPermission } from './rbac.service';
import { viewerCanSeeAgents } from '../lib/agentVisibility';
import { UserType, type Prisma, type UserRole } from '@prisma/client';

export interface AuditViewer {
  readonly id: string;
  readonly role: UserRole;
  readonly canViewAgents?: boolean | null;
}

export interface AuditExportOptions {
  /** ISO date (inclusive lower bound) — defaults to 90 days ago. */
  readonly from?: string;
  /** ISO date (exclusive upper bound) — defaults to now. */
  readonly to?: string;
  /** Hard cap on rows (DoS guard). */
  readonly limit?: number;
}

export interface AuditRow {
  timestamp: string;
  actorType: UserType;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  project: string;
}

function parseDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** The scoped, ordered audit rows for the viewer + window. */
export async function getAuditRows(viewer: AuditViewer, opts: AuditExportOptions = {}): Promise<AuditRow[]> {
  const to = parseDate(opts.to, new Date());
  const from = parseDate(opts.from, new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000));
  const take = Math.min(Math.max(opts.limit ?? 10_000, 1), 50_000);

  const where: Prisma.ActivityWhereInput = { createdAt: { gte: from, lt: to } };

  // Project scope: admins with view_all see everything; others only their projects.
  if (!(await checkPermission(viewer.role, 'project.view_all'))) {
    const memberships = await prisma.projectMember.findMany({ where: { userId: viewer.id }, select: { projectId: true } });
    where.projectId = { in: memberships.map((m) => m.projectId) };
  }
  // Agent-visibility directive: hide agent-authored rows from viewers not on the
  // allowlist, even in an export.
  if (!viewerCanSeeAgents(viewer)) where.actorType = UserType.HUMAN;

  const rows = await prisma.activity.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      createdAt: true,
      actorType: true,
      action: true,
      targetType: true,
      targetId: true,
      user: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    timestamp: r.createdAt.toISOString(),
    actorType: r.actorType,
    actor: r.user?.name ?? '',
    action: r.action,
    targetType: r.targetType ?? '',
    targetId: r.targetId ?? '',
    project: r.project?.name ?? '',
  }));
}

const COLUMNS: (keyof AuditRow)[] = ['timestamp', 'actorType', 'actor', 'action', 'targetType', 'targetId', 'project'];

/** Quote a CSV field per RFC 4180 (and neutralize spreadsheet formula injection). */
function csvField(value: string): string {
  // A leading =,+,-,@ would be interpreted as a formula by Excel/Sheets — prefix
  // a quote-safe apostrophe so an audit row can't execute on open.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Serialize audit rows to RFC-4180 CSV with a header line. */
export function toCsv(rows: AuditRow[]): string {
  const header = COLUMNS.join(',');
  const body = rows.map((r) => COLUMNS.map((c) => csvField(String(r[c]))).join(','));
  return [header, ...body].join('\r\n');
}
