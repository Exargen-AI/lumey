/**
 * Python client generator — emits a dependency-free `lumey_sdk` package from the
 * SAME contract the TypeScript client uses: types from `contract/schemas.ts`
 * (via JSON-Schema) and methods from `contract/operations.ts`. One source, two
 * clients, zero drift. Pure: `generatePython()` returns a `{ filename → content }`
 * map; the CLI (`gen-python.cli.ts`) writes it. Run: `npm run gen:python`.
 */
import { contractJsonSchema } from '../src/contract/jsonSchema';
import { OPERATIONS, type Operation } from '../src/contract/operations';

const HEADER = '# AUTO-GENERATED from the Lumey contract by sdk/scripts/generatePython.ts.\n# Do not edit by hand — run `npm run gen:python` to regenerate.\n';

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

type JsonSchema = Record<string, unknown>;

/** Resolve a property/item schema to a Python type, reusing named contract types. */
function pyType(schema: JsonSchema, contract: Record<string, JsonSchema>): string {
  const named = matchNamed(schema, contract);
  if (named) return named;
  if (schema.nullable) {
    const base = pyType({ ...schema, nullable: false }, contract);
    return `Optional[${base}]`;
  }
  if (Array.isArray(schema.enum)) return `Literal[${(schema.enum as string[]).map((v) => JSON.stringify(v)).join(', ')}]`;
  switch (schema.type) {
    case 'string':
      return 'str';
    case 'number':
      return 'float';
    case 'integer':
      return 'int';
    case 'boolean':
      return 'bool';
    case 'array':
      return `List[${pyType((schema.items as JsonSchema) ?? {}, contract)}]`;
    case 'object':
      return 'Dict[str, Any]';
    default:
      return 'Any';
  }
}

/** If a schema is structurally one of the named contract types, return its name. */
function matchNamed(schema: JsonSchema, contract: Record<string, JsonSchema>): string | null {
  const key = JSON.stringify(schema);
  for (const [name, def] of Object.entries(contract)) {
    if (JSON.stringify(def) === key) return name;
  }
  return null;
}

function generateModels(contract: Record<string, JsonSchema>): string {
  const lines: string[] = [
    HEADER,
    'from __future__ import annotations',
    'from typing import TypedDict, Optional, List, Literal, Any, Dict',
    '',
    '',
  ];
  for (const [name, schema] of Object.entries(contract)) {
    if (Array.isArray(schema.enum) && schema.type === 'string') {
      lines.push(`${name} = Literal[${(schema.enum as string[]).map((v) => JSON.stringify(v)).join(', ')}]`, '', '');
      continue;
    }
    if (schema.type === 'object') {
      const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
      lines.push(`class ${name}(TypedDict, total=False):`);
      const entries = Object.entries(props);
      if (entries.length === 0) lines.push('    pass');
      for (const [field, fieldSchema] of entries) {
        lines.push(`    ${field}: ${pyType(fieldSchema, contract)}`);
      }
      lines.push('', '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function generateErrors(): string {
  return `${HEADER}
class LumeyError(Exception):
    def __init__(self, message, status=None, code=None, run_id=None, trace_id=None, retryable=False):
        super().__init__(message)
        self.status = status
        self.code = code
        self.run_id = run_id
        self.trace_id = trace_id
        self.retryable = retryable


class LumeyConnectionError(LumeyError):
    def __init__(self, message):
        super().__init__(message, retryable=True)


class LumeyAuthError(LumeyError):
    pass


class LumeyUnavailableError(LumeyError):
    pass


class LumeyContractError(LumeyError):
    pass


class BudgetExceededError(LumeyError):
    pass


class ApprovalRequiredError(LumeyError):
    pass


class ClarificationPendingError(LumeyError):
    pass


_CODE_MAP = {
    "BUDGET_EXCEEDED": BudgetExceededError,
    "APPROVAL_REQUIRED": ApprovalRequiredError,
    "CLARIFICATION_PENDING": ClarificationPendingError,
}


def error_from_response(status, body):
    err = (body or {}).get("error") or {} if isinstance(body, dict) else {}
    ctx = dict(
        status=status,
        code=err.get("code"),
        run_id=err.get("run_id") or err.get("runId"),
        trace_id=err.get("trace_id") or err.get("traceId"),
        retryable=status == 429 or status >= 500,
    )
    message = err.get("message") or "request failed ({})".format(status)
    code = err.get("code")
    if code and code in _CODE_MAP:
        return _CODE_MAP[code](message, **ctx)
    if status in (401, 403):
        return LumeyAuthError(message, **ctx)
    if status == 429 or status >= 500:
        return LumeyUnavailableError(message, **ctx)
    return LumeyError(message, **ctx)
`;
}

function methodFor(op: Operation): string {
  const snakeParams = op.params.map(camelToSnake);
  const args = ['self', ...snakeParams];
  if (op.write) args.push('idempotency_key=None');
  const pyPath = op.path.replace(/\{(\w+)\}/g, (_, k) => `{${camelToSnake(k)}}`);
  const pathExpr = op.params.length ? `f"${pyPath}"` : `"${pyPath}"`;
  const callArgs = [JSON.stringify(op.http), pathExpr];
  if (op.write) {
    callArgs.push('body={}');
    callArgs.push('idempotency_key=idempotency_key');
  }
  return [
    `    def ${op.method}(${args.join(', ')}):`,
    `        """${op.summary}"""`,
    `        return self._t.request(${callArgs.join(', ')})`,
  ].join('\n');
}

function generateClient(): string {
  const byResource = new Map<string, Operation[]>();
  for (const op of OPERATIONS) {
    const list = byResource.get(op.resource) ?? [];
    list.push(op);
    byResource.set(op.resource, list);
  }

  const resourceClasses: string[] = [];
  const ctorLines: string[] = [];
  for (const [resource, ops] of byResource) {
    const cls = `${resource[0].toUpperCase()}${resource.slice(1)}Resource`;
    resourceClasses.push(
      [`class ${cls}:`, '    def __init__(self, transport):', '        self._t = transport', '', ops.map(methodFor).join('\n\n')].join('\n'),
    );
    ctorLines.push(`        self.${resource} = ${cls}(transport)`);
  }

  return `${HEADER}
import json
import time
import uuid
import urllib.request
import urllib.error
from urllib.parse import urlparse

from .errors import error_from_response, LumeyConnectionError

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _origin_of(base_url):
    p = urlparse(base_url)
    return "{}://{}".format(p.scheme, p.netloc)


class _Transport:
    def __init__(self, base_url, token, timeout=30.0, max_retries=2, retry_base=0.2, origin=None):
        self._base = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        self._max_retries = max_retries
        self._retry_base = retry_base
        self._origin = origin or _origin_of(base_url)

    def request(self, method, path, body=None, idempotency_key=None):
        url = self._base + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"authorization": "Bearer " + self._token, "accept": "application/json", "origin": self._origin}
        if body is not None:
            headers["content-type"] = "application/json"
        if method in _WRITE_METHODS:
            headers["idempotency-key"] = idempotency_key or str(uuid.uuid4())

        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                    text = resp.read().decode("utf-8")
                    parsed = json.loads(text) if text else None
                    if isinstance(parsed, dict) and "data" in parsed:
                        return parsed["data"]
                    return parsed
            except urllib.error.HTTPError as e:
                text = e.read().decode("utf-8") if e.fp else ""
                parsed = json.loads(text) if text else None
                err = error_from_response(e.code, parsed)
                if err.retryable and attempt < self._max_retries:
                    time.sleep(self._retry_base * (2 ** attempt))
                    attempt += 1
                    continue
                raise err
            except urllib.error.URLError as e:
                if attempt < self._max_retries:
                    time.sleep(self._retry_base * (2 ** attempt))
                    attempt += 1
                    continue
                raise LumeyConnectionError(str(e))


${resourceClasses.join('\n\n\n')}


class LumeyClient:
    """The Lumey Platform SDK (Python). Generated from the contract."""

    def __init__(self, base_url, token, timeout=30.0, max_retries=2, origin=None):
        transport = _Transport(base_url, token, timeout=timeout, max_retries=max_retries, origin=origin)
${ctorLines.join('\n')}
`;
}

function generateInit(): string {
  return `${HEADER}
from .client import LumeyClient
from .errors import (
    LumeyError,
    LumeyConnectionError,
    LumeyAuthError,
    LumeyUnavailableError,
    LumeyContractError,
    BudgetExceededError,
    ApprovalRequiredError,
    ClarificationPendingError,
)

__all__ = [
    "LumeyClient",
    "LumeyError",
    "LumeyConnectionError",
    "LumeyAuthError",
    "LumeyUnavailableError",
    "LumeyContractError",
    "BudgetExceededError",
    "ApprovalRequiredError",
    "ClarificationPendingError",
]
`;
}

/** The whole generated package as `{ relative path → file content }`. */
export function generatePython(): Record<string, string> {
  const contract = contractJsonSchema();
  return {
    'lumey_sdk/__init__.py': generateInit(),
    'lumey_sdk/models.py': generateModels(contract),
    'lumey_sdk/errors.py': generateErrors(),
    'lumey_sdk/client.py': generateClient(),
  };
}
