import { cn } from '@/lib/cn';
import { PHASE_LABELS } from '@/lib/constants';

const PHASE_COLORS = ['#94a3b8', '#a78bfa', '#6366f1', '#f59e0b', '#22c55e', '#10b981'];

interface PhasePipelineProps {
  data: { phase: string; count: number }[];
}

export function PhasePipeline({ data }: PhasePipelineProps) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) return <div className="h-48 flex items-center justify-center text-sm text-gray-400">No project data</div>;

  return (
    <div className="space-y-3">
      {data.map((d, i) => {
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
        const label = PHASE_LABELS[d.phase as keyof typeof PHASE_LABELS] || d.phase;
        return (
          <div key={d.phase} className="flex items-center gap-3">
            <span className="text-[10px] text-gray-500 dark:text-gray-400 w-20 text-right truncate">{label}</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-5 relative overflow-hidden">
              <div
                className="h-5 rounded-full transition-all flex items-center justify-end pr-2"
                style={{ width: `${Math.max(pct, d.count > 0 ? 15 : 0)}%`, backgroundColor: PHASE_COLORS[i] }}
              >
                {d.count > 0 && <span className="text-[10px] font-bold text-white">{d.count}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
