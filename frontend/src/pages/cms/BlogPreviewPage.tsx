import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { BlogPreview } from '../../components/cms/BlogPreview';
import { useBlog, useMediaAssets } from '../../hooks/useCms';

export default function BlogPreviewPage() {
  const { projectId, blogId } = useParams<{ projectId: string; blogId: string }>();
  const navigate = useNavigate();
  const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const { data: blog, isLoading: isBlogLoading } = useBlog(blogId!);
  const { data: mediaAssets = [], isLoading: isMediaLoading } = useMediaAssets(projectId!);

  if (isBlogLoading || isMediaLoading) {
    return <div className="p-6">Loading preview...</div>;
  }

  if (!blog) {
    return <div className="p-6">Blog not found.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="border-b bg-white px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <button
              onClick={() => navigate(`/cms/projects/${projectId}/blogs`)}
              className="mb-3 flex items-center gap-2 text-brand-600 hover:text-brand-800"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Blogs
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Blog Preview</h1>
            <p className="text-gray-600">Preview this blog inside CMS without leaving the workspace.</p>
          </div>

          <div className="flex items-center gap-2 rounded-xl border bg-white p-1 shadow-sm">
            <button
              onClick={() => setPreviewMode('desktop')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
                previewMode === 'desktop' ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Monitor className="h-4 w-4" />
              Desktop
            </button>
            <button
              onClick={() => setPreviewMode('tablet')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
                previewMode === 'tablet' ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Tablet className="h-4 w-4" />
              Tablet
            </button>
            <button
              onClick={() => setPreviewMode('mobile')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${
                previewMode === 'mobile' ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Smartphone className="h-4 w-4" />
              Mobile
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        <BlogPreview blog={blog} mediaAssets={mediaAssets} previewMode={previewMode} />
      </div>
    </div>
  );
}
