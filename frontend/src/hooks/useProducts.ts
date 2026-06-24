import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/products';
import type { CreateProductInput, ProductStatus, UpdateProductInput } from '@/api/products';

/**
 * List products for a project. Default view excludes ARCHIVED — pass
 * `includeArchived: true` for the admin retired-products section.
 */
export function useProducts(projectId: string, opts: { status?: ProductStatus; includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: ['products', projectId, opts.status ?? null, opts.includeArchived ?? false],
    queryFn: () => api.listProducts(projectId, opts),
    enabled: !!projectId,
  });
}

export function useProduct(projectId: string, productId: string | null | undefined) {
  return useQuery({
    queryKey: ['product', productId],
    queryFn: () => api.getProduct(projectId, productId!),
    enabled: !!projectId && !!productId,
  });
}

export function useCreateProduct(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) => api.createProduct(projectId, input),
    onSuccess: () => {
      // Any list view of this project's products needs to re-fetch;
      // task lists do not (creation alone doesn't affect them).
      qc.invalidateQueries({ queryKey: ['products', projectId] });
    },
  });
}

export function useUpdateProduct(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: UpdateProductInput }) =>
      api.updateProduct(projectId, productId, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['products', projectId] });
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
      // Tasks include the product mini-object on the card; an icon/color
      // change should propagate without forcing the user to reload.
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}

export function useDeleteProduct(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => api.deleteProduct(projectId, productId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products', projectId] });
      // Tasks whose productId pointed at the deleted product now have
      // productId=NULL; refresh the kanban so the product chip clears.
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}
