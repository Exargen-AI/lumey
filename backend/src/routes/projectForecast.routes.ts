import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { projectAccess } from '../middleware/projectAccess';
import * as handler from '../handlers/projectForecast.handler';

const router = Router();

/**
 * Project delivery forecast. Surfaces on the client project status page —
 * which means CLIENT-role users hit this endpoint. The `projectAccess`
 * middleware handles "is this user a member of this project?" so clients
 * only ever see forecasts for the projects they're on.
 */
router.get(
  '/projects/:id/forecast',
  authenticate,
  projectAccess,
  handler.forecastHandler,
);

export default router;
