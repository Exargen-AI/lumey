import { FileText, Lightbulb, AlertTriangle, ChevronRight } from 'lucide-react';
import { useClientActions } from '@/hooks/useClientActions';
import type { ClientActionItem } from '@/api/clientActions';
import { cn } from '@/lib/cn';

/**
 * "Your action needed" callout — sits above the project hero on the client
 * status page. Lists deliverables awaiting sign-off + open decisions in
 * one merged list, oldest-first. Hidden entirely when no items wait.
 *
 * Visual weight is amber → rose: a 1–4 day wait is amber (gentle nudge);
 * any item waiting 5+ days flips the whole callout to rose (likely
 * forgotten — needs visible escalation).
 *
 * Deliverable rows scroll-link to the deliverables panel further down
 * the page (id `deliverables-panel` on the ProjectStatusPage). Decision
 * rows don't link anywhere today because there's no client-facing
 * decisions UI yet — they're informational so the client knows to
 * raise the topic with the team. (Future PR: add a decisions panel.)
 */
interface Props {
  projectId: string;
}

const URGENCY_AGE_DAYS = 5;

export function ClientActionsCallout({ projectId }: Props) {
  const { data, isLoading, error } = useClientActions(projectId);

  // Render-or-bust:
  //   - loading → render nothing (no shimmer; the rest of the page is loaded)
  //   - error → render nothing (the page is still useful without this strip)
  //   - empty → render nothing (no callout when there's no action needed)
  if (isLoading) return null;
  if (error || !data || data.count === 0) return null;

  const anyUrgent = data.items.some((it) => it.waitingDays >= URGENCY_AGE_DAYS);
  const palette = anyUrgent ? URGENT_PALETTE : GENTLE_PALETTE;
  const oldestDays = Math.max(...data.items.map((it) => it.waitingDays));

  return (
    <div className={cn('rounded-2xl border p-5', palette.container, 'animate-fade-in-up')}>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className={cn('shrink-0', palette.icon)} />
        <h2 className={cn('text-[14px] font-semibold tracking-tight', palette.heading)}>
          {data.count === 1 ? '1 item needs your input' : `${data.count} items need your input`}
        </h2>
        {anyUrgent && (
          <span className={cn('text-[10px] font-semibold tracking-wide uppercase rounded-full px-1.5 py-0.5', palette.chip)}>
            Oldest waiting {oldestDays}d
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {data.items.map((item) => (
          <ClientActionRow key={`${item.kind}-${item.id}`} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ClientActionRow({ item }: { item: ClientActionItem }) {
  const baseClass = cn(
    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px]',
    'bg-white/60 dark:bg-obsidian-panel/60',
    'border border-transparent',
  );

  const inner = (
    <>
      <ActionIcon kind={item.kind} className="shrink-0 text-gray-500 dark:text-obsidian-muted" />
      <span className="flex-1 min-w-0 truncate text-gray-900 dark:text-obsidian-fg font-medium">
        {item.title}
      </span>
      <span className="shrink-0 text-[11px] text-gray-500 dark:text-obsidian-muted tabular-nums">
        {labelFor(item)}
      </span>
    </>
  );

  // Deliverable: anchor-link to the deliverables panel section so the
  // page scrolls down. Decision: render as non-link informational row —
  // no client-facing decision UI exists today (future PR).
  if (item.kind === 'DELIVERABLE') {
    return (
      <li>
        <a
          href="#deliverables-panel"
          className={cn(
            baseClass,
            'group hover:bg-white hover:border-gray-200',
            'dark:hover:bg-obsidian-panel dark:hover:border-obsidian-border',
            'transition-colors',
          )}
        >
          {inner}
          <ChevronRight
            size={14}
            className="shrink-0 text-gray-400 dark:text-obsidian-faded group-hover:translate-x-0.5 transition-transform"
          />
        </a>
      </li>
    );
  }

  return (
    <li>
      <div className={baseClass} title="Open decision — discuss with the project team to resolve">
        {inner}
      </div>
    </li>
  );
}

function ActionIcon({ kind, className }: { kind: ClientActionItem['kind']; className?: string }) {
  if (kind === 'DELIVERABLE') return <FileText size={14} className={className} />;
  return <Lightbulb size={14} className={className} />;
}

function labelFor(item: ClientActionItem): string {
  const noun = item.kind === 'DELIVERABLE' ? 'awaiting sign-off' : 'open decision';
  if (item.waitingDays === 0) return `${noun} · today`;
  if (item.waitingDays === 1) return `${noun} · 1 day`;
  return `${noun} · ${item.waitingDays} days`;
}

const URGENT_PALETTE = {
  container: 'bg-rose-50 border-rose-200 dark:bg-rose-500/[0.08] dark:border-rose-500/30',
  heading: 'text-rose-900 dark:text-rose-100',
  icon: 'text-rose-600 dark:text-rose-400',
  chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
} as const;

const GENTLE_PALETTE = {
  container: 'bg-amber-50 border-amber-200 dark:bg-amber-500/[0.08] dark:border-amber-500/30',
  heading: 'text-amber-900 dark:text-amber-100',
  icon: 'text-amber-600 dark:text-amber-400',
  chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200',
} as const;
