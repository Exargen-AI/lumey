/**
 * GreetingHeader — personalised welcome on /today (2026-05-29).
 *
 * Time-of-day greeting in the user's local time + their first name + an
 * appropriate emoji. Re-renders every minute so the greeting flips at
 * boundaries (e.g. 11:59 "morning" → 12:00 "afternoon") without
 * needing a manual refresh.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';

interface GreetingParts {
  word: string;       // "morning" / "afternoon" / "evening" / "night"
  emoji: string;
  // Subtitle below the greeting — varies subtly by time of day so the
  // header feels alive rather than static. Conservative tone, never
  // motivational-poster cheesy.
  subtitle: string;
}

function greetingFor(now: Date): GreetingParts {
  const h = now.getHours();
  if (h >= 5 && h < 12) {
    return {
      word: 'morning',
      emoji: '🌅',
      subtitle: "Hope you're having a great start to the day.",
    };
  }
  if (h >= 12 && h < 17) {
    return {
      word: 'afternoon',
      emoji: '☀️',
      subtitle: "Halfway there. Keep at it.",
    };
  }
  if (h >= 17 && h < 21) {
    return {
      word: 'evening',
      emoji: '🌆',
      subtitle: "Winding down? Don't forget today's standup.",
    };
  }
  return {
    word: 'night',
    emoji: '🌙',
    subtitle: 'Burning the midnight oil. Take care of yourself.',
  };
}

function firstName(fullName: string | undefined | null): string {
  if (!fullName) return 'friend';
  const trimmed = fullName.trim();
  if (!trimmed) return 'friend';
  return trimmed.split(/\s+/)[0]!;
}

export function GreetingHeader() {
  const user = useAuthStore((s) => s.user);
  const [now, setNow] = useState(() => new Date());

  // Tick once per minute so the greeting flips at the 12:00 / 17:00 /
  // 21:00 / 05:00 boundaries without manual refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const parts = greetingFor(now);
  const name = firstName(user?.name);
  const today = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Good {parts.word}, {name} {parts.emoji}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{parts.subtitle}</p>
      </div>
      <div className="text-xs text-gray-400 text-right shrink-0">{today}</div>
    </header>
  );
}
