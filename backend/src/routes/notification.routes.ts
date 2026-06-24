import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { validate } from '../middleware/validate';
import * as handler from '../handlers/notification.handler';
import {
  setPreferenceSchema,
  bulkUpdatePreferencesSchema,
} from '../validators/notificationPreference.schema';

const router = Router();

router.get('/notifications', authenticate, handler.listHandler);
router.get('/notifications/unread-count', authenticate, handler.unreadCountHandler);
// IMPORTANT: register the static `/preferences` routes BEFORE the
// dynamic `:id/read` route. Express's matcher is order-sensitive
// and `:id/read` would otherwise catch `/preferences/read` style
// paths (it won't today because we don't have a `/preferences/read`
// — but it's defensive to mount static-first regardless).
router.get(
  '/notifications/preferences',
  authenticate,
  handler.listPreferencesHandler,
);
router.patch(
  '/notifications/preferences/:type',
  authenticate,
  validate(setPreferenceSchema),
  handler.setPreferenceHandler,
);
router.put(
  '/notifications/preferences',
  authenticate,
  validate(bulkUpdatePreferencesSchema),
  handler.bulkUpdatePreferencesHandler,
);
router.patch('/notifications/:id/read', authenticate, handler.markReadHandler);
router.patch('/notifications/read-all', authenticate, handler.markAllReadHandler);
// 2026-05-15 notification-subsystem audit: pre-fix users had no
// way to clear a notification from their list. Mark-as-read flipped
// `read=true` but the row stayed, so the inbox grew forever.
// `deleteMany` in the service scopes by userId so a stranger-id
// attempt is a silent no-op at the DB layer; the handler turns
// that into a 404 rather than the deceptive `{success:true}`.
router.delete('/notifications/:id', authenticate, handler.deleteNotificationHandler);

export default router;
