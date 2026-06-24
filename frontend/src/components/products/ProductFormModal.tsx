import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Modal, Field, Input, Textarea, Select, Button } from '@/components/ui';
import { useCreateProduct, useUpdateProduct } from '@/hooks/useProducts';
import type { Product, ProductStatus } from '@/api/products';
import { cn } from '@/lib/cn';

/**
 * Create / edit a Product. Used by the admin Products tab — the modal
 * doubles as create + edit because both flows share the same fields
 * and validation. Slug is auto-derived from the name on first edit
 * but stays manually editable afterwards.
 */

interface ProductFormModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Provide a product to edit; omit for the create flow. */
  product?: Product | null;
}

const STATUSES: { value: ProductStatus; label: string; hint: string }[] = [
  { value: 'ACTIVE',   label: 'Active',    hint: 'Shipping in the current cycle' },
  { value: 'PAUSED',   label: 'Paused',    hint: 'Between releases or on hold' },
  { value: 'ARCHIVED', label: 'Archived',  hint: 'Retired — kept for history' },
];

// Lightweight slug derivation. Lowercase, replace non-alphanumerics with
// hyphens, collapse repeats, trim hyphens. Maxes 50 chars; the
// validator on the server enforces the full pattern.
function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export function ProductFormModal({ open, onClose, projectId, product }: ProductFormModalProps) {
  const isEdit = !!product;
  const createProduct = useCreateProduct(projectId);
  const updateProduct = useUpdateProduct(projectId);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProductStatus>('ACTIVE');
  const [color, setColor] = useState('');
  const [icon, setIcon] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open / when product flips.
  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? '');
    setSlug(product?.slug ?? '');
    setDescription(product?.description ?? '');
    setStatus(product?.status ?? 'ACTIVE');
    setColor(product?.color ?? '');
    setIcon(product?.icon ?? '');
    setSlugTouched(isEdit); // edit mode: don't auto-rewrite the slug
    setError(null);
  }, [open, product, isEdit]);

  // Auto-derive slug from name while it hasn't been touched manually.
  useEffect(() => {
    if (!slugTouched) setSlug(deriveSlug(name));
  }, [name, slugTouched]);

  const pending = createProduct.isPending || updateProduct.isPending;
  const valid = useMemo(() => {
    if (name.trim().length === 0) return false;
    if (slug.length < 2) return false;
    // Same bounded slug pattern as backend's product.schema — no
    // catastrophic backtracking on the 50-char-capped input.
    // eslint-disable-next-line security/detect-unsafe-regex
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return false;
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return false;
    return true;
  }, [name, slug, color]);

  const submit = async () => {
    setError(null);
    try {
      if (isEdit) {
        await updateProduct.mutateAsync({
          productId: product!.id,
          input: {
            name: name.trim(),
            slug,
            description: description.trim() || null,
            status,
            color: color.trim() || null,
            icon: icon.trim() || null,
          },
        });
      } else {
        await createProduct.mutateAsync({
          name: name.trim(),
          slug,
          description: description.trim() || null,
          status,
          color: color.trim() || null,
          icon: icon.trim() || null,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not save the product. Try again?');
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) onClose(); }}
      title={isEdit ? `Edit ${product?.name}` : 'New product'}
      subtitle={isEdit ? 'Changes apply immediately to every task in this product.' : 'A new shipping unit inside this project. Tasks can be scoped to it.'}
      size="md"
      accent="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || pending}>
            {pending && <Loader2 size={13} className="animate-spin mr-1.5" />}
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Customer Web App"
            maxLength={80}
          />
        </Field>

        <Field
          label="Slug"
          hint="URL fragment + display id. Lowercase letters, digits, hyphens. Auto-derived from name."
        >
          <Input
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
            placeholder="customer-web"
            maxLength={50}
            className="font-mono"
          />
        </Field>

        <Field label="Description" hint="Optional. Surfaces on the product detail page.">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What is this product, and why does it exist?"
            maxLength={10_000}
          />
        </Field>

        {/* Status + Color — side-by-side on tablets, stacked on phones
            so the status hint text + color preview swatch don't squeeze. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-gray-400 dark:text-obsidian-faded">
              {STATUSES.find((s) => s.value === status)?.hint}
            </p>
          </Field>
          <Field label="Color" hint="Optional 6-digit hex. Tints the product chip on task cards.">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#8b5cf6"
                maxLength={7}
                className="font-mono"
              />
              <div
                className="w-8 h-8 rounded-md border border-gray-200 dark:border-obsidian-border shrink-0"
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'transparent' }}
                aria-hidden
              />
            </div>
          </Field>
        </div>

        {error && (
          <div className={cn(
            'flex items-start gap-2 text-[12px] rounded-md p-2.5',
            'bg-rose-50 text-rose-700 border border-rose-200',
            'dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
          )}>
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
