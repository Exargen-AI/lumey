import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ProfessionalBlogEditor } from '../../components/cms/ProfessionalBlogEditor';
import { useBlog, useMediaAssets, useTemplates, useUpdateBlog, useUploadMedia } from '../../hooks/useCms';
import { buildAvailableTemplates } from '../../lib/cmsTemplates';
import { DesktopHint } from '@/components/ui';

export default function EditBlogPage() {
  const { projectId, blogId } = useParams<{ projectId: string; blogId: string }>();
  const navigate = useNavigate();
  const updateBlogMutation = useUpdateBlog();
  const uploadMediaMutation = useUploadMedia();

  const { data: blog, isLoading: isBlogLoading } = useBlog(blogId!);
  const { data: templates = [], isLoading: isTemplatesLoading } = useTemplates(projectId!);
  const { data: mediaAssets = [], isLoading: isMediaLoading } = useMediaAssets(projectId!);

  const allTemplates = buildAvailableTemplates(projectId!, templates);

  const handleSave = async (blogData: any) => {
    await updateBlogMutation.mutateAsync({
      id: blogId!,
      data: blogData,
    });

    navigate(`/cms/projects/${projectId}/blogs`);
  };

  const handleUploadMedia = async (files: File[]) => {
    return uploadMediaMutation.mutateAsync({
      projectId: projectId!,
      files,
    });
  };

  if (isBlogLoading || isTemplatesLoading || isMediaLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!blog) {
    return <div className="p-6">Blog not found.</div>;
  }

  // Normalise content to the flat CmsContentBlock[] array the editor requires.
  // Handles three shapes that can arrive from the DB:
  //   1. Already a proper CmsContentBlock[] array  → use as-is
  //   2. { blocks: [...] } wrapper (old CE format)  → unwrap
  //   3. Legacy { type, content } blocks            → convert to { type, data: { text } }
  const normalizeContent = (raw: any): any[] => {
    const arr: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.blocks)
        ? raw.blocks
        : [];

    return arr.map((block: any, i: number) => {
      // Already well-formed (has id + data object)
      if (block?.id && block?.data && typeof block.data === 'object') return block;

      const id = block?.id ?? `block_norm_${i}`;
      const type = block?.type === 'heading' ? 'header' : (block?.type ?? 'paragraph');
      const text = block?.data?.text ?? block?.content ?? '';
      const level = block?.level ?? block?.data?.level ?? 2;

      if (type === 'header') {
        return { id, type: 'header', data: { text, level, alignment: 'left' } };
      }
      return { id, type: 'paragraph', data: { text, alignment: 'left' } };
    });
  };

  const normalizedBlog = { ...blog, content: normalizeContent(blog.content) };

  return (
    <div className="h-screen">
      <div className="bg-white border-b px-6 py-4">
        <button
          onClick={() => navigate(`/cms/projects/${projectId}/blogs`)}
          className="flex items-center gap-2 text-brand-600 hover:text-brand-800"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blogs
        </button>
      </div>

      {/* Mobile hint — TipTap editor toolbar + content panes don't lay
          out comfortably below 1024px. Hard-block would be too
          aggressive (reading a draft is fine); warn tone instead. */}
      <div className="px-4 sm:px-6 pt-4">
        <DesktopHint dismissKey="cms-blog-editor" tone="warn" />
      </div>

      <ProfessionalBlogEditor
        blog={normalizedBlog}
        projectId={projectId!}
        templates={allTemplates as any}
        mediaAssets={mediaAssets}
        onSave={handleSave}
        onUploadMedia={handleUploadMedia}
        author={blog.author}
        onManageTemplates={() => navigate(`/cms/projects/${projectId}/templates`)}
      />
    </div>
  );
}
