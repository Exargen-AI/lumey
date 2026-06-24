import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useCreateBlog, useMediaAssets, useTemplates, useUploadMedia } from '../../hooks/useCms';
import { ProfessionalBlogEditor } from '../../components/cms/ProfessionalBlogEditor';
import { ArrowLeft } from 'lucide-react';
import axios from 'axios';
import { buildAvailableTemplates } from '../../lib/cmsTemplates';
import { DesktopHint } from '@/components/ui';

type ValidationIssue = {
  code?: string;
  minimum?: number;
  type?: string;
  path?: Array<string | number>;
  message?: string;
};

const toFieldLabel = (field: string) =>
  field
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

const toFriendlyIssueMessage = (issue: ValidationIssue) => {
  const field = issue.path?.length ? String(issue.path[0]) : 'Field';
  const label = toFieldLabel(field);

  if (issue.code === 'too_small' && issue.type === 'string' && issue.minimum === 1) {
    return `${label} is required.`;
  }

  return issue.message ? `${label}: ${issue.message}` : `${label} is invalid.`;
};

const formatCmsError = (error: unknown) => {
  if (!axios.isAxiosError(error)) {
    return 'Failed to save blog.';
  }

  const rawError = error.response?.data?.error;

  if (Array.isArray(rawError)) {
    const messages = rawError
      .map((issue: ValidationIssue) => toFriendlyIssueMessage(issue))
      .filter(Boolean);

    return messages.length > 0 ? messages.join(' ') : error.message;
  }

  if (typeof rawError === 'string') {
    try {
      const parsed = JSON.parse(rawError);
      if (Array.isArray(parsed)) {
        const messages = parsed
          .map((issue: ValidationIssue) => toFriendlyIssueMessage(issue))
          .filter(Boolean);

        if (messages.length > 0) {
          return messages.join(' ');
        }
      }
    } catch {
      return rawError;
    }

    return rawError;
  }

  return error.message || 'Failed to save blog.';
};

export default function CreateBlogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const createBlogMutation = useCreateBlog();
  const uploadMediaMutation = useUploadMedia();
  const [toastMessage, setToastMessage] = useState('');
  const { data: templates = [] } = useTemplates(projectId!);
  const { data: mediaAssets = [] } = useMediaAssets(projectId!);
  const initialTemplateId = searchParams.get('templateId') || undefined;

  useEffect(() => {
    if (!toastMessage) return;

    const timeout = window.setTimeout(() => {
      setToastMessage('');
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  const allTemplates = buildAvailableTemplates(projectId!, templates);

  const handleSave = async (blogData: any) => {
    try {
      const payload = {
        projectId: projectId!,
        ...blogData,
      };

      setToastMessage('');
      await createBlogMutation.mutateAsync(payload);
      navigate(`/cms/projects/${projectId}/blogs`);
    } catch (error: unknown) {
      console.error('Failed to create blog:', error);
      setToastMessage(formatCmsError(error));
      throw error;
    }
  };

  const handleUploadMedia = async (files: File[]) => {
    return uploadMediaMutation.mutateAsync({
      projectId: projectId!,
      files,
    });
  };

  if (createBlogMutation.isSuccess) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h2 className="text-green-800 text-xl font-semibold mb-2">Blog Created Successfully!</h2>
            <p className="text-green-600 mb-4">Your blog has been created and is ready for editing.</p>
            <button
              onClick={() => navigate(`/cms/projects/${projectId}/blogs`)}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Go to Blogs
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen">
      {toastMessage && (
        <div className="fixed right-4 top-4 z-[100] max-w-md rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          {toastMessage}
        </div>
      )}

      <div className="bg-white border-b px-6 py-4">
        <button
          onClick={() => navigate(`/cms/projects/${projectId}/blogs`)}
          className="flex items-center gap-2 text-brand-600 hover:text-brand-800"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blogs
        </button>
      </div>

      {/* Mobile hint sits inside the page area, just above the editor.
          The editor itself uses TipTap and its toolbar doesn't pack well
          under 1024px — so this is a `warn` tone rather than the softer
          `info`. */}
      <div className="px-4 sm:px-6 pt-4">
        <DesktopHint dismissKey="cms-blog-editor" tone="warn" />
      </div>

      <ProfessionalBlogEditor
        projectId={projectId!}
        templates={allTemplates as any}
        mediaAssets={mediaAssets}
        onSave={handleSave}
        onUploadMedia={handleUploadMedia}
        onManageTemplates={() => navigate(`/cms/projects/${projectId}/templates`)}
        initialTemplateId={initialTemplateId}
      />
    </div>
  );
}
