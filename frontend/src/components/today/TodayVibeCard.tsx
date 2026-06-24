/**
 * TodayVibeCard — encouragement + stats + daily quote (2026-05-29).
 *
 * The "how am I doing today" panel. Three stacked sections:
 *
 *   1. Big productivity number + standup-streak chip + clock-in chip
 *   2. Encouragement banner — single line that adapts to context
 *      (no streak, mid-day, end-of-day, etc.). Conservative + factual
 *      tone, never overly cheerful, never shaming.
 *   3. Daily quote — same for everyone on the team for that day
 *
 * Polling: every 60 sec the today-summary refetches so the productive
 * hours number reflects the latest Pulse snapshot.
 */

import { useQuery } from '@tanstack/react-query';
import { Flame, Sparkles, Clock, Quote as QuoteIcon } from 'lucide-react';
import api from '@/api/client';
import { getMyStreak } from '@/api/dailyUpdates';
import { pickQuote } from '@/lib/dailyQuote';

interface MyTodaySummary {
  activeSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  productiveSeconds: number;
  entertainmentSeconds: number;
  reportingDeviceCount: number;
  standupSubmittedToday: boolean;
  currentlyClockedIn: boolean;
  dateKey: string;
}

async function fetchMyToday(): Promise<MyTodaySummary> {
  const { data } = await api.get('/pulse/me/today');
  return data.data;
}

function formatHM(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

function encouragement(summary: MyTodaySummary, streak: number | undefined): string {
  const hour = new Date().getHours();
  const activeH = summary.activeSeconds / 3600;
  const productiveH = summary.productiveSeconds / 3600;

  // No device yet → user hasn't installed the Pulse agent.
  if (summary.reportingDeviceCount === 0) {
    return "No device telemetry yet. Once your Pulse agent is installed, today's stats will populate here.";
  }

  // Tamper or excessive entertainment — but we never use this card to
  // shame; the SUPER_ADMIN dashboard surfaces those alerts. Keep this
  // card encouraging.
  if (productiveH >= 6) {
    return `Strong day — ${formatHM(summary.productiveSeconds)} of heads-down time so far. Take a break when you can.`;
  }
  if (productiveH >= 3) {
    return `Solid pace — ${formatHM(summary.productiveSeconds)} of focused work logged today.`;
  }
  if (activeH >= 1 && productiveH < 1) {
    return "You've been online but light on heads-down work so far. What's one thing you can knock out next?";
  }
  if (hour < 11) {
    return 'Just getting started. Pick the most important thing and get the first 25 minutes done.';
  }
  if (hour >= 17 && !summary.standupSubmittedToday) {
    return "Heads up — you haven't submitted today's standup yet. Even one line counts.";
  }
  if (streak && streak >= 3 && !summary.standupSubmittedToday) {
    return `You're on a ${streak}-day standup streak — don't break it today!`;
  }
  return 'Make today count.';
}

export function TodayVibeCard() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['pulse', 'me', 'today'],
    queryFn: fetchMyToday,
    refetchInterval: 60_000,
  });

  const { data: streakResp } = useQuery<{ currentStreak: number }>({
    queryKey: ['daily-update', 'mine', 'streak'],
    queryFn: getMyStreak,
  });
  const streak = streakResp?.currentStreak;

  // Same quote for everyone on the team that day.
  const dateKey = summary?.dateKey ?? new Date().toISOString().slice(0, 10);
  const quote = pickQuote(dateKey);

  if (isLoading || !summary) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="text-xs text-gray-400">Loading today's vibe…</div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-brand-50 via-white to-amber-50 rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Row 1 — big productivity numbers + chips */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold text-gray-900">
            {formatHM(summary.productiveSeconds)}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">heads-down today</div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {streak !== undefined && streak > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">
              <Flame size={12} />
              {streak}-day standup streak
            </span>
          )}
          {summary.currentlyClockedIn && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium">
              <Clock size={12} />
              Clocked in
            </span>
          )}
          {summary.standupSubmittedToday && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-sky-100 text-sky-800 font-medium">
              <Sparkles size={12} />
              Standup done
            </span>
          )}
        </div>
      </div>

      {/* Row 2 — encouragement */}
      <p className="text-sm text-gray-700">{encouragement(summary, streak)}</p>

      {/* Row 3 — quote */}
      <div className="border-t border-gray-200 pt-4 flex items-start gap-3">
        <QuoteIcon size={16} className="text-gray-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm italic text-gray-700">"{quote.text}"</p>
          <p className="text-xs text-gray-500 mt-1">— {quote.author}</p>
        </div>
      </div>
    </div>
  );
}
