import { z } from 'zod';

const FIELD_TYPES = ['TEXT', 'NUMBER', 'SELECT', 'DATE', 'URL', 'BADGE'] as const;

// Top-level config validator — the service layer does the type-specific
// deeper validation. Keeping the zod surface loose-but-bounded here means
// we get a clear 400 for malformed payloads at the edge while the service
// guarantees the per-type invariants regardless of caller.
const configSchema = z.record(z.string(), z.any()).optional();

export const createCustomFieldSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    name:      z.string().min(1).max(80),
    key:       z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    fieldType: z.enum(FIELD_TYPES),
    config:    configSchema,
    required:  z.boolean().optional(),
    hint:      z.string().max(500).optional(),
  }),
});

export const updateCustomFieldSchema = z.object({
  params: z.object({ fieldId: z.string().uuid() }),
  body: z.object({
    name:      z.string().min(1).max(80).optional(),
    fieldType: z.enum(FIELD_TYPES).optional(),
    config:    configSchema,
    required:  z.boolean().optional(),
    hint:      z.string().max(500).nullable().optional(),
  }),
});

export const reorderCustomFieldSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    ids: z.array(z.string().uuid()).max(50),
  }),
});
