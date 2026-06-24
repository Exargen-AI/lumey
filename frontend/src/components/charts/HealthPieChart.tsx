import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const HEALTH_CHART_COLORS: Record<string, string> = {
  GREEN: '#22c55e',
  YELLOW: '#eab308',
  RED: '#ef4444',
};

const HEALTH_LABELS: Record<string, string> = {
  GREEN: 'Healthy',
  YELLOW: 'At Risk',
  RED: 'Critical',
};

interface HealthPieChartProps {
  data: Record<string, number> | undefined;
}

export function HealthPieChart({ data }: HealthPieChartProps) {
  if (!data) return <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />;

  const chartData = Object.entries(data)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      name: HEALTH_LABELS[key] || key,
      value: count,
      color: HEALTH_CHART_COLORS[key] || '#6b7280',
    }));

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) return <div className="h-48 flex items-center justify-center text-sm text-gray-400">No project data</div>;

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value} projects`, name]}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-gray-900">{total}</span>
          <span className="text-xs text-gray-400">projects</span>
        </div>
      </div>
      <div className="space-y-3">
        {chartData.map((entry) => (
          <div key={entry.name} className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-sm text-gray-600 w-16">{entry.name}</span>
            <span className="text-sm font-bold text-gray-900">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
