import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import * as todayHandler from '../handlers/today.handler';

const router = Router();

// GET /today — daily wrap-up.
// Query args:
//   date=YYYY-MM-DD       (defaults to today, per tz)
//   tz=<minutes-west-utc> (defaults to 0)
//   mine=true             (engineer dashboard variant — only my closes)
//   projectId=<uuid>      (narrow to one project; PM/admin use this)
//
// Visibility is computed inside the service from req.user. Every role
// gets a useful view of "what shipped today" — clients see their
// client-visible tasks, engineers see what they touched, admin/PM see
// everything they can already see elsewhere.
router.get('/today', authenticate, todayHandler.getDoneTodayHandler);

export default router;
