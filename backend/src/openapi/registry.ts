import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * OpenAPI registry. This is the central registry where every documented
 * endpoint is registered with its zod schemas + metadata. The registry
 * builds a single OpenAPI v3 document that's served at:
 *
 *   GET /api/v1/openapi.json   — machine-readable spec
 *   GET /api/v1/docs           — Swagger UI (human-readable)
 *
 * Why this exists:
 *
 *   An agent (or any external developer) needs a machine-readable
 *   description of the API to build integrations against. Without
 *   OpenAPI they have to read the source code, which (a) doesn't scale
 *   to external contributors, and (b) tightly couples integrations to
 *   our implementation details.
 *
 * Pragmatic v1 approach:
 *
 *   We DO NOT auto-register every existing endpoint up front — that
 *   would be a multi-day effort to round-trip ~150 endpoints. Instead
 *   we register the AGENT-FACING surface (the endpoints a runtime
 *   actually needs to call) plus a clear extension point for future
 *   registration.
 *
 *   Endpoints not yet registered: a `paths` object is empty for them.
 *   That doesn't break the UI — it just means they're "undocumented
 *   in the spec yet, see /agent-platform docs for now". As surfaces
 *   stabilize, we add their schemas to this file (or a sibling).
 *
 * Schemas are decorated with `.openapi(...)` metadata via the
 * `extendZodWithOpenApi(z)` patch — installed once below.
 */

// Extend zod's prototype to attach .openapi() — must be called BEFORE
// any schema is created.
extendZodWithOpenApi(z);

/** The central registry instance. Every spec contributor pushes here. */
export const registry = new OpenAPIRegistry();

/**
 * Standard error response shape used everywhere — the canonical
 * `{ success: false, error: { code, message, errorId } }` envelope.
 * Registered here once so each operation can reference it instead of
 * inlining the same schema.
 */
export const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'Title is required' }),
      errorId: z.string().optional().openapi({ example: '8a3f9b2c' }),
      details: z.unknown().optional(),
    }),
  }),
);

/**
 * Standard success envelope. Every successful response is shaped as
 * `{ success: true, data: <T> }`. Registered once so individual
 * endpoints just specify the `T`.
 */
export function successEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}

/** Bearer-token security scheme — JWT auth used by every authenticated route. */
registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'JWT access token obtained via `POST /auth/login`. Include as `Authorization: Bearer <token>`.',
});

/**
 * The Idempotency-Key header — accepted on POST/PATCH/PUT/DELETE
 * across the API. Registered as a reusable parameter so per-operation
 * docs can reference it via `parameters: [{ $ref: ... }]` instead of
 * re-declaring it.
 *
 * The zod-to-openapi library takes a zod schema decorated with
 * `.openapi({ param: { ... } })` for parameter registration.
 */
registry.registerParameter(
  'IdempotencyKey',
  z
    .string()
    .max(255)
    .optional()
    .openapi({
      param: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description:
          'Opaque string up to 255 characters. When provided on a state-changing request, the server caches the response for 24 hours. Retries with the same key replay the original response (`X-Idempotent-Replay: true` header on the replayed response). Retries with the same key but a different request body return 409.',
      },
    }),
);

/**
 * Build the OpenAPI document. Called by the route handler that serves
 * `GET /api/v1/openapi.json`.
 *
 * @returns a fully-formed OpenAPI v3 spec object
 */
export function buildOpenApiDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Exargen Command Center API',
      version: '1.0.0',
      description: [
        'REST API for the Exargen Command Center platform.',
        '',
        '## Layers',
        '',
        '- **Layer 1 — project management**: projects, tasks, comments, users, agents (all standard REST verbs).',
        '- **Layer 2 — agent control plane**: knowledge packs, next-task, budget accounting, idempotency keys, audit logs.',
        '- **Layer 3 — agent execution**: out of scope here. Any execution framework (Claude direct, ADK, LangGraph, custom) calls the Layer 1 + Layer 2 endpoints described below.',
        '',
        '## Auth',
        '',
        'All endpoints except `/auth/login`, `/auth/refresh`, and the public CMS routes require a Bearer JWT. Obtain via `POST /auth/login` with email + password.',
        '',
        '## Idempotency',
        '',
        'Send `Idempotency-Key: <opaque>` on POST/PATCH/PUT/DELETE to safely retry on network failure. Same key + same body → cached response. Same key + different body → 409.',
        '',
        '## Error envelope',
        '',
        'Every error response uses the shape `{ success: false, error: { code, message, errorId } }`. Validation failures include a `details.fieldErrors` map. See `ErrorResponse` schema below.',
      ].join('\n'),
      contact: {
        name: 'Exargen Engineering',
        url: 'https://github.com/Exargen-AI/exargen-command-center',
      },
    },
    servers: [
      { url: '/api/v1', description: 'Same-origin (recommended)' },
      { url: 'http://localhost:3002/api/v1', description: 'Local development' },
    ],
    security: [{ BearerAuth: [] }],
  });
}
