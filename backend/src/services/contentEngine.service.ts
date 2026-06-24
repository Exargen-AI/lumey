import prisma from '../config/database';
import { createAIProvider, type TopicAnalysis, type GeneratedBlog } from '../providers/aiProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnalyzeTopicInput {
  projectId: string;
  createdById: string;
  topic: string;
  timeRange?: string;
  sentimentFilter?: string;
}

export interface GenerateBlogInput {
  projectId: string;
  createdById: string;
  analysisId: string;
  selectedIdea?: string;
}

export interface CreateDraftInput {
  projectId: string;
  createdById: string;
  generatedDraftId: string;
  featuredImageUrl?: string;
  featuredImageAlt?: string;
  contentImages?: Array<{ url: string; altText: string }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ContentEngineService {
  /**
   * Run AI topic analysis and persist the result.
   * Returns the saved AiAnalysisResult row.
   */
  static async analyzeTopic(input: AnalyzeTopicInput) {
    const { projectId, createdById, topic, timeRange, sentimentFilter } = input;

    const project = await prisma.cmsContentProject.findFirst({
      where: { id: projectId, deletedAt: null },
    });
    if (!project) throw new Error('CMS project not found');

    const provider = createAIProvider();
    const analysis = await provider.analyzeTopic(topic, {
      timeRange: timeRange ?? undefined,
      sentiment: sentimentFilter ?? undefined,
    });

    // Normalise the AI response to guarantee all required fields exist
    const seoKeywords = ContentEngineService.normalizeSeoKeywords(analysis.seo_keywords);
    const sentiment = analysis.sentiment ?? { label: 'neutral', confidence: 0.5 };
    const blogIdeas: any[] = Array.isArray(analysis.blog_ideas) ? analysis.blog_ideas : [];
    const recommendedTags: string[] = Array.isArray(analysis.recommended_tags)
      ? analysis.recommended_tags
      : [];

    const db = prisma as any;
    const result = await db.$transaction(async (tx: any) => {
      const search = await tx.contentEngineSearch.create({
        data: {
          projectId,
          createdById,
          topic: topic.trim(),
          timeRange: timeRange ?? null,
          sentimentFilter: sentimentFilter ?? null,
        },
      });

      return tx.aiAnalysisResult.create({
        data: {
          searchId: search.id,
          topic: analysis.topic || topic,
          summary: analysis.summary || '',
          sentiment: sentiment as any,
          trendScore: Math.min(100, Math.max(0, Math.round(Number(analysis.trend_score) || 50))),
          viralScore: Math.min(100, Math.max(0, Math.round(Number(analysis.viral_score) || 50))),
          engagementInsight: analysis.engagement_insight || '',
          trendingSubtopics: Array.isArray(analysis.trending_subtopics) ? analysis.trending_subtopics : [],
          commonQuestions: Array.isArray(analysis.common_questions) ? analysis.common_questions : [],
          painPoints: Array.isArray(analysis.pain_points) ? analysis.pain_points : [],
          seoKeywords: seoKeywords as any,
          blogIdeas: blogIdeas as any,
          recommendedTitle: analysis.recommended_title || topic,
          recommendedTags,
          rawResponse: analysis as any,
        },
        include: { search: true },
      });
    });

    return result;
  }

  /**
   * Generate a full blog from a prior analysis result.
   */
  static async generateBlog(input: GenerateBlogInput) {
    const { projectId, createdById, analysisId, selectedIdea } = input;

    const analysisRow = await (prisma as any).aiAnalysisResult.findUnique({
      where: { id: analysisId },
      include: { search: true },
    });
    if (!analysisRow) throw new Error('Analysis result not found');

    const seoKeywords = ContentEngineService.normalizeSeoKeywords(analysisRow.seoKeywords);

    const analysis: TopicAnalysis = {
      topic: analysisRow.topic,
      summary: analysisRow.summary,
      sentiment: analysisRow.sentiment as TopicAnalysis['sentiment'],
      trend_score: analysisRow.trendScore,
      viral_score: analysisRow.viralScore,
      engagement_insight: analysisRow.engagementInsight,
      trending_subtopics: analysisRow.trendingSubtopics,
      common_questions: analysisRow.commonQuestions,
      pain_points: analysisRow.painPoints,
      seo_keywords: seoKeywords,
      blog_ideas: (analysisRow.blogIdeas as any[]) ?? [],
      recommended_title: analysisRow.recommendedTitle,
      recommended_tags: analysisRow.recommendedTags,
    };

    const provider = createAIProvider();
    const blog: GeneratedBlog = await provider.generateBlog(analysisRow.topic, analysis, selectedIdea);

    const slug = ContentEngineService.sanitizeSlug(blog.slug || blog.title);
    const content = ContentEngineService.buildContentBlocks(blog);

    // Cast required: tsserver may lag behind prisma generate on fresh schemas
    const draft = await (prisma.generatedBlogDraft.create as any)({
      data: {
        analysisId,
        projectId,
        createdById,
        title: blog.title || analysisRow.topic,
        slug,
        excerpt: blog.excerpt || blog.meta_description || '',
        content: content,
        seo: {
          title: blog.title,
          description: blog.meta_description || blog.excerpt || '',
          keywords: seoKeywords.primary,
        },
        tags: Array.isArray(blog.tags) ? blog.tags : [],
        categories: Array.isArray(blog.categories) ? blog.categories : [],
        status: 'generated',
      },
    });

    return { draft, blog };
  }

  /**
   * Promote a generated draft into the real CmsBlog table as a DRAFT.
   */
  static async createCmsDraft(input: CreateDraftInput) {
    const { projectId, createdById, generatedDraftId, featuredImageUrl, featuredImageAlt, contentImages } = input;

    const genDraft = await (prisma as any).generatedBlogDraft.findUnique({
      where: { id: generatedDraftId },
    });
    if (!genDraft) throw new Error('Generated draft not found');

    if (genDraft.status === 'draft_created' && genDraft.cmsBlogId) {
      const existing = await prisma.cmsBlog.findUnique({ where: { id: genDraft.cmsBlogId } });
      return { cmsBlog: existing, generatedDraft: genDraft, alreadyExists: true };
    }

    const slug = await ContentEngineService.uniqueSlug(projectId, genDraft.slug);

    const featuredImage = featuredImageUrl
      ? { url: featuredImageUrl, altText: featuredImageAlt ?? genDraft.title ?? '' }
      : null;

    // Inject content images (images #2+) as image blocks distributed evenly
    // through the blog content so they appear inline when the editor opens.
    const rawBlocks: any[] = Array.isArray(genDraft.content)
      ? genDraft.content
      : Array.isArray(genDraft.content?.blocks)
        ? genDraft.content.blocks
        : [];

    const extraImages = (contentImages ?? []).slice(featuredImageUrl ? 1 : 0);
    const finalBlocks = ContentEngineService.injectImageBlocks(rawBlocks, extraImages);

    const result = await prisma.$transaction(async (tx) => {
      const cmsBlog = await tx.cmsBlog.create({
        data: {
          projectId,
          title: genDraft.title,
          slug,
          excerpt: genDraft.excerpt ?? '',
          content: finalBlocks as any,
          featuredImage: featuredImage as any,
          seo: genDraft.seo as any ?? null,
          tags: Array.isArray(genDraft.tags) ? genDraft.tags : [],
          categories: Array.isArray(genDraft.categories) ? genDraft.categories : [],
          status: 'DRAFT',
          authorId: createdById,
        },
      });

      const updatedDraft = await (tx as any).generatedBlogDraft.update({
        where: { id: generatedDraftId },
        data: { status: 'draft_created', cmsBlogId: cmsBlog.id },
      });

      return { cmsBlog, generatedDraft: updatedDraft };
    });

    return { ...result, alreadyExists: false };
  }

  /**
   * List recent content engine searches for a project.
   */
  static async getHistory(projectId: string, limit = 20) {
    // Cast: tsserver may not reflect newly generated Prisma types until restarted
    return (prisma as any).contentEngineSearch.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: { select: { id: true, name: true } },
        results: {
          select: {
            id: true,
            topic: true,
            trendScore: true,
            viralScore: true,
            sentiment: true,
            recommendedTitle: true,
            createdAt: true,
            generatedDrafts: { select: { id: true, status: true, cmsBlogId: true } },
          },
        },
      },
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Distribute extra images as image blocks evenly between major sections.
   * Uses `url` in the data so ImagePreview renders them without an assetId.
   */
  static injectImageBlocks(
    blocks: any[],
    images: Array<{ url: string; altText: string }>,
  ): any[] {
    if (!images.length) return blocks;

    // Find positions of H2 header blocks — image goes right after each heading
    const sectionStarts: number[] = [];
    blocks.forEach((b, i) => {
      if ((b.type === 'header' || b.type === 'heading') && (b.data?.level ?? b.level ?? 2) === 2) {
        sectionStarts.push(i);
      }
    });

    // Pick evenly-spaced insertion points (skip first heading — image near top looks odd)
    const insertAfter = new Map<number, { url: string; altText: string }>();
    const slots = sectionStarts.slice(1); // skip very first h2
    images.forEach((img, i) => {
      const slot = slots[i % slots.length];
      if (slot !== undefined) insertAfter.set(slot, img);
    });

    const result: any[] = [];
    let seq = Date.now();
    blocks.forEach((block, i) => {
      result.push(block);
      const img = insertAfter.get(i);
      if (img) {
        result.push({
          id: `block_ce_img_${seq++}`,
          type: 'image',
          data: {
            url: img.url,         // rendered by the patched ImagePreview
            assetId: '',          // empty — no CMS asset
            alt: img.altText,
            caption: '',
            alignment: 'center',
          },
        });
      }
    });

    // If we have more images than section slots, append them at the end
    const usedCount = insertAfter.size;
    images.slice(usedCount).forEach((img) => {
      result.push({
        id: `block_ce_img_${seq++}`,
        type: 'image',
        data: { url: img.url, assetId: '', alt: img.altText, caption: '', alignment: 'center' },
      });
    });

    return result;
  }

  static normalizeSeoKeywords(raw: any): TopicAnalysis['seo_keywords'] {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return {
        primary: Array.isArray(raw.primary) ? raw.primary : Array.isArray(raw.keywords) ? raw.keywords : [],
        long_tail: Array.isArray(raw.long_tail) ? raw.long_tail : Array.isArray(raw.longTail) ? raw.longTail : [],
        questions: Array.isArray(raw.questions) ? raw.questions : [],
      };
    }
    // AI returned an array instead of an object — treat as primary keywords
    if (Array.isArray(raw)) {
      return { primary: raw, long_tail: [], questions: [] };
    }
    return { primary: [], long_tail: [], questions: [] };
  }

  private static sanitizeSlug(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 80);
  }

  private static async uniqueSlug(projectId: string, base: string): Promise<string> {
    let slug = ContentEngineService.sanitizeSlug(base);
    let attempt = 0;
    while (true) {
      const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
      const exists = await prisma.cmsBlog.findUnique({
        where: { projectId_slug: { projectId, slug: candidate } },
      });
      if (!exists) return candidate;
      attempt++;
    }
  }

  /**
   * Convert AI blog output into a CmsContentBlock[] array matching the format
   * the RichContentEditor expects:
   *   { id: string, type: 'header'|'paragraph', data: { text, level?, alignment } }
   * Content is a FLAT ARRAY — no { blocks: [...] } wrapper.
   */
  private static buildContentBlocks(blog: GeneratedBlog): object[] {
    let seq = 0;
    const id = () => `block_ce_${Date.now()}_${seq++}`;

    const blocks: object[] = [];

    if (blog.content?.introduction) {
      blocks.push({ id: id(), type: 'paragraph', data: { text: blog.content.introduction, alignment: 'left' } });
    }

    for (const section of blog.content?.sections ?? []) {
      if (section.heading) {
        blocks.push({ id: id(), type: 'header', data: { text: section.heading, level: 2, alignment: 'left' } });
      }
      if (section.content) {
        blocks.push({ id: id(), type: 'paragraph', data: { text: section.content, alignment: 'left' } });
      }
    }

    if (blog.content?.faqs?.length) {
      blocks.push({ id: id(), type: 'header', data: { text: 'Frequently Asked Questions', level: 2, alignment: 'left' } });
      for (const faq of blog.content.faqs) {
        blocks.push({ id: id(), type: 'header', data: { text: faq.question, level: 3, alignment: 'left' } });
        blocks.push({ id: id(), type: 'paragraph', data: { text: faq.answer, alignment: 'left' } });
      }
    }

    if (blog.content?.conclusion) {
      blocks.push({ id: id(), type: 'header', data: { text: 'Conclusion', level: 2, alignment: 'left' } });
      blocks.push({ id: id(), type: 'paragraph', data: { text: blog.content.conclusion, alignment: 'left' } });
    }

    if (blog.content?.cta) {
      blocks.push({ id: id(), type: 'paragraph', data: { text: blog.content.cta, alignment: 'left' } });
    }

    return blocks;
  }
}
