import { Calendar, Globe, User } from 'lucide-react';
import { CmsBlog, CmsMediaAsset } from '../../api/cms';
import { RichContentEditor } from './RichContentEditor';

interface BlogPreviewProps {
  blog: CmsBlog;
  mediaAssets?: CmsMediaAsset[];
  previewMode?: 'desktop' | 'tablet' | 'mobile';
}

const getPreviewWidth = (previewMode: BlogPreviewProps['previewMode']) => {
  switch (previewMode) {
    case 'mobile':
      return 'max-w-sm';
    case 'tablet':
      return 'max-w-2xl';
    case 'desktop':
    default:
      return 'max-w-4xl';
  }
};

export function BlogPreview({
  blog,
  mediaAssets = [],
  previewMode = 'desktop',
}: BlogPreviewProps) {
  return (
    <div className={`mx-auto ${getPreviewWidth(previewMode)} overflow-hidden rounded-2xl bg-white shadow-lg`}>
      <header className="border-b">
        {blog.featuredImage?.url && (
          <div className="aspect-video">
            <img
              src={blog.featuredImage.url}
              alt={blog.featuredImage.altText || blog.title}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="p-8">
          <h1 className="mb-4 text-4xl font-bold text-gray-900">{blog.title || 'Untitled'}</h1>

          {blog.excerpt && (
            <p className="mb-6 text-xl text-gray-600">{blog.excerpt}</p>
          )}

          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            {blog.author && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span>{blog.author.name}</span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>{new Date(blog.publishedAt || blog.createdAt).toLocaleDateString()}</span>
            </div>

            {blog.status === 'PUBLISHED' && (
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                <span>Published</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="p-8">
        <RichContentEditor
          content={Array.isArray(blog.content) ? blog.content : []}
          onChange={() => {}}
          mediaAssets={mediaAssets}
          readonly={true}
          showPreview={true}
        />
      </main>

      {Array.isArray(blog.tags) && blog.tags.length > 0 && (
        <footer className="border-t p-8">
          <div className="flex flex-wrap gap-2">
            {blog.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700"
              >
                #{tag}
              </span>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
