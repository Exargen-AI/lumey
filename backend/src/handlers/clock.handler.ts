/**
 * Pulse — Clock In / Clock Out handlers (2026-05-28b).
 *
 * Thin pass-through to clockSession.service. Two surfaces:
 *
 *   Self routes (any authenticated user):
 *     POST /clock/in       — start a session
 *     POST /clock/out      — close the open session
 *     GET  /clock/me/today — current status + today's sessions
 *
 *   Admin route (SUPER_ADMIN-only):
 *     GET  /admin/pulse/clock/team — team-wide clock status for a date
 *
 * Clock activity isn't agent-mediated (the human, not the laptop, is
 * the actor). All routes use the user-JWT `authenticate` middleware.
 */

import type { Request, Response, NextFunction } from 'express';
import * as service from '../services/clockSession.service';
import { UserRole } from '@exargen/shared';
import { ForbiddenError } from '../utils/errors';

function toDTO(s: {
  id: string;
  userId: string;
  clockedInAt: Date;
  clockedOutAt: Date | null;
  autoClosedAt: Date | null;
  noteIn: string | null;
  noteOut: string | null;
}) {
  return {
    id: s.id,
    userId: s.userId,
    clockedInAt: s.clockedInAt.toISOString(),
    clockedOutAt: s.clockedOutAt ? s.clockedOutAt.toISOString() : null,
    autoClosedAt: s.autoClosedAt ? s.autoClosedAt.toISOString() : null,
    noteIn: s.noteIn,
    noteOut: s.noteOut,
  };
}

export async function clockInHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { note?: string };
    const session = await service.clockIn(req.user!.id, body.note);
    res.status(201).json({ success: true, data: toDTO(session) });
  } catch (err) {
    next(err);
  }
}

export async function clockOutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { note?: string };
    const session = await service.clockOut(req.user!.id, body.note);
    res.status(200).json({ success: true, data: toDTO(session) });
  } catch (err) {
    next(err);
  }
}

export async function getMyClockStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const status = await service.getClockStatusForUser(req.user!.id);
    res.status(200).json({
      success: true,
      data: {
        openSession: status.openSession ? toDTO(status.openSession) : null,
        todaySessions: status.todaySessions.map(toDTO),
        totalSecondsToday: status.totalSecondsToday,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getTeamClockStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Defence in depth on top of requireRoles middleware.
    if (req.user!.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Pulse team clock view is SUPER_ADMIN-only');
    }
    const dateParam = typeof req.query.date === 'string' ? new Date(req.query.date) : new Date();
    const rows = await service.getTeamClockStatus(dateParam);
    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        user: r.user,
        openSession: r.openSession ? toDTO(r.openSession) : null,
        totalSecondsToday: r.totalSecondsToday,
        sessionCountToday: r.sessionCountToday,
      })),
    });
  } catch (err) {
    next(err);
  }
}
