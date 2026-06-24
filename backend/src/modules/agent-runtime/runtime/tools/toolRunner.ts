/**
 * ToolRunner — the dispatch + validation gate between the model and the tools.
 * For each model tool call it: resolves the tool, parses the JSON arguments,
 * validates them against the tool's zod schema, runs the handler in the sandbox,
 * and turns the outcome (success, bad request, or thrown error) into a single
 * `ToolResult`. It **never throws** — a tool failure is data the agent reads and
 * recovers from, not a crash that kills the run.
 *
 * Calls run **sequentially**: writes and edits must be ordered, and shell
 * commands have side effects. Parallelizing provably read-only tools is a later
 * optimization, not a default we'd risk on a shared workspace.
 */
import { toModelTool } from './schema';
import type { ModelTool, ToolCall, ToolContext, ToolDefinition, ToolResult } from './types';

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatZodIssues(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export class ToolRunner {
  private readonly byName: Map<string, ToolDefinition>;

  constructor(tools: ToolDefinition[]) {
    this.byName = new Map();
    for (const tool of tools) {
      if (this.byName.has(tool.name)) throw new Error(`ToolRunner: duplicate tool name "${tool.name}"`);
      this.byName.set(tool.name, tool);
    }
  }

  /** The tools to advertise to the model this turn. */
  list(): ModelTool[] {
    return [...this.byName.values()].map(toModelTool);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  async run(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const start = Date.now();
    const result = (ok: boolean, content: string, data?: unknown): ToolResult => ({
      callId: call.id,
      name: call.name,
      ok,
      content,
      data,
      durationMs: Date.now() - start,
    });

    if (ctx.signal?.aborted) return result(false, 'run cancelled before tool execution');

    const tool = this.byName.get(call.name);
    if (!tool) return result(false, `unknown tool: ${call.name}`);

    let parsed: unknown;
    try {
      parsed = call.arguments.trim() ? JSON.parse(call.arguments) : {};
    } catch (e) {
      return result(false, `invalid JSON arguments: ${describeError(e)}`);
    }

    const validated = tool.schema.safeParse(parsed);
    if (!validated.success) {
      return result(false, `invalid arguments: ${formatZodIssues(validated.error)}`);
    }

    try {
      const out = await tool.handler(validated.data, ctx);
      return result(true, out.content, out.data);
    } catch (e) {
      return result(false, describeError(e));
    }
  }

  /** Run a batch of calls in order, collecting every result. */
  async runAll(calls: ToolCall[], ctx: ToolContext): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.run(call, ctx));
    }
    return results;
  }
}
