import { cn } from '@/lib/cn';

interface SegmentedProgressBarProps {
  /** How many segments are filled. */
  done: number;
  /** Total number of segments. */
  total: number;
  /** How many segments are in-progress (rendered between done and remaining with a softer fill). */
  inProgress?: number;
  /**
   * If `total` is large (>16), we collapse to a continuous bar so each segment
   * doesn't become a sliver. Set `forceSegments` to override.
   */
  forceSegments?: boolean;
  /** Bar height in px — default 4 (a thin Linear-style sliver). */
  height?: number;
  className?: string;
  /** Color tokens — defaults to brand. */
  tone?: 'brand' | 'success' | 'info';
  /** Accessible label that screen readers will announce. */
  ariaLabel?: string;
}

const TONE_DONE: Record<NonNullable<SegmentedProgressBarProps['tone']>, string> = {
  brand:   'bg-brand-500',
  success: 'bg-success-500',
  info:    'bg-info-500',
};
const TONE_IP: Record<NonNullable<SegmentedProgressBarProps['tone']>, string> = {
  brand:   'bg-brand-500/40',
  success: 'bg-success-500/40',
  info:    'bg-info-500/40',
};

/**
 * Slim progress bar. Renders as discrete N-segment chips for small totals
 * (so each task feels visible) or as a smooth bar for large totals.
 *
 * Used on product cards to convey current sprint completion at a glance.
 */
export function SegmentedProgressBar({
  done,
  total,
  inProgress = 0,
  forceSegments = false,
  height = 4,
  className,
  tone = 'brand',
  ariaLabel,
}: SegmentedProgressBarProps) {
  if (total <= 0) {
    return (
      <div
        className={cn(
          'rounded-full bg-gray-200 dark:bg-obsidian-border',
          className,
        )}
        style={{ height }}
        role="progressbar"
        aria-label={ariaLabel ?? 'No items'}
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={0}
      />
    );
  }

  const safeDone = Math.min(done, total);
  const safeIp   = Math.min(inProgress, total - safeDone);
  const percentDone = (safeDone / total) * 100;
  const percentIp   = (safeIp / total) * 100;
  const useSegments = forceSegments || total <= 16;

  if (useSegments) {
    return (
      <div
        className={cn('flex gap-[2px]', className)}
        role="progressbar"
        aria-label={ariaLabel ?? `${safeDone} of ${total} done`}
        aria-valuenow={safeDone}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        {Array.from({ length: total }, (_, i) => {
          const cls =
            i < safeDone
              ? TONE_DONE[tone]
              : i < safeDone + safeIp
              ? TONE_IP[tone]
              : 'bg-gray-200 dark:bg-obsidian-border';
          return (
            <div
              key={i}
              className={cn('flex-1 rounded-[1px] transition-colors', cls)}
              style={{ height }}
            />
          );
        })}
      </div>
    );
  }

  // Smooth bar for large totals.
  return (
    <div
      className={cn('relative w-full rounded-full bg-gray-200 dark:bg-obsidian-border overflow-hidden', className)}
      style={{ height }}
      role="progressbar"
      aria-label={ariaLabel ?? `${safeDone} of ${total} done`}
      aria-valuenow={safeDone}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div
        className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500', TONE_DONE[tone])}
        style={{ width: `${percentDone}%` }}
      />
      {percentIp > 0 && (
        <div
          className={cn('absolute inset-y-0 transition-[width] duration-500', TONE_IP[tone])}
          style={{ left: `${percentDone}%`, width: `${percentIp}%` }}
        />
      )}
    </div>
  );
}
