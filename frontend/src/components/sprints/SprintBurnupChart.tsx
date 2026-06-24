import { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, ReferenceLine,
} from 'recharts';
import { useSprintBurnup } from '@/hooks/useSprints';

interface SprintBurnupChartProps {
  sprintId: string;
  height?: number;
  /** Render a smaller variant (no axis labels, tighter padding) for inline cards. */
  compact?: boolean;
}

const TOOLTIP_STYLE = {
  contentStyle: {
    fontSize: 11,
    borderRadius: 8,
    border: '1px solid rgba(124,58,237,0.25)',
    backgroundColor: 'rgba(20,20,20,0.96)',
    color: '#dcddde',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    padding: '8px 10px',
  },
  labelStyle: { fontWeight: 600, color: '#f3f4f6', marginBottom: 2 },
  itemStyle:  { color: '#a3a3a3' },
  cursor:     { stroke: 'rgba(124,58,237,0.18)' },
};

/**
 * Per-sprint burnup chart. Renders three series:
 *   - Completed points (filled brand area)
 *   - Scope (dashed gray line) — flat unless tasks were added mid-sprint
 *   - Ideal burndown (dashed muted line) — what completion would look like
 *     under perfect even pacing
 *
 * Hidden when the sprint has no tasks yet (avoids a misleading flat zero).
 */
export function SprintBurnupChart({ sprintId, height = 140, compact }: SprintBurnupChartProps) {
  const { data, isLoading } = useSprintBurnup(sprintId);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.series.map((d) => ({
      label: d.date.slice(5), // MM-DD
      Completed: d.completedPoints,
      Scope: d.scopePoints,
      Ideal: d.idealRemaining,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div
        className="w-full rounded-md bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse"
        style={{ height }}
        aria-label="Loading burnup chart"
      />
    );
  }

  if (!data || data.totalScope === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11px] italic text-gray-400 dark:text-obsidian-faded"
        style={{ height }}
      >
        Add tasks to see the burnup.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={compact ? { top: 6, right: 4, bottom: 0, left: -28 } : { top: 8, right: 12, bottom: 0, left: -10 }}>
        <defs>
          <linearGradient id={`burnup-grad-${sprintId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#7c3aed" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="0" stroke="rgba(124,58,237,0.06)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: '#a3a3a3' }}
          axisLine={{ stroke: 'rgba(124,58,237,0.15)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#a3a3a3' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip {...TOOLTIP_STYLE} />
        {/* Total scope as a reference line — usually flat, jumps when scope creep happens */}
        <ReferenceLine y={data.totalScope} stroke="rgba(220,221,222,0.25)" strokeDasharray="3 3"
          label={compact ? undefined : { value: 'scope', fill: '#a3a3a3', fontSize: 9, position: 'insideTopRight' }} />
        <Line type="monotone" dataKey="Ideal" stroke="rgba(220,221,222,0.4)" strokeWidth={1.25}
          strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        <Area
          type="monotone"
          dataKey="Completed"
          stroke="#7c3aed"
          strokeWidth={1.5}
          fill={`url(#burnup-grad-${sprintId})`}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
