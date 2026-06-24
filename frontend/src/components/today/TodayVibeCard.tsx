/**
 * TodayVibeCard — encouragement + standup streak + daily quote.
 *
 * The "how am I doing today" panel. Two stacked sections:
 *
 *   1. Standup-streak chip + a short, context-aware encouragement line.
 *      Conservative + factual tone, never overly cheerful, never shaming.
 *   2. Daily quote — same for everyone on the team for that day.
 */

import { useQuery } from '@tanstack/react-query';
import { Flame, Quote as QuoteIcon } from 'lucide-react';
import { getMyStreak } from '@/api/dailyUpdates';
import { pickQuote } from '@/lib/dailyQuote';

function encouragement(streak: number | undefined): string {
  const hour = new Date().getHours();

  if (hour < 11) {
    return 'Just getting started. Pick the most important thing and get the first 25 minutes done.';
  }
  if (streak && streak >= 3) {
    return `You're on a ${streak}-day standup streak — don't break it today!`;
  }
  if (hour >= 17) {
    return "Heads up — if you haven't submitted today's standup yet, even one line counts.";
  }
  return 'Make today count.';
}

export function TodayVibeCard() {
  const { data: streakResp } = useQuery<{ currentStreak: number }>({
    queryKey: ['daily-update', 'mine', 'streak'],
    queryFn: getMyStreak,
  });
  const streak = streakResp?.currentStreak;

  // Same quote for everyone on the team that day.
  const dateKey = new Date().toISOString().slice(0, 10);
  const quote = pickQuote(dateKey);

  return (
    <div className="bg-gradient-to-br from-brand-50 via-white to-amber-50 rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Row 1 — standup streak chip */}
      {streak !== undefined && streak > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">
            <Flame size={12} />
            {streak}-day standup streak
          </span>
        </div>
      )}

      {/* Row 2 — encouragement */}
      <p className="text-sm text-gray-700">{encouragement(streak)}</p>

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
