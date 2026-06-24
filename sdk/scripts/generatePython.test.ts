import { describe, it, expect } from 'vitest';
import { generatePython } from './generatePython';

describe('generatePython', () => {
  const files = generatePython();

  it('emits the package files', () => {
    expect(Object.keys(files).sort()).toEqual([
      'lumey_sdk/__init__.py',
      'lumey_sdk/client.py',
      'lumey_sdk/errors.py',
      'lumey_sdk/models.py',
    ]);
  });

  it('generates enum aliases and TypedDicts from the contract', () => {
    const models = files['lumey_sdk/models.py'];
    expect(models).toContain('RunStatus = Literal["QUEUED", "RUNNING"');
    expect(models).toContain('class AgentRunSummary(TypedDict, total=False):');
    // named contract types are reused, not inlined:
    expect(models).toContain('steps: List[RunStep]');
    expect(models).toContain('status: RunStatus');
  });

  it('generates client methods from the operations manifest', () => {
    const client = files['lumey_sdk/client.py'];
    expect(client).toContain('class LumeyClient:');
    expect(client).toContain('class RunsResource:');
    expect(client).toContain('def start(self, task_id, idempotency_key=None):');
    expect(client).toContain('def get(self, task_id, run_id):');
    expect(client).toContain('def next(self):');
    expect(client).toContain('self.runs = RunsResource(transport)');
  });

  it('carries the typed error hierarchy and code mapping', () => {
    const errors = files['lumey_sdk/errors.py'];
    expect(errors).toContain('class BudgetExceededError(LumeyError):');
    expect(errors).toContain('"BUDGET_EXCEEDED": BudgetExceededError');
  });

  it('marks every file as generated', () => {
    for (const content of Object.values(files)) {
      expect(content).toContain('AUTO-GENERATED');
    }
  });
});
