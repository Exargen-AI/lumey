/**
 * Generate the model-facing JSON-Schema for a tool from its `zod` argument
 * schema, so a tool is declared exactly once. We cover the small, closed subset
 * our tools actually use (object · string · number · boolean · enum · array ·
 * optional/default wrappers) rather than pulling in a general converter — the
 * inputs are our own tool schemas, so the subset is fixed and fully tested.
 */
import type { z } from 'zod';
import type { ModelTool, ToolDefinition } from './types';

interface ZodDefLike {
  typeName: string;
  description?: string;
  innerType?: z.ZodTypeAny;
  type?: z.ZodTypeAny; // array element
  values?: readonly string[]; // enum
  shape?: () => Record<string, z.ZodTypeAny>;
}

function defOf(schema: z.ZodTypeAny): ZodDefLike {
  return (schema as unknown as { _def: ZodDefLike })._def;
}

function isOptional(schema: z.ZodTypeAny): boolean {
  const tn = defOf(schema).typeName;
  return tn === 'ZodOptional' || tn === 'ZodDefault';
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = defOf(schema);
  let out: Record<string, unknown>;

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = def.shape ? def.shape() : {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      out = { type: 'object', properties, additionalProperties: false };
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
      out = { type: 'array', items: def.type ? zodToJsonSchema(def.type) : {} };
      break;
    case 'ZodOptional':
    case 'ZodDefault':
      out = def.innerType ? zodToJsonSchema(def.innerType) : {};
      break;
    default:
      out = {}; // unknown → permissive (the zod schema still validates at runtime)
  }

  if (def.description && out.description === undefined) out.description = def.description;
  return out;
}

/** Advertise a tool to the model: name + description + generated JSON-Schema. */
export function toModelTool(tool: ToolDefinition): ModelTool {
  return { name: tool.name, description: tool.description, parameters: zodToJsonSchema(tool.schema) };
}
