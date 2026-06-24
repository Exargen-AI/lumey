import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema, toModelTool } from './schema';
import type { ToolDefinition } from './types';

describe('zodToJsonSchema', () => {
  it('maps an object with mixed fields and marks only non-optional as required', () => {
    const schema = z.object({
      path: z.string().describe('a path'),
      count: z.number(),
      enabled: z.boolean(),
      mode: z.enum(['a', 'b']),
      tags: z.array(z.string()),
      note: z.string().optional(),
      retries: z.number().default(0),
    });
    const js = zodToJsonSchema(schema);
    expect(js.type).toBe('object');
    expect(js.additionalProperties).toBe(false);
    const props = js.properties as Record<string, { type: string; enum?: string[]; description?: string }>;
    expect(props.path).toEqual({ type: 'string', description: 'a path' });
    expect(props.count).toEqual({ type: 'number' });
    expect(props.enabled).toEqual({ type: 'boolean' });
    expect(props.mode).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(props.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect((js.required as string[]).sort()).toEqual(['count', 'enabled', 'mode', 'path', 'tags']);
    expect(js.required).not.toContain('note');
    expect(js.required).not.toContain('retries');
  });
});

describe('toModelTool', () => {
  it('advertises name + description + generated parameters', () => {
    const tool: ToolDefinition<{ x: string }> = {
      name: 'demo',
      description: 'a demo',
      mutates: false,
      schema: z.object({ x: z.string() }),
      handler: async () => ({ content: '' }),
    };
    expect(toModelTool(tool)).toEqual({
      name: 'demo',
      description: 'a demo',
      parameters: { type: 'object', additionalProperties: false, properties: { x: { type: 'string' } }, required: ['x'] },
    });
  });
});
