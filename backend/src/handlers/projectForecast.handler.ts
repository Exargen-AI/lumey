import { Request, Response, NextFunction } from 'express';
import * as service from '../services/projectForecast.service';

/**
 * GET /projects/:id/forecast
 *
 * Returns a `ProjectForecast` for the project. The shape is suitable for
 * direct rendering on the client project status page hero — the service
 * already produces a `message` field the UI can show verbatim.
 *
 * Access: `projectAccess` middleware on the route gates this to project
 * members (including CLIENT-role members) + anyone with `project.view_all`.
 * No additional permission is required — if you can view the project, you
 * can see its forecast.
 */
export async function forecastHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const forecast = await service.computeProjectForecast(req.params.id);
    res.json({ success: true, data: forecast });
  } catch (err) {
    next(err);
  }
}
