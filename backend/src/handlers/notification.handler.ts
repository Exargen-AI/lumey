import { Request, Response, NextFunction } from 'express';
import * as notificationService from '../services/notification.service';
import * as preferenceService from '../services/notificationPreference.service';
import { NOTIFICATION_TYPES, NOTIFICATION_CATEGORIES } from '../constants/notificationTypes';

/**
 * Upper bound on `page` so a malicious caller can't force Postgres
 * to compute `skip = 99999999 * 20` (deep-scan footgun, mini-DoS
 * vector even though it's scoped to the caller's own row set).
 * Anyone past page 500 of their own notifications has bigger
 * problems than UI polish.
 */
const MAX_PAGE = 500;

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.min(MAX_PAGE, Math.max(1, parseInt(req.query.page as string) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const data = await notificationService.getUserNotifications(req.user!.id, page, limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function unreadCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await notificationService.getUnreadCount(req.user!.id);
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
}

export async function markReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.markAsRead(req.params.id, req.user!.id);
    if (result.updated === 0) {
      // 2026-05-15 audit: pre-fix the handler returned
      // `{ success: true }` even when the notification id was
      // stale OR belonged to another user. The FE then
      // optimistically removed the row from its unread list and
      // the badge count went out of sync. A 404 with a clear
      // code lets the FE re-fetch.
      res.status(404).json({
        success: false,
        error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found or already gone' },
      });
      return;
    }
    res.json({ success: true, data: { updated: result.updated } });
  } catch (err) { next(err); }
}

export async function markAllReadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.markAllAsRead(req.user!.id);
    // Return the count so the FE can decrement the unread badge by
    // exactly this number without re-fetching.
    res.json({ success: true, data: { updated: result.updated } });
  } catch (err) { next(err); }
}

export async function deleteNotificationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await notificationService.deleteNotification(req.params.id, req.user!.id);
    if (result.deleted === 0) {
      res.status(404).json({
        success: false,
        error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found or already gone' },
      });
      return;
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ── Notification preferences (mute by type) ────────────────────────────
//
// All three handlers are scoped to the authenticated user. The route
// never accepts a `userId` from the request — the only legitimate
// caller is "me changing my own preferences", and an admin path
// would need a separate handler with its own authz check (no such
// flow exists yet; users own their own settings).
//
// The list endpoint returns both the toggle rows AND the category
// metadata so the FE can render the grouped UI without a second
// round-trip OR a hardcoded copy of the categories.

export async function listPreferencesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const preferences = await preferenceService.getPreferences(req.user!.id);
    res.json({
      success: true,
      data: {
        preferences,
        types: NOTIFICATION_TYPES,
        categories: NOTIFICATION_CATEGORIES,
      },
    });
  } catch (err) { next(err); }
}

export async function setPreferenceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await preferenceService.setMuted(
      req.user!.id,
      req.params.type,
      req.body.muted,
    );
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
}

export async function bulkUpdatePreferencesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await preferenceService.bulkUpdate(
      req.user!.id,
      req.body.preferences,
    );
    res.json({ success: true, data: { preferences: result } });
  } catch (err) { next(err); }
}
