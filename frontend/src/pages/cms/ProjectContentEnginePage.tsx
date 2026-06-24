import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search, Zap, TrendingUp, BarChart2, Tag,
  Lightbulb, FileText, ChevronDown, ChevronUp, ArrowLeft,
  Sparkles, Target, MessageSquare, AlertCircle, Clock, CheckCircle2,
  ImageIcon, RefreshCw, X, Trash2,
} from 'lucide-react';
import {
  useAnalyzeTopic, useGenerateBlog, useCreateCmsDraft,
  useContentEngineHistory, useContentEngineImages,
  useDeleteSearch, useClearSearches,
} from '../../hooks/useContentEngine';
import type { AiAnalysisResult, GeneratedBlogDraft, BlogIdea } from '../../api/contentEngine';

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold text-white ${color}`}>
        {value}
      </div>
      <span className="text-xs text-gray-500 mt-1 text-center">{label}</span>
    </div>
  );
}

// ─── Sentiment badge ──────────────────────────────────────────────────────────

function SentimentBadge({ label, confidence }: { label: string; confidence: number }) {
  const map: Record<string, string> = {
    positive: 'bg-green-100 text-green-800',
    negative: 'bg-red-100 text-red-800',
    neutral: 'bg-gray-100 text-gray-700',
    mixed: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${map[label] ?? map.neutral}`}>
      {label} ({Math.round(confidence * 100)}% confidence)
    </span>
  );
}

// ─── Tag pill ─────────────────────────────────────────────────────────────────

function TagPill({ label }: { label: string }) {
  return (
    <span className="px-2 py-1 bg-brand-50 text-brand-700 rounded text-xs font-medium border border-brand-100">
      {label}
    </span>
  );
}

// ─── Generated blog view ──────────────────────────────────────────────────────

function GeneratedBlogPanel({
  draft,
  projectId,
  onDraftCreated,
}: {
  draft: GeneratedBlogDraft;
  projectId: string;
  onDraftCreated: (blogId: string) => void;
}) {
  const navigate = useNavigate();
  const createDraft = useCreateCmsDraft(projectId);
  const [creating, setCreating] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Array<{ url: string; altText: string }>>([]);
  const [showImages, setShowImages] = useState(false);

  // Use the blog title for image search — much more relevant than generic tags
  const imageQuery = draft.title || draft.tags?.slice(0, 3).join(' ') || '';
  const { data: images, isFetching: loadingImages, refetch: refetchImages } =
    useContentEngineImages(projectId, imageQuery, showImages);

  const toggleImage = (img: { url: string; altText: string }) => {
    setSelectedImages(prev => {
      const exists = prev.some(s => s.url === img.url);
      return exists ? prev.filter(s => s.url !== img.url) : [...prev, img];
    });
  };

  const handleUseDraft = async () => {
    setCreating(true);
    try {
      const featured = selectedImages[0];
      const result = await createDraft.mutateAsync({
        generatedDraftId: draft.id,
        featuredImageUrl: featured?.url,
        featuredImageAlt: featured?.altText,
        // Pass all images so the service can inject #2+ as inline image blocks
        contentImages: selectedImages,
      });
      if (result.cmsBlog?.id) {
        onDraftCreated(result.cmsBlog.id);
        navigate(`/cms/projects/${projectId}/blogs/${result.cmsBlog.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  // Content blocks support both { type, data: { text } } and legacy { type, content }
  const blocks: any[] = Array.isArray(draft.content)
    ? draft.content
    : draft.content?.blocks ?? [];

  return (
    <div className="mt-6 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Generated Blog Draft
          </h3>
          <p className="text-brand-200 text-sm mt-0.5">{draft.title}</p>
        </div>
        <button
          onClick={handleUseDraft}
          disabled={creating || draft.status === 'draft_created'}
          className="bg-white text-brand-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-50 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          {draft.status === 'draft_created' ? (
            <><CheckCircle2 className="w-4 h-4 text-green-600" /> Draft Created</>
          ) : creating ? (
            <><div className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" /> Creating…</>
          ) : (
            <><FileText className="w-4 h-4" /> Use as CMS Draft</>
          )}
        </button>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 pb-6 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Slug</p>
            <p className="text-sm text-gray-700 font-mono bg-gray-50 px-2 py-1 rounded">{draft.slug}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Excerpt</p>
            <p className="text-sm text-gray-600 line-clamp-2">{draft.excerpt}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Tags</p>
            <div className="flex flex-wrap gap-1">
              {draft.tags.slice(0, 5).map((t) => <TagPill key={t} label={t} />)}
            </div>
          </div>
        </div>

        {/* ── Image Picker ── */}
        <div className="mb-6 pb-6 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              Blog Images
              {selectedImages.length > 0 && (
                <span className="bg-brand-100 text-brand-700 px-1.5 py-0.5 rounded-full font-semibold">
                  {selectedImages.length} selected
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {selectedImages.length > 0 && (
                <button onClick={() => setSelectedImages([])}
                  className="text-xs text-red-500 hover:text-red-700 font-medium">
                  Clear selection
                </button>
              )}
              <button
                onClick={() => { setShowImages(true); if (showImages) refetchImages(); }}
                className="text-xs text-brand-600 hover:text-brand-800 flex items-center gap-1 font-medium border border-brand-200 px-2 py-1 rounded-md hover:bg-brand-50"
              >
                <RefreshCw className={`w-3 h-3 ${loadingImages ? 'animate-spin' : ''}`} />
                {showImages ? 'Refresh' : 'Browse Images'}
              </button>
            </div>
          </div>

          {/* Selected images strip */}
          {selectedImages.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-3">
              {selectedImages.map((img, i) => (
                <div key={i} className="relative group">
                  <img src={img.url} alt={img.altText}
                    className="h-20 w-28 object-cover rounded-lg border-2 border-brand-400" />
                  <span className="absolute top-0.5 left-0.5 bg-brand-600 text-white text-[9px] font-bold px-1 rounded">
                    {i === 0 ? 'COVER' : `#${i + 1}`}
                  </span>
                  <button onClick={() => toggleImage(img)}
                    className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showImages && (
            loadingImages ? (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                Searching images…
              </div>
            ) : images && images.length > 0 ? (
              <>
                <p className="text-xs text-gray-400 mb-2">
                  Click to select · First image = cover photo · All images attached to draft
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
                  {images.map((img, i) => {
                    const isSelected = selectedImages.some(s => s.url === img.url);
                    const selIdx = selectedImages.findIndex(s => s.url === img.url);
                    return (
                      <button key={i}
                        onClick={() => toggleImage({ url: img.url, altText: img.altText })}
                        className={`relative rounded-lg overflow-hidden border-2 transition-all text-left group ${isSelected ? 'border-brand-500 ring-2 ring-brand-300' : 'border-gray-200 hover:border-brand-300'}`}>
                        <img src={img.thumbUrl} alt={img.altText}
                          className="w-full h-20 object-cover bg-gray-100" loading="lazy"
                          onError={(e) => {
                            const kw = encodeURIComponent(img.altText.slice(0, 40));
                            (e.target as HTMLImageElement).src = `https://loremflickr.com/400/250/${kw}?lock=${i + 10}`;
                          }} />
                        {isSelected && (
                          <div className="absolute inset-0 bg-brand-600/20 flex items-center justify-center">
                            <span className="bg-brand-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                              {selIdx === 0 ? 'COVER' : `#${selIdx + 1}`}
                            </span>
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="text-[9px] text-white truncate">{img.source}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400 py-2">Could not load images. Check your connection and try refreshing.</p>
            )
          )}
        </div>

        <div className="prose prose-sm max-w-none">
          {blocks.map((block: any, i: number) => {
            const text = block?.data?.text ?? block?.content ?? '';
            const level = block?.data?.level ?? block?.level ?? 2;
            if (block.type === 'header' || block.type === 'heading') {
              const Tag = (`h${level}`) as 'h1' | 'h2' | 'h3';
              const cls = level === 2
                ? 'text-xl font-bold text-gray-900 mt-6 mb-2'
                : 'text-base font-semibold text-gray-800 mt-4 mb-1';
              return <Tag key={i} className={cls}>{text}</Tag>;
            }
            return (
              <p key={i} className="text-gray-700 leading-relaxed mb-3">
                {text}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Analysis result card ─────────────────────────────────────────────────────

function AnalysisCard({
  analysis,
  projectId,
  onClose,
}: {
  analysis: AiAnalysisResult;
  projectId: string;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<BlogIdea | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedBlogDraft | null>(null);
  const [generateError, setGenerateError] = useState('');
  const generateBlog = useGenerateBlog(projectId);
  const navigate = useNavigate();

  const handleGenerate = async (idea?: BlogIdea) => {
    const target = idea ?? selectedIdea;
    setSelectedIdea(target ?? null);
    setGenerateError('');
    try {
      const result = await generateBlog.mutateAsync({
        analysisId: analysis.id,
        selectedIdea: target ? `${target.title} — ${target.angle}` : undefined,
      });
      setGeneratedDraft(result.draft);
    } catch (err: any) {
      const msg =
        err?.response?.data?.error?.message ??
        err?.response?.data?.message ??
        err?.message ??
        'Blog generation failed. Please try again.';
      setGenerateError(msg);
    }
  };

  const trendColor = analysis.trendScore >= 70 ? 'bg-green-500' : analysis.trendScore >= 40 ? 'bg-amber-500' : 'bg-gray-400';
  const viralColor = analysis.viralScore >= 70 ? 'bg-purple-500' : analysis.viralScore >= 40 ? 'bg-blue-500' : 'bg-gray-400';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 mb-1">{analysis.recommendedTitle}</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{analysis.summary}</p>
          </div>
          <button onClick={onClose}
            className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Close">
            <X className="w-4 h-4" />
          </button>
          <div className="flex gap-4 shrink-0">
            <ScoreBadge label="Trend" value={analysis.trendScore} color={trendColor} />
            <ScoreBadge label="Viral" value={analysis.viralScore} color={viralColor} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <SentimentBadge label={analysis.sentiment?.label ?? 'neutral'} confidence={analysis.sentiment?.confidence ?? 0.5} />
          <span className="text-sm text-gray-500 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {new Date(analysis.createdAt).toLocaleString()}
          </span>
        </div>

        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-4 py-3 border border-gray-100 leading-relaxed">
          <span className="font-medium text-gray-900">Engagement: </span>
          {analysis.engagementInsight}
        </p>
      </div>

      {/* Scores + keywords */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-gray-100">
        {/* SEO Keywords */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-brand-500" />
            SEO Keywords
          </h4>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-gray-400 mb-1">Primary</p>
              <div className="flex flex-wrap gap-1">
                {(analysis.seoKeywords?.primary ?? []).map((k) => <TagPill key={k} label={k} />)}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Long-tail</p>
              <div className="flex flex-wrap gap-1">
                {(analysis.seoKeywords?.long_tail ?? []).slice(0, 6).map((k) => (
                  <span key={k} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{k}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Trending subtopics */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-green-500" />
            Trending Subtopics
          </h4>
          <div className="flex flex-wrap gap-1">
            {(analysis.trendingSubtopics ?? []).map((t) => (
              <span key={t} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs border border-green-100">{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Expandable section */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-3 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2 transition-colors border-b border-gray-100"
      >
        {expanded ? <><ChevronUp className="w-4 h-4" /> Hide details</> : <><ChevronDown className="w-4 h-4" /> Show questions & pain points</>}
      </button>

      {expanded && (
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-gray-100 bg-gray-50">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              Common Questions
            </h4>
            <ul className="space-y-1.5">
              {(analysis.commonQuestions ?? []).map((q) => (
                <li key={q} className="text-sm text-gray-600 flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5 shrink-0">?</span>
                  {q}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-red-400" />
              Pain Points
            </h4>
            <ul className="space-y-1.5">
              {(analysis.painPoints ?? []).map((p) => (
                <li key={p} className="text-sm text-gray-600 flex items-start gap-2">
                  <span className="text-red-400 mt-0.5 shrink-0">•</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Blog ideas */}
      <div className="p-6 border-b border-gray-100">
        <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          Blog Content Ideas
        </h4>
        <div className="space-y-2">
          {(analysis.blogIdeas ?? []).map((idea, i) => (
            <div
              key={i}
              className={`rounded-lg border p-3 cursor-pointer transition-all ${
                selectedIdea?.title === idea.title
                  ? 'border-brand-400 bg-brand-50'
                  : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'
              }`}
              onClick={() => setSelectedIdea(selectedIdea?.title === idea.title ? null : idea)}
            >
              <p className="text-sm font-medium text-gray-900">{idea.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{idea.angle}</p>
              <p className="text-xs text-brand-600 mt-1 font-medium">→ {idea.target_audience}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex flex-wrap gap-1 items-center">
          <Tag className="w-3.5 h-3.5 text-gray-400 mr-1" />
          {(analysis.recommendedTags ?? []).map((t) => (
            <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{t}</span>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="px-6 py-4 flex flex-wrap gap-3">
        <button
          onClick={() => handleGenerate()}
          disabled={generateBlog.isPending}
          className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          {generateBlog.isPending ? (
            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Generate Blog{selectedIdea ? ' (Selected Idea)' : ''}</>
          )}
        </button>

        {generatedDraft && generatedDraft.status === 'draft_created' && generatedDraft.cmsBlogId && (
          <button
            onClick={() => navigate(`/cms/projects/${projectId}/blogs/${generatedDraft.cmsBlogId}`)}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            Open in CMS Editor
          </button>
        )}
      </div>

      {/* Generated blog output */}
      {generateError && (
        <div className="mx-6 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{generateError}</span>
        </div>
      )}

      {generatedDraft && (
        <div className="px-6 pb-6">
          <GeneratedBlogPanel
            draft={generatedDraft}
            projectId={projectId}
            onDraftCreated={(blogId) => {
              setGeneratedDraft((d) => d ? { ...d, status: 'draft_created', cmsBlogId: blogId } : d);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectContentEnginePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [topic, setTopic] = useState('');
  const [timeRange, setTimeRange] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');
  const [results, setResults] = useState<AiAnalysisResult[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState('');

  const analyzeTopic = useAnalyzeTopic(projectId!);
  const { data: history } = useContentEngineHistory(projectId!);
  const deleteSearch = useDeleteSearch(projectId!);
  const clearSearches = useClearSearches(projectId!);

  const visibleResults = results.filter(r => !dismissedIds.has(r.id));
  const dismissResult = (id: string) => setDismissedIds(prev => new Set([...prev, id]));

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setErrorMsg('');
    try {
      const result = await analyzeTopic.mutateAsync({
        topic: topic.trim(),
        timeRange: timeRange || undefined,
        sentimentFilter: sentimentFilter || undefined,
      });
      setResults((prev) => [result, ...prev]);
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error?.message ?? err?.response?.data?.message;
      const status = err?.response?.status;
      const msg = serverMsg
        ?? (status === 503 ? 'Anthropic API is temporarily overloaded — please wait a few seconds and try again.'
          : status === 429 ? 'Rate limit reached. Please wait a moment and try again.'
          : err?.message ?? 'Analysis failed. Check that AI_API_KEY is configured and try again.');
      setErrorMsg(msg);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate(`/cms/projects/${projectId}/blogs`)}
          className="mb-4 text-brand-600 hover:text-brand-800 text-sm flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blog Management
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Zap className="w-7 h-7 text-brand-600" />
              Content Engine
            </h1>
            <p className="text-gray-500 mt-1">
              Discover trending discussions and generate AI-powered SEO content ideas.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
            <BarChart2 className="w-3.5 h-3.5" />
            {history?.length ?? 0} searches this project
          </div>
        </div>
      </div>

      {/* Search section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-8">
        <h2 className="text-base font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-brand-500" />
          Analyze a Topic
        </h2>

        <form onSubmit={handleAnalyze}>
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. AI coding tools, Redis performance, Kubernetes security…"
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              disabled={analyzeTopic.isPending}
            />
            <button
              type="submit"
              disabled={analyzeTopic.isPending || !topic.trim()}
              className="bg-brand-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {analyzeTopic.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Analyzing…
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Analyze Topic
                </>
              )}
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Time Range:</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="border border-gray-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                disabled={analyzeTopic.isPending}
              >
                <option value="">Any time</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-500">Sentiment:</label>
              <select
                value={sentimentFilter}
                onChange={(e) => setSentimentFilter(e.target.value)}
                className="border border-gray-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                disabled={analyzeTopic.isPending}
              >
                <option value="">All sentiments</option>
                <option value="positive">Positive</option>
                <option value="negative">Negative</option>
                <option value="neutral">Neutral</option>
              </select>
            </div>
          </div>
        </form>

        {/* Loading state */}
        {analyzeTopic.isPending && (
          <div className="mt-5 flex items-center gap-3 text-sm text-gray-500 bg-brand-50 border border-brand-100 rounded-lg px-4 py-3">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
            <span>
              AI is analyzing <strong className="text-gray-800">{topic}</strong> — discovering trends, sentiment, and content opportunities…
            </span>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {errorMsg}
          </div>
        )}
      </div>

      {/* Results */}
      {visibleResults.length > 0 && (
        <div className="space-y-6 mb-10">
          <h2 className="text-base font-semibold text-gray-700 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-500" />
            Analysis Results ({visibleResults.length})
          </h2>
          {visibleResults.map((analysis) => (
            <AnalysisCard
              key={analysis.id}
              analysis={analysis}
              projectId={projectId!}
              onClose={() => dismissResult(analysis.id)}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !analyzeTopic.isPending && (
        <div className="text-center py-16 text-gray-400">
          <Zap className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <h3 className="text-lg font-semibold text-gray-500 mb-1">Ready to discover content opportunities</h3>
          <p className="text-sm">Search any topic above to get AI-powered trend insights and SEO-optimised blog ideas.</p>
        </div>
      )}

      {/* Search history */}
      {history && history.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
              <Clock className="w-3.5 h-3.5" />
              Recent Searches
            </h2>
            <button
              onClick={() => clearSearches.mutate()}
              disabled={clearSearches.isPending}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 font-medium disabled:opacity-50"
            >
              <Trash2 className="w-3 h-3" />
              Clear All
            </button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {history.slice(0, 20).map((search) => (
              <div key={search.id} className="px-5 py-3 flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="text-sm font-medium text-gray-700 truncate">{search.topic}</span>
                  {search.timeRange && (
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{search.timeRange}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {search.results[0] && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded text-white ${search.results[0].trendScore >= 70 ? 'bg-green-500' : search.results[0].trendScore >= 40 ? 'bg-amber-500' : 'bg-gray-400'}`}>
                      {search.results[0].trendScore}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {new Date(search.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => {
                      setTopic(search.topic);
                      if (search.results[0]) {
                        setResults(prev => {
                          const already = prev.find(r => r.id === search.results[0].id);
                          if (!already) {
                            setDismissedIds(d => { const n = new Set(d); n.delete(search.results[0].id); return n; });
                          }
                          return already ? prev : [search.results[0] as AiAnalysisResult, ...prev];
                        });
                      }
                    }}
                    className="text-xs text-brand-600 hover:text-brand-800 font-medium"
                  >
                    View
                  </button>
                  <button
                    onClick={() => deleteSearch.mutate(search.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    title="Delete this search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
