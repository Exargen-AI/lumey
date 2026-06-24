import { useParams, Link } from 'react-router-dom';
import { ArrowRight, Bug as BugIcon, Package, PauseCircle, Sparkles, ListChecks } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { useProducts } from '@/hooks/useProducts';
import type { Product } from '@/api/products';
import { cn } from '@/lib/cn';

/**
 * Client Products section — `/client/projects/:id/products`.
 *
 * Read-only catalogue: each product shows description + open task /
 * completion stats + open bug count. Clients click through to a
 * product detail page that gives them a scoped board + a "Submit a bug"
 * affordance (the more important client surface).
 *
 * No create/edit/delete here — the product taxonomy is owned by the
 * team. Clients tag bugs against products; they don't shape them.
 */
export function ClientProductsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading: projectLoading } = useProject(id!);
  const { data: products, isLoading: productsLoading } = useProducts(id!);

  if (projectLoading || productsLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-6 rounded w-40" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-36 rounded-2xl" />)}
        </div>
      </div>
    );
  }
  if (!project) return null;

  const list = products ?? [];

  return (
    <div className="space-y-6 animate-fade-in-down">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
          Products
        </h1>
        <p className="mt-1.5 text-sm text-gray-500 dark:text-obsidian-muted max-w-2xl">
          The shipping units inside this project. Click into a product to see
          its work in progress and submit bugs scoped to it.
        </p>
      </header>

      {list.length === 0 ? (
        <div className={cn(
          'rounded-2xl border-2 border-dashed py-14 text-center',
          'border-gray-200 dark:border-obsidian-border',
          'bg-white/40 dark:bg-obsidian-panel/40',
        )}>
          <Package size={28} className="mx-auto text-gray-300 dark:text-obsidian-faded mb-3" />
          <p className="text-sm text-gray-500 dark:text-obsidian-muted">
            No products have been set up on this project yet.
          </p>
          <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">
            Once the team adds products, they'll show up here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {list.map((p) => <ClientProductCard key={p.id} projectId={id!} product={p} />)}
        </div>
      )}
    </div>
  );
}

function ClientProductCard({ projectId, product }: { projectId: string; product: Product }) {
  const isPaused = product.status === 'PAUSED';
  const accentColor = product.color && /^#[0-9a-fA-F]{6}$/.test(product.color) ? product.color : null;
  const taskCount = product.taskCount ?? 0;
  const completion = product.completionPct ?? 0;

  return (
    <Link
      to={`/client/projects/${projectId}/products/${product.id}`}
      className={cn(
        'group relative block rounded-2xl border p-5 transition-all duration-200',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'hover:shadow-lift dark:hover:shadow-lift-dark hover:border-brand-300/60 dark:hover:border-brand-500/30',
        'hover:-translate-y-0.5',
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
        <div className="flex items-start gap-3 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
            style={{
              backgroundColor: accentColor ? accentColor + '20' : undefined,
              color: accentColor ?? undefined,
            }}
          >
            <Package size={16} className={accentColor ? '' : 'text-gray-500 dark:text-obsidian-muted'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14.5px] font-semibold text-gray-900 dark:text-obsidian-fg truncate group-hover:text-brand-700 dark:group-hover:text-brand-300 transition-colors">
              {product.name}
            </h3>
            {isPaused && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5 mt-1">
                <PauseCircle size={9} /> Paused
              </span>
            )}
          </div>
        </div>

        {product.description ? (
          <p className="text-[12.5px] text-gray-600 dark:text-obsidian-muted line-clamp-2 leading-snug mb-4">
            {product.description}
          </p>
        ) : (
          <p className="text-[12.5px] text-gray-400 dark:text-obsidian-faded italic mb-4">
            No description yet.
          </p>
        )}

        <div className="flex items-center gap-5">
          <div>
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
              <ListChecks size={10} /> Tasks
            </p>
            <p className="text-[16px] font-semibold text-gray-900 dark:text-obsidian-fg tabular-nums leading-none mt-0.5">
              {taskCount}
            </p>
          </div>
          {taskCount > 0 && (
            <div>
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
                <Sparkles size={10} /> Done
              </p>
              <p className="text-[16px] font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums leading-none mt-0.5">
                {completion}%
              </p>
            </div>
          )}
          <div className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 dark:text-brand-400 group-hover:gap-1.5 transition-all">
            <BugIcon size={12} /> Submit a bug
            <ArrowRight size={12} />
          </div>
        </div>
      </div>
    </Link>
  );
}
