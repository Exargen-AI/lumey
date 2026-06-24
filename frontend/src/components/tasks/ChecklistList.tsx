import { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import type { ChecklistItem } from '@/api/tasks';
import { useConfirm } from '@/components/ui';
import { cn } from '@/lib/cn';

interface ChecklistListProps {
  /** Stable identity for keying the optimistic state. Re-mounts when this changes. */
  identityKey: string;
  /** Source-of-truth items from the server. */
  items: ChecklistItem[];
  /** Whether the current user can edit at all (RBAC + sanity gate). */
  canEdit: boolean;
  /** Whether the current mutation is in flight — used to disable inputs. */
  isPending?: boolean;
  /** Triggered when the array changes (add / edit / toggle / delete). */
  onChange: (items: ChecklistItem[]) => void;
  /** Placeholder for the inline-add input. */
  addPlaceholder?: string;
  /**
   * Tint of the checkbox + progress bar — green for AC (encouragement),
   * brand for plain subtasks.
   */
  tone?: 'brand' | 'success';
  /** Show "+/+" progress in the header. Default true. */
  showProgress?: boolean;
}

/**
 * Reusable checklist editor — drives both the Subtasks and the Acceptance
 * Criteria sections of the task detail view. Keeps the wire format simple
 * (`{id, text, done}[]`) so the same backend endpoint shape works for both.
 *
 * Optimistic UX: the local state mirrors `items` and updates immediately on
 * user action; the parent's `onChange` fires after each mutation so the
 * server can persist. The parent typically debounces persistence by feeding
 * a single mutation hook.
 */
export function ChecklistList({
  identityKey,
  items,
  canEdit,
  isPending,
  onChange,
  addPlaceholder = 'Add an item…',
  tone = 'brand',
  showProgress = true,
}: ChecklistListProps) {
  // Mirror the server array for snappier edits. Reset whenever the parent's
  // identity changes (different task) or whenever a fresh array arrives.
  const [local, setLocal] = useState<ChecklistItem[]>(items);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [adding, setAdding] = useState('');
  const confirm = useConfirm();

  useEffect(() => {
    setLocal(items);
  }, [identityKey, items]);

  const editInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  function commit(next: ChecklistItem[]) {
    setLocal(next);
    onChange(next);
  }

  function newId(): string {
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.randomUUID) {
      return (globalThis as any).crypto.randomUUID();
    }
    return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function handleAdd() {
    const trimmed = adding.trim();
    if (!trimmed) return;
    if (trimmed.length > 500) return;
    commit([...local, { id: newId(), text: trimmed, done: false }]);
    setAdding('');
  }

  function handleToggle(item: ChecklistItem) {
    commit(local.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
  }

  function handleStartEdit(item: ChecklistItem) {
    setEditingId(item.id);
    setEditingText(item.text);
  }

  function handleSaveEdit() {
    if (!editingId) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    commit(local.map((i) => (i.id === editingId ? { ...i, text: trimmed.slice(0, 500) } : i)));
    setEditingId(null);
    setEditingText('');
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditingText('');
  }

  async function handleDelete(item: ChecklistItem) {
    const ok = await confirm({
      title: 'Remove this item?',
      body: `“${item.text}” will be removed. This cannot be undone.`,
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    commit(local.filter((i) => i.id !== item.id));
  }

  const doneCount = local.filter((i) => i.done).length;
  const totalCount = local.length;
  const allDone = totalCount > 0 && doneCount === totalCount;

  const checkboxClasses =
    tone === 'success' ? 'accent-success-500 text-success-500' : 'accent-brand-500 text-brand-500';
  const progressFill = tone === 'success' ? 'bg-success-500' : 'bg-brand-500';

  return (
    <div className="space-y-2">
      {showProgress && totalCount > 0 && (
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-1 rounded-full bg-gray-200 dark:bg-obsidian-border overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-[width] duration-300', progressFill)}
              style={{ width: `${(doneCount / totalCount) * 100}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums font-mono text-gray-500 dark:text-obsidian-muted shrink-0">
            {doneCount}/{totalCount}
            {allDone && <span className="ml-1 text-success-500">·</span>}
          </span>
        </div>
      )}

      {local.length === 0 && !canEdit && (
        <p className="text-[12px] italic text-gray-400 dark:text-obsidian-faded">No items yet.</p>
      )}

      <ul className="space-y-1" role="list">
        {local.map((item) => {
          const isEditing = editingId === item.id;
          return (
            <li
              key={item.id}
              className={cn(
                'group flex items-start gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors',
                'hover:bg-gray-50 dark:hover:bg-obsidian-raised/40',
                isEditing && 'bg-gray-50 dark:bg-obsidian-raised/40',
              )}
            >
              <input
                type="checkbox"
                checked={item.done}
                disabled={!canEdit || isPending}
                onChange={() => handleToggle(item)}
                className={cn(
                  'mt-0.5 w-4 h-4 rounded shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                  checkboxClasses,
                )}
                aria-label={item.done ? `Uncheck ${item.text}` : `Check ${item.text}`}
              />

              {isEditing ? (
                <div className="flex-1 flex items-center gap-1">
                  <input
                    ref={editInputRef}
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(); }
                      if (e.key === 'Escape') { e.preventDefault(); handleCancelEdit(); }
                    }}
                    onBlur={handleSaveEdit}
                    maxLength={500}
                    className="flex-1 bg-white dark:bg-obsidian-bg border border-gray-300 dark:border-obsidian-border rounded px-2 py-1 text-[13px] text-gray-900 dark:text-obsidian-fg focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleSaveEdit}
                    className="p-1 rounded text-success-500 hover:bg-success-500/10"
                    aria-label="Save"
                    title="Save (Enter)"
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCancelEdit}
                    className="p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-obsidian-border"
                    aria-label="Cancel"
                    title="Cancel (Esc)"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <span
                    className={cn(
                      'flex-1 text-[13px] leading-relaxed break-words min-w-0',
                      item.done ? 'line-through text-gray-400 dark:text-obsidian-faded' : 'text-gray-800 dark:text-obsidian-fg',
                    )}
                    onDoubleClick={() => canEdit && !isPending && handleStartEdit(item)}
                    title={canEdit ? 'Double-click to edit' : undefined}
                  >
                    {item.text}
                  </span>
                  {canEdit && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(item)}
                        className="p-1 rounded text-gray-400 dark:text-obsidian-faded hover:bg-gray-200 dark:hover:bg-obsidian-border hover:text-gray-700 dark:hover:text-obsidian-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:opacity-100"
                        aria-label="Edit item"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        className="p-1 rounded text-gray-400 dark:text-obsidian-faded hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 focus-visible:opacity-100"
                        aria-label="Delete item"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="flex items-center gap-1.5 pt-1">
          <Plus size={13} className="text-gray-400 dark:text-obsidian-faded shrink-0" aria-hidden />
          <input
            type="text"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
            }}
            placeholder={addPlaceholder}
            disabled={isPending}
            maxLength={500}
            className="flex-1 bg-transparent border-0 px-1 py-1 text-[13px] text-gray-700 dark:text-obsidian-fg placeholder:text-gray-400 dark:placeholder:text-obsidian-faded focus:outline-none disabled:opacity-50"
          />
          {adding.trim() && (
            <button
              type="button"
              onClick={handleAdd}
              disabled={isPending}
              className="text-[11px] font-medium px-2 py-0.5 rounded bg-brand-500/10 text-brand-700 dark:text-brand-300 hover:bg-brand-500/20 transition-colors disabled:opacity-50"
            >
              Add
            </button>
          )}
        </div>
      )}
    </div>
  );
}
