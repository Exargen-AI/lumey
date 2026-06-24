import { Pencil, TrendingUp } from 'lucide-react';
import type { StoryUpdateData } from '@exargen/shared';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';

interface StoryUpdateCardProps {
  data: StoryUpdateData;
  authorName?: string;
  createdAt?: string;
  /** Hero treatment used for the pinned "latest update" at the top of the
   *  thread — slightly louder header so it reads as the headline, not just
   *  another comment. */
  pinned?: boolean;
  /** Show an "edited" marker (the author has revised this update). */
  edited?: boolean;
  /** When provided (author-only), renders an edit affordance in the header. */
  onEdit?: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-[13px]">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-obsidian-faded pt-0.5">
        {label}
      </span>
      <span className="text-gray-700 dark:text-obsidian-fg whitespace-pre-wrap break-words">{children}</span>
    </div>
  );
}

/**
 * Renders a `story_update` comment as a distinct card (not a plain markdown
 * bubble) so a client's progress update never gets buried in the thread.
 * Mirrors the client story template: objective / current task / reason /
 * impact / design change / progress / next step.
 */
export function StoryUpdateCard({ data, authorName, createdAt, pinned, edited, onEdit }: StoryUpdateCardProps) {
  const progress = Math.max(0, Math.min(100, data.progress ?? 0));

  return (
    <div
      className={cn(
        'rounded-lg border bg-white dark:bg-obsidian-raised/60 overflow-hidden',
        pinned
          ? 'border-brand-300 dark:border-brand-500/40 shadow-sm'
          : 'border-gray-200 dark:border-obsidian-border',
      )}
    >
      {/* Header — label + progress */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-2.5 border-b',
          pinned
            ? 'bg-brand-50/70 dark:bg-brand-500/[0.08] border-brand-200/70 dark:border-brand-500/20'
            : 'bg-gray-50/70 dark:bg-obsidian-sunken/40 border-gray-100 dark:border-obsidian-border/60',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp size={14} className="text-brand-600 dark:text-brand-300 shrink-0" />
          <span className="text-[12px] font-semibold text-gray-800 dark:text-obsidian-fg truncate">
            {pinned ? 'Latest progress update' : 'Progress update'}
          </span>
          {authorName && (
            <span className="text-[11px] text-gray-400 dark:text-obsidian-faded truncate">
              · {authorName}
              {createdAt ? ` · ${formatRelative(createdAt)}` : ''}
              {edited ? ' · edited' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onEdit && (
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-brand-600 dark:text-obsidian-faded dark:hover:text-brand-300 transition-colors"
              title="Edit this update"
            >
              <Pencil size={11} /> Edit
            </button>
          )}
          <span className="text-[12px] font-bold tabular-nums text-brand-700 dark:text-brand-300">
            {progress}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 w-full bg-gray-100 dark:bg-obsidian-sunken">
        <div
          className="h-full bg-brand-500 dark:bg-brand-400 transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <Row label="Objective">{data.objective}</Row>
        <Row label="Current">{data.currentTask}</Row>
        {data.reason?.trim() && <Row label="Reason">{data.reason}</Row>}
        {data.impact?.trim() && <Row label="Impact">{data.impact}</Row>}
        {data.designChange === 'changed' && (
          <Row label="Design">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 mb-1">
              Design changed
            </span>
            {(data.designOriginal?.trim() || data.designNew?.trim()) && (
              <div className="mt-0.5 text-[12.5px] text-gray-600 dark:text-obsidian-muted">
                <span className="line-through opacity-70">{data.designOriginal?.trim() || '—'}</span>
                {' → '}
                <span className="font-medium text-gray-800 dark:text-obsidian-fg">{data.designNew?.trim() || '—'}</span>
              </div>
            )}
          </Row>
        )}
        {data.nextStep?.trim() && <Row label="Next step">{data.nextStep}</Row>}
      </div>
    </div>
  );
}
