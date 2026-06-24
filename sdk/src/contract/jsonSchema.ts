/**
 * The codegen seam — render the `zod` contract as JSON-Schema. This is the
 * artifact a Python (or any-language) generator consumes, so the cross-language
 * clients are produced from the *same* source the TypeScript client validates
 * against. Hand-written client code can never drift from the contract.
 *
 * Self-contained (no converter dependency): the contract uses a closed, known
 * subset of zod, so a small mapper is the right tradeoff and is fully tested.
 */
import type { z } from 'zod';
import { CONTRACT } from './schemas';

interface ZodDefLike {
  typeName: string;
  description?: string;
  innerType?: z.ZodTypeAny;
  type?: z.ZodTypeAny;
  values?: readonly string[];
  shape?: () => Record<string, z.ZodTypeAny>;
  unknownKeys?: string;
}

function defOf(schema: z.ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const tn = defOf(schema).typeName;
  return tn === 'ZodOptional' || tn === 'ZodDefault';
}

/** Mark a schema nullable (OpenAPI-style) without losing its base shape. */
function withNullable(out: Record<string, unknown>): Record<string, unknown> {
  return { ...out, nullable: true };
}

export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = defOf(schema);
  let out: Record<string, unknown>;

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = toJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      out = { type: 'object', properties, additionalProperties: def.unknownKeys === 'passthrough' };
      if (required.length) out.required = required;
      break;
    }
    case 'ZodString':
      out = { type: 'string' };
      break;
    case 'ZodNumber':
      out = { type: 'number' };
      break;
    case 'ZodBoolean':
      out = { type: 'boolean' };
      break;
    case 'ZodEnum':
      out = { type: 'string', enum: [...(def.values ?? [])] };
      break;
    case 'ZodArray':
      out = { type: 'array', items: def.type ? toJsonSchema(def.type) : {} };
      break;
    case 'ZodNullable':
      return withNullable(def.innerType ? toJsonSchema(def.innerType) : {});
    case 'ZodOptional':
    case 'ZodDefault':
      out = def.innerType ? toJsonSchema(def.innerType) : {};
      break;
    case 'ZodUnknown':
    case 'ZodAny':
      out = {};
      break;
    default:
      out = {};
  }

  if (def.description && out.description === undefined) out.description = def.description;
  return out;
}

/** The whole contract as a `{ name → JSON-Schema }` map — the codegen input. */
export function contractJsonSchema(): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, schema] of Object.entries(CONTRACT)) {
    result[name] = toJsonSchema(schema as z.ZodTypeAny);
  }
  return result;
}
