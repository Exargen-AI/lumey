import { cn } from '@/lib/cn';

/**
 * Loading skeletons. Each rectangle uses two-tone bands so it doesn't
 * disappear in dark mode — light shimmer on `gray-200`, dark shimmer
 * on `obsidian-raised`. Without the dark variant, skeleton placeholders
 * rendered as washed-out light bars on the dark dashboard, looking
 * like a broken layout instead of a load state.
 */
const PULSE_BAR = 'bg-gray-200 dark:bg-obsidian-raised rounded animate-pulse';
const CARD_SURFACE =
  'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border rounded-xl';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn(PULSE_BAR, className)} />;
}

export function SkeletonCard() {
  return (
    <div className={cn(CARD_SURFACE, 'p-5 animate-pulse')}>
      <div className={cn(PULSE_BAR, 'h-5 w-3/4 mb-3')} />
      <div className={cn(PULSE_BAR, 'h-4 w-1/2 mb-4')} />
      <div className={cn(PULSE_BAR, 'h-3 w-full')} />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className={cn(PULSE_BAR, 'h-4 w-1/4')} />
          <div className={cn(PULSE_BAR, 'h-4 w-1/3')} />
          <div className={cn(PULSE_BAR, 'h-4 w-1/6')} />
          <div className={cn(PULSE_BAR, 'h-4 w-1/6')} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonMetricCards({ count = 4 }: { count?: number }) {
  return (
    <div className={cn('grid gap-4', `grid-cols-${count}`)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(CARD_SURFACE, 'p-5 animate-pulse')}>
          <div className={cn(PULSE_BAR, 'h-4 w-1/2 mb-2')} />
          <div className={cn(PULSE_BAR, 'h-8 w-1/3')} />
        </div>
      ))}
    </div>
  );
}
