import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bug as BugIcon, Package, PauseCircle, Pencil, Plus,
  Sparkles, ListChecks,
} from 'lucide-react';
import { Button, useConfirm } from '@/components/ui';
import { Can } from '@/components/auth/Can';
import { useProject } from '@/hooks/useProjects';
import { useProduct, useDeleteProduct } from '@/hooks/useProducts';
import { useTasks } from '@/hooks/useTasks';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { ProductFormModal } from '@/components/products/ProductFormModal';
import { BugSubmissionModal } from '@/components/bugs/BugSubmissionModal';
import { cn } from '@/lib/cn';

/**
 * Admin Product Detail page — `/projects/:id/products/:productId`.
 *
 * Sections:
 *   1. Slim header: back link, product name + slug + status, edit/delete
 *      kebab, "Submit a bug" CTA (auto-scopes to this product).
 *   2. Compact stats strip (tasks, completion, bug count) so the team
 *      reads the product's load at a glance.
 *   3. Embedded KanbanBoard scoped to this product via the new
 *      `productId` prop — the board fetches a product-filtered task
 *      list and quick-add auto-scopes new tasks to the same product.
 */
export function ProductDetailPage() {
  const { id: projectId, productId } = useParams<{ id: string; productId: string }>();
  const navigate = useNavigate();
  const { data: project } = useProject(projectId!);
  const { data: product, isLoading: productLoading } = useProduct(projectId!, productId);
  // Pre-filtered task list — same params the KanbanBoard inside uses,
  // so react-query dedupes and the stats strip stays in lockstep with
  // the board.
  const { data: tasks } = useTasks(projectId!, productId ? { productId } : undefined);

  const [editOpen, setEditOpen] = useState(false);
  const [bugOpen, setBugOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const taskSiblings = (tasks ?? []).map((t: any) => t.id);

  const deleteProduct = useDeleteProduct(projectId!);
  const confirm = useConfirm();

  const handleDelete = async () => {
    if (!product) return;
    const ok = await confirm({
      title: `Delete ${product.name}?`,
      body: 'Tasks scoped to this product will be unscoped (their data survives). This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete product',
    });
    if (ok) {
      deleteProduct.mutate(product.id, {
        onSuccess: () => navigate(`/projects/${projectId}`),
      });
    }
  };

  if (productLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-1/3 rounded" />
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-96 rounded-2xl" />
      </div>
    );
  }
  if (!product) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">
        Product not found.
      </div>
    );
  }

  const accentColor = product.color && /^#[0-9a-fA-F]{6}$/.test(product.color) ? product.color : null;
  const totalTasks = (tasks ?? []).length;
  const doneTasks = (tasks ?? []).filter((t: any) => t.status === 'DONE').length;
  const bugs = (tasks ?? []).filter((t: any) => t.taskType === 'BUG').length;
  const openBugs = (tasks ?? []).filter((t: any) => t.taskType === 'BUG' && t.status !== 'DONE').length;
  const completionPct = totalTasks === 0 ? 0 : Math.round((doneTasks / totalTasks) * 100);

  return (
    <div className="space-y-5 animate-fade-in-down">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="p-1.5 -ml-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-obsidian-raised text-gray-400 dark:text-obsidian-muted shrink-0 mt-0.5"
            aria-label="Back to project"
          >
            <ArrowLeft size={18} />
          </button>
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              backgroundColor: accentColor ? accentColor + '20' : undefined,
              color: accentColor ?? undefined,
            }}
          >
            <Package size={18} className={accentColor ? '' : 'text-gray-500 dark:text-obsidian-muted'} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg truncate">
                {product.name}
              </h1>
              <span className="text-[11px] font-mono text-gray-400 dark:text-obsidian-faded">{product.slug}</span>
              {product.status === 'PAUSED' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5">
                  <PauseCircle size={10} /> Paused
                </span>
              )}
              {product.status === 'ARCHIVED' && (
                <span className="text-[10px] font-semibold uppercase tracking-wider rounded-full bg-gray-100 text-gray-500 dark:bg-obsidian-raised dark:text-obsidian-muted px-2 py-0.5">
                  Archived
                </span>
              )}
            </div>
            {project?.name && (
              <p className="text-[11.5px] text-gray-500 dark:text-obsidian-muted mt-0.5 truncate">
                in {project.name}
              </p>
            )}
            {product.description && (
              <p className="text-[12.5px] text-gray-600 dark:text-obsidian-muted mt-2 max-w-2xl leading-snug">
                {product.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            onClick={() => setBugOpen(true)}
            title="Report a bug for this product"
          >
            <BugIcon size={14} /> Submit a bug
          </Button>
          <Can permission="product.edit">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:text-obsidian-faded dark:hover:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised transition-colors"
              aria-label="Edit product"
              title="Edit product"
            >
              <Pencil size={15} />
            </button>
          </Can>
          <Can permission="product.delete">
            <button
              type="button"
              onClick={handleDelete}
              className="p-1.5 rounded-md text-gray-400 hover:text-rose-600 dark:text-obsidian-faded dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
              aria-label="Delete product"
              title="Delete product"
            >
              <Plus size={15} className="rotate-45" />
            </button>
          </Can>
        </div>
      </div>

      {/* ─── Stats strip ─── */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Tasks" value={totalTasks} icon={<ListChecks size={13} />} tone="neutral" />
        <Stat label="Completion" value={`${completionPct}%`} icon={<Sparkles size={13} />} tone="brand" />
        <Stat
          label="Bugs"
          value={bugs}
          icon={<BugIcon size={13} />}
          tone={openBugs > 0 ? 'rose' : 'emerald'}
          sub={openBugs > 0 ? `${openBugs} open` : 'all closed'}
        />
        <Stat label="Status" value={product.status} icon={<Package size={13} />} tone="neutral" />
      </section>

      {/* ─── Product-scoped kanban ─── */}
      <KanbanBoard
        projectId={projectId!}
        productId={product.id}
        onTaskClick={(taskId) => setOpenTaskId(taskId)}
      />

      {/* Slide-over for task detail */}
      {openTaskId && (
        <TaskDetailModal
          taskId={openTaskId}
          projectId={projectId!}
          onClose={() => setOpenTaskId(null)}
          siblings={taskSiblings}
          onNavigate={(newId) => setOpenTaskId(newId)}
        />
      )}

      <ProductFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        projectId={projectId!}
        product={product}
      />

      <BugSubmissionModal
        open={bugOpen}
        onClose={() => setBugOpen(false)}
        projectId={projectId!}
        defaultProductId={product.id}
        // Admin pages don't force client-request flag; team users
        // submitting bugs themselves shouldn't be treated as client-
        // request workflow.
      />
    </div>
  );
}

function Stat({
  label, value, icon, tone, sub,
}: { label: string; value: string | number; icon: React.ReactNode; tone: 'neutral' | 'brand' | 'rose' | 'emerald'; sub?: string }) {
  const accent: Record<string, { text: string; bar: string }> = {
    neutral: { text: 'text-gray-700 dark:text-obsidian-fg',   bar: 'bg-gray-300 dark:bg-obsidian-faded' },
    brand:   { text: 'text-brand-700 dark:text-brand-300',    bar: 'bg-brand-500' },
    rose:    { text: 'text-rose-700 dark:text-rose-300',      bar: 'bg-rose-500' },
    emerald: { text: 'text-emerald-700 dark:text-emerald-300', bar: 'bg-emerald-500' },
  };
  return (
    <div className={cn(
      'relative rounded-xl border p-3 overflow-hidden',
      'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
      'shadow-soft dark:shadow-soft-dark',
    )}>
      <span className={cn('absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full', accent[tone].bar)} />
      <div className="ml-2">
        <div className="flex items-center gap-1.5 text-gray-500 dark:text-obsidian-muted">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{label}</span>
        </div>
        <p className={cn('mt-1 text-[20px] font-semibold tabular-nums leading-none', accent[tone].text)}>
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-[11px] text-gray-500 dark:text-obsidian-muted">{sub}</p>
        )}
      </div>
    </div>
  );
}
