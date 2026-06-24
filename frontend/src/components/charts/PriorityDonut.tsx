import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/lib/constants';

interface PriorityDonutProps {
  data: Record<string, number>;
}

export function PriorityDonut({ data }: PriorityDonutProps) {
  const chartData = Object.entries(data)
    .filter(([, count]) => count > 0)
    .map(([priority, count]) => ({
      name: PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS] || priority,
      value: count,
      color: PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] || '#6b7280',
    }));

  const total = chartData.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return <div className="h-48 flex items-center justify-center text-sm text-gray-400">No priority data</div>;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-32 h-32 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={3} dataKey="value" stroke="none">
              {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Pie>
            <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e5e7eb' }} formatter={(v: number, n: string) => [`${v}`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{total}</span>
          <span className="text-[9px] text-gray-400">active</span>
        </div>
      </div>
      <div className="space-y-2">
        {chartData.map((d) => (
          <div key={d.name} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-xs text-gray-600 dark:text-gray-400 w-12">{d.name}</span>
            <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
