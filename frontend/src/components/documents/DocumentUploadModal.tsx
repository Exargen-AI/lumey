import { useState, useRef, useCallback } from 'react';
import { Upload, FileText, AlertCircle, X } from 'lucide-react';
import { Modal, Button, Input } from '@/components/ui';
import { useUploadDocument } from '@/hooks/useProjectDocuments';
import type { DocCategory } from '@/api/projectDocuments';
import { cn } from '@/lib/cn';

/**
 * Document upload modal. Drag-drop or click-to-pick file, fill in title +
 * optional description + category, hit upload. Shows byte progress on the
 * S3 PUT step (the part that takes time) and surfaces server errors
 * verbatim — they're already user-readable (validation messages from the
 * service layer).
 *
 * Closes automatically on success after a brief "uploaded" flash so the
 * user sees confirmation.
 */

const CATEGORIES: { value: DocCategory; label: string; hint: string }[] = [
  { value: 'SPEC',      label: 'Spec',      hint: 'Product or technical specification' },
  { value: 'DESIGN',    label: 'Design',    hint: 'Mockups, design briefs, wireframes' },
  { value: 'CONTRACT',  label: 'Contract',  hint: 'Agreements, SOWs, partner contracts' },
  { value: 'REFERENCE', label: 'Reference', hint: 'Background reading, prior art' },
  { value: 'RUNBOOK',   label: 'Runbook',   hint: 'Operational procedures, playbooks' },
  { value: 'SECURITY',  label: 'Security',  hint: 'Policies, audits, compliance docs' },
  { value: 'OTHER',     label: 'Other',     hint: 'Anything that doesn\'t fit above' },
];

const MAX_BYTES = 52_428_800; // 50 MiB; matches backend env default

export function DocumentUploadModal({
  open, onClose, projectId,
}: { open: boolean; onClose: () => void; projectId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DocCategory>('OTHER');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLLabelElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setTitle('');
    setDescription('');
    setCategory('OTHER');
    setProgress(0);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    if (mutation.isPending) return; // don't close mid-upload
    reset();
    onClose();
  }, [onClose, reset]);

  const mutation = useUploadDocument(projectId);

  const pickFile = useCallback((f: File | null) => {
    setError(null);
    if (!f) { setFile(null); return; }
    if (f.size > MAX_BYTES) {
      setError(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB — limit is ${MAX_BYTES / 1024 / 1024} MB`);
      return;
    }
    setFile(f);
    // Use filename (minus extension) as the default title if user hasn't typed anything
    if (!title) {
      const base = f.name.replace(/\.[^.]+$/, '');
      setTitle(base);
    }
  }, [title]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.remove('ring-2', 'ring-brand-400');
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }, [pickFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.add('ring-2', 'ring-brand-400');
  }, []);

  const handleDragLeave = useCallback(() => {
    dropRef.current?.classList.remove('ring-2', 'ring-brand-400');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Pick a file first');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setError(null);
    try {
      await mutation.mutateAsync({
        file,
        title: title.trim(),
        description: description.trim() || null,
        category,
        onProgress: setProgress,
      });
      // brief success flash, then close
      setTimeout(() => {
        handleClose();
      }, 400);
    } catch (err: any) {
      setError(
        err?.response?.data?.error?.message
          ?? err?.message
          ?? 'Upload failed. Try again.',
      );
      setProgress(0);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Upload document"
      subtitle="Specs, designs, contracts, runbooks — anything the team needs to reference on this project."
      size="lg"
      hideClose={mutation.isPending}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* File picker / drop zone */}
        <label
          ref={dropRef}
          htmlFor="doc-file-input"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'relative block rounded-xl border-2 border-dashed cursor-pointer transition-all',
            'border-gray-200 dark:border-obsidian-border',
            'bg-gray-50/40 dark:bg-obsidian-sunken/40',
            'hover:border-brand-300 dark:hover:border-brand-500/50',
            'p-6',
          )}
        >
          <input
            ref={fileInputRef}
            id="doc-file-input"
            type="file"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            disabled={mutation.isPending}
          />
          {file ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-100 dark:bg-brand-500/20 flex items-center justify-center shrink-0">
                <FileText size={18} className="text-brand-600 dark:text-brand-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg truncate">{file.name}</p>
                <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-0.5">
                  {prettyBytes(file.size)} · {file.type || 'unknown type'}
                </p>
              </div>
              {!mutation.isPending && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:text-obsidian-faded dark:hover:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-panel transition-colors"
                  aria-label="Remove file"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center text-center py-3">
              <Upload size={20} className="text-gray-400 dark:text-obsidian-faded mb-2" />
              <p className="text-[13px] font-medium text-gray-700 dark:text-obsidian-fg">
                Drop a file here, or click to pick
              </p>
              <p className="text-[11px] text-gray-500 dark:text-obsidian-muted mt-1">
                PDF, Markdown, text, images, .docx, .xlsx, .pptx — up to {MAX_BYTES / 1024 / 1024} MB
              </p>
            </div>
          )}
        </label>

        {/* Title */}
        <div>
          <label htmlFor="doc-title" className="block text-[12px] font-medium text-gray-700 dark:text-obsidian-muted mb-1.5">
            Title
          </label>
          <Input
            id="doc-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q3 partner data-sharing agreement"
            maxLength={200}
            disabled={mutation.isPending}
            autoFocus={!!file}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="doc-description" className="block text-[12px] font-medium text-gray-700 dark:text-obsidian-muted mb-1.5">
            Description <span className="font-normal text-gray-400 dark:text-obsidian-faded">(optional — what's this doc for?)</span>
          </label>
          <textarea
            id="doc-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Two paragraphs is plenty. Helps the team find this later."
            rows={3}
            maxLength={2000}
            disabled={mutation.isPending}
            className={cn(
              'w-full rounded-md border bg-white dark:bg-obsidian-bg',
              'border-gray-300 dark:border-obsidian-border',
              'text-[13px] text-gray-900 dark:text-obsidian-fg',
              'placeholder:text-gray-400 dark:placeholder:text-obsidian-faded',
              'px-3 py-2 resize-y',
              'focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent',
              'disabled:opacity-60',
            )}
          />
        </div>

        {/* Category */}
        <div>
          <label className="block text-[12px] font-medium text-gray-700 dark:text-obsidian-muted mb-1.5">Category</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                disabled={mutation.isPending}
                title={c.hint}
                className={cn(
                  'rounded-md border px-3 py-2 text-[12px] font-medium text-left transition-colors',
                  category === c.value
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'border-gray-200 dark:border-obsidian-border text-gray-700 dark:text-obsidian-muted hover:border-gray-300 dark:hover:border-obsidian-border-strong',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar — only while uploading */}
        {mutation.isPending && (
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="text-gray-500 dark:text-obsidian-muted font-medium">Uploading…</span>
              <span className="text-gray-700 dark:text-obsidian-fg tabular-nums">{progress}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full overflow-hidden bg-gray-100 dark:bg-obsidian-raised">
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 px-3 py-2.5">
            <AlertCircle size={14} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[12px] text-rose-700 dark:text-rose-200 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-obsidian-border">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !file || !title.trim()} loading={mutation.isPending}>
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
