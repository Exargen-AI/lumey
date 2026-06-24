import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TASK_TYPE_LABELS, TASK_TYPE_COLORS } from '@/lib/constants';

// Brighter colors for dark mode visibility
const TYPE_COLORS: Record<string, string> = {
  FEATURE: '#818cf8',
  BUG: '#f87171',
  CHORE: '#94a3b8',
  SPIKE: '#fbbf24',
};

interface TaskTypeChartProps {
  data: Record<string, number>;
}

export function TaskTypeChart({ data }: TaskTypeChartProps) {
  const chartData = Object.entries(data).map(([type, count]) => ({
    type,
    label: TASK_TYPE_LABELS[type as keyof typeof TASK_TYPE_LABELS] || type,
    count,
    color: TYPE_COLORS[type] || '#94a3b8',
  }));

  const total = chartData.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return <div className="h-48 flex items-center justify-center text-sm text-gray-400">No task data</div>;

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 55, bottom: 5 }}>
        <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} width={55} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 10, border: 'none', backgroundColor: 'rgba(15,23,42,0.95)', color: '#e2e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          formatter={(value: number) => [`${value} tasks`, '']}
          cursor={{ fill: 'rgba(148,163,184,0.08)' }}
        />
        <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={22}>
          {chartData.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
