/* eslint-disable no-alert -- Phase 4 migration target: replace the
   template-apply `window.confirm` with the design-system useConfirm modal. */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { CmsBlog, CmsMediaAsset, CmsContentBlock, CmsTemplate } from '@exargen/shared';
import { RichContentEditor } from './RichContentEditor';
import { MediaManager } from './MediaManager';
import { TemplateGallery } from './TemplateGallery';
import { isSampleTemplateId } from '../../lib/cmsTemplates';
import { 
  Save, 
  Eye, 
  LayoutTemplate,
  Image as ImageIcon, 
  FileText, 
  Calendar,
  User,
  Globe,
  X,
  Monitor,
  Tablet,
  Smartphone
} from 'lucide-react';

interface ProfessionalBlogEditorProps {
  blog?: CmsBlog;
  projectId: string;
  templates: CmsTemplate[];
  mediaAssets: CmsMediaAsset[];
  onSave: (blogData: Partial<CmsBlog>) => Promise<void>;
  onUploadMedia: (files: File[]) => Promise<CmsMediaAsset[]>;
  author?: { id: string; name: string; email: string };
  onManageTemplates?: () => void;
  initialTemplateId?: string;
}

export function ProfessionalBlogEditor({ 
  blog, 
  projectId, 
  templates,
  mediaAssets, 
  onSave, 
  onUploadMedia,
  author,
  onManageTemplates,
  initialTemplateId
}: ProfessionalBlogEditorProps) {
  const [activeTab, setActiveTab] = useState<'content' | 'media' | 'seo' | 'preview'>('content');
  const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isSaving, setIsSaving] = useState(false);
  const [showMediaModal, setShowMediaModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const hasAppliedInitialTemplate = useRef(false);
  
  const [blogData, setBlogData] = useState<Partial<CmsBlog>>({
    title: blog?.title || '',
    slug: blog?.slug || '',
    excerpt: blog?.excerpt || '',
    content: blog?.content || [],
    status: blog?.status || 'DRAFT',
    featuredImage: blog?.featuredImage,
    templateId: blog?.templateId,
    seo: blog?.seo || {},
    tags: blog?.tags || [],
    categories: blog?.categories || [],
    publishedAt: blog?.publishedAt,
  });

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === blogData.templateId),
    [templates, blogData.templateId]
  );

  useEffect(() => {
    const hasChanges = JSON.stringify(blogData) !== JSON.stringify({
      title: blog?.title || '',
      slug: blog?.slug || '',
      excerpt: blog?.excerpt || '',
      content: blog?.content || [],
      status: blog?.status || 'DRAFT',
      featuredImage: blog?.featuredImage,
      templateId: blog?.templateId,
      seo: blog?.seo || {},
      tags: blog?.tags || [],
      categories: blog?.categories || [],
      publishedAt: blog?.publishedAt,
    });
    setHasUnsavedChanges(hasChanges);
  }, [blogData, blog]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave(blogData);
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error('Failed to save blog:', error);
    } finally {
      setIsSaving(false);
    }
  }, [blogData, onSave]);

  const generateSlug = useCallback((title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }, []);

  const handleTitleChange = useCallback((title: string) => {
    const slug = generateSlug(title);
    setBlogData(prev => ({ ...prev, title, slug }));
  }, [generateSlug]);

  const handleContentChange = useCallback((content: CmsContentBlock[]) => {
    setBlogData(prev => ({ ...prev, content }));
  }, []);

  const handleMediaSelect = useCallback((asset: CmsMediaAsset) => {
    setBlogData(prev => ({ ...prev, featuredImage: asset }));
    setShowMediaModal(false);
  }, []);

  const cloneTemplateBlocks = useCallback((blocks: CmsContentBlock[]): CmsContentBlock[] => {
    const cloneBlock = (block: CmsContentBlock): CmsContentBlock => ({
      ...block,
      id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      data: block.data ? JSON.parse(JSON.stringify(block.data)) : {},
      children: Array.isArray(block.children) ? block.children.map(cloneBlock) : undefined,
    });

    return blocks.map(cloneBlock);
  }, []);

  useEffect(() => {
    if (hasAppliedInitialTemplate.current || !initialTemplateId || blog) {
      return;
    }

    const template = templates.find((item) => item.id === initialTemplateId);
    if (!template) {
      return;
    }

    if ((blogData.content?.length || 0) > 0) {
      hasAppliedInitialTemplate.current = true;
      return;
    }

    setBlogData((prev) => ({
      ...prev,
      templateId: isSampleTemplateId(template.id) ? undefined : template.id,
      content: cloneTemplateBlocks(template.structure || []),
    }));
    hasAppliedInitialTemplate.current = true;
  }, [blog, blogData.content?.length, cloneTemplateBlocks, initialTemplateId, templates]);

  const handleTemplateSelect = useCallback((template: CmsTemplate) => {
    const shouldReplace =
      (blogData.content?.length || 0) === 0 ||
      window.confirm('Apply this template? Your current content blocks will be replaced.');

    if (!shouldReplace) {
      return;
    }

    setBlogData(prev => ({
      ...prev,
      templateId: isSampleTemplateId(template.id) ? undefined : template.id,
      content: cloneTemplateBlocks(template.structure || []),
    }));
    setShowTemplateModal(false);
  }, [blogData.content?.length, cloneTemplateBlocks]);

  const addTag = useCallback((tag: string) => {
    if (tag && !blogData.tags?.includes(tag)) {
      setBlogData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tag]
      }));
    }
  }, [blogData.tags]);

  const removeTag = useCallback((tag: string) => {
    setBlogData(prev => ({
      ...prev,
      tags: prev.tags?.filter(t => t !== tag) || []
    }));
  }, []);

  const addCategory = useCallback((category: string) => {
    if (category && !blogData.categories?.includes(category)) {
      setBlogData(prev => ({
        ...prev,
        categories: [...(prev.categories || []), category]
      }));
    }
  }, [blogData.categories]);

  const removeCategory = useCallback((category: string) => {
    setBlogData(prev => ({
      ...prev,
      categories: prev.categories?.filter(c => c !== category) || []
    }));
  }, [blogData.categories]);

  const getPreviewWidth = () => {
    switch (previewMode) {
      case 'mobile': return 'max-w-sm';
      case 'tablet': return 'max-w-2xl';
      case 'desktop': return 'max-w-4xl';
      default: return 'max-w-4xl';
    }
  };

  const renderPreview = () => {
    return (
      <div className={`mx-auto ${getPreviewWidth()} bg-white shadow-lg`}>
        {/* Header */}
        <header className="border-b">
          {blogData.featuredImage && (
            <div className="aspect-video">
              <img
                src={blogData.featuredImage.url}
                alt={blogData.featuredImage.altText || blogData.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          
          <div className="p-8">
            <h1 className="text-4xl font-bold mb-4">{blogData.title || 'Untitled'}</h1>
            
            {blogData.excerpt && (
              <p className="text-xl text-gray-600 mb-6">{blogData.excerpt}</p>
            )}
            
            <div className="flex items-center gap-4 text-sm text-gray-500">
              {author && (
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  <span>{author.name}</span>
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <span>{new Date().toLocaleDateString()}</span>
              </div>
              
              {blogData.status === 'PUBLISHED' && (
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  <span>Published</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="p-8">
          <RichContentEditor 
            content={blogData.content || []}
            onChange={() => {}}
            mediaAssets={mediaAssets}
            readonly={true}
            showPreview={true}
          />
        </main>

        {/* Footer */}
        {blogData.tags && blogData.tags.length > 0 && (
          <footer className="border-t p-8">
            <div className="flex flex-wrap gap-2">
              {blogData.tags.map(tag => (
                <span
                  key={tag}
                  className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </footer>
        )}
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">
              {blog ? 'Edit Blog' : 'Create Blog'}
            </h1>
            
            {hasUnsavedChanges && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                activeTab === 'preview' 
                  ? 'bg-brand-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
            
            <button
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b">
        <nav className="flex gap-8 px-6">
          {[
            { id: 'content', label: 'Content', icon: FileText },
            { id: 'media', label: 'Media', icon: ImageIcon },
            { id: 'seo', label: 'SEO', icon: Globe },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as any)}
              className={`flex items-center gap-2 py-4 border-b-2 transition-colors ${
                activeTab === id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'content' && (
          <div className="p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={blogData.title || ''}
                  onChange={(e) => handleTitleChange(e.target.value)}
                  className="w-full text-2xl font-bold border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="Enter blog title..."
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  URL Slug
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">/blog/</span>
                  <input
                    type="text"
                    value={blogData.slug || ''}
                    onChange={(e) => setBlogData(prev => ({ ...prev, slug: e.target.value }))}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                    placeholder="url-slug"
                  />
                </div>
              </div>

              {/* Excerpt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Excerpt
                </label>
                <textarea
                  value={blogData.excerpt || ''}
                  onChange={(e) => setBlogData(prev => ({ ...prev, excerpt: e.target.value }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                  placeholder="Brief description of your blog..."
                />
              </div>

              {/* Featured Image */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Featured Image
                </label>
                <div className="border border-gray-300 rounded-lg p-4">
                  {blogData.featuredImage ? (
                    <div className="space-y-3">
                      <img
                        src={blogData.featuredImage.url}
                        alt={blogData.featuredImage.altText || ''}
                        className="w-full h-48 object-cover rounded"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowMediaModal(true)}
                          className="px-3 py-1 bg-brand-600 text-white rounded hover:bg-brand-700"
                        >
                          Change Image
                        </button>
                        <button
                          onClick={() => setBlogData(prev => ({ ...prev, featuredImage: undefined }))}
                          className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div 
                      className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-brand-400"
                      onClick={() => setShowMediaModal(true)}
                    >
                      <ImageIcon className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                      <p className="text-gray-500">Click to select featured image</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tags
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {blogData.tags?.map(tag => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-brand-100 text-brand-700 rounded-full text-sm"
                    >
                      #{tag}
                      <button
                        onClick={() => removeTag(tag)}
                        className="hover:text-brand-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        addTag(e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="Add tag..."]') as HTMLInputElement;
                      if (input.value) {
                        addTag(input.value);
                        input.value = '';
                      }
                    }}
                    className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Categories */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Categories
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {blogData.categories?.map(category => (
                    <span
                      key={category}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm"
                    >
                      {category}
                      <button
                        onClick={() => removeCategory(category)}
                        className="hover:text-green-900"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add category..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2"
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        addCategory(e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.querySelector('input[placeholder="Add category..."]') as HTMLInputElement;
                      if (input.value) {
                        addCategory(input.value);
                        input.value = '';
                      }
                    }}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status
                </label>
                <select
                  value={blogData.status || 'DRAFT'}
                  onChange={(e) => setBlogData(prev => ({ ...prev, status: e.target.value as any }))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                >
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
              </div>

              {/* Content Editor */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Content
                </label>
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-gray-500">
                    Build the blog directly here. Apply a template if you want a starter structure, then edit it freely.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowTemplateModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
                  >
                    <LayoutTemplate className="h-4 w-4" />
                    Apply Template
                  </button>
                  {onManageTemplates && (
                    <button
                      type="button"
                      onClick={onManageTemplates}
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Manage Templates
                    </button>
                  )}
                </div>
                {blogData.templateId && (
                  <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                    This blog is currently based on {selectedTemplate ? `"${selectedTemplate.name}"` : 'a template'}. The blocks below are fully editable.
                  </div>
                )}
                <RichContentEditor
                  content={blogData.content || []}
                  onChange={handleContentChange}
                  mediaAssets={mediaAssets}
                  onUploadMedia={async (file) => {
                    const [asset] = await onUploadMedia([file]);
                    return asset;
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'media' && (
          <div className="p-6">
            <MediaManager
              assets={mediaAssets}
              onUpload={onUploadMedia}
              onSelect={handleMediaSelect}
            />
          </div>
        )}

        {activeTab === 'seo' && (
          <div className="p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              <h2 className="text-xl font-semibold mb-4">SEO Settings</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  SEO Title
                </label>
                <input
                  type="text"
                  value={blogData.seo?.title || ''}
                  onChange={(e) => setBlogData(prev => ({
                    ...prev,
                    seo: { ...prev.seo, title: e.target.value }
                  }))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="SEO title (leave empty to use blog title)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Meta Description
                </label>
                <textarea
                  value={blogData.seo?.description || ''}
                  onChange={(e) => setBlogData(prev => ({
                    ...prev,
                    seo: { ...prev.seo, description: e.target.value }
                  }))}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="Meta description for search engines"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Keywords
                </label>
                <input
                  type="text"
                  value={blogData.seo?.keywords?.join(', ') || ''}
                  onChange={(e) => setBlogData(prev => ({
                    ...prev,
                    seo: { 
                      ...prev.seo, 
                      keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean)
                    }
                  }))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  placeholder="keyword1, keyword2, keyword3"
                />
              </div>

              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={blogData.seo?.noIndex || false}
                    onChange={(e) => setBlogData(prev => ({
                      ...prev,
                      seo: { ...prev.seo, noIndex: e.target.checked }
                    }))}
                  />
                  <span className="text-sm text-gray-700">No index (tell search engines not to index this page)</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'preview' && (
          <div className="p-6 bg-gray-100">
            {/* Preview Mode Selector */}
            <div className="flex justify-center mb-6">
              <div className="bg-white rounded-lg shadow-sm border p-1 flex">
                <button
                  onClick={() => setPreviewMode('desktop')}
                  className={`flex items-center gap-2 px-4 py-2 rounded ${
                    previewMode === 'desktop' ? 'bg-brand-100 text-brand-700' : 'text-gray-600'
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                  Desktop
                </button>
                <button
                  onClick={() => setPreviewMode('tablet')}
                  className={`flex items-center gap-2 px-4 py-2 rounded ${
                    previewMode === 'tablet' ? 'bg-brand-100 text-brand-700' : 'text-gray-600'
                  }`}
                >
                  <Tablet className="w-4 h-4" />
                  Tablet
                </button>
                <button
                  onClick={() => setPreviewMode('mobile')}
                  className={`flex items-center gap-2 px-4 py-2 rounded ${
                    previewMode === 'mobile' ? 'bg-brand-100 text-brand-700' : 'text-gray-600'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  Mobile
                </button>
              </div>
            </div>

            {/* Preview Content */}
            <div className="overflow-auto" style={{ height: 'calc(100vh - 300px)' }}>
              {renderPreview()}
            </div>
          </div>
        )}
      </div>

      {/* Media Modal */}
      {showMediaModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg w-full max-w-6xl h-5/6 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-semibold">Select Media</h2>
              <button
                onClick={() => setShowMediaModal(false)}
                className="p-2 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <MediaManager
                assets={mediaAssets}
                onUpload={onUploadMedia}
                onSelect={handleMediaSelect}
              />
            </div>
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="flex h-5/6 w-full max-w-6xl flex-col rounded-lg bg-white">
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="text-xl font-semibold">Apply Template</h2>
                <p className="text-sm text-gray-500">Choose a template, then continue editing the copied blocks in content.</p>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="rounded p-2 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <TemplateGallery
                templates={templates}
                onSelect={handleTemplateSelect}
                selectedTemplateId={blogData.templateId}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
