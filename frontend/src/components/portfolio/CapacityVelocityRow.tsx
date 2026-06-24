import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine,
  PieChart, Pie, Cell,
} from 'recharts';
import type { CapacitySnapshot } from '@/api/analytics';
import { cn } from '@/lib/cn';

interface CapacityVelocityRowProps {
  capacity: CapacitySnapshot | undefined;
  velocityRows: Array<{ week: string; projectName: string; completed: number }>;
  myTimeDistribution: Array<{ projectId: string; projectName: string; tasks: number }>;
  isLoading?: boolean;
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
  itemStyle: { color: '#a3a3a3' },
  cursor: { fill: 'rgba(124,58,237,0.08)' },
};

/**
 * Band 3 — three compact charts answering:
 *  (a) Capacity:  is each product loaded right? Stacked bar of current sprint
 *      points (done | remaining) per project.
 *  (b) Velocity:  is each product accelerating? 8-week trend per product with
 *      a median reference line for studio-wide context.
 *  (c) My time:   where did I personally spend energy this week? Donut.
 */
export function CapacityVelocityRow({
  capacity, velocityRows, myTimeDistribution, isLoading,
}: CapacityVelocityRowProps) {
  // ─── (a) Capacity stacked bar ───
  const capacityChart = useMemo(() => {
    if (!capacity) return [];
    return capacity.perProject
      .slice()
      .sort((a, b) => b.plannedPoints - a.plannedPoints)
      .map((p) => ({
        name: p.projectName.length > 12 ? p.projectName.slice(0, 11) + '…' : p.projectName,
        fullName: p.projectName,
        category: p.category,
        Done: p.completedPoints,
        Remaining: Math.max(0, p.plannedPoints - p.completedPoints),
      }));
  }, [capacity]);

  // ─── (b) Velocity overlay lines ───
  const { velocityChart, velocityProjects, medianLine } = useMemo(() => {
    if (!velocityRows.length) return { velocityChart: [], velocityProjects: [], medianLine: 0 };
    const weekMap = new Map<string, Record<string, number>>();
    const projects = new Set<string>();
    for (const r of velocityRows) {
      if (!weekMap.has(r.week)) weekMap.set(r.week, {});
      const w = weekMap.get(r.week)!;
      w[r.projectName] = (w[r.projectName] ?? 0) + r.completed;
      projects.add(r.projectName);
    }
    const projectList = Array.from(projects);
    const chart = Array.from(weekMap.entries())
      .map(([week, vals]) => ({
        week: week.slice(5), // MM-DD only
        ...projectList.reduce((acc, p) => ({ ...acc, [p]: vals[p] ?? 0 }), {}),
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    const allValues = velocityRows.map((r) => r.completed).filter((v) => v > 0).sort((a, b) => a - b);
    const median = allValues.length === 0 ? 0 : allValues[Math.floor(allValues.length / 2)];
    return { velocityChart: chart, velocityProjects: projectList, medianLine: median };
  }, [velocityRows]);

  // ─── (c) My time donut ───
  const timeChart = useMemo(() => {
    if (!myTimeDistribution.length) return [];
    return myTimeDistribution
      .filter((t) => t.tasks > 0)
      .slice(0, 6)
      .map((t) => ({ name: t.projectName, value: t.tasks }));
  }, [myTimeDistribution]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <ChartCard title="Capacity" subtitle="Current sprint points per product">
        {isLoading || !capacity ? (
          <ChartSkeleton />
        ) : capacityChart.length === 0 ? (
          <EmptyChart label="No active sprints" />
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={capacityChart} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(124,58,237,0.06)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: '#a3a3a3' }}
                axisLine={{ stroke: 'rgba(124,58,237,0.12)' }}
                tickLine={false}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={36}
              />
              <YAxis tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(_lbl: string, payload: any[]) => payload?.[0]?.payload?.fullName ?? _lbl}
              />
              <Bar dataKey="Done" stackId="a" fill="#7c3aed" radius={[0, 0, 2, 2]} />
              <Bar dataKey="Remaining" stackId="a" fill="rgba(124,58,237,0.22)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Velocity" subtitle="8-week trend per product">
        {isLoading ? (
          <ChartSkeleton />
        ) : velocityChart.length === 0 ? (
          <EmptyChart label="No velocity data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={velocityChart} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="0" stroke="rgba(124,58,237,0.06)" vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={{ stroke: 'rgba(124,58,237,0.12)' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#a3a3a3' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              {medianLine > 0 && (
                <ReferenceLine
                  y={medianLine}
                  stroke="rgba(220,221,222,0.35)"
                  strokeDasharray="3 3"
                  label={{ value: 'median', fill: '#a3a3a3', fontSize: 9, position: 'right' }}
                />
              )}
              {velocityProjects.map((p, i) => (
                <Line
                  key={p}
                  type="monotone"
                  dataKey={p}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="My time this week" subtitle="Tasks I touched, by product">
        {isLoading ? (
          <ChartSkeleton />
        ) : timeChart.length === 0 ? (
          <EmptyChart label="No personal activity yet this week" />
        ) : (
          <div className="grid grid-cols-[140px_1fr] gap-3 items-center h-[170px]">
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={timeChart}
                  cx="50%"
                  cy="50%"
                  innerRadius={32}
                  outerRadius={58}
                  paddingAngle={1.5}
                  dataKey="value"
                  stroke="rgba(20,20,20,0.5)"
                  strokeWidth={1}
                >
                  {timeChart.map((entry, i) => (
                    <Cell key={entry.name} fill={LINE_COLORS[i % LINE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="space-y-1.5 text-[11px] overflow-y-auto max-h-full pr-1">
              {timeChart.map((t, i) => (
                <li key={t.name} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
                  <span className="truncate text-gray-700 dark:text-obsidian-fg flex-1">{t.name}</span>
                  <span className="font-mono tabular-nums text-gray-500 dark:text-obsidian-faded">{t.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

const LINE_COLORS = [
  '#a78bfa', // brand-300 — primary
  '#22d3ee', // cyan-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#fb7185', // rose-400
  '#818cf8', // indigo-400
  '#f472b6', // pink-400
  '#2dd4bf', // teal-400
];

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className={cn(
      'rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'p-4 hover:border-gray-300 dark:hover:border-obsidian-border-strong transition-colors',
    )}>
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
          {title}
        </h3>
        <p className="text-[10px] text-gray-400 dark:text-obsidian-faded mt-0.5">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-[170px] rounded-md bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse" />;
}
function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[170px] flex items-center justify-center text-[11px] text-gray-400 dark:text-obsidian-faded italic">
      {label}
    </div>
  );
}
