import api from './client';

export type ProductStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export interface Product {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProductStatus;
  order: number;
  color: string | null;
  icon: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Aggregates returned by the list endpoint. Absent on the single-get
  // response.
  taskCount?: number;
  doneCount?: number;
  completionPct?: number;
}

export interface CreateProductInput {
  name: string;
  slug: string;
  description?: string | null;
  status?: ProductStatus;
  order?: number;
  color?: string | null;
  icon?: string | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export async function listProducts(projectId: string, opts: { status?: ProductStatus; includeArchived?: boolean } = {}): Promise<Product[]> {
  const params: Record<string, string> = {};
  if (opts.status) params.status = opts.status;
  if (opts.includeArchived) params.includeArchived = 'true';
  const { data } = await api.get(`/projects/${projectId}/products`, { params });
  return data.data;
}

export async function getProduct(projectId: string, productId: string): Promise<Product> {
  const { data } = await api.get(`/projects/${projectId}/products/${productId}`);
  return data.data;
}

export async function createProduct(projectId: string, input: CreateProductInput): Promise<Product> {
  const { data } = await api.post(`/projects/${projectId}/products`, input);
  return data.data;
}

export async function updateProduct(projectId: string, productId: string, input: UpdateProductInput): Promise<Product> {
  const { data } = await api.put(`/projects/${projectId}/products/${productId}`, input);
  return data.data;
}

export async function deleteProduct(projectId: string, productId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/products/${productId}`);
}
