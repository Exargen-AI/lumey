import { Link } from 'react-router-dom';
import { AlertOctagon, UserPlus, MailWarning, Bug, Layers, ChevronRight, CheckCircle2 } from 'lucide-react';
import type { AttentionItem } from '@/api/analytics';
import { cn } from '@/lib/cn';

interface AttentionListProps {
  items: AttentionItem[];
  isLoading?: boolean;
}

// Keep this in sync with TriageInboxPage's KIND_META — when a new kind lands
// in the backend, both consumers (dashboard band + /inbox page) must render it.
const ICONS: Record<AttentionItem['kind'], React.ReactNode> = {
  BLOCKED_AGING:        <AlertOctagon size={14} strokeWidth={2.25} />,
  UNASSIGNED_IN_SPRINT: <UserPlus size={14} strokeWidth={2} />,
  MISSING_EOD:          <MailWarning size={14} strokeWidth={2} />,
  RECENT_BUG:           <Bug size={14} strokeWidth={2} />,
  EPIC_LESS_IN_SPRINT:  <Layers size={14} strokeWidth={2} />,
};

const SEV_PILL: Record<AttentionItem['severity'], string> = {
  high:   'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25',
  medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25',
  low:    'bg-gray-500/10 text-gray-600 dark:text-obsidian-muted ring-1 ring-gray-500/15',
};
const SEV_ICON_BG: Record<AttentionItem['severity'], string> = {
  high:   'bg-rose-500/12 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/25',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20',
  low:    'bg-gray-500/8 text-gray-500 dark:text-obsidian-muted ring-1 ring-gray-500/15',
};

/**
 * Band 4 — auto-generated alerts that need a routing decision.
 *
 * Shows only what the studio lead can act on: tasks blocked >3d, unassigned
 * tasks in active sprints, engineers who skipped yesterday's EOD. Sorted by
 * severity. Each row carries a single quick-action so the lead can clear the
 * alert without leaving the page (future: inline mutations; for now: jump to
 * the project).
 */
export function AttentionList({ items, isLoading }: AttentionListProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border p-4">
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 rounded-md bg-gray-100 dark:bg-obsidian-raised/60" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={cn(
        'rounded-xl border border-dashed p-8 text-center',
        'border-emerald-300/30 bg-emerald-500/5',
        'dark:border-emerald-500/20 dark:bg-emerald-500/[0.04]',
      )}>
        <CheckCircle2 size={20} className="mx-auto text-emerald-500 mb-2" />
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          Inbox clean — nothing needs your attention.
        </p>
        <p className="text-[11px] text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
          Great time to plan ahead or unblock someone else.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-obsidian-border/60 bg-gray-50/60 dark:bg-obsidian-sunken/40">
        <h3 className="text-[10px] uppercase tracking-[0.1em] font-semibold text-gray-500 dark:text-obsidian-muted">
          Attention required
        </h3>
        <Link
          to="/inbox"
          className="text-[10px] tabular-nums text-gray-500 dark:text-obsidian-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors flex items-center gap-1"
        >
          {items.length} {items.length === 1 ? 'item' : 'items'}
          <ChevronRight size={11} />
        </Link>
      </div>
      <ul>
        {items.map((item) => (
          <AttentionRow key={item.id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const Inner = (
    <div className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-2.5 group">
      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', SEV_ICON_BG[item.severity])}>
        {ICONS[item.kind]}
      </div>
      <div className="min-w-0">
        <p className="text-[12.5px] text-gray-800 dark:text-obsidian-fg truncate group-hover:text-brand-700 dark:group-hover:text-brand-200">
          {item.message}
        </p>
        {/* secondary line — kind + assignee/blockerNote if available */}
        <p className="text-[10px] uppercase tracking-[0.08em] text-gray-400 dark:text-obsidian-faded mt-0.5">
          {humanKind(item.kind)}
          {kindMeta(item)}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold', SEV_PILL[item.severity])}>
          {item.action.label}
        </span>
        <ChevronRight size={13} className="text-gray-300 dark:text-obsidian-faded opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );

  if (item.action.href) {
    return (
      <li className="border-b border-gray-100 dark:border-obsidian-border/60 last:border-b-0">
        <Link
          to={item.action.href}
          className="block hover:bg-gray-50 dark:hover:bg-obsidian-raised/60 transition-colors focus:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-obsidian-raised/60"
        >
          {Inner}
        </Link>
      </li>
    );
  }
  return (
    <li className="border-b border-gray-100 dark:border-obsidian-border/60 last:border-b-0">
      {Inner}
    </li>
  );
}

function humanKind(k: AttentionItem['kind']): string {
  switch (k) {
    case 'BLOCKED_AGING':         return 'Blocked task aging';
    case 'UNASSIGNED_IN_SPRINT':  return 'Unassigned in active sprint';
    case 'MISSING_EOD':           return 'Missing EOD';
    case 'RECENT_BUG':            return 'New bug — needs triage';
    case 'EPIC_LESS_IN_SPRINT':   return 'Sprint task without epic';
  }
}

function kindMeta(item: AttentionItem): string {
  if (item.kind === 'BLOCKED_AGING') {
    const a = item.context.assignee as string | null | undefined;
    return a ? ` · ${a}` : ' · unassigned';
  }
  return '';
}
