import { Request, Response, NextFunction } from 'express';
import { publicLeadSchema } from '../validators/lead.schema';
import LeadService from '../services/lead.service';

export const ingestPublicLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = req.params;
    const payload = publicLeadSchema.parse(req.body);

    const result = await LeadService.ingestLead(apiKey, payload);

    if (result.duplicate) {
      return res.status(200).json({ success: true, duplicate: true, data: result.lead });
    }

    res.status(201).json({ success: true, data: result.lead });
  } catch (err) {
    next(err);
  }
};

export const listLeads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, status } = req.query as unknown as { projectId?: string; status?: string };
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 25);

    const validStatus =
      status && ['NEW', 'CONTACTED', 'CLOSED'].includes(status)
        ? (status as 'NEW' | 'CONTACTED' | 'CLOSED')
        : undefined;

    const data = await LeadService.listLeads(projectId ?? null, page, limit, validStatus);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

export const getLead = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const lead = await LeadService.getLead(id);
    if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (err) {
    next(err);
  }
};

export const updateLeadStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: string };
    const updated = await LeadService.updateLeadStatus(id, status);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};
