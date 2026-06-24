import apiClient from './client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeoKeywords {
  primary: string[];
  long_tail: string[];
  questions: string[];
}

export interface BlogIdea {
  title: string;
  angle: string;
  target_audience: string;
}

export interface Sentiment {
  label: 'positive' | 'negative' | 'neutral' | 'mixed';
  confidence: number;
}

export interface AiAnalysisResult {
  id: string;
  searchId: string;
  topic: string;
  summary: string;
  sentiment: Sentiment;
  trendScore: number;
  viralScore: number;
  engagementInsight: string;
  trendingSubtopics: string[];
  commonQuestions: string[];
  painPoints: string[];
  seoKeywords: SeoKeywords;
  blogIdeas: BlogIdea[];
  recommendedTitle: string;
  recommendedTags: string[];
  createdAt: string;
  generatedDrafts?: Array<{ id: string; status: string; cmsBlogId: string | null }>;
}

export interface GeneratedBlogDraft {
  id: string;
  analysisId: string;
  projectId: string;
  cmsBlogId: string | null;
  title: string;
  slug: string;
  excerpt: string;
  content: any;
  seo: any;
  tags: string[];
  categories: string[];
  status: 'generated' | 'draft_created';
  createdAt: string;
}

export interface ContentEngineSearch {
  id: string;
  projectId: string;
  topic: string;
  timeRange: string | null;
  sentimentFilter: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  results: AiAnalysisResult[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

const unwrap = (res: any) => res?.data?.data ?? res?.data;

export const contentEngineApi = {
  analyzeTopic: (
    projectId: string,
    data: { topic: string; timeRange?: string; sentimentFilter?: string },
  ) =>
    apiClient
      .post(`/content-engine/${projectId}/analyze`, data)
      .then(unwrap) as Promise<AiAnalysisResult>,

  generateBlog: (
    projectId: string,
    data: { analysisId: string; selectedIdea?: string },
  ) =>
    apiClient
      .post(`/content-engine/${projectId}/generate-blog`, data)
      .then(unwrap) as Promise<{ draft: GeneratedBlogDraft; blog: any }>,

  createDraft: (projectId: string, data: {
    generatedDraftId: string;
    featuredImageUrl?: string;
    featuredImageAlt?: string;
    contentImages?: Array<{ url: string; altText: string }>;
  }) =>
    apiClient
      .post(`/content-engine/${projectId}/create-draft`, data)
      .then(unwrap) as Promise<{ cmsBlog: any; generatedDraft: GeneratedBlogDraft; alreadyExists: boolean }>,

  getImages: (projectId: string, query: string) =>
    apiClient
      .get(`/content-engine/${projectId}/images?query=${encodeURIComponent(query)}`)
      .then(unwrap) as Promise<Array<{ url: string; thumbUrl: string; title: string; altText: string; source: string }>>,

  getHistory: (projectId: string, limit = 20) =>
    apiClient
      .get(`/content-engine/${projectId}/history?limit=${limit}`)
      .then(unwrap) as Promise<ContentEngineSearch[]>,

  deleteSearch: (projectId: string, searchId: string) =>
    apiClient.delete(`/content-engine/${projectId}/searches/${searchId}`),

  clearSearches: (projectId: string) =>
    apiClient.delete(`/content-engine/${projectId}/searches`),
};
