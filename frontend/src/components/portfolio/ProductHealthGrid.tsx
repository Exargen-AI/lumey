import { Link } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import type { ProductHealthCard } from '@/api/analytics';
import { Sparkline, SegmentedProgressBar, Tooltip } from '@/components/ui';
import { CATEGORY_COLORS, CATEGORY_LABELS, PHASE_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';

interface ProductHealthGridProps {
  cards: ProductHealthCard[];
  isLoading?: boolean;
}

const HEALTH_DOT: Record<string, string> = {
  GREEN:  'bg-emerald-500',
  YELLOW: 'bg-amber-500',
  RED:    'bg-rose-500',
};
const HEALTH_GLOW: Record<string, string> = {
  GREEN:  'shadow-[0_0_8px_rgba(16,185,129,0.55)]',
  YELLOW: 'shadow-[0_0_8px_rgba(245,158,11,0.55)]',
  RED:    'shadow-[0_0_8px_rgba(244,63,94,0.65)]',
};

/**
 * Band 1 of the Studio Portfolio — one card per product, scannable in <2s.
 *
 * Each card answers: "is this product healthy, and what's it shipping right now?"
 *  - lead avatar + name → "who do I tap on the shoulder"
 *  - phase + category → "what kind of work is this"
 *  - segmented bar of current sprint progress → "how far through"
 *  - blocked count in red → "how worried should I be"
 *  - 8-week velocity sparkline → "is the trend up or down"
 */
export function ProductHealthGrid({ cards, isLoading }: ProductHealthGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[152px] rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-obsidian-muted">No products yet.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
      {cards.map((c) => (
        <ProductCard key={c.id} card={c} />
      ))}
    </div>
  );
}

function ProductCard({ card }: { card: ProductHealthCard }) {
  const sprint = card.currentSprint;
  const accent = (CATEGORY_COLORS as Record<string, string>)[card.category] ?? '#6366f1';
  const initials = card.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Tooltip
      content={sprint?.goal ? `Sprint ${sprint.number} · ${sprint.goal}` : 'No active sprint'}
      side="top"
    >
      <Link
        to={`/projects/${card.id}`}
        className={cn(
          'group block relative overflow-hidden rounded-xl p-4 transition-all duration-200',
          'bg-white border border-gray-200',
          'dark:bg-obsidian-panel dark:border-obsidian-border',
          'hover:border-brand-400/60 dark:hover:border-brand-500/40',
          'hover:shadow-[0_2px_16px_-4px_rgba(124,58,237,0.18)]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        )}
      >
        {/* category accent strip on the left */}
        <div
          className="absolute inset-y-0 left-0 w-[3px] opacity-70 group-hover:opacity-100 transition-opacity"
          style={{ background: accent }}
          aria-hidden="true"
        />

        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
                {card.name}
              </h3>
              <span
                className={cn(
                  'inline-block w-1.5 h-1.5 rounded-full shrink-0',
                  HEALTH_DOT[card.healthStatus],
                  HEALTH_GLOW[card.healthStatus],
                )}
                aria-label={`Health: ${card.healthStatus.toLowerCase()}`}
              />
            </div>
            <p className="text-[10px] uppercase tracking-[0.1em] text-gray-400 dark:text-obsidian-faded mt-0.5 truncate">
              {(CATEGORY_LABELS as Record<string, string>)[card.category] ?? card.category}
              {' · '}
              {(PHASE_LABELS as Record<string, string>)[card.phase] ?? card.phase}
            </p>
          </div>

          {/* Lead avatar */}
          {card.lead ? (
            <div
              className="shrink-0 w-7 h-7 rounded-full bg-brand-500/15 ring-1 ring-brand-500/25 flex items-center justify-center text-[10px] font-semibold text-brand-700 dark:text-brand-300"
              title={`Lead: ${card.lead.name}`}
              aria-label={`Lead: ${card.lead.name}`}
            >
              {card.lead.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
          ) : (
            <div
              className="shrink-0 w-7 h-7 rounded-full bg-gray-100 dark:bg-obsidian-raised text-[10px] font-medium text-gray-400 dark:text-obsidian-faded flex items-center justify-center"
              title="No lead assigned"
              aria-label="No lead assigned"
            >
              —
            </div>
          )}
        </div>

        {/* Sprint progress */}
        {sprint ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-[10px]">
              <span className="font-medium text-gray-500 dark:text-obsidian-muted">
                Sprint {sprint.number}
              </span>
              <span className="font-mono tabular-nums text-gray-600 dark:text-obsidian-fg">
                {sprint.tasksDone}/{sprint.tasksTotal}
              </span>
            </div>
            <SegmentedProgressBar
              done={sprint.tasksDone}
              total={Math.max(sprint.tasksTotal, 1)}
              inProgress={sprint.tasksInProgress}
              tone="brand"
              ariaLabel={`Sprint ${sprint.number}: ${sprint.tasksDone} of ${sprint.tasksTotal} tasks done`}
            />
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 dark:text-obsidian-faded italic py-1">
            No active sprint
          </div>
        )}

        {/* Bottom strip: blocked count + velocity */}
        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {card.blockedCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                <AlertOctagon size={11} strokeWidth={2.25} />
                <span className="tabular-nums">{card.blockedCount}</span>
                <span className="text-[10px] text-rose-500/80 dark:text-rose-400/70">blocked</span>
              </span>
            ) : (
              <span className="text-[10px] text-gray-400 dark:text-obsidian-faded">No blockers</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-gray-400 dark:text-obsidian-faded">8w</span>
            <Sparkline
              data={card.velocity}
              tone={card.healthStatus === 'RED' ? 'danger' : card.healthStatus === 'YELLOW' ? 'warning' : 'brand'}
              width={64}
              height={20}
              fill
            />
          </div>
        </div>

        {/* tiny initials watermark, decorative */}
        <span
          className="pointer-events-none absolute -right-2 -bottom-3 text-[60px] font-black tracking-tighter opacity-[0.025] dark:opacity-[0.04] select-none"
          aria-hidden="true"
        >
          {initials}
        </span>
      </Link>
    </Tooltip>
  );
}
