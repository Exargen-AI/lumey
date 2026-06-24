import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Trash2, AlertTriangle } from 'lucide-react';
import { useDeleteProject } from '@/hooks/useProjects';
import { Modal, Button } from '@/components/ui';

/**
 * Kebab menu next to the "Edit project" button on the project detail page,
 * plus the type-name-to-confirm modal it triggers.
 *
 * Hard delete on the backend cascades through every task / sprint / epic /
 * comment / decision / milestone / deliverable / member assignment under
 * the project. Modeled after GitHub's "delete repository" flow — the
 * destructive action is hidden behind a kebab, then a typed-name barrier
 * makes it impossible to one-click by accident.
 *
 * Visibility is owner-gated by the surrounding `<Can permission="project.delete">`
 * — this component does not check perms itself.
 */
interface Props {
  projectId: string;
  projectName: string;
}

export function DeleteProjectMenu({ projectId, projectName }: Props) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const deleteMut = useDeleteProject();

  // Close the kebab dropdown on outside-click. We deliberately don't use
  // `onBlur` here because clicking a menu item would race the blur and
  // sometimes swallow the click before the handler fires.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Exact-match gate. Comparing trimmed forms so an accidental trailing
  // space doesn't lock the button — but the underlying project name is
  // already trimmed at create-time, so this is belt-and-suspenders.
  const canConfirm = typed.trim() === projectName.trim() && !deleteMut.isPending;

  const onConfirm = () => {
    if (!canConfirm) return;
    setError(null);
    deleteMut.mutate(projectId, {
      onSuccess: () => {
        setConfirmOpen(false);
        // Project no longer exists — kick the user back to the list so
        // they don't see a 404 on the now-orphan URL.
        navigate('/projects');
      },
      onError: (err: any) => {
        setError(err?.response?.data?.error?.message || 'Failed to delete project. Please try again.');
      },
    });
  };

  const closeConfirm = () => {
    if (deleteMut.isPending) return; // don't let the user dismiss mid-request
    setConfirmOpen(false);
    setTyped('');
    setError(null);
  };

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 dark:text-obsidian-muted"
          title="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Project options"
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-1 z-30 min-w-[200px] rounded-md bg-white dark:bg-obsidian-panel border border-gray-200 dark:border-obsidian-border shadow-pop dark:shadow-pop-dark py-1"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
                setTyped('');
                setError(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/[0.08] text-left transition-colors"
            >
              <Trash2 size={14} /> Delete project
            </button>
          </div>
        )}
      </div>

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="Delete project"
        subtitle={projectName}
        accent="danger"
        footer={
          <>
            <Button variant="ghost" onClick={closeConfirm} disabled={deleteMut.isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={onConfirm}
              disabled={!canConfirm}
              loading={deleteMut.isPending}
            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete project'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-rose-50 dark:bg-rose-500/[0.08] border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 text-[12.5px] leading-relaxed">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              This permanently deletes the project and{' '}
              <strong>every task, sprint, epic, comment, decision, milestone, deliverable, and member assignment</strong>{' '}
              under it. This action cannot be undone.
            </div>
          </div>
          <div>
            <label htmlFor="delete-project-confirm" className="block text-[12px] font-medium text-gray-700 dark:text-obsidian-fg mb-1.5">
              Type{' '}
              <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg font-mono text-[12px]">
                {projectName}
              </code>{' '}
              to confirm:
            </label>
            <input
              id="delete-project-confirm"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder={projectName}
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 text-[13px] rounded-md border border-gray-300 dark:border-obsidian-border bg-white dark:bg-obsidian-panel text-gray-900 dark:text-obsidian-fg focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-300 dark:focus:border-rose-500 dark:focus:ring-rose-500/40"
            />
          </div>
          {error && (
            <div className="text-xs text-rose-700 dark:text-rose-300 px-1">{error}</div>
          )}
        </div>
      </Modal>
    </>
  );
}
