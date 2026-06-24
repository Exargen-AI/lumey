import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// In production, reject the dev placeholder strings that meet the min-32
// floor but are public knowledge (QA finding #46). Without this, copying the
// dev .env to staging/prod silently ships a forge-able JWT signing key. Dev
// is allowed to use them; the check only fires when NODE_ENV=production.
const isProd = process.env.NODE_ENV === 'production';
const looksLikePlaceholder = (v: string) =>
  v.startsWith('local_dev_only_secret_') ||
  v.includes('changeme') ||
  /^0+$/.test(v) ||
  /^x+$/.test(v);
const productionSecret = (v: string) => !isProd || !looksLikePlaceholder(v);

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32).refine(
    productionSecret,
    'JWT_ACCESS_SECRET looks like a development placeholder. Set a unique production secret.',
  ),
  JWT_REFRESH_SECRET: z.string().min(32).refine(
    productionSecret,
    'JWT_REFRESH_SECRET looks like a development placeholder. Set a unique production secret.',
  ),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  // 30 days — matches the refresh-cookie maxAge in auth.handler.ts. If you
  // change one, change the other (the cookie is the gate the browser sees;
  // the JWT exp is the gate the server checks). See the rationale comment
  // on getRefreshCookieOptions() for why 30 days vs the old 7.
  JWT_REFRESH_EXPIRY: z.string().default('30d'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Structured-logger verbosity (pino). Defaults to info in prod, debug
  // in dev (resolved in lib/logger.ts when unset).
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  // CORS_ORIGIN: comma-separated allowlist. In production we REFUSE the
  // localhost default — an unset CORS_ORIGIN in prod would silently
  // accept localhost requests (and reject Vercel's URL). Fail-closed
  // (QA finding H-H2). In dev/test the default is convenient.
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174').refine(
    (v) => !isProd || (v && !v.includes('localhost') && !v.includes('127.0.0.1')),
    'CORS_ORIGIN must be set explicitly in production (got localhost default). Set to your Vercel URL(s), comma-separated.',
  ),
  // Public URL of THIS backend, used by Helmet CSP connect-src so the
  // browser allows the SPA to talk to us (QA finding H-C2). In dev the
  // FE talks to localhost so we don't need to set this. In prod, the
  // Vercel frontend needs to fetch from the Railway backend; without
  // explicit connect-src the browser falls back to default-src 'self'
  // and blocks every XHR.
  BACKEND_PUBLIC_URL: z.string().url().optional(),
  // Number of reverse-proxy hops in front of this app. Default 1 matches
  // Railway / Render / Heroku. Bump to 2 if you put Cloudflare or
  // another CDN in front. Express's `trust proxy` is set to this value
  // (QA H-M3 — was a comment-only constant).
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  PRISMA_LOG_QUERIES: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  LOAD_SEED_DATA: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // AI provider configuration for the Content Engine.
  // AI_PROVIDER selects the adapter: 'anthropic' (default) or 'openai'.
  // AI_API_KEY is required when the content engine is in use.
  // AI_MODEL overrides the provider default (e.g. 'claude-opus-4-7', 'gpt-4o').
  // AI_BASE_URL is only needed for OpenAI-compatible endpoints (e.g. Azure OpenAI).
  AI_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),

  // Smart Parse — LLM-based plan ingestion. Independent model knob from
  // AI_MODEL so the content engine can stay on Opus while parsing runs on
  // cheap Haiku. INGEST_PARSER_ENABLED gates the feature entirely (lets
  // ops kill it without code change if costs run away).
  INGEST_PARSER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),
  INGEST_PARSER_MODEL: z.string().optional(),

  // ─── Project Documents (S3-backed) ───
  // All four are optional; the docs feature degrades to a clean "not
  // configured" error if S3_DOCUMENTS_BUCKET is unset, which lets the
  // codebase ship before the bucket exists. When set, the bucket must
  // live in AWS_REGION (default ap-southeast-1 to match the agent-runtime
  // EC2). AWS creds: prefer omitting them locally (the SDK falls back to
  // ~/.aws/credentials or instance profile); on Railway, set explicit
  // access keys belonging to the cc-backend IAM user.
  AWS_REGION: z.string().default('ap-southeast-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_DOCUMENTS_BUCKET: z.string().optional(),

  // Presigned URLs live this long. Short enough that a leaked URL is
  // useless within minutes; long enough that an agent's slow download
  // or a client's slow upload doesn't hit a stall.
  S3_PRESIGNED_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

  // Hard upload cap. 50 MB covers specs, designs, contracts, PDFs. Larger
  // assets (videos, datasets) should use a separate storage path — this
  // bucket is for human-readable project context, not media.
  DOCUMENTS_MAX_BYTES: z.coerce.number().int().min(1024).default(52_428_800),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
