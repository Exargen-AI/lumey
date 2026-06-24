import { Prisma, ProductStatus } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';

/**
 * Product CRUD service. Mirrors the shape of decision.service.ts +
 * milestone.service.ts so cross-feature reading stays cheap.
 *
 * Per-product task counts are included in the list response so the UI
 * doesn't need a second round-trip to render "Customer Web · 12 tasks"
 * on every card. The Prisma `_count` selector is the cheap path; for
 * larger lists we'd switch to a single aggregate query, but at the
 * expected scale (single-digit-to-low-double-digit products per
 * project) per-row count is fine.
 */

export interface ListProductsOptions {
  status?: ProductStatus;
  /** When true, include ARCHIVED products. Default false. */
  includeArchived?: boolean;
}

export async function listProducts(projectId: string, opts: ListProductsOptions = {}) {
  const where: Prisma.ProductWhereInput = { projectId };

  if (opts.status) {
    where.status = opts.status;
  } else if (!opts.includeArchived) {
    // Default view: hide ARCHIVED. ACTIVE + PAUSED are surfaced.
    where.status = { not: ProductStatus.ARCHIVED };
  }

  const products = await prisma.product.findMany({
    where,
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: {
          tasks: true,
        },
      },
    },
  });

  // Derive a "completion %" per product from task status. We split tasks
  // into done vs not — story-points-weighted is the *better* metric but
  // would require an additional aggregate; v1 keeps it simple, and the
  // Insights page is where the deeper analytics live.
  // Done in one COUNT query rather than fetching every task row.
  const productIds = products.map((p) => p.id);
  const doneCounts = productIds.length === 0 ? [] : await prisma.task.groupBy({
    by: ['productId', 'status'],
    where: { productId: { in: productIds } },
    _count: { _all: true },
  });
  const doneByProduct = new Map<string, number>();
  const totalByProduct = new Map<string, number>();
  for (const row of doneCounts) {
    if (!row.productId) continue;
    const c = row._count._all;
    totalByProduct.set(row.productId, (totalByProduct.get(row.productId) ?? 0) + c);
    if (row.status === 'DONE') {
      doneByProduct.set(row.productId, (doneByProduct.get(row.productId) ?? 0) + c);
    }
  }

  return products.map((p) => {
    const total = totalByProduct.get(p.id) ?? 0;
    const done = doneByProduct.get(p.id) ?? 0;
    return {
      ...p,
      taskCount: p._count.tasks,
      doneCount: done,
      // 0 when there are no tasks — the UI renders this as "—" so a
      // brand-new product doesn't read as "0% done".
      completionPct: total === 0 ? 0 : Math.round((done / total) * 100),
    };
  });
}

export async function getProduct(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      _count: { select: { tasks: true } },
    },
  });
  if (!product) throw new NotFoundError('Product');
  return product;
}

export async function createProduct(
  projectId: string,
  data: {
    name: string;
    slug: string;
    description?: string | null;
    status?: ProductStatus;
    order?: number;
    color?: string | null;
    icon?: string | null;
  },
  userId: string,
) {
  // Pre-check slug uniqueness scoped to this project. Prisma surfaces
  // a P2002 we'd convert to a 500 otherwise; intercepting here lets us
  // return a clean validation error.
  const conflict = await prisma.product.findUnique({
    where: { projectId_slug: { projectId, slug: data.slug } },
    select: { id: true },
  });
  if (conflict) {
    throw new ValidationError(`A product with slug "${data.slug}" already exists in this project`);
  }

  const product = await prisma.product.create({
    data: {
      projectId,
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      status: data.status ?? 'ACTIVE',
      order: data.order ?? 0,
      color: data.color ?? null,
      icon: data.icon ?? null,
    },
  });

  await logActivity({
    userId,
    projectId,
    action: 'created_product',
    targetType: 'product',
    targetId: product.id,
    details: { name: product.name, slug: product.slug },
  });

  return product;
}

export async function updateProduct(
  productId: string,
  data: {
    name?: string;
    slug?: string;
    description?: string | null;
    status?: ProductStatus;
    order?: number;
    color?: string | null;
    icon?: string | null;
  },
  userId: string,
) {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) throw new NotFoundError('Product');

  if (data.slug && data.slug !== existing.slug) {
    const conflict = await prisma.product.findUnique({
      where: { projectId_slug: { projectId: existing.projectId, slug: data.slug } },
      select: { id: true },
    });
    if (conflict && conflict.id !== productId) {
      throw new ValidationError(`A product with slug "${data.slug}" already exists in this project`);
    }
  }

  // ARCHIVED transition: stamp archivedAt for forensic ordering on the
  // admin "show retired products" view. Setting back to ACTIVE/PAUSED
  // clears it — un-archive is fine.
  const isArchiving = data.status === 'ARCHIVED' && existing.status !== 'ARCHIVED';
  const isUnarchiving = data.status && data.status !== 'ARCHIVED' && existing.status === 'ARCHIVED';

  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      ...data,
      ...(isArchiving && { archivedAt: new Date() }),
      ...(isUnarchiving && { archivedAt: null }),
    },
  });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'updated_product',
    targetType: 'product',
    targetId: productId,
    details: {
      name: product.name,
      ...(data.status && { statusChange: { from: existing.status, to: data.status } }),
    },
  });

  return product;
}

export async function deleteProduct(productId: string, userId: string) {
  const existing = await prisma.product.findUnique({ where: { id: productId } });
  if (!existing) throw new NotFoundError('Product');

  // Tasks pointing at this product have their `productId` SET to NULL
  // automatically via the FK rule. We don't need to count them up here —
  // the cascade is part of the DB contract and the operator who confirms
  // the delete in the UI is already shown the count.
  await prisma.product.delete({ where: { id: productId } });

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'deleted_product',
    targetType: 'product',
    targetId: productId,
    details: { name: existing.name, slug: existing.slug },
  });
}
