import { cn } from '@/lib/cn';
import { toLocalDateString } from '@/lib/formatters';

interface HeatmapProps {
  data: { date: string; count: number }[];
  weeks?: number;
}

const INTENSITY = [
  'bg-gray-100',      // 0
  'bg-green-200',     // 1
  'bg-green-400',     // 2-3
  'bg-green-500',     // 4-5
  'bg-green-700',     // 6+
];

function getIntensity(count: number): string {
  if (count === 0) return INTENSITY[0];
  if (count === 1) return INTENSITY[1];
  if (count <= 3) return INTENSITY[2];
  if (count <= 5) return INTENSITY[3];
  return INTENSITY[4];
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function ProductivityHeatmap({ data, weeks = 12 }: HeatmapProps) {
  // Build a map of date -> count
  const countMap = new Map<string, number>();
  data.forEach((d) => countMap.set(d.date, d.count));

  // Generate grid: columns = weeks, rows = days (Mon-Sun)
  const today = new Date();
  const totalDays = weeks * 7;
  const cells: { date: string; count: number; dayOfWeek: number }[] = [];

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = toLocalDateString(d);
    cells.push({
      date: dateStr,
      count: countMap.get(dateStr) || 0,
      dayOfWeek: d.getDay(),
    });
  }

  // Group into weeks (columns)
  const weekColumns: typeof cells[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weekColumns.push(cells.slice(i, i + 7));
  }

  // Month labels
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let lastMonth = -1;
  weekColumns.forEach((week, wi) => {
    const firstDay = new Date(week[0]?.date);
    if (firstDay.getMonth() !== lastMonth) {
      monthLabels.push({ label: MONTH_LABELS[firstDay.getMonth()], weekIndex: wi });
      lastMonth = firstDay.getMonth();
    }
  });

  const totalActivity = cells.reduce((sum, c) => sum + c.count, 0);

  return (
    <div>
      <div className="flex items-end gap-1">
        {/* Day labels */}
        <div className="flex flex-col gap-[3px] mr-1 text-[9px] text-gray-400">
          <span className="h-[11px]"></span>
          <span className="h-[11px] flex items-center">Mon</span>
          <span className="h-[11px]"></span>
          <span className="h-[11px] flex items-center">Wed</span>
          <span className="h-[11px]"></span>
          <span className="h-[11px] flex items-center">Fri</span>
          <span className="h-[11px]"></span>
        </div>

        {/* Grid */}
        <div className="flex-1">
          {/* Month labels row */}
          <div className="flex gap-[3px] mb-1 text-[9px] text-gray-400">
            {weekColumns.map((_, wi) => {
              const ml = monthLabels.find((m) => m.weekIndex === wi);
              return <span key={wi} className="w-[11px] text-center">{ml?.label || ''}</span>;
            })}
          </div>

          {/* Cells */}
          <div className="flex gap-[3px]">
            {weekColumns.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((cell) => (
                  <div
                    key={cell.date}
                    className={cn('w-[11px] h-[11px] rounded-[2px] transition-colors', getIntensity(cell.count))}
                    title={`${cell.date}: ${cell.count} tasks completed`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-gray-400">{totalActivity} tasks in the last {weeks} weeks</span>
        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <span>Less</span>
          {INTENSITY.map((cls, i) => <div key={i} className={cn('w-[10px] h-[10px] rounded-[2px]', cls)} />)}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
