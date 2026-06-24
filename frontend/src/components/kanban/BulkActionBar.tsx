import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X, Calendar as CalendarIcon, Flag, User as UserIcon, Layers, Ban, Trash2, Loader2, AlertCircle, ArrowRightLeft,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useKanbanSelection } from '@/stores/kanbanSelectionStore';
import { useProjectMembers } from '@/hooks/useProjects';
import { useProjectSprints, useProjectEpics } from '@/hooks/useSprints';
import { bulkUpdateTasks, bulkDeleteTasks, previewBulkDeleteCascade, type BulkChange } from '@/api/tasks';
import { useConfirm } from '@/components/ui';
import { PRIORITY_LABELS, PRIORITY_COLORS, TASK_STATUS_ORDER, TASK_STATUS_LABELS } from '@/lib/constants';

type Popover = 'sprint' | 'status' | 'priority' | 'assignee' | 'epic' | 'blocker' | null;

interface BulkActionBarProps {
  projectId: string;
}

/**
 * Floating action bar that appears once at least one card is selected. Hosts
 * the bulk-mutate popovers (sprint / priority / assignee / epic / blocker)
 * and the bulk-delete with confirm.
 *
 * After every successful mutation we invalidate the project's task queries
 * so the board re-fetches and the cards re-render with the new state. The
 * selection itself stays — that way you can do "set sprint, then change
 * priority on the same set" without re-selecting.
 *
 * Partial failure is surfaced as a toast at the top of the bar (e.g.
 * "21 succeeded · 2 failed"). Click the failure pill to expand details.
 *
 * Outer / inner split (kanban follow-up #16): the outer component subscribes
 * only to the selection size and bails out when count === 0, so the inner
 * component — and its react-query hooks for members / sprints / epics —
 * never mount when there's nothing selected. Previously every kanban load
 * fired three extra queries even on a fresh navigation.
 */
export function BulkActionBar({ projectId }: BulkActionBarProps) {
  const count = useKanbanSelection((s) => s.selected.size);
  if (count === 0) return null;
  return <BulkActionBarInner projectId={projectId} />;
}

function BulkActionBarInner({ projectId }: BulkActionBarProps) {
  const selected = useKanbanSelection((s) => s.selected);
  const clear = useKanbanSelection((s) => s.clear);
  const count = selected.size;

  const [popover, setPopover] = useState<Popover>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: number; fail: number; errors?: string[] } | null>(null);
  const [showFailDetails, setShowFailDetails] = useState(false);

  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data: members } = useProjectMembers(projectId);
  const { data: sprints } = useProjectSprints(projectId);
  const { data: epics } = useProjectEpics(projectId);

  // Close any popover on Escape — the same key clears selection only when
  // no popover is open. Layered handler keeps both UX rules cleanly separate.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (popover) {
        setPopover(null);
        e.preventDefault();
      } else if (count > 0) {
        clear();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [popover, count, clear]);

  // Close popover when clicking outside the bar.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popover) return;
    const handler = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setPopover(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [popover]);

  // Note: no `count === 0` early-return here — the outer `BulkActionBar`
  // unmounts this whole tree (and its hooks) the moment selection drops to
  // zero, so by the time we reach this line the count is guaranteed > 0.

  const ids = Array.from(selected);

  const apply = async (change: BulkChange, label: string) => {
    setBusy(true);
    setLastResult(null);
    try {
      const r = await bulkUpdateTasks(ids, change);
      const failedErrors = r.results.filter((x) => !x.ok).map((x) => x.error || 'Unknown error');
      setLastResult({ ok: r.succeeded, fail: r.failed, errors: failedErrors });
      // Invalidate the board so cards reflect the new state. We invalidate
      // broadly so any open task-detail panels also refresh.
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
    } catch (e: any) {
      setLastResult({ ok: 0, fail: ids.length, errors: [e?.response?.data?.error?.message || `${label} failed`] });
    } finally {
      setBusy(false);
      setPopover(null);
    }
  };

  const handleDelete = async () => {
    // Fetch cascade counts so the confirm dialog tells the truth (QA K-C2:
    // a 50-task delete could destroy hours of timesheet data with no
    // warning otherwise). Preview is read-only; safe to call before any
    // user confirmation.
    let preview: { comments: number; timeEntries: number; loggedHours: number; externalLinks: number; taskLinks: number; statusHistory: number } | null = null;
    try {
      preview = await previewBulkDeleteCascade(ids);
    } catch {
      // If the preview fetch fails, fall back to a generic warning. The
      // delete itself runs the same auth checks server-side.
      preview = null;
    }
    const cascadeLines: string[] = [];
    if (preview) {
      if (preview.comments > 0) cascadeLines.push(`${preview.comments} comment${preview.comments === 1 ? '' : 's'} will be deleted`);
      if (preview.statusHistory > 0) cascadeLines.push(`${preview.statusHistory} status change${preview.statusHistory === 1 ? '' : 's'} from history will be deleted`);
      if (preview.taskLinks > 0) cascadeLines.push(`${preview.taskLinks} task-to-task link${preview.taskLinks === 1 ? '' : 's'} will be deleted`);
      if (preview.externalLinks > 0) cascadeLines.push(`${preview.externalLinks} linked GitHub PR${preview.externalLinks === 1 ? '' : 's'} will be deleted`);
      if (preview.timeEntries > 0) cascadeLines.push(`${preview.loggedHours.toFixed(1)}h logged across ${preview.timeEntries} entr${preview.timeEntries === 1 ? 'y' : 'ies'} will be UNLINKED (hours preserved on the timesheet, just no longer attributed to a task)`);
    }
    const body = cascadeLines.length > 0
      ? `This is permanent. Cascade impact:\n• ${cascadeLines.join('\n• ')}`
      : 'This is permanent. Comments, attachments, and history go with them.';

    if (!(await confirm({
      title: `Delete ${count} ${count === 1 ? 'task' : 'tasks'}?`,
      body,
      confirmLabel: `Delete ${count}`,
      tone: 'danger',
    }))) return;
    setBusy(true);
    setLastResult(null);
    try {
      const r = await bulkDeleteTasks(ids);
      const failedErrors = r.results.filter((x) => !x.ok).map((x) => x.error || 'Unknown error');
      setLastResult({ ok: r.succeeded, fail: r.failed, errors: failedErrors });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['project', projectId] });
      if (r.succeeded > 0) clear();
    } catch (e: any) {
      setLastResult({ ok: 0, fail: ids.length, errors: [e?.response?.data?.error?.message || 'Delete failed'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={barRef}
      className={cn(
        // On mobile: lifted 5rem above the bottom (~80px) so it clears the
        // 56px MobileBottomNav + safe-area-inset and never collides. On
        // desktop: pinned to bottom-6 as before. The bar's z-40 matches
        // the nav's z-40 — stacking is fine because they don't overlap
        // on either viewport once positioned.
        'fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-40',
        'rounded-xl border border-gray-200 dark:border-obsidian-border',
        'bg-white/95 dark:bg-obsidian-panel/95 backdrop-blur-md',
        'shadow-pop dark:shadow-pop-dark',
        // Mobile: fill the viewport with a small inset so the bar still
        // reads as floating. Desktop: keep the legacy 420–680px range.
        'flex flex-col w-[calc(100vw-1rem)] max-w-[680px] lg:min-w-[420px] lg:w-auto',
        'animate-fade-in-up',
      )}
      role="toolbar"
      aria-label="Bulk task actions"
    >
      {/* Result banner — collapses by default, expands when user clicks the failure pill */}
      {lastResult && (lastResult.fail > 0 || lastResult.ok > 0) && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 text-[12px] border-b border-gray-100 dark:border-obsidian-border/60',
          lastResult.fail === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300',
        )}>
          <AlertCircle size={13} className="shrink-0" />
          <span>
            {lastResult.ok > 0 && `${lastResult.ok} updated`}
            {lastResult.ok > 0 && lastResult.fail > 0 && ' · '}
            {lastResult.fail > 0 && (
              <button onClick={() => setShowFailDetails((v) => !v)} className="underline decoration-dotted underline-offset-2 hover:opacity-80">
                {lastResult.fail} failed
              </button>
            )}
          </span>
          <button onClick={() => setLastResult(null)} className="ml-auto opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}
      {showFailDetails && lastResult?.errors?.length ? (
        <div className="px-3 pb-2 text-[11px] text-gray-600 dark:text-obsidian-muted">
          <ul className="list-disc pl-4 space-y-0.5 max-h-32 overflow-y-auto">
            {Array.from(new Set(lastResult.errors)).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Main row */}
      <div className="flex items-center gap-1 px-3 py-2.5">
        <span className="text-[12.5px] font-semibold text-gray-900 dark:text-obsidian-fg mr-2">
          {count} selected
        </span>
        <ActionBtn icon={<CalendarIcon size={13} />} label="Sprint"   active={popover === 'sprint'}   onClick={() => setPopover(popover === 'sprint' ? null : 'sprint')}   />
        <ActionBtn icon={<ArrowRightLeft size={13} />} label="Status" active={popover === 'status'}   onClick={() => setPopover(popover === 'status' ? null : 'status')}   />
        <ActionBtn icon={<Flag size={13} />}         label="Priority" active={popover === 'priority'} onClick={() => setPopover(popover === 'priority' ? null : 'priority')} />
        <ActionBtn icon={<UserIcon size={13} />}     label="Assignee" active={popover === 'assignee'} onClick={() => setPopover(popover === 'assignee' ? null : 'assignee')} />
        <ActionBtn icon={<Layers size={13} />}       label="Epic"     active={popover === 'epic'}     onClick={() => setPopover(popover === 'epic' ? null : 'epic')}       />
        <ActionBtn icon={<Ban size={13} />}          label="Blocker"  active={popover === 'blocker'}  onClick={() => setPopover(popover === 'blocker' ? null : 'blocker')}  />
        <span className="w-px h-5 bg-gray-200 dark:bg-obsidian-border mx-1" />
        <ActionBtn icon={<Trash2 size={13} />} label="Delete" tone="danger" onClick={handleDelete} disabled={busy} />
        <span className="ml-auto" />
        <button
          onClick={clear}
          aria-label="Clear selection"
          className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 dark:text-obsidian-muted dark:hover:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised transition-colors"
          title="Clear selection (Esc)"
        >
          <X size={14} />
        </button>
        {busy && <Loader2 size={14} className="animate-spin text-brand-500" />}
      </div>

      {/* Popover surfaces */}
      {popover === 'sprint' && (
        <PopoverList title="Move to sprint">
          <PopoverRow onClick={() => apply({ sprintId: null }, 'Move to backlog')}>Backlog (no sprint)</PopoverRow>
          {sprints?.filter((s: any) => s.status !== 'COMPLETED' && s.status !== 'CANCELLED').map((s: any) => (
            <PopoverRow key={s.id} onClick={() => apply({ sprintId: s.id }, `Move to ${s.name}`)}>
              {s.name} <span className="text-[10px] text-gray-400">{s.status.toLowerCase()}</span>
            </PopoverRow>
          ))}
        </PopoverList>
      )}
      {popover === 'status' && (
        <PopoverList title="Move to status">
          {TASK_STATUS_ORDER.map((s) => (
            <PopoverRow key={s} onClick={() => apply({ status: s as BulkChange['status'] }, `Move to ${TASK_STATUS_LABELS[s]}`)}>
              {TASK_STATUS_LABELS[s]}
            </PopoverRow>
          ))}
        </PopoverList>
      )}
      {popover === 'priority' && (
        <PopoverList title="Set priority">
          {(['P0', 'P1', 'P2', 'P3'] as const).map((p) => (
            <PopoverRow key={p} onClick={() => apply({ priority: p }, `Priority ${p}`)}>
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: PRIORITY_COLORS[p] }}
              />
              {p} — {PRIORITY_LABELS[p]}
            </PopoverRow>
          ))}
        </PopoverList>
      )}
      {popover === 'assignee' && (
        <PopoverList title="Reassign">
          <PopoverRow onClick={() => apply({ assigneeId: null }, 'Unassign')}>Unassigned</PopoverRow>
          {members?.map((m: any) => (
            <PopoverRow key={m.userId} onClick={() => apply({ assigneeId: m.userId }, `Assign to ${m.user.name}`)}>
              <span className="inline-flex w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-500/20 items-center justify-center text-[10px] font-semibold text-brand-700 dark:text-brand-300">
                {m.user.name.charAt(0)}
              </span>
              {m.user.name}
              <span className="text-[10px] text-gray-400 ml-auto capitalize">{m.role?.toLowerCase().replace('_', ' ')}</span>
            </PopoverRow>
          ))}
        </PopoverList>
      )}
      {popover === 'epic' && (
        <PopoverList title="Set epic">
          <PopoverRow onClick={() => apply({ epicId: null }, 'Remove from epic')}>No epic</PopoverRow>
          {epics?.map((e: any) => (
            <PopoverRow key={e.id} onClick={() => apply({ epicId: e.id }, `Move to ${e.title}`)}>
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: e.color || '#7c3aed' }}
              />
              {e.title}
            </PopoverRow>
          ))}
        </PopoverList>
      )}
      {popover === 'blocker' && <BlockerPopover onApply={apply} />}
    </div>
  );
}

function ActionBtn({
  icon, label, onClick, active, tone, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  tone?: 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        tone === 'danger'
          ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15'
          : active
            ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/30'
            : 'text-gray-700 dark:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function PopoverList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-100 dark:border-obsidian-border/60 max-h-64 overflow-y-auto">
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted">{title}</div>
      <div className="pb-1.5">{children}</div>
    </div>
  );
}

function PopoverRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[13px] text-gray-700 dark:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised flex items-center gap-2"
    >
      {children}
    </button>
  );
}

function BlockerPopover({ onApply }: { onApply: (change: BulkChange, label: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  return (
    <div className="border-t border-gray-100 dark:border-obsidian-border/60 p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-obsidian-muted">Mark blocked</div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why are these blocked? (optional, applied to all)"
        maxLength={2000}
        className="w-full text-[12.5px] rounded-md border border-gray-300 dark:border-obsidian-border px-2 py-1.5 bg-white dark:bg-obsidian-bg text-gray-900 dark:text-obsidian-fg focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => onApply({ isBlocked: false }, 'Unblock')}
          className="px-2.5 py-1.5 text-[12px] rounded-md text-gray-700 dark:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised"
        >
          Unblock
        </button>
        <button
          type="button"
          onClick={() => onApply({ isBlocked: true, blockerNote: note.trim() || null }, 'Mark blocked')}
          className="px-2.5 py-1.5 text-[12px] rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium"
        >
          Mark blocked
        </button>
      </div>
    </div>
  );
}
