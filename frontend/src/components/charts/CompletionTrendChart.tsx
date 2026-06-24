import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface CompletionTrendChartProps {
  data: { date: string; count: number }[];
}

export function CompletionTrendChart({ data }: CompletionTrendChartProps) {
  if (!data?.length) return <div className="h-64 flex items-center justify-center text-sm text-gray-400">No completion data</div>;

  const chartData = data.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <defs>
          <linearGradient id="completionGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="0" stroke="rgba(148,163,184,0.1)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: 'rgba(148,163,184,0.2)' }} tickLine={false} interval={4} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 10, border: 'none', backgroundColor: 'rgba(15,23,42,0.95)', color: '#e2e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.3)' }}
          formatter={(value: number) => [`${value} tasks`, 'Completed']}
          labelStyle={{ color: '#f1f5f9', fontWeight: 600 }}
        />
        <Area type="monotone" dataKey="count" stroke="#818cf8" strokeWidth={2.5} fill="url(#completionGradient)" dot={false}
          activeDot={{ r: 5, fill: '#818cf8', stroke: '#1e1b4b', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
