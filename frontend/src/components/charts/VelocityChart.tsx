import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useVelocityData } from '@/hooks/useAnalytics';

// Refined palette — vibrant but harmonious
const COLORS = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#2dd4bf'];

export function VelocityChart({ weeks = 8 }: { weeks?: number }) {
  const { data: rawData, isLoading } = useVelocityData(weeks);

  if (isLoading) return <div className="h-64 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />;
  if (!rawData?.length) return <div className="h-64 flex items-center justify-center text-sm text-gray-400">No velocity data yet</div>;

  const weekMap = new Map<string, Record<string, number>>();
  const projectSet = new Set<string>();

  rawData.forEach((entry: any) => {
    const weekLabel = formatWeekLabel(entry.week);
    if (!weekMap.has(weekLabel)) weekMap.set(weekLabel, {});
    const weekData = weekMap.get(weekLabel)!;
    weekData[entry.projectName] = (weekData[entry.projectName] || 0) + entry.completed;
    projectSet.add(entry.projectName);
  });

  const projects = Array.from(projectSet);
  const chartData = Array.from(weekMap.entries())
    .map(([week, data]) => ({ week, ...data }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="0" stroke="rgba(148,163,184,0.1)" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: 'rgba(148,163,184,0.2)' }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 10, border: 'none', backgroundColor: 'rgba(15,23,42,0.95)', color: '#e2e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          labelStyle={{ fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}
          itemStyle={{ color: '#cbd5e1' }}
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
        {projects.map((project, i) => (
          <Bar key={project} dataKey={project} stackId="velocity" fill={COLORS[i % COLORS.length]}
            radius={i === projects.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `W${getWeekNumber(d)}`;
}

function getWeekNumber(d: Date): number {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
}
