/**
 * Pulse — Clock In / Clock Out service (2026-05-28b).
 *
 * Employee-self clock sessions. Distinct from automatic device
 * telemetry (the device might be on while the human isn't working —
 * meetings, phone calls, off-laptop tasks). This is the user's
 * declared "I'm working now" / "I'm done now" interval.
 *
 * Invariants:
 *   - At most one OPEN session per user at any time (refuses double-
 *     clockIn).
 *   - clockOut without an open session is a no-op + ValidationError.
 *   - Sessions still open after 12h get an autoClosedAt timestamp on
 *     the sweep so the SUPER_ADMIN view can flag forgot-to-clock-out
 *     cases without polluting totals.
 *
 * What it deliberately does NOT do:
 *   - Approve / dispute hours (that's the Timesheet system).
 *   - Cross-day rollover (each session is a contiguous interval;
 *     "today's total" is computed at read time from the session set).
 */

import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import { emitProductivityEvent } from '../lib/productivityOutbox';
import { toDateOnlyString } from '../utils/date';

const AUTO_CLOSE_AFTER_MS = 12 * 60 * 60 * 1000; // 12h

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() + 1);
  return d;
}

export async function getOpenSession(userId: string) {
  return prisma.clockSession.findFirst({
    where: { userId, clockedOutAt: null, autoClosedAt: null },
    orderBy: { clockedInAt: 'desc' },
  });
}

export async function clockIn(userId: string, note?: string) {
  // Wave 11 — the partial unique index
  // `clock_sessions_one_open_per_user` enforces "at most one open
  // session per user" at the DB level. The application code below
  // is the friendly path: check for an existing open session first
  // (return ValidationError so the FE renders "already clocked in"),
  // and as a backstop catch the Postgres unique_violation (23505) if
  // two concurrent /clock/in races slip past the application check.
  // Without the catch the second caller sees a generic 500. With
  // the catch they see the consistent "already clocked in" message.
  const open = await getOpenSession(userId);
  if (open) {
    throw new ValidationError(
      'You are already clocked in. Clock out first before clocking in again.',
    );
  }
  let session;
  try {
    session = await prisma.clockSession.create({
      data: {
        userId,
        clockedInAt: new Date(),
        noteIn: note ?? null,
      },
    });
  } catch (err) {
    // Prisma surfaces unique_violation as P2002. The narrow check
    // makes sure we don't swallow unrelated errors.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ValidationError(
        'You are already clocked in. Clock out first before clocking in again.',
      );
    }
    throw err;
  }
  await logActivity({
    userId,
    action: 'clock_in',
    targetType: 'clock_session',
    targetId: session.id,
    details: { noteIn: note ?? null },
  });
  return session;
}

export async function clockOut(userId: string, note?: string) {
  const open = await getOpenSession(userId);
  if (!open) {
    throw new ValidationError('You are not currently clocked in.');
  }

  // Pulse productivity score (Wave 2) — PRESENCE signal.
  // Wrap the close + outbox emit in one transaction so the event
  // never lands without the corresponding ClockSession row, and
  // vice-versa. The activity log stays after the tx (it's a separate
  // concern; same shape as the previous implementation).
  const session = await prisma.$transaction(async (tx) => {
    const updated = await tx.clockSession.update({
      where: { id: open.id },
      data: {
        clockedOutAt: new Date(),
        noteOut: note ?? null,
      },
    });

    // PRESENCE outbox event — credit a clock.session_closed for this
    // user. Day string in user-local TZ for window bucketing on the
    // worker side.
    const durationSeconds = Math.floor(
      (updated.clockedOutAt!.getTime() - updated.clockedInAt.getTime()) / 1000,
    );
    const date = toDateOnlyString(updated.clockedInAt);
    await emitProductivityEvent(tx, {
      userId,
      signal: 'PRESENCE',
      eventType: 'clock.session_closed',
      occurredAt: updated.clockedOutAt!,
      rawPayload: {
        clockedInAt: updated.clockedInAt.toISOString(),
        clockedOutAt: updated.clockedOutAt!.toISOString(),
        durationSeconds,
        date,
      },
      source: 'clock_sessions',
      sourceId: updated.id,
    });

    return updated;
  });

  await logActivity({
    userId,
    action: 'clock_out',
    targetType: 'clock_session',
    targetId: session.id,
    details: {
      noteOut: note ?? null,
      durationSeconds: Math.floor(
        (session.clockedOutAt!.getTime() - session.clockedInAt.getTime()) / 1000,
      ),
    },
  });
  return session;
}

function sessionEffectiveOutAt(s: {
  clockedOutAt: Date | null;
  autoClosedAt: Date | null;
}): Date {
  return s.clockedOutAt ?? s.autoClosedAt ?? new Date();
}

function sessionSeconds(s: {
  clockedInAt: Date;
  clockedOutAt: Date | null;
  autoClosedAt: Date | null;
}): number {
  const out = sessionEffectiveOutAt(s);
  return Math.max(0, Math.floor((out.getTime() - s.clockedInAt.getTime()) / 1000));
}

export async function getClockStatusForUser(userId: string) {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  // Sessions that touch today (started or ended today).
  const todaySessions = await prisma.clockSession.findMany({
    where: {
      userId,
      OR: [
        { clockedInAt: { gte: dayStart, lt: dayEnd } },
        // Sessions opened before midnight but still open OR closed today.
        {
          clockedInAt: { lt: dayEnd },
          OR: [
            { clockedOutAt: { gte: dayStart, lt: dayEnd } },
            { autoClosedAt: { gte: dayStart, lt: dayEnd } },
            { clockedOutAt: null, autoClosedAt: null },
          ],
        },
      ],
    },
    orderBy: { clockedInAt: 'asc' },
  });

  // Compute "today's seconds" by clipping each session to the [dayStart,
  // now] window. This handles a session that ran from yesterday into
  // today cleanly.
  let totalSecondsToday = 0;
  for (const s of todaySessions) {
    const sessionStart = s.clockedInAt < dayStart ? dayStart : s.clockedInAt;
    const sessionEnd = sessionEffectiveOutAt(s);
    const clippedEnd = sessionEnd > now ? now : sessionEnd;
    totalSecondsToday += Math.max(
      0,
      Math.floor((clippedEnd.getTime() - sessionStart.getTime()) / 1000),
    );
  }

  const open =
    todaySessions.find(
      (s) => s.clockedOutAt === null && s.autoClosedAt === null,
    ) ?? null;

  return {
    openSession: open,
    todaySessions,
    totalSecondsToday,
  };
}

// ─── Auto-close sweep ─────────────────────────────────────────────────

export async function autoCloseStaleSessions(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_MS);
  // We need clockedInAt now (Wave 11) so we can compute the
  // duration for the PRESENCE outbox emit.
  const stale = await prisma.clockSession.findMany({
    where: {
      clockedOutAt: null,
      autoClosedAt: null,
      clockedInAt: { lt: cutoff },
    },
    select: { id: true, userId: true, clockedInAt: true },
  });
  if (stale.length === 0) return { closed: 0 };

  // Wave 11 — close + emit PRESENCE in a single transaction per
  // session. The old code marked sessions as autoClosed but never
  // emitted a `clock.session_closed` event, so the PRESENCE scorer
  // silently dropped credit for the work the user actually did.
  // An employee who forgot to clock out lost their entire session's
  // presence contribution.
  //
  // Now: each auto-closed session emits the same event the manual
  // clockOut emits, with duration capped at AUTO_CLOSE_AFTER_MS.
  // The event's `occurredAt = now` (when we detected the stale-
  // ness) so it lands in the correct cadence window.
  await Promise.all(
    stale.map((s) =>
      prisma.$transaction(async (tx) => {
        await tx.clockSession.update({
          where: { id: s.id },
          data: { autoClosedAt: now },
        });
        const durationSeconds = Math.floor(
          (now.getTime() - s.clockedInAt.getTime()) / 1000,
        );
        const date = toDateOnlyString(s.clockedInAt);
        await emitProductivityEvent(tx, {
          userId: s.userId,
          signal: 'PRESENCE',
          eventType: 'clock.session_closed',
          occurredAt: now,
          rawPayload: {
            clockedInAt: s.clockedInAt.toISOString(),
            clockedOutAt: now.toISOString(),
            durationSeconds,
            date,
            // Audit-trail breadcrumb so the breakdown drawer shows
            // "this session was auto-closed, not manually clocked out."
            autoClosed: true,
          },
          source: 'clock_sessions',
          sourceId: s.id,
        });
      }),
    ),
  );

  // Audit-log per affected user. We can't log against a synthetic
  // "system" userId because Activity.userId has a strict FK into
  // users.id — a synthetic value would either fail at insert or
  // (because logActivity outside a transaction is fire-and-forget)
  // silently drop the audit trail. Logging against each affected
  // user preserves the trail correctly.
  await Promise.all(
    stale.map((s) =>
      logActivity({
        userId: s.userId,
        action: 'clock_session_auto_closed',
        targetType: 'clock_session',
        targetId: s.id,
        details: { cutoff: cutoff.toISOString() },
      }),
    ),
  );
  return { closed: stale.length };
}

// ─── Admin (SUPER_ADMIN) team view ────────────────────────────────────

export async function getTeamClockStatus(date: Date = new Date()) {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  // All users who had ANY clock activity today + anyone with a still-
  // open session that began earlier.
  const sessions = await prisma.clockSession.findMany({
    where: {
      OR: [
        { clockedInAt: { gte: dayStart, lt: dayEnd } },
        {
          clockedInAt: { lt: dayEnd },
          clockedOutAt: { gte: dayStart, lt: dayEnd },
        },
        { clockedOutAt: null, autoClosedAt: null },
      ],
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { clockedInAt: 'asc' },
  });

  type Row = {
    user: { id: string; name: string; email: string };
    openSession: (typeof sessions)[number] | null;
    totalSecondsToday: number;
    sessionCountToday: number;
  };
  const byUser = new Map<string, Row>();
  for (const s of sessions) {
    const row = byUser.get(s.userId) ?? {
      user: s.user,
      openSession: null,
      totalSecondsToday: 0,
      sessionCountToday: 0,
    };
    if (s.clockedOutAt === null && s.autoClosedAt === null) row.openSession = s;
    const sessionStart = s.clockedInAt < dayStart ? dayStart : s.clockedInAt;
    const sessionEnd = sessionEffectiveOutAt(s);
    const clippedEnd = sessionEnd > dayEnd ? dayEnd : sessionEnd;
    row.totalSecondsToday += Math.max(
      0,
      Math.floor((clippedEnd.getTime() - sessionStart.getTime()) / 1000),
    );
    row.sessionCountToday += 1;
    byUser.set(s.userId, row);
  }
  return Array.from(byUser.values()).sort((a, b) =>
    a.user.name.localeCompare(b.user.name),
  );
}

// Internal helper exported for tests.
export const _internal = {
  sessionSeconds,
  startOfDay,
  endOfDay,
};
