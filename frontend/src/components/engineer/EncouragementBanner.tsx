import { Flame, Sparkles, TrendingUp, Target, Sunrise, Coffee, Trophy } from 'lucide-react';
import { cn } from '@/lib/cn';

type Stats = {
  currentStreak: number;
  longestStreak: number;
  submittedToday: boolean;
  completedToday: number;
  completedThisWeek: number;
  completedLastWeek: number;
  activeTaskCount: number;
};

type Pick = {
  icon: typeof Flame;
  title: string;
  body: string;
  tone: 'fire' | 'positive' | 'gentle' | 'celebrate';
};

// Pick the most important contextual message — always returns ONE so the
// banner is always present and never feels nagging.
function pickMessage(stats: Stats, firstName: string, hour: number): Pick {
  const {
    currentStreak,
    longestStreak,
    submittedToday,
    completedToday,
    completedThisWeek,
    completedLastWeek,
    activeTaskCount,
  } = stats;

  if (currentStreak > 0 && currentStreak === longestStreak && currentStreak >= 7) {
    return {
      icon: Trophy,
      title: `Personal best: ${currentStreak}-day streak!`,
      body: `You've never gone this long without skipping a daily update. Keep going, ${firstName}.`,
      tone: 'celebrate',
    };
  }

  if (currentStreak > 2 && !submittedToday && hour >= 17) {
    return {
      icon: Flame,
      title: `${currentStreak}-day streak — don't let it break tonight`,
      body: 'Submit your EOD update before midnight to keep the streak alive. Two minutes, that\'s it.',
      tone: 'fire',
    };
  }

  if (completedThisWeek > completedLastWeek && completedThisWeek >= 3) {
    const delta = completedThisWeek - completedLastWeek;
    return {
      icon: TrendingUp,
      title: `On a roll: ${completedThisWeek} tasks this week`,
      body: `That's ${delta} more than last week. Whatever you're doing, keep doing it.`,
      tone: 'positive',
    };
  }

  if (completedToday > 0) {
    return {
      icon: Sparkles,
      title: completedToday === 1 ? 'First win of the day!' : `${completedToday} tasks shipped today`,
      body: 'Small wins compound. Pick the next one and keep moving.',
      tone: 'positive',
    };
  }

  if (hour < 12 && completedToday === 0 && activeTaskCount > 0) {
    return {
      icon: Sunrise,
      title: `Good morning, ${firstName}`,
      body: `${activeTaskCount} task${activeTaskCount === 1 ? '' : 's'} on your plate today. Pick the most important one and start there.`,
      tone: 'gentle',
    };
  }

  if (hour >= 13 && hour < 17 && completedToday === 0 && activeTaskCount > 0) {
    return {
      icon: Coffee,
      title: 'Afternoon checkpoint',
      body: 'Halfway through the day. What\'s one task you can close before EOD?',
      tone: 'gentle',
    };
  }

  if (activeTaskCount === 0) {
    return {
      icon: Target,
      title: 'All caught up!',
      body: 'Nothing in your queue. Great moment to pick up a new task or help someone unblock.',
      tone: 'celebrate',
    };
  }

  return {
    icon: Target,
    title: `Let's make today count, ${firstName}`,
    body: `${activeTaskCount} active task${activeTaskCount === 1 ? '' : 's'} — small focused steps.`,
    tone: 'gentle',
  };
}

export function EncouragementBanner({ stats, firstName }: { stats: Stats; firstName: string }) {
  const hour = new Date().getHours();
  const msg = pickMessage(stats, firstName, hour);
  const Icon = msg.icon;

  // Each tone is a different gradient on the panel surface. Borders are kept
  // subtle (8% opacity) so they read in dark mode without harsh seams.
  const toneStyles: Record<Pick['tone'], string> = {
    fire:      'from-orange-500/[0.08] via-transparent to-red-500/[0.06] border-orange-300/40 dark:border-orange-500/20',
    positive:  'from-brand-500/[0.10] via-transparent to-fuchsia-500/[0.06] border-brand-300/50 dark:border-brand-500/25',
    gentle:    'from-brand-500/[0.06] via-transparent to-blue-500/[0.06] border-brand-200/50 dark:border-brand-500/15',
    celebrate: 'from-emerald-500/[0.10] via-transparent to-teal-500/[0.06] border-emerald-300/40 dark:border-emerald-500/20',
  };

  const iconRing: Record<Pick['tone'], string> = {
    fire:      'text-orange-500 ring-orange-500/20 dark:ring-orange-500/25',
    positive:  'text-brand-500 dark:text-brand-400 ring-brand-500/20 dark:ring-brand-400/25',
    gentle:    'text-brand-500 dark:text-brand-400 ring-brand-500/15 dark:ring-brand-400/20',
    celebrate: 'text-emerald-500 ring-emerald-500/20 dark:ring-emerald-500/25',
  };

  return (
    <div className={cn(
      'relative overflow-hidden rounded-2xl border bg-gradient-to-br',
      'bg-white dark:bg-obsidian-panel',
      'p-5 shadow-soft dark:shadow-soft-dark',
      'animate-fade-in-up',
      toneStyles[msg.tone],
    )}>
      <div className="flex items-start gap-4">
        <div className={cn(
          'w-11 h-11 rounded-xl flex items-center justify-center shrink-0',
          'bg-white dark:bg-obsidian-raised ring-1',
          iconRing[msg.tone],
        )}>
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-obsidian-fg leading-snug">{msg.title}</h2>
          <p className="text-sm text-gray-600 dark:text-obsidian-muted mt-1 leading-relaxed">{msg.body}</p>
        </div>
      </div>
    </div>
  );
}
