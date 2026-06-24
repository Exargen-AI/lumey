# Content Engine

AI-powered trend discovery and blog generation, built natively inside the Exargen CMS.

---

## What It Does

The Content Engine lets operators search any topic, instantly receive AI-analysed insights about what people are currently discussing online, and convert those insights directly into publish-ready CMS blog drafts — without leaving the Command Center.

```
Operator searches topic
        ↓
  AI Analysis Engine
  ┌─────────────────────────────┐
  │  Trend Discovery            │
  │  Sentiment Analysis         │
  │  Viral Score                │
  │  Engagement Analysis        │
  │  SEO Keyword Extraction     │
  └─────────────────────────────┘
        ↓
  Generate Blog Ideas
        ↓
  Generate Full Blog Draft
        ↓
  Push into CMS as DRAFT
        ↓
  Operator Reviews → Publishes
```

---

## Getting Started

### 1. Get an API Key

The Content Engine requires an AI provider API key.

**Anthropic (Claude) — recommended:**
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Navigate to **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-api03-...`)

**OpenAI (GPT-4o) — alternative:**
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Copy the key (starts with `sk-...`)

---

### 2. Configure Environment Variables

Add the following to `backend/.env`:

```env
# Required
AI_PROVIDER=anthropic
AI_API_KEY=sk-ant-api03-your-full-key-here

# Optional — override the default model
# Anthropic default: claude-haiku-4-5-20251001
# OpenAI default:    gpt-4o
AI_MODEL=claude-haiku-4-5-20251001

# Only needed for OpenAI-compatible custom endpoints
# AI_BASE_URL=https://your-endpoint.com/v1
```

> **Note:** Never commit `backend/.env` to git. It is already in `.gitignore`.

---

### 3. Run the Migration

```bash
cd backend
npx prisma migrate deploy
```

This creates three new tables: `content_engine_searches`, `ai_analysis_results`, `generated_blog_drafts`.

---

### 4. Restart the Backend

```bash
npm run dev:backend
```

On startup the server automatically syncs the new `cms.content_engine.use` permission for all roles that have CMS access (Admin, Product Manager).

---

## How to Use

### Opening the Content Engine

1. Navigate to **Content → CMS** in the sidebar
2. Select a CMS project
3. Click **Content Engine** (the purple button next to Templates in the Blog Management page)

---

### Step 1 — Analyze a Topic

Enter any topic in the search bar and click **Analyze Topic**.

**Examples:**
- `AI coding tools`
- `Redis performance`
- `Kubernetes security`
- `Java 25 features`
- `IPL 2025`

**Optional filters:**
| Filter | Options | Effect |
|---|---|---|
| Time Range | Any time / Last 24h / 7d / 30d | Focuses the AI on recent vs broader context |
| Sentiment | All / Positive / Negative / Neutral | Filters the tone of insights |

The AI analyses current online discussion patterns, trending subtopics, pain points, community sentiment, and SEO opportunities — and returns a structured result card.

---

### Step 2 — Review the Analysis Card

Each result card shows:

| Field | Description |
|---|---|
| **Recommended Title** | Best SEO-optimised blog title for this topic |
| **Summary** | 2–3 sentence overview of current discussion landscape |
| **Trend Score** (0–100) | How much momentum the topic has right now |
| **Viral Score** (0–100) | Shareability and audience interest potential |
| **Sentiment** | Positive / Negative / Neutral / Mixed with confidence % |
| **Engagement Insight** | Which communities are active, audience demographics |
| **SEO Keywords** | Primary keywords + long-tail phrases |
| **Trending Subtopics** | Related areas gaining traction |
| **Common Questions** | What people are asking (expandable section) |
| **Pain Points** | Frustrations and problems people discuss (expandable) |
| **Blog Ideas** | 5 ready-to-use content angles with target audience |
| **Recommended Tags** | Content tags for categorisation |

---

### Step 3 — Generate a Blog

**Option A — Generate from the full analysis:**
Click **Generate Blog** without selecting a specific idea. The AI writes a comprehensive blog covering the whole topic.

**Option B — Generate from a specific idea:**
Click any blog idea card to select it (it highlights in purple), then click **Generate Blog (Selected Idea)**. The AI focuses on that specific angle.

The generated blog includes:
- SEO title and URL slug
- Meta description (155 chars)
- Introduction
- 4–6 structured sections with H2 headings
- FAQ section (3–5 questions)
- Conclusion
- Call-to-action

> **Expected time:** 15–40 seconds depending on API load.

---

### Step 4 — Push to CMS as Draft

Once the blog preview appears below the card, click **Use as CMS Draft**.

The system will:
1. Create a new CMS blog entry with status `DRAFT`
2. Auto-fill: title, slug, excerpt, content blocks, SEO metadata, tags
3. Redirect you directly to the CMS Editor for that blog

From the editor you can:
- Edit any section
- Add images and media
- Adjust SEO settings
- Preview the blog
- Publish when ready

> **Content is always saved as DRAFT.** Nothing is published automatically. Human review is required before publishing.

---

## AI Provider Reference

### Supported Providers

| Provider | `AI_PROVIDER` value | Default Model | Notes |
|---|---|---|---|
| Anthropic Claude | `anthropic` | `claude-haiku-4-5-20251001` | Recommended. Fast, cost-effective |
| OpenAI | `openai` | `gpt-4o` | Alternative |
| Azure OpenAI | `openai` | set via `AI_MODEL` | Requires `AI_BASE_URL` |
| Any OpenAI-compatible API | `openai` | set via `AI_MODEL` | Requires `AI_BASE_URL` |

### Recommended Models

| Use Case | Provider | Model |
|---|---|---|
| Fast + affordable (recommended) | Anthropic | `claude-haiku-4-5-20251001` |
| Higher quality analysis | Anthropic | `claude-sonnet-4-6` |
| Best quality | Anthropic | `claude-opus-4-7` |
| OpenAI standard | OpenAI | `gpt-4o` |
| OpenAI fast | OpenAI | `gpt-4o-mini` |

---

## Error Reference

| Error | Cause | Fix |
|---|---|---|
| `AI_API_KEY is not configured` | `AI_API_KEY` missing from `.env` | Add the key and restart backend |
| `Anthropic API key is invalid or expired` | Wrong or revoked key | Generate a new key at console.anthropic.com |
| `Model not found` | `AI_MODEL` has wrong value | Check the model name in the table above |
| `Anthropic API is temporarily overloaded` | Anthropic servers at capacity | Wait 10–30s and retry. The system auto-retries up to 3 times |
| `Rate limit reached` | Too many requests | Wait a moment and retry |

---

## Architecture

### Backend Files

```
backend/src/
├── providers/
│   └── aiProvider.ts              # Provider adapter (Anthropic + OpenAI)
├── services/
│   └── contentEngine.service.ts   # Orchestration + DB persistence
├── handlers/
│   └── contentEngine.handler.ts   # Route handlers with Zod validation
└── routes/
    └── contentEngine.routes.ts    # API routes
```

### Frontend Files

```
frontend/src/
├── api/
│   └── contentEngine.ts           # Typed API client
├── hooks/
│   └── useContentEngine.ts        # React Query hooks
└── pages/cms/
    └── ProjectContentEnginePage.tsx  # Full UI page
```

### Database Tables

| Table | Purpose |
|---|---|
| `content_engine_searches` | One row per operator search (topic + filters) |
| `ai_analysis_results` | Structured AI analysis output per search |
| `generated_blog_drafts` | AI-generated blog content before CMS promotion |

### API Endpoints

All endpoints require authentication + `cms.content_engine.use` permission.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/content-engine/:projectId/analyze` | Run AI topic analysis |
| `POST` | `/api/v1/content-engine/:projectId/generate-blog` | Generate full blog from analysis |
| `POST` | `/api/v1/content-engine/:projectId/create-draft` | Promote generated blog to CMS draft |
| `GET` | `/api/v1/content-engine/:projectId/history` | List recent searches |

### Permissions

| Permission Key | Granted To |
|---|---|
| `cms.content_engine.use` | SUPER_ADMIN, ADMIN, PRODUCT_MANAGER |

---

## Security

- No social media APIs are called directly — the AI uses its training knowledge to synthesise insights
- Raw AI prompts are never exposed to the frontend
- Content is always saved as `DRAFT` — publishing requires explicit human action
- All endpoints are gated behind JWT authentication and RBAC permission checks
- The AI API key is stored server-side only, never sent to the browser

---

## Scalability Notes

The current implementation is synchronous (request waits for AI response). For production at scale, consider:

- Moving `analyzeTopic` and `generateBlog` to a background job queue (BullMQ / similar)
- Returning a job ID immediately and polling for completion
- The database schema and service layer are already designed to support this pattern — the `ContentEngineSearch` → `AiAnalysisResult` → `GeneratedBlogDraft` chain maps cleanly to async job stages
