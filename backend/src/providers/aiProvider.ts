import { env } from '../config/env';
import { AppError } from '../utils/errors';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface TopicAnalysis {
  topic: string;
  summary: string;
  sentiment: { label: 'positive' | 'negative' | 'neutral' | 'mixed'; confidence: number };
  trend_score: number;
  viral_score: number;
  engagement_insight: string;
  trending_subtopics: string[];
  common_questions: string[];
  pain_points: string[];
  seo_keywords: { primary: string[]; long_tail: string[]; questions: string[] };
  blog_ideas: Array<{ title: string; angle: string; target_audience: string }>;
  recommended_title: string;
  recommended_tags: string[];
}

export interface GeneratedBlog {
  title: string;
  slug: string;
  excerpt: string;
  meta_description: string;
  content: {
    introduction: string;
    sections: Array<{ heading: string; content: string }>;
    faqs: Array<{ question: string; answer: string }>;
    conclusion: string;
    cta: string;
  };
  tags: string[];
  categories: string[];
}

export interface IAIProvider {
  analyzeTopic(topic: string, options?: { timeRange?: string; sentiment?: string }): Promise<TopicAnalysis>;
  generateBlog(topic: string, analysis: TopicAnalysis, selectedIdea?: string): Promise<GeneratedBlog>;
}

// ─── Anthropic (Claude) Provider ─────────────────────────────────────────────

class AnthropicProvider implements IAIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey;
    this.model = model || 'claude-opus-4-7';
  }

  private async call(prompt: string, maxTokens: number, attempt = 1): Promise<string> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as any;
      const detail = body?.error?.message ?? '';

      // Transient errors — retry up to 3 times with exponential backoff
      if ((response.status === 529 || response.status === 503 || response.status === 502) && attempt < 3) {
        const delay = attempt * 8_000; // 8s, 16s
        console.warn(`Anthropic ${response.status} (attempt ${attempt}/3) — retrying in ${delay / 1000}s…`);
        await new Promise((r) => setTimeout(r, delay));
        return this.call(prompt, maxTokens, attempt + 1);
      }

      if (response.status === 529 || response.status === 503) {
        throw new AppError(503, 'AI_OVERLOADED', 'Anthropic API is temporarily overloaded. Please wait a few seconds and try again.');
      }
      if (response.status === 401) {
        throw new AppError(502, 'AI_AUTH_ERROR', `Anthropic API key is invalid or expired. Check AI_API_KEY in your .env. (${detail})`);
      }
      if (response.status === 429) {
        throw new AppError(429, 'AI_RATE_LIMIT', 'Anthropic API rate limit reached. Please wait a moment and try again.');
      }
      if (response.status === 404) {
        throw new AppError(502, 'AI_MODEL_NOT_FOUND', `Model "${this.model}" not found. Check AI_MODEL in your .env.`);
      }
      throw new AppError(502, 'AI_PROVIDER_ERROR', `Anthropic API error ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as any;
    return data?.content?.[0]?.text ?? '';
  }

  async analyzeTopic(topic: string, options?: { timeRange?: string; sentiment?: string }): Promise<TopicAnalysis> {
    const timeCtx = options?.timeRange ? `Focus on discussions from the last ${options.timeRange}.` : '';
    const sentCtx = options?.sentiment ? `Emphasise ${options.sentiment} sentiment signals.` : '';

    const prompt = `You are an AI content intelligence analyst with deep knowledge of online discussion patterns, social media trends, tech forums, Reddit, LinkedIn, Twitter/X, Hacker News, and SEO.

Analyse the topic: "${topic}"

${timeCtx} ${sentCtx}

Based on your broad knowledge of online conversations, trending discussions, community sentiment, and search behaviour around this topic, produce a structured analysis.

Return ONLY valid JSON (no markdown fences, no explanation). Schema:

{
  "topic": "string",
  "summary": "2-3 sentences describing the current discussion landscape",
  "sentiment": { "label": "positive|negative|neutral|mixed", "confidence": 0.0-1.0 },
  "trend_score": 0-100,
  "viral_score": 0-100,
  "engagement_insight": "detailed insight about discussion intensity, communities active, audience demographics",
  "trending_subtopics": ["array of 5-8 trending subtopics"],
  "common_questions": ["array of 6-10 questions people commonly ask about this topic"],
  "pain_points": ["array of 5-7 frustrations or pain points people discuss"],
  "seo_keywords": {
    "primary": ["5-8 high-volume primary keywords"],
    "long_tail": ["8-12 specific long-tail keyword phrases"],
    "questions": ["6-10 question-format keywords ideal for FAQs"]
  },
  "blog_ideas": [
    { "title": "string", "angle": "unique content angle", "target_audience": "string" }
  ],
  "recommended_title": "best SEO-optimised title for a blog post",
  "recommended_tags": ["8-12 relevant content tags"]
}

Generate exactly 5 blog_ideas. trend_score reflects current momentum (100 = peak trending). viral_score reflects shareability potential.`;

    const raw = await this.call(prompt, 2000);
    return this.parseJson<TopicAnalysis>(raw, topic);
  }

  async generateBlog(topic: string, analysis: TopicAnalysis, selectedIdea?: string): Promise<GeneratedBlog> {
    const ideaCtx = selectedIdea ? `\n\nFocus specifically on this content angle: ${selectedIdea}` : '';
    const keywordsFlat = [
      ...(analysis.seo_keywords.primary || []),
      ...(analysis.seo_keywords.long_tail.slice(0, 4) || []),
    ].join(', ');

    const prompt = `You are an expert SEO content writer. Write a comprehensive, original, SEO-optimised blog post about: "${topic}"${ideaCtx}

Context from trend analysis:
- Summary: ${analysis.summary}
- Target keywords: ${keywordsFlat}
- Common reader questions: ${analysis.common_questions.slice(0, 5).join('; ')}
- Pain points to address: ${analysis.pain_points.slice(0, 4).join('; ')}
- Recommended title: ${analysis.recommended_title}

Requirements:
- 1500-2500 words total
- SEO-friendly, scannable, no fluff
- 4-6 main sections with clear H2 headings
- 3-5 FAQs answering real reader questions
- Compelling introduction and strong CTA
- Original — do NOT copy any source verbatim

Return ONLY valid JSON (no markdown fences, no explanation). Schema:

{
  "title": "string",
  "slug": "url-friendly-slug-max-70-chars",
  "excerpt": "150-160 character compelling excerpt for meta description",
  "meta_description": "155 character SEO meta description",
  "content": {
    "introduction": "2-3 paragraph hook that establishes context and reader value",
    "sections": [
      { "heading": "H2 section heading", "content": "Full section content in plain text with natural paragraph breaks. 250-400 words per section." }
    ],
    "faqs": [
      { "question": "string", "answer": "2-3 sentence answer" }
    ],
    "conclusion": "Summarising paragraph with key takeaways",
    "cta": "Call-to-action paragraph encouraging reader engagement"
  },
  "tags": ["8-12 relevant tags"],
  "categories": ["1-3 broad categories"]
}`;

    const raw = await this.call(prompt, 7500);
    return this.parseJson<GeneratedBlog>(raw, topic);
  }

  private parseJson<T>(raw: string, topic: string): T {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    // First attempt: parse as-is
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Second attempt: try to repair a truncated JSON string by closing
      // open structures. This handles the case where max_tokens cut the
      // response mid-string.
      const repaired = this.repairJson(cleaned);
      try {
        return JSON.parse(repaired) as T;
      } catch {
        throw new AppError(
          502,
          'AI_INVALID_RESPONSE',
          `The AI response was incomplete (token limit reached). Please try again — the model will generate a shorter response. Topic: "${topic}"`,
        );
      }
    }
  }

  private repairJson(s: string): string {
    // Close any unclosed string by appending a quote if the last char is not
    // a delimiter, then close all open brackets/braces.
    let result = s.trimEnd();

    // If we're mid-string (odd number of unescaped quotes at the end), close it
    const lastQuotePos = result.lastIndexOf('"');
    const lastClosingPos = Math.max(
      result.lastIndexOf('}'),
      result.lastIndexOf(']'),
      result.lastIndexOf(','),
    );
    if (lastQuotePos > lastClosingPos) {
      // We're inside an unclosed string — close it
      result += '"';
    } else if (result.endsWith(',')) {
      // Trailing comma before the cut — remove it
      result = result.slice(0, -1);
    }

    // Count and close unclosed brackets/braces
    const opens: string[] = [];
    let inString = false;
    for (let i = 0; i < result.length; i++) {
      const ch = result[i];
      if (ch === '"' && (i === 0 || result[i - 1] !== '\\')) inString = !inString;
      if (!inString) {
        if (ch === '{' || ch === '[') opens.push(ch === '{' ? '}' : ']');
        else if (ch === '}' || ch === ']') opens.pop();
      }
    }
    // Close all open structures in reverse order
    for (let i = opens.length - 1; i >= 0; i--) {
      result += opens[i];
    }
    return result;
  }
}

// ─── OpenAI-compatible Provider ───────────────────────────────────────────────

class OpenAIProvider implements IAIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model || 'gpt-4o';
    this.baseUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
  }

  private async call(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as any;
      const detail = body?.error?.message ?? '';
      if (response.status === 401) {
        throw new AppError(502, 'AI_AUTH_ERROR', `OpenAI API key is invalid or expired. Check AI_API_KEY in your .env. (${detail})`);
      }
      if (response.status === 429) {
        throw new AppError(502, 'AI_RATE_LIMIT', 'OpenAI API rate limit reached. Please try again in a moment.');
      }
      throw new AppError(502, 'AI_PROVIDER_ERROR', `OpenAI API error ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as any;
    return data?.choices?.[0]?.message?.content ?? '';
  }

  async analyzeTopic(topic: string, options?: { timeRange?: string; sentiment?: string }): Promise<TopicAnalysis> {
    const timeCtx = options?.timeRange ? `Focus on discussions from the last ${options.timeRange}.` : '';
    const sentCtx = options?.sentiment ? `Emphasise ${options.sentiment} sentiment signals.` : '';

    const system = 'You are an AI content intelligence analyst. Always respond with valid JSON only.';
    const user = `Analyse the topic: "${topic}" ${timeCtx} ${sentCtx}

Return ONLY valid JSON matching this schema:
{
  "topic": "string", "summary": "string",
  "sentiment": { "label": "positive|negative|neutral|mixed", "confidence": 0.0-1.0 },
  "trend_score": 0-100, "viral_score": 0-100,
  "engagement_insight": "string",
  "trending_subtopics": ["5-8 items"], "common_questions": ["6-10 items"], "pain_points": ["5-7 items"],
  "seo_keywords": { "primary": ["5-8"], "long_tail": ["8-12"], "questions": ["6-10"] },
  "blog_ideas": [{ "title": "string", "angle": "string", "target_audience": "string" }],
  "recommended_title": "string", "recommended_tags": ["8-12 items"]
}
Generate exactly 5 blog_ideas.`;

    const raw = await this.call(system, user, 2000);
    return JSON.parse(raw) as TopicAnalysis;
  }

  async generateBlog(topic: string, analysis: TopicAnalysis, selectedIdea?: string): Promise<GeneratedBlog> {
    const system = 'You are an expert SEO content writer. Always respond with valid JSON only.';
    const ideaCtx = selectedIdea ? `Focus on: ${selectedIdea}.` : '';

    const user = `Write a comprehensive SEO-optimised blog post about "${topic}". ${ideaCtx}
Keywords: ${analysis.seo_keywords.primary.join(', ')}.
Questions to answer: ${analysis.common_questions.slice(0, 5).join('; ')}.

Return ONLY valid JSON:
{
  "title": "string", "slug": "string", "excerpt": "string", "meta_description": "string",
  "content": {
    "introduction": "string",
    "sections": [{ "heading": "string", "content": "string" }],
    "faqs": [{ "question": "string", "answer": "string" }],
    "conclusion": "string", "cta": "string"
  },
  "tags": ["array"], "categories": ["array"]
}`;

    const raw = await this.call(system, user, 7500);
    return JSON.parse(raw) as GeneratedBlog;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAIProvider(): IAIProvider {
  const apiKey = env.AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AI_API_KEY is not configured. Set it in your .env file to use the Content Engine.'
    );
  }

  if (env.AI_PROVIDER === 'openai') {
    return new OpenAIProvider(apiKey, env.AI_MODEL, env.AI_BASE_URL);
  }

  return new AnthropicProvider(apiKey, env.AI_MODEL);
}
