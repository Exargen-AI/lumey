import type { Request, Response, NextFunction } from 'express';
import { getAuditRows, toCsv } from '../services/audit.service';

// GET /api/v1/audit/export?format=csv|json&from=&to= — a scoped, date-windowed
// export of the activity log for compliance. CSV downloads as a file; JSON is a
// normal API response. Admin-gated at the route; the service scopes rows.
export async function exportAuditHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const viewer = { id: req.user!.id, role: req.user!.role, canViewAgents: req.user!.canViewAgents };
    const rows = await getAuditRows(viewer, {
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    });

    if (req.query.format === 'json') {
      res.json({ success: true, data: rows });
      return;
    }
    const filename = `lumey-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(toCsv(rows));
  } catch (err) {
    next(err);
  }
}
