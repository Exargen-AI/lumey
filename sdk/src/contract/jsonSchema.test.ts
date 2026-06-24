import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toJsonSchema, contractJsonSchema } from './jsonSchema';

describe('toJsonSchema', () => {
  it('maps objects, enums, nullables, arrays, and optionals', () => {
    const schema = z.object({
      id: z.string(),
      status: z.enum(['A', 'B']),
      summary: z.string().nullable(),
      tags: z.array(z.string()),
      note: z.string().optional(),
    });
    const js = toJsonSchema(schema);
    const props = js.properties as Record<string, Record<string, unknown>>;
    expect(props.id).toEqual({ type: 'string' });
    expect(props.status).toEqual({ type: 'string', enum: ['A', 'B'] });
    expect(props.summary).toEqual({ type: 'string', nullable: true });
    expect(props.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect((js.required as string[]).sort()).toEqual(['id', 'status', 'summary', 'tags']);
    expect(js.required).not.toContain('note');
  });

  it('honours passthrough as additionalProperties', () => {
    expect(toJsonSchema(z.object({ a: z.string() }).passthrough()).additionalProperties).toBe(true);
    expect(toJsonSchema(z.object({ a: z.string() })).additionalProperties).toBe(false);
  });
});

describe('contractJsonSchema', () => {
  it('exports every contract type as a JSON-Schema (the codegen input)', () => {
    const all = contractJsonSchema();
    expect(Object.keys(all)).toEqual(
      expect.arrayContaining(['RunStatus', 'TaskRef', 'AgentRunSummary', 'AgentRunDetail']),
    );
    expect(all.RunStatus).toMatchObject({ type: 'string', enum: expect.arrayContaining(['QUEUED', 'RUNNING']) });
    expect(all.AgentRunDetail.type).toBe('object');
  });
});
