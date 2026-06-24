import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ContentEngineService } from '../services/contentEngine.service';
import prisma from '../config/database';

// ─── Validation schemas ───────────────────────────────────────────────────────

const analyzeTopicSchema = z.object({
  topic: z.string().min(2).max(200).trim(),
  timeRange: z.enum(['24h', '7d', '30d']).optional(),
  sentimentFilter: z.enum(['positive', 'negative', 'neutral']).optional(),
});

const generateBlogSchema = z.object({
  analysisId: z.string().uuid(),
  selectedIdea: z.string().max(500).optional(),
});

const createDraftSchema = z.object({
  generatedDraftId: z.string().uuid(),
  featuredImageUrl: z.string().url().optional(),
  featuredImageAlt: z.string().max(200).optional(),
  // All selected images (including the featured one). The service distributes
  // images #2+ as image blocks inside the blog content.
  contentImages: z.array(z.object({
    url: z.string().url(),
    altText: z.string().max(200),
  })).optional(),
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export async function analyzeTopic(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    const parsed = analyzeTopicSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthenticated' });
      return;
    }

    const result = await ContentEngineService.analyzeTopic({
      projectId,
      createdById: userId,
      topic: parsed.data.topic,
      timeRange: parsed.data.timeRange,
      sentimentFilter: parsed.data.sentimentFilter,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function generateBlog(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    const parsed = generateBlogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthenticated' });
      return;
    }

    const result = await ContentEngineService.generateBlog({
      projectId,
      createdById: userId,
      analysisId: parsed.data.analysisId,
      selectedIdea: parsed.data.selectedIdea,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createDraft(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    const parsed = createDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthenticated' });
      return;
    }

    const result = await ContentEngineService.createCmsDraft({
      projectId,
      createdById: userId,
      generatedDraftId: parsed.data.generatedDraftId,
      featuredImageUrl: parsed.data.featuredImageUrl,
      featuredImageAlt: parsed.data.featuredImageAlt,
      contentImages: parsed.data.contentImages,
    });

    const statusCode = result.alreadyExists ? 200 : 201;
    res.status(statusCode).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);

    const history = await ContentEngineService.getHistory(projectId, limit);
    res.json({ success: true, data: history });
  } catch (err) {
    next(err);
  }
}

/**
 * Fetch royalty-free images from Wikimedia Commons — no API key required.
 * Returns up to 9 image objects with { url, thumbUrl, title, description }.
 */
export async function getImages(req: Request, res: Response, next: NextFunction) {
  try {
    const query = String(req.query.query ?? '').trim();
    if (!query) {
      res.status(400).json({ success: false, error: { message: 'query param is required' } });
      return;
    }

    const images = await fetchWikimediaImages(query);
    res.json({ success: true, data: images });
  } catch (err) {
    next(err);
  }
}

export async function deleteSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId, searchId } = req.params;
    await prisma.contentEngineSearch.delete({
      where: { id: searchId, projectId },
    }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function clearSearches(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    await prisma.contentEngineSearch.deleteMany({
      where: { projectId },
    }).catch(() => null);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

interface WikiImage {
  url: string;
  thumbUrl: string;
  title: string;
  altText: string;
  source: string;
}

/**
 * Strategy 1: Wikipedia article page-images API.
 * Searches Wikipedia articles matching the query and returns their lead images.
 * High-quality, relevant, no API key required.
 */
async function fetchWikipediaImages(query: string): Promise<WikiImage[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '20',
    gsrnamespace: '0',
    prop: 'pageimages',
    piprop: 'thumbnail|original',
    pithumbsize: '800',
    pilimit: '20',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'ExargenCMS/1.0 (content-engine; blog-images)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as any;
  const pages: any[] = Object.values(data?.query?.pages ?? {});
  const results: WikiImage[] = [];

  for (const page of pages) {
    const thumb = page.thumbnail?.source || page.original?.source;
    if (!thumb) continue;
    const ext = thumb.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) continue;

    const fullUrl = page.original?.source || thumb;
    results.push({
      url: fullUrl,
      thumbUrl: thumb,
      title: page.title ?? query,
      altText: page.title ?? query,
      source: 'Wikipedia',
    });
    if (results.length >= 12) break;
  }
  return results;
}

/**
 * Strategy 2: Wikimedia Commons category/search.
 * Broader search across Commons file descriptions.
 */
async function fetchCommonsImages(query: string): Promise<WikiImage[]> {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '15',
    gsrnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '800',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'ExargenCMS/1.0 (content-engine; blog-images)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];

  const data = (await res.json()) as any;
  const pages: any[] = Object.values(data?.query?.pages ?? {});
  const results: WikiImage[] = [];

  for (const page of pages) {
    const url = page.imageinfo?.[0]?.url;
    if (!url) continue;
    const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) continue;

    results.push({
      url,
      thumbUrl: url,
      title: page.title?.replace('File:', '') ?? query,
      altText: page.title?.replace('File:', '') ?? query,
      source: 'Commons',
    });
    if (results.length >= 9) break;
  }
  return results;
}

/**
 * Strategy 3: DuckDuckGo image search (powered by Bing's index).
 * No API key required. Returns real web images highly relevant to the query.
 * Works by fetching the VQD session token then calling the image API.
 */
async function fetchDuckDuckGoImages(query: string): Promise<WikiImage[]> {
  try {
    // Step 1 — get VQD session token from DDG HTML page
    const pageRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!pageRes.ok) return [];

    const html = await pageRes.text();
    // VQD token is embedded as: vqd="..." or vqd='...' or vqd=...
    const vqdMatch = html.match(/vqd=["']?([^"'&\s]+)/);
    if (!vqdMatch?.[1]) return [];
    const vqd = vqdMatch[1];

    // Step 2 — fetch image results using the VQD token
    const imgRes = await fetch(
      `https://duckduckgo.com/i.js?q=${encodeURIComponent(query)}&o=json&s=0&l=us-en&p=1&vqd=${encodeURIComponent(vqd)}&f=,,,,,`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://duckduckgo.com/',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!imgRes.ok) return [];

    const data = (await imgRes.json()) as any;
    const results: WikiImage[] = [];

    for (const img of data?.results ?? []) {
      if (!img?.image || !img?.thumbnail) continue;
      // Skip tiny images or tracking pixels
      if ((img.width ?? 0) < 200 || (img.height ?? 0) < 150) continue;
      results.push({
        url: img.image,
        thumbUrl: img.thumbnail,
        title: img.title || query,
        altText: (img.title || query).slice(0, 120),
        source: 'Web Search',
      });
      if (results.length >= 12) break;
    }
    return results;
  } catch {
    return [];
  }
}

async function fetchWikimediaImages(query: string): Promise<WikiImage[]> {
  // Run all three sources in parallel
  const [wiki, commons, ddg] = await Promise.all([
    fetchWikipediaImages(query).catch(() => [] as WikiImage[]),
    fetchCommonsImages(query).catch(() => [] as WikiImage[]),
    fetchDuckDuckGoImages(query).catch(() => [] as WikiImage[]),
  ]);

  // DDG first (most relevant real photos), then Wikipedia, then Commons
  const combined = dedupeByUrl([...ddg, ...wiki, ...commons]);
  return combined.slice(0, 18);
}

function dedupeByUrl(images: WikiImage[]): WikiImage[] {
  const seen = new Set<string>();
  return images.filter(img => {
    if (seen.has(img.url)) return false;
    seen.add(img.url);
    return true;
  });
}
