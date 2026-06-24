import { useMemo } from 'react';
import { cn } from '@/lib/cn';

interface SparklineProps {
  data: number[];
  /** Display width — default 80, height proportional. */
  width?: number;
  height?: number;
  /** Stroke color. Tailwind class — controls line + fill gradient. */
  tone?: 'brand' | 'success' | 'info' | 'warning' | 'danger' | 'muted';
  className?: string;
  /** Show a subtle filled area under the line. */
  fill?: boolean;
  /** Render a dot at the most recent (last) data point. */
  showLast?: boolean;
}

const TONE_STROKE: Record<NonNullable<SparklineProps['tone']>, string> = {
  brand:   'stroke-brand-500',
  success: 'stroke-success-500',
  info:    'stroke-info-500',
  warning: 'stroke-warning-500',
  danger:  'stroke-danger-500',
  muted:   'stroke-gray-400 dark:stroke-obsidian-faded',
};
const TONE_FILL: Record<NonNullable<SparklineProps['tone']>, string> = {
  brand:   'fill-brand-500/20',
  success: 'fill-success-500/20',
  info:    'fill-info-500/20',
  warning: 'fill-warning-500/20',
  danger:  'fill-danger-500/20',
  muted:   'fill-gray-400/15 dark:fill-obsidian-faded/15',
};
const TONE_DOT: Record<NonNullable<SparklineProps['tone']>, string> = {
  brand:   'fill-brand-400',
  success: 'fill-success-500',
  info:    'fill-info-500',
  warning: 'fill-warning-500',
  danger:  'fill-danger-500',
  muted:   'fill-gray-400 dark:fill-obsidian-muted',
};

/**
 * Tiny inline trend-line. SVG-based, no chart library — keeps bundle small and
 * lets us style with Tailwind tokens. Used in product cards on the portfolio
 * dashboard for at-a-glance velocity.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  tone = 'brand',
  className,
  fill = true,
  showLast = true,
}: SparklineProps) {
  const { linePath, areaPath, lastX, lastY, isFlat } = useMemo(() => {
    if (data.length < 2) return { linePath: '', areaPath: '', lastX: 0, lastY: 0, isFlat: true };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const flat = max === min;
    const padY = 2; // leave room so stroke isn't clipped
    const range = flat ? 1 : max - min;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;

    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = flat
        ? height / 2
        : height - padY - ((v - min) / range) * (height - padY * 2);
      return { x, y };
    });

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const area = `${line} L${points[points.length - 1].x.toFixed(2)} ${height} L0 ${height} Z`;
    const last = points[points.length - 1];

    return { linePath: line, areaPath: area, lastX: last.x, lastY: last.y, isFlat: flat };
  }, [data, width, height]);

  if (data.length < 2) {
    return (
      <div
        className={cn('text-[10px] text-gray-400 dark:text-obsidian-faded italic', className)}
        style={{ width, height }}
        aria-label="Not enough data"
      >
        —
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={`Trend: ${data.join(', ')}`}
    >
      {fill && !isFlat && <path d={areaPath} className={TONE_FILL[tone]} />}
      <path
        d={linePath}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={TONE_STROKE[tone]}
      />
      {showLast && (
        <circle cx={lastX} cy={lastY} r={2} className={TONE_DOT[tone]} />
      )}
    </svg>
  );
}
