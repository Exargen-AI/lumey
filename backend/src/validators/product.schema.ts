import { z } from 'zod';
import { ProductStatus } from '@prisma/client';

// URL-safe slug: lowercase letters, digits, hyphens, no leading/trailing
// hyphen, min 2 chars. Project-scoped uniqueness is enforced at the DB
// level by the (projectId, slug) unique index.
const slugSchema = z
  .string()
  .min(2, 'Slug must be at least 2 characters')
  .max(50, 'Slug cannot exceed 50 characters')
  // Length-capped at 50 chars by .max() above; the inner `[a-z0-9-]*` has
  // no overlap with the trailing `[a-z0-9]` quantifier (no nested
  // quantifiers, no ambiguous alternation), so the regex is linear-time
  // for the bounded input.
  // eslint-disable-next-line security/detect-unsafe-regex
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, digits, and hyphens only');

// Hex color OR null. Six-digit form only — we render via inline style and
// don't want short-hex edge cases.
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex color (e.g. #8b5cf6)')
  .nullable()
  .optional();

const iconSchema = z
  .string()
  .min(1)
  .max(40, 'Icon name too long')
  .nullable()
  .optional();

export const createProductSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(80),
    slug: slugSchema,
    description: z.string().max(10_000).nullable().optional(),
    status: z.nativeEnum(ProductStatus).optional().default(ProductStatus.ACTIVE),
    order: z.number().int().min(0).max(10_000).optional().default(0),
    color: colorSchema,
    icon: iconSchema,
  }),
});

export const updateProductSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
  }),
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(10_000).nullable().optional(),
    status: z.nativeEnum(ProductStatus).optional(),
    order: z.number().int().min(0).max(10_000).optional(),
    color: colorSchema,
    icon: iconSchema,
  }).refine(
    (b) => Object.keys(b).length > 0,
    'Provide at least one field to update.',
  ),
});

export const productParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
    productId: z.string().uuid(),
  }),
});
