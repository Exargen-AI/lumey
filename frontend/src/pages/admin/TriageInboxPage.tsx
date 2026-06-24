import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertOctagon, UserPlus, MailWarning, Bug, Layers, Filter, X, ChevronRight,
  CheckCircle2, Sparkles,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getAttentionItems, type AttentionItem, type AttentionKind } from '@/api/analytics';
import { useTask } from '@/hooks/useTasks';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { pluralize } from '@/lib/plural';

const KIND_META: Record<AttentionKind, {
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  tone: 'rose' | 'amber' | 'gray' | 'orange' | 'brand';
}> = {
  BLOCKED_AGING:        { label: 'Blocked & aging',         shortLabel: 'Blocked',     icon: <AlertOctagon size={11} />, tone: 'rose'   },
  RECENT_BUG:           { label: 'New bugs to triage',      shortLabel: 'New bugs',    icon: <Bug size={11} />,          tone: 'orange' },
  UNASSIGNED_IN_SPRINT: { label: 'Unassigned in sprint',    shortLabel: 'Unassigned',  icon: <UserPlus size={11} />,     tone: 'amber'  },
  EPIC_LESS_IN_SPRINT:  { label: 'No epic in active sprint', shortLabel: 'No epic',     icon: <Layers size={11} />,       tone: 'brand'  },
  MISSING_EOD:          { label: 'Missing EOD updates',     shortLabel: 'Missing EOD', icon: <MailWarning size={11} />,  tone: 'gray'   },
};

const KIND_ORDER: AttentionKind[] = [
  'BLOCKED_AGING',
  'RECENT_BUG',
  'UNASSIGNED_IN_SPRINT',
  'EPIC_LESS_IN_SPRINT',
  'MISSING_EOD',
];

const TONE_PILL: Record<NonNullable<ReturnType<typeof getKindTone>>, string> = {
  rose:   'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25',
  amber:  'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25',
  gray:   'bg-gray-500/10 text-gray-700 dark:text-obsidian-fg ring-1 ring-gray-500/15',
  orange: 'bg-orange-500/12 text-orange-700 dark:text-orange-300 ring-1 ring-orange-500/25',
  brand:  'bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25',
};
const TONE_ICON: Record<NonNullable<ReturnType<typeof getKindTone>>, string> = {
  rose:   'bg-rose-500/12 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/25',
  amber:  'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20',
  gray:   'bg-gray-500/8 text-gray-500 dark:text-obsidian-muted ring-1 ring-gray-500/15',
  orange: 'bg-orange-500/12 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/25',
  brand:  'bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25',
};

function getKindTone(k: AttentionKind) { return KIND_META[k].tone; }

const SEV_DOT: Record<AttentionItem['severity'], string> = {
  high:   'bg-rose-500',
  medium: 'bg-amber-500',
  low:    'bg-gray-400 dark:bg-obsidian-faded',
};

/**
 * /inbox — the morning triage ritual screen.
 *
 *   - Reuses /analytics/attention so it stays in sync with the studio
 *     dashboard band on /dashboard.
 *   - Items are grouped by kind, severity-sorted within each group.
 *   - J / K walk through items; Enter takes the row's action; F switches
 *     filter focus; Esc clears focus.
 *   - Hovering an item that links to a task previews the task title +
 *     description + assignee + due in a side panel — saves a click for
 *     fast scanning.
 *   - Empty state celebrates the clean inbox so finishing the ritual feels
 *     like an accomplishment.
 */
export function TriageInboxPage() {
  const navigate = useNavigate();
  const { data: items, isLoading } = useQuery({
    queryKey: ['attention'],
    queryFn: getAttentionItems,
    refetchInterval: 60_000,
  });

  const [enabledKinds, setEnabledKinds] = useState<Set<AttentionKind>>(
    () => new Set(KIND_ORDER),
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Filter + group
  const { groups, flatVisible, totalAll, totalVisible, perKindCounts } = useMemo(() => {
    const all = items ?? [];
    const counts: Partial<Record<AttentionKind, number>> = {};
    all.forEach((i) => { counts[i.kind] = (counts[i.kind] ?? 0) + 1; });
    const visible = all.filter((i) => enabledKinds.has(i.kind));
    const grouped = new Map<AttentionKind, AttentionItem[]>();
    KIND_ORDER.forEach((k) => grouped.set(k, []));
    visible.forEach((i) => grouped.get(i.kind)!.push(i));
    const flat: AttentionItem[] = [];
    KIND_ORDER.forEach((k) => grouped.get(k)!.forEach((i) => flat.push(i)));
    return {
      groups: grouped,
      flatVisible: flat,
      totalAll: all.length,
      totalVisible: visible.length,
      perKindCounts: counts,
    };
  }, [items, enabledKinds]);

  // Auto-clear focus when filters hide the focused row
  useEffect(() => {
    if (focusedId && !flatVisible.some((i) => i.id === focusedId)) {
      setFocusedId(null);
    }
  }, [flatVisible, focusedId]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const idx = focusedId ? flatVisible.findIndex((i) => i.id === focusedId) : -1;

      if ((e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') && flatVisible.length > 0) {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.min(flatVisible.length - 1, idx + 1);
        setFocusedId(flatVisible[next].id);
        return;
      }
      if ((e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') && flatVisible.length > 0) {
        e.preventDefault();
        const next = idx < 0 ? 0 : Math.max(0, idx - 1);
        setFocusedId(flatVisible[next].id);
        return;
      }
      if (e.key === 'Enter' && focusedId) {
        const item = flatVisible[idx];
        if (item?.action.href) {
          e.preventDefault();
          navigate(item.action.href);
        }
        return;
      }
      if (e.key === 'Escape') { setFocusedId(null); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flatVisible, focusedId, navigate]);

  // Scroll focused row into view
  useEffect(() => {
    if (!focusedId) return;
    // Query by data-attribute instead of threading a ref — keeps TS happy
    // under React 19's stricter ref typing and survives re-mounts.
    const el = document.querySelector<HTMLElement>(`[data-row-id="${focusedId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedId]);

  const toggleKind = (k: AttentionKind) => {
    const next = new Set(enabledKinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setEnabledKinds(next);
  };

  const filterAll = () => setEnabledKinds(new Set(KIND_ORDER));
  const filterNone = () => setEnabledKinds(new Set());
  const allEnabled = enabledKinds.size === KIND_ORDER.length;

  // Hover preview only fires when the row references a real task.
  const hoveredItem = items?.find((i) => i.id === hoveredId) ?? null;
  const previewTaskId = hoveredItem && (hoveredItem.context.taskId as string | undefined);

  return (
    <div className="space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-end justify-between gap-4 animate-fade-in-down">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded">
            Morning ritual
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Triage{' '}
            <span className="bg-gradient-to-r from-brand-500 to-brand-300 bg-clip-text text-transparent">Inbox</span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1.5">
            {isLoading
              ? 'Loading…'
              : totalAll === 0
              ? 'Inbox clean — nothing needs your attention.'
              : `${pluralize(totalAll, 'item')} need a routing decision today.`}
          </p>
        </div>
        <div className="hidden md:flex items-center gap-2 text-[11px] text-gray-500 dark:text-obsidian-faded">
          <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised border border-gray-200 dark:border-obsidian-border text-gray-700 dark:text-obsidian-fg font-mono text-[10px]">J</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised border border-gray-200 dark:border-obsidian-border text-gray-700 dark:text-obsidian-fg font-mono text-[10px]">K</kbd>
          navigate ·
          <kbd className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised border border-gray-200 dark:border-obsidian-border text-gray-700 dark:text-obsidian-fg font-mono text-[10px]">↵</kbd>
          take action
        </div>
      </div>

      {/* ─── Filter chips ─── */}
      <div className="flex flex-wrap items-center gap-1.5 animate-fade-in">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-faded mr-1">
          <Filter size={10} /> Filter
        </span>
        {KIND_ORDER.map((k) => {
          const meta = KIND_META[k];
          const enabled = enabledKinds.has(k);
          const count = perKindCounts[k] ?? 0;
          if (count === 0 && !enabled) return null;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={enabled}
              onClick={() => toggleKind(k)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                enabled
                  ? TONE_PILL[meta.tone]
                  : 'border-gray-200 dark:border-obsidian-border text-gray-500 dark:text-obsidian-faded hover:border-gray-300 dark:hover:border-obsidian-border-strong',
              )}
            >
              {meta.icon}
              {meta.shortLabel}
              {count > 0 && <span className="text-[10px] tabular-nums opacity-70">{count}</span>}
            </button>
          );
        })}
        {!allEnabled ? (
          <button onClick={filterAll} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-brand-600 dark:text-brand-300 hover:underline">
            Show all
          </button>
        ) : (
          totalAll > 0 && (
            <button onClick={filterNone} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-gray-500 dark:text-obsidian-faded hover:text-gray-700 dark:hover:text-obsidian-fg">
              <X size={10} /> Hide all
            </button>
          )
        )}
      </div>

      {/* ─── Body: list + side preview ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse" />
              ))}
            </div>
          ) : totalAll === 0 ? (
            <CleanInboxState />
          ) : totalVisible === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-10 text-center">
              <p className="text-sm text-gray-500 dark:text-obsidian-muted">
                Filters hide every item. <button onClick={filterAll} className="text-brand-600 dark:text-brand-300 hover:underline">Show all</button>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {KIND_ORDER.map((kind) => {
                const list = groups.get(kind) ?? [];
                if (list.length === 0) return null;
                const meta = KIND_META[kind];
                return (
                  <section key={kind}>
                    <div className="flex items-center justify-between mb-2">
                      <h2 className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] uppercase tracking-[0.1em] font-semibold', TONE_PILL[meta.tone])}>
                        {meta.icon}
                        {meta.label}
                      </h2>
                      <span className="text-[10px] tabular-nums text-gray-400 dark:text-obsidian-faded">
                        {list.length}
                      </span>
                    </div>
                    <ul role="list" className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border overflow-hidden">
                      {list.map((item) => (
                        <Row
                          key={item.id}
                          item={item}
                          focused={focusedId === item.id}
                          onFocus={() => setFocusedId(item.id)}
                          onHover={(over) => setHoveredId(over ? item.id : null)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        {/* Hover preview rail — only when we're on a task-bound row */}
        <aside className="hidden lg:block">
          <div className="sticky top-4">
            {previewTaskId ? (
              <TaskPreview taskId={previewTaskId} kind={hoveredItem!.kind} />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-5 text-center text-[11px] text-gray-400 dark:text-obsidian-faded leading-relaxed">
                Hover an item to peek at the task here without leaving the inbox.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

interface RowProps {
  item: AttentionItem;
  focused: boolean;
  onFocus: () => void;
  onHover: (over: boolean) => void;
}

function Row({ item, focused, onFocus, onHover }: RowProps) {
  const meta = KIND_META[item.kind];
  const days = (item.context.days as number | undefined) ?? null;
  const inner = (
    <div
      className={cn(
        'grid grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-2.5 group',
        focused && 'bg-brand-500/[0.06] dark:bg-brand-500/[0.10]',
      )}
    >
      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', TONE_ICON[meta.tone])}>
        {meta.icon}
      </div>
      <div className="min-w-0">
        <p className={cn(
          'text-[12.5px] truncate transition-colors',
          focused
            ? 'text-brand-700 dark:text-brand-200'
            : 'text-gray-800 dark:text-obsidian-fg group-hover:text-brand-700 dark:group-hover:text-brand-200',
        )}>
          {item.message}
        </p>
        <p className="text-[10px] uppercase tracking-[0.08em] text-gray-400 dark:text-obsidian-faded mt-0.5 flex items-center gap-1.5">
          <span className={cn('w-1 h-1 rounded-full inline-block', SEV_DOT[item.severity])} />
          {item.severity}
          {days != null && <><span>·</span><span>{days}d</span></>}
          {(item.context.assignee as string | undefined) && (
            <><span>·</span><span>{item.context.assignee as string}</span></>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn('text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold', TONE_PILL[meta.tone])}>
          {item.action.label}
        </span>
        <ChevronRight size={13} className="text-gray-300 dark:text-obsidian-faded opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );

  return (
    <li
      data-row-id={item.id}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={onFocus}
      onClick={onFocus}
      className="border-b border-gray-100 dark:border-obsidian-border/60 last:border-b-0"
    >
      {item.action.href ? (
        <a
          href={item.action.href}
          className="block hover:bg-gray-50 dark:hover:bg-obsidian-raised/60 transition-colors focus:outline-none"
        >
          {inner}
        </a>
      ) : (
        <div className="block">{inner}</div>
      )}
    </li>
  );
}

function TaskPreview({ taskId, kind }: { taskId: string; kind: AttentionKind }) {
  const { data: task, isLoading } = useTask(taskId);
  const meta = KIND_META[kind];
  if (isLoading) {
    return (
      <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border p-4 space-y-2">
        <div className="skeleton h-3 rounded w-1/3" />
        <div className="skeleton h-5 rounded w-3/4" />
        <div className="skeleton h-16 rounded" />
      </div>
    );
  }
  if (!task) return null;
  return (
    <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border overflow-hidden">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-obsidian-border/60 bg-gray-50/40 dark:bg-obsidian-sunken/30">
        <p className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] uppercase tracking-[0.1em] font-semibold', TONE_PILL[meta.tone])}>
          {meta.icon}
          {meta.shortLabel}
        </p>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted mb-0.5">
            {task.project?.name}
          </p>
          <h3 className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg leading-snug">
            {task.title}
          </h3>
        </div>
        {task.description && (
          <p className="text-[12px] text-gray-600 dark:text-obsidian-muted leading-relaxed line-clamp-6 whitespace-pre-wrap">
            {task.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-obsidian-muted">
          <span>Status · {task.status?.toLowerCase().replace('_', ' ')}</span>
          <span>·</span>
          <span>Priority · {task.priority}</span>
          {task.assignee ? (
            <>
              <span>·</span>
              <span>{task.assignee.name}</span>
            </>
          ) : (
            <>
              <span>·</span>
              <span className="italic text-rose-500/80">unassigned</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CleanInboxState() {
  return (
    <div className={cn(
      'rounded-2xl border-2 border-dashed border-emerald-300/40 dark:border-emerald-500/25',
      'bg-emerald-500/5 dark:bg-emerald-500/[0.04]',
      'p-12 text-center',
    )}>
      <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/15 ring-1 ring-emerald-500/30 flex items-center justify-center mb-4 relative animate-pulse-glow">
        <CheckCircle2 size={28} className="text-emerald-500" strokeWidth={1.75} />
        <Sparkles size={14} className="absolute -top-1 -right-1 text-emerald-400" />
      </div>
      <h2 className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
        Triage clean ✓
      </h2>
      <p className="text-sm text-emerald-600/80 dark:text-emerald-400/80 mt-2 max-w-md mx-auto">
        Nothing needs your attention right now. Great time to plan ahead, unblock a teammate, or take a real break.
      </p>
    </div>
  );
}
