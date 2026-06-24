import { useState, useRef, useEffect } from 'react';
import { Calendar, TrendingUp, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { useProjectForecast } from '@/hooks/useProjectForecast';
import { cn } from '@/lib/cn';

/**
 * The delivery forecast strip — the single most important line on the
 * client project status page. Renders the service's `message` field
 * verbatim and color-codes the surrounding chrome based on
 * `deliveryStatus`. A hover tooltip surfaces the inputs (remaining
 * points, velocity, target date, range) so clients can see the math.
 */
interface Props {
  projectId: string;
}

export function ProjectForecastStrip({ projectId }: Props) {
  const { data: forecast, isLoading, error } = useProjectForecast(projectId);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside closes tooltip on mobile (where hover doesn't work).
  useEffect(() => {
    if (!tooltipOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setTooltipOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tooltipOpen]);

  if (isLoading) {
    return (
      <div className="rounded-lg h-9 bg-gray-50 dark:bg-obsidian-sunken/40 animate-pulse" />
    );
  }
  if (error || !forecast) {
    // Don't render the strip at all if the endpoint errors — the hero
    // card is still informative without it. A red banner here would
    // confuse clients more than the missing info.
    return null;
  }

  // Color tokens by status — match the rest of the design system.
  const palette = paletteFor(forecast.status, forecast.deliveryStatus);
  const Icon = iconFor(forecast.status, forecast.deliveryStatus);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-[13px] font-medium border',
        palette.container,
      )}
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
    >
      <Icon size={15} className={cn('shrink-0', palette.icon)} />
      <span className={cn('flex-1', palette.text)}>{forecast.message}</span>
      <button
        type="button"
        onClick={() => setTooltipOpen((o) => !o)}
        className={cn('shrink-0', palette.icon, 'opacity-50 hover:opacity-100 transition-opacity')}
        aria-label="Show forecast details"
        title="How was this calculated?"
      >
        <Info size={13} />
      </button>

      {tooltipOpen && (
        <ForecastTooltip forecast={forecast} />
      )}
    </div>
  );
}

function ForecastTooltip({ forecast }: { forecast: ReturnType<typeof useProjectForecast>['data'] }) {
  if (!forecast) return null;
  const lines: Array<{ label: string; value: string }> = [];

  if (forecast.remainingPoints !== undefined && forecast.totalPoints !== undefined) {
    lines.push({
      label: 'Scope',
      value: `${forecast.donePoints ?? 0} / ${forecast.totalPoints} pts complete (${forecast.completionPct ?? 0}%)`,
    });
  }
  if (forecast.velocityPerWeek !== undefined && forecast.velocityPerWeek > 0) {
    const stdDevHint = forecast.velocityStdDev && forecast.velocityStdDev > 0
      ? ` ± ${forecast.velocityStdDev.toFixed(1)}`
      : '';
    lines.push({
      label: 'Pace',
      value: `${forecast.velocityPerWeek} pts/wk${stdDevHint} (last 4 weeks)`,
    });
  }
  if (forecast.conservativeDate && forecast.optimisticDate) {
    lines.push({
      label: 'Range',
      value: `${formatShort(forecast.optimisticDate)} — ${formatShort(forecast.conservativeDate)}`,
    });
  }
  if (forecast.targetDate) {
    const days = forecast.daysFromTarget;
    const drift =
      days === undefined ? ''
      : days < 0 ? ` (${Math.abs(days)}d ahead)`
      : days === 0 ? ' (exactly on target)'
      : ` (${days}d past target)`;
    lines.push({
      label: 'Target',
      value: `${formatShort(forecast.targetDate)}${drift}`,
    });
  }
  if (forecast.reason && forecast.status !== 'FORECASTED') {
    lines.push({ label: 'Why', value: forecast.reason });
  }

  if (lines.length === 0) return null;

  return (
    <div className="absolute left-0 right-0 top-full mt-1.5 z-20 rounded-lg px-3.5 py-2.5 text-[11.5px] bg-gray-900 dark:bg-obsidian-raised text-gray-100 dark:text-obsidian-fg shadow-pop dark:shadow-pop-dark border border-gray-800 dark:border-obsidian-border-strong">
      <div className="space-y-1">
        {lines.map((line) => (
          <div key={line.label} className="flex gap-2">
            <span className="font-semibold tracking-wide uppercase text-[10px] text-gray-400 dark:text-obsidian-muted w-12 shrink-0 pt-0.5">
              {line.label}
            </span>
            <span className="flex-1 leading-relaxed text-gray-100 dark:text-obsidian-fg">{line.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

interface Palette {
  container: string;
  text: string;
  icon: string;
}

function paletteFor(status: ProjectForecastStatus, delivery: DeliveryStatus | undefined): Palette {
  // BASELINING / NO_TARGET → neutral
  if (status === 'BASELINING' || status === 'NO_TARGET') {
    return {
      container: 'bg-gray-50 border-gray-200 dark:bg-obsidian-sunken/50 dark:border-obsidian-border',
      text: 'text-gray-700 dark:text-obsidian-fg',
      icon: 'text-gray-400 dark:text-obsidian-muted',
    };
  }
  if (status === 'COMPLETE') {
    return {
      container: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/[0.08] dark:border-emerald-500/30',
      text: 'text-emerald-800 dark:text-emerald-200',
      icon: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  // FORECASTED → color depends on delivery status (or neutral if no target)
  if (delivery === 'AT_RISK') {
    return {
      container: 'bg-amber-50 border-amber-200 dark:bg-amber-500/[0.08] dark:border-amber-500/30',
      text: 'text-amber-800 dark:text-amber-200',
      icon: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (delivery === 'BEHIND') {
    return {
      container: 'bg-rose-50 border-rose-200 dark:bg-rose-500/[0.08] dark:border-rose-500/30',
      text: 'text-rose-800 dark:text-rose-200',
      icon: 'text-rose-600 dark:text-rose-400',
    };
  }
  // ON_TRACK
  return {
    container: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/[0.08] dark:border-emerald-500/30',
    text: 'text-emerald-800 dark:text-emerald-200',
    icon: 'text-emerald-600 dark:text-emerald-400',
  };
}

function iconFor(status: ProjectForecastStatus, delivery: DeliveryStatus | undefined) {
  if (status === 'COMPLETE') return CheckCircle2;
  if (status === 'FORECASTED' && delivery === 'BEHIND') return AlertTriangle;
  if (status === 'FORECASTED' && delivery === 'AT_RISK') return AlertTriangle;
  if (status === 'FORECASTED' && delivery === 'ON_TRACK') return TrendingUp;
  return Calendar;
}

// Re-declared locally to avoid coupling the strip to the API client types.
type ProjectForecastStatus = 'BASELINING' | 'NO_TARGET' | 'COMPLETE' | 'FORECASTED';
type DeliveryStatus = 'ON_TRACK' | 'AT_RISK' | 'BEHIND';
