import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2, Search, ChevronRight, Layers } from 'lucide-react';
import { useProjectEpics, useDeleteEpic } from '@/hooks/useSprints';
import type { EpicSummary } from '@/api/sprints';
import { Button, Input, Badge, useConfirm } from '@/components/ui';
import { Can } from '@/components/auth/Can';
import { pluralize } from '@/lib/plural';
import { cn } from '@/lib/cn';
import { EpicFormModal } from './EpicFormModal';
import { EpicDetailPanel } from './EpicDetailPanel';

interface EpicListProps {
  projectId: string;
  /**
   * If true, the list is rendered without its own outer Card chrome — useful
   * when slotted inside a tab that already has padding.
   */
  inset?: boolean;
}

const STATUS_LABELS: Record<EpicSummary['status'], string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};
const STATUS_TONE: Record<EpicSummary['status'], 'neutral' | 'info' | 'success'> = {
  OPEN: 'neutral',
  IN_PROGRESS: 'info',
  DONE: 'success',
};

/**
 * Epic table for the project's "Epics" tab.
 *
 * Each row is dense and scannable: color stripe, title, status badge,
 * progress bar, points, blocker count, edit/delete actions. Click anywhere
 * (other than action buttons) to open the detail slide-over.
 *
 * Empty state nudges the user to create their first epic — epics are how
 * Linear/Jira/Height users break large projects into trackable threads.
 */
export function EpicList({ projectId, inset }: EpicListProps) {
  const { data: epics, isLoading } = useProjectEpics(projectId);
  const deleteMutation = useDeleteEpic(projectId);
  const confirm = useConfirm();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EpicSummary | null>(null);
  const [openEpicId, setOpenEpicId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!epics) return [];
    const q = search.trim().toLowerCase();
    if (!q) return epics;
    return epics.filter(
      (e: EpicSummary) =>
        e.title.toLowerCase().includes(q) ||
        (e.description ?? '').toLowerCase().includes(q),
    );
  }, [epics, search]);

  async function handleDelete(epic: EpicSummary) {
    const ok = await confirm({
      title: `Delete “${epic.title}”?`,
      body:
        epic.totalTasks > 0
          ? `This epic has ${pluralize(epic.totalTasks, 'task')}. Tasks will be unassigned from this epic, not deleted. This cannot be undone.`
          : 'This cannot be undone.',
      confirmLabel: 'Delete epic',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteMutation.mutateAsync(epic.id);
  }

  if (isLoading) {
    return (
      <div className={cn('space-y-2', !inset && 'p-1')}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-lg bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Toolbar — search + create */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 max-w-sm">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-obsidian-faded pointer-events-none"
          />
          <Input
            type="text"
            placeholder="Search epics…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-gray-400 dark:text-obsidian-faded">
            {epics && epics.length > 0 ? pluralize(epics.length, 'epic') : ''}
          </span>
          <Can permission="project.edit">
            <Button
              variant="primary"
              size="sm"
              leadingIcon={<Plus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              New epic
            </Button>
          </Can>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState
          searching={search.length > 0}
          onCreate={() => setCreateOpen(true)}
        />
      ) : (
        <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border overflow-hidden">
          <div
            className="grid items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-obsidian-border/60 bg-gray-50/60 dark:bg-obsidian-sunken/40 text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted"
            style={{ gridTemplateColumns: '4px 1fr 110px 200px 80px 80px' }}
            aria-hidden
          >
            <div />
            <div>Epic</div>
            <div>Status</div>
            <div>Progress</div>
            <div className="text-right">Points</div>
            <div className="text-right pr-1">Actions</div>
          </div>
          <ul role="list">
            {filtered.map((epic: EpicSummary) => (
              <EpicRow
                key={epic.id}
                epic={epic}
                onOpen={() => setOpenEpicId(epic.id)}
                onEdit={() => setEditing(epic)}
                onDelete={() => handleDelete(epic)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Modals */}
      <EpicFormModal
        projectId={projectId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <EpicFormModal
        projectId={projectId}
        open={!!editing}
        epic={editing}
        onClose={() => setEditing(null)}
      />
      <EpicDetailPanel
        epicId={openEpicId}
        onClose={() => setOpenEpicId(null)}
        onEdit={(e) => {
          setOpenEpicId(null);
          setEditing(e);
        }}
      />
    </>
  );
}

interface EpicRowProps {
  epic: EpicSummary;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function EpicRow({ epic, onOpen, onEdit, onDelete }: EpicRowProps) {
  return (
    <li
      className="grid items-center gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-obsidian-border/60 last:border-b-0 hover:bg-gray-50 dark:hover:bg-obsidian-raised/40 transition-colors group"
      style={{ gridTemplateColumns: '4px 1fr 110px 200px 80px 80px' }}
    >
      {/* Color stripe */}
      <button
        type="button"
        onClick={onOpen}
        className="h-9 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
        style={{ background: epic.color }}
        aria-label={`Open epic ${epic.title}`}
      />

      {/* Title + meta */}
      <button
        type="button"
        onClick={onOpen}
        className="text-left min-w-0 focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[13.5px] font-medium tracking-tight text-gray-900 dark:text-obsidian-fg truncate group-hover:text-brand-700 dark:group-hover:text-brand-200">
            {epic.title}
          </h3>
        </div>
        {epic.description && (
          <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5 truncate max-w-prose">
            {epic.description}
          </p>
        )}
      </button>

      {/* Status badge */}
      <div>
        <Badge tone={STATUS_TONE[epic.status]} size="sm">
          {STATUS_LABELS[epic.status]}
        </Badge>
      </div>

      {/* Progress: bar + percentage */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-gray-200 dark:bg-obsidian-border overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${epic.progressPct}%`,
              background: epic.color,
            }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-gray-600 dark:text-obsidian-fg w-9 text-right">
          {epic.progressPct}%
        </span>
      </div>

      {/* Points done / total */}
      <div className="text-right text-[12px] tabular-nums">
        <span className="font-medium text-gray-900 dark:text-obsidian-fg">{epic.donePoints}</span>
        <span className="text-gray-400 dark:text-obsidian-faded">/{epic.totalPoints}</span>
      </div>

      {/* Actions — visible on hover or focus */}
      <div className="flex justify-end items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <Can permission="project.edit">
          <button
            type="button"
            onClick={onEdit}
            className="p-1.5 rounded-md hover:bg-gray-200 dark:hover:bg-obsidian-border text-gray-500 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            aria-label="Edit epic"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-rose-500/15 text-gray-500 dark:text-obsidian-muted hover:text-rose-600 dark:hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
            aria-label="Delete epic"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </Can>
        <ChevronRight
          size={14}
          className="text-gray-300 dark:text-obsidian-faded ml-1"
          aria-hidden="true"
        />
      </div>
    </li>
  );
}

function EmptyState({ searching, onCreate }: { searching: boolean; onCreate: () => void }) {
  if (searching) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-6 text-center">
        <p className="text-sm text-gray-500 dark:text-obsidian-muted">
          No epics match your search.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-10 text-center">
      <div className="w-10 h-10 mx-auto rounded-full bg-brand-500/10 ring-1 ring-brand-500/20 flex items-center justify-center mb-3">
        <Layers size={18} className="text-brand-600 dark:text-brand-300" />
      </div>
      <h3 className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg">
        No epics yet
      </h3>
      <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-1 max-w-sm mx-auto">
        Epics are how you break a large body of work into a coherent set of stories. Create one for each major thread you're shipping.
      </p>
      <Can permission="project.edit">
        <div className="mt-4">
          <Button variant="primary" size="sm" leadingIcon={<Plus size={14} />} onClick={onCreate}>
            Create your first epic
          </Button>
        </div>
      </Can>
    </div>
  );
}
