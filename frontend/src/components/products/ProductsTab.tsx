import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Package, PauseCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, useConfirm, EmptyState } from '@/components/ui';
import { Can } from '@/components/auth/Can';
import { usePermission } from '@/hooks/usePermission';
import { useProducts, useDeleteProduct } from '@/hooks/useProducts';
import type { Product } from '@/api/products';
import { ProductFormModal } from './ProductFormModal';
import { cn } from '@/lib/cn';

/**
 * Admin Products tab — mounted inside ProjectDetailPage. Lists every
 * product on the project (ACTIVE + PAUSED by default; ARCHIVED hidden
 * behind a toggle), with a New-product CTA and a Pencil action per
 * card. Clicking a card navigates to the product detail page where
 * the team scopes a kanban + reviews bug submissions.
 *
 * The list uses the `taskCount` and `completionPct` aggregates the
 * service returns so the cards read substantive on a first paint
 * (vs. "0 tasks" while a follow-up fetch resolves).
 */
export function ProductsTab({ projectId, projectSlug }: { projectId: string; projectSlug?: string }) {
  void projectSlug; // currently unused — reserved for future slug-based deep links
  const [showArchived, setShowArchived] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const canCreate = usePermission('product.create');

  const { data: products, isLoading } = useProducts(projectId, { includeArchived: showArchived });

  return (
    <div className="space-y-5 animate-fade-in-down">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Products
          </h2>
          <p className="text-[12.5px] text-gray-500 dark:text-obsidian-muted mt-1 max-w-2xl leading-snug">
            The discrete shipping units inside this project. Each task can be scoped to a
            product so the kanban can be filtered + clients can target bug reports.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              'text-[11px] font-medium px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1',
              showArchived
                ? 'bg-gray-100 dark:bg-obsidian-raised text-gray-700 dark:text-obsidian-fg'
                : 'text-gray-500 dark:text-obsidian-muted hover:bg-gray-100 dark:hover:bg-obsidian-raised',
            )}
          >
            <ChevronDown size={11} className={cn('transition-transform', !showArchived && '-rotate-90')} />
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          <Can permission="product.create">
            <Button
              variant="primary"
              onClick={() => { setEditing(null); setFormOpen(true); }}
            >
              <Plus size={14} /> New product
            </Button>
          </Can>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
        </div>
      ) : (products ?? []).length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description="Create a product to organize tasks by shipping unit and let clients target bug submissions."
          // Only surface the CTA to roles who can actually create —
          // others see a plain empty state and ask their admin.
          action={canCreate ? {
            label: 'New product',
            onClick: () => { setEditing(null); setFormOpen(true); },
            icon: Plus,
          } : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(products ?? []).map((p) => (
            <ProductCard
              key={p.id}
              projectId={projectId}
              product={p}
              onEdit={() => { setEditing(p); setFormOpen(true); }}
            />
          ))}
        </div>
      )}

      <ProductFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        projectId={projectId}
        product={editing}
      />
    </div>
  );
}

/* ─── Product card ─────────────────────────────────────────────── */

function ProductCard({
  projectId, product, onEdit,
}: { projectId: string; product: Product; onEdit: () => void }) {
  const navigate = useNavigate();
  const deleteProduct = useDeleteProduct(projectId);
  const confirm = useConfirm();
  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const ok = await confirm({
      title: `Delete ${product.name}?`,
      body: 'Tasks scoped to this product will be unscoped (their tasks survive). This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete product',
    });
    if (ok) deleteProduct.mutate(product.id);
  };

  const isArchived = product.status === 'ARCHIVED';
  const isPaused = product.status === 'PAUSED';
  const accentColor = product.color && /^#[0-9a-fA-F]{6}$/.test(product.color) ? product.color : null;
  const taskCount = product.taskCount ?? 0;
  const completion = product.completionPct ?? 0;

  return (
    <Link
      to={`/projects/${projectId}/products/${product.id}`}
      onClick={(e) => {
        // If a child handler invoked stopPropagation (delete / edit), the
        // Link still navigates. Guard explicitly to keep those handlers
        // self-contained.
        if ((e.target as HTMLElement).closest('[data-card-action]')) {
          e.preventDefault();
        }
      }}
      className={cn(
        'group relative block rounded-2xl border p-5 transition-all duration-200',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'hover:shadow-lift dark:hover:shadow-lift-dark hover:border-brand-300/60 dark:hover:border-brand-500/30',
        'hover:-translate-y-0.5',
        isArchived && 'opacity-60',
      )}
    >
      {accentColor && (
        <span
          aria-hidden
          className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full"
          style={{ backgroundColor: accentColor }}
        />
      )}
      <div className={cn(accentColor && 'pl-2')}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{
                backgroundColor: accentColor ? accentColor + '20' : undefined,
                color: accentColor ?? undefined,
              }}
            >
              <Package size={16} className={accentColor ? '' : 'text-gray-500 dark:text-obsidian-muted'} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[14.5px] font-semibold text-gray-900 dark:text-obsidian-fg truncate group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
                {product.name}
              </h3>
              <p className="text-[11px] font-mono text-gray-400 dark:text-obsidian-faded truncate">
                {product.slug}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <Can permission="product.edit">
              <button
                type="button"
                data-card-action
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(); }}
                className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:text-obsidian-faded dark:hover:text-obsidian-fg hover:bg-gray-100 dark:hover:bg-obsidian-raised transition-colors"
                aria-label="Edit product"
                title="Edit product"
              >
                <Pencil size={13} />
              </button>
            </Can>
            <Can permission="product.delete">
              <button
                type="button"
                data-card-action
                onClick={handleDelete}
                className="p-1.5 rounded-md text-gray-400 hover:text-rose-600 dark:text-obsidian-faded dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                aria-label="Delete product"
                title="Delete product"
              >
                <Trash2 size={13} />
              </button>
            </Can>
          </div>
        </div>

        {/* Description / status note */}
        {product.description ? (
          <p className="text-[12.5px] text-gray-600 dark:text-obsidian-muted line-clamp-2 leading-snug mb-4">
            {product.description}
          </p>
        ) : (
          <p className="text-[12.5px] text-gray-400 dark:text-obsidian-faded italic mb-4">
            No description yet.
          </p>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
              Tasks
            </p>
            <p className="text-[18px] font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums leading-none mt-0.5">
              {taskCount}
            </p>
          </div>
          {taskCount > 0 && (
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
                Complete
              </p>
              <p className="text-[18px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums leading-none mt-0.5">
                {completion}%
              </p>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {(isArchived || isPaused) && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full',
                isArchived
                  ? 'bg-gray-100 text-gray-500 dark:bg-obsidian-raised dark:text-obsidian-muted'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
              )}>
                {isArchived ? 'Archived' : <><PauseCircle size={10} /> Paused</>}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); navigate(`/projects/${projectId}/products/${product.id}`); }}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 dark:text-brand-400 group-hover:gap-1.5 transition-all"
            >
              Open <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
