import { LeadStatus } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errors';
import { PublicLeadPayload } from '../validators/lead.schema';

const LEAD_STATUS_VALUES = new Set<LeadStatus>(['NEW', 'CONTACTED', 'CLOSED']);

export class LeadService {
  static async ingestLead(apiKey: string, payload: PublicLeadPayload) {
    const project = await prisma.cmsContentProject.findFirst({ where: { apiKey, isActive: true, deletedAt: null } });
    if (!project) throw new AppError(403, 'INVALID_API_KEY', 'API key not valid');

    // If scopes are present, require leads.ingest
    if (Array.isArray(project.apiKeyScopes) && project.apiKeyScopes.length > 0 && !project.apiKeyScopes.includes('leads.ingest')) {
      throw new AppError(403, 'INSUFFICIENT_SCOPE', 'API key does not permit lead ingestion');
    }

    // Basic duplicate detection: same email + formType within 7 days
    if (payload.email) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const existing = await prisma.lead.findFirst({
        where: {
          projectId: project.id,
          email: payload.email,
          formType: payload.formType,
          createdAt: { gt: sevenDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existing) {
        return { duplicate: true, lead: existing };
      }
    }

    const lead = await prisma.lead.create({
      data: {
        projectId: project.id,
        website: project.name,
        formType: payload.formType,
        name: payload.name ?? null,
        email: payload.email ?? null,
        phone: payload.phone ?? null,
        company: payload.company ?? null,
        message: payload.message ?? null,
        sourcePage: payload.sourcePage ?? null,
        metadata: payload.metadata ?? null,
      },
    });

    // No activity-log entry: that table is user-attributed (userId is
    // non-null), and public ingest has no acting user. The lead row
    // itself + the bell notification below carry the same signal.

    // Non-blocking bell notification fan-out — recipients = active
    // users whose role grants `leads.view`. Dynamic import keeps the
    // public ingest path off the notification service's import graph
    // until the first lead lands, matching the activity log pattern
    // above. Duplicates DO NOT re-notify (we return early before this).
    import('./notification.service').then(({ notifyLeadIngested }) => {
      notifyLeadIngested({
        leadId: lead.id,
        projectId: project.id,
        projectName: project.name,
        formType: lead.formType,
        leadName: lead.name,
        leadEmail: lead.email,
      }).catch(() => {});
    }).catch(() => {});

    return { duplicate: false, lead };
  }

  static async listLeads(
    projectId: string | null,
    page = 1,
    limit = 25,
    status?: 'NEW' | 'CONTACTED' | 'CLOSED'
  ) {
    const offset = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { project: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.lead.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  static async getLead(id: string) {
    return prisma.lead.findUnique({ where: { id } });
  }

  static async updateLeadStatus(id: string, status: string) {
    if (!LEAD_STATUS_VALUES.has(status as LeadStatus)) {
      throw new AppError(400, 'INVALID_STATUS', `status must be one of: ${[...LEAD_STATUS_VALUES].join(', ')}`);
    }
    return prisma.lead.update({ where: { id }, data: { status: status as LeadStatus } });
  }
}

export default LeadService;
