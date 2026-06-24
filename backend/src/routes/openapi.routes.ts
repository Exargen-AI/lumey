import { Router, type Request, type Response } from 'express';
import { buildOpenApiDocument } from '../openapi/registry';

// Side-effect imports: each path file registers its operations into the
// global registry. Add new path files here as more endpoints are documented.
import '../openapi/agent.paths';

/**
 * 2026-05-23 — OpenAPI spec serving routes.
 *
 * Exposes the API description in two forms:
 *
 *   GET /openapi.json   — machine-readable spec (for client codegen,
 *                          Postman import, etc.)
 *   GET /docs           — minimal Swagger-UI-style HTML for humans
 *                          (read-only — no "Try it out" button to avoid
 *                          accidentally driving prod from the docs)
 *
 * The spec is built on-demand per request (cheap — ~5ms for ~10 endpoints)
 * so a hot-reload during dev surfaces in the spec immediately.
 *
 * What's NOT here:
 *
 *   - Auth on the routes themselves. The spec describes public + auth
 *     surfaces alike; exposing it doesn't grant access. The spec describes
 *     WHAT exists, not what the caller can do.
 *   - "Try it out" buttons. Per-request authoring against prod is a
 *     footgun; the docs UI is reference, not REPL. Use curl / httpie /
 *     Postman against a dev environment if you want to call live.
 */

const router = Router();

router.get('/openapi.json', (_req: Request, res: Response) => {
  const doc = buildOpenApiDocument();
  res.json(doc);
});

/**
 * The HTML page that loads Swagger-UI from a CDN against our spec.
 * Inlined so we don't need an extra `swagger-ui-express` dependency
 * for a single page; the page is tiny and won't change.
 */
const docsHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Exargen Command Center — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafbfc; }
    .topbar { display: none; } /* Swagger's default header — we have our own */
    .swagger-banner {
      padding: 16px 24px;
      background: #111827;
      color: #fafbfc;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    .swagger-banner h1 { margin: 0; font-size: 18px; }
    .swagger-banner p { margin: 4px 0 0; font-size: 13px; opacity: .75; }
    .swagger-banner code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <div class="swagger-banner">
    <h1>Exargen Command Center API</h1>
    <p>
      Layer 2 (agent control plane) is fully documented. Layer 1 endpoints are
      progressively being registered. Machine-readable spec at <code>/api/v1/openapi.json</code>.
    </p>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/v1/openapi.json',
      dom_id: '#swagger-ui',
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
      // "Try it out" disabled — docs are reference, not a live REPL.
      // Anyone driving the API for real should use curl / Postman with
      // their own credentials. This prevents accidentally hitting prod
      // from a docs page that happens to be open.
      tryItOutEnabled: false,
      supportedSubmitMethods: [],
    });
  </script>
</body>
</html>`;

router.get('/docs', (_req: Request, res: Response) => {
  res.type('html').send(docsHtml);
});

export default router;
