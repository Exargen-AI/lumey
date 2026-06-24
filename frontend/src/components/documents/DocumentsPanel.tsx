import { useState } from 'react';
import { Plus, FileText, Download, Trash2, AlertCircle } from 'lucide-react';
import { Button, useConfirm } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useProjectDocuments, useDeleteDocument, downloadDocument } from '@/hooks/useProjectDocuments';
import type { ProjectDocument, DocCategory } from '@/api/projectDocuments';
import { DocumentUploadModal } from './DocumentUploadModal';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/formatters';

/**
 * Reusable Documents panel. Shows the list of READY documents for a
 * project and (for users with document.upload) lets them add more.
 * Delete is gated visually too — only the uploader OR a user with
 * document.delete sees the trash icon.
 *
 * Used by:
 *   - Client portal Documents section (/client/projects/:id/documents)
 *   - Admin project detail page (forthcoming follow-up)
 *
 * The panel handles its own modal state and react-query mutations so
 * callers just drop it in with a projectId.
 */
export function DocumentsPanel({ projectId }: { projectId: string }) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const { user, permissions } = useAuthStore();
  const { data: documents, isLoading, error } = useProjectDocuments(projectId);
  const deleteMut = useDeleteDocument(projectId);
  const confirm = useConfirm();

  // String-literal permission keys — same shape backend issues. Avoids a
  // hard import on shared/PERMISSIONS that's harder to land independently.
  const canUpload = permissions.includes('document.upload');
  const canDeleteAny = permissions.includes('document.delete');

  const handleDelete = async (doc: ProjectDocument) => {
    const ok = await confirm({
      title: `Delete "${doc.title}"?`,
      body: 'The document is removed from this project. The team will no longer see it on Command Center, and AI agents will lose access to it on the next task.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    deleteMut.mutate(doc.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-obsidian-fg">All documents</h2>
          <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5">
            {documents?.length
              ? `${documents.length} ${documents.length === 1 ? 'document' : 'documents'} shared with the team`
              : 'Nothing here yet'}
          </p>
        </div>
        {canUpload && (
          <Button onClick={() => setUploadOpen(true)} leadingIcon={<Plus size={14} />}>
            Upload
          </Button>
        )}
      </div>

      {/* List body — three states: loading / error / list (with empty fallback) */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-lg" />)}
        </div>
      ) : error ? (
        <ErrorState message={(error as any)?.response?.data?.error?.message ?? 'Could not load documents'} />
      ) : !documents || documents.length === 0 ? (
        <EmptyState canUpload={canUpload} onUpload={() => setUploadOpen(true)} />
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-obsidian-border rounded-xl border border-gray-200 dark:border-obsidian-border overflow-hidden bg-white dark:bg-obsidian-panel">
          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              projectId={projectId}
              doc={doc}
              canDelete={canDeleteAny || doc.uploadedBy.id === user?.id}
              onDelete={() => handleDelete(doc)}
            />
          ))}
        </ul>
      )}

      <DocumentUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}

/* ─── One row ─── */
function DocumentRow({
  projectId, doc, canDelete, onDelete,
}: {
  projectId: string;
  doc: ProjectDocument;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadDocument(projectId, doc.id);
    } catch (err) {
      // Could surface a toast here; for now we just stop the spinner.
      console.error('Download failed', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-obsidian-raised/40 transition-colors flex items-center gap-4">
      <div className="w-9 h-9 rounded-lg bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center shrink-0">
        <FileText size={16} className="text-brand-600 dark:text-brand-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{doc.title}</span>
          <CategoryPill category={doc.category} />
        </div>
        {doc.description && (
          <p className="text-[12px] text-gray-500 dark:text-obsidian-muted mt-0.5 truncate">
            {doc.description}
          </p>
        )}
        <p className="text-[11px] text-gray-400 dark:text-obsidian-faded mt-1">
          {prettyBytes(doc.sizeBytes)} · uploaded by {doc.uploadedBy.name} · {formatRelative(doc.uploadedAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="p-2 rounded-md text-gray-500 hover:text-brand-700 dark:text-obsidian-muted dark:hover:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-colors disabled:opacity-50"
          aria-label={`Download ${doc.title}`}
          title="Download"
        >
          <Download size={15} />
        </button>
        {canDelete && (
          <button
            onClick={onDelete}
            className="p-2 rounded-md text-gray-400 hover:text-rose-600 dark:text-obsidian-faded dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
            aria-label={`Delete ${doc.title}`}
            title="Delete"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </li>
  );
}

/* ─── Bits ─── */

const CATEGORY_STYLES: Record<DocCategory, string> = {
  SPEC:      'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  DESIGN:    'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  CONTRACT:  'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  REFERENCE: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  RUNBOOK:   'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  SECURITY:  'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  OTHER:     'bg-gray-100 text-gray-700 dark:bg-obsidian-raised dark:text-obsidian-muted',
};

function CategoryPill({ category }: { category: DocCategory }) {
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
      CATEGORY_STYLES[category],
    )}>
      {category}
    </span>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-3 py-2.5">
      <AlertCircle size={14} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
      <p className="text-[12px] text-rose-700 dark:text-rose-200">{message}</p>
    </div>
  );
}

function EmptyState({ canUpload, onUpload }: { canUpload: boolean; onUpload: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-obsidian-border bg-white/40 dark:bg-obsidian-sunken/40 px-6 py-10 text-center">
      <div className="inline-flex w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-500/10 items-center justify-center mb-3">
        <FileText size={18} className="text-brand-600 dark:text-brand-400" />
      </div>
      <p className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">No documents yet</p>
      <p className="mt-1.5 text-[12px] text-gray-500 dark:text-obsidian-muted max-w-md mx-auto leading-relaxed">
        Upload specs, designs, contracts, runbooks, or any other project context here. The team will see them on Command Center, and AI agents working on this project can read them as they pick up tasks.
      </p>
      {canUpload && (
        <div className="mt-4">
          <Button onClick={onUpload} leadingIcon={<Plus size={14} />}>
            Upload your first document
          </Button>
        </div>
      )}
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
