import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTemplates, useCreateTemplate, useUpdateTemplate, useDeleteTemplate } from '../../hooks/useCms';
import { Can } from '../../components/auth/Can';
import { useConfirm } from '@/components/ui';
import { Plus, Edit, Layout, Copy, Trash2 } from 'lucide-react';
import { TemplateEditor } from '../../components/cms/TemplateEditor';
import { CmsTemplate } from '../../api/cms';
import { buildAvailableTemplates, isSampleTemplateId } from '../../lib/cmsTemplates';

export default function ProjectTemplatesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CmsTemplate | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});
  
  const { data: templates = [], isLoading } = useTemplates(projectId!);
  const createTemplateMutation = useCreateTemplate();
  const updateTemplateMutation = useUpdateTemplate();
  const deleteTemplateMutation = useDeleteTemplate();
  const allTemplates = buildAvailableTemplates(projectId!, templates);

  const handleSaveTemplate = async (data: any) => {
    try {
      if (editingTemplate) {
        await updateTemplateMutation.mutateAsync({
          id: editingTemplate.id,
          data,
        });
        setEditingTemplate(null);
        setFeedback({ type: 'success', message: 'Template updated successfully.' });
        return;
      }

      await createTemplateMutation.mutateAsync({
        projectId: projectId!,
        ...data,
      });
      setIsCreatingTemplate(false);
      setFeedback({ type: 'success', message: 'Template created successfully.' });
    } catch (error: any) {
      console.error('Template save failed:', error);
      setFeedback({
        type: 'error',
        message: `Failed to save template: ${error.message || 'Unknown error'}`,
      });
    }
  };

  const confirm = useConfirm();
  const handleDeleteTemplate = async (template: CmsTemplate) => {
    const confirmed = await confirm({
      title: `Delete "${template.name}"?`,
      body: 'Blogs already using this template will keep their copied content. The template itself will be removed.',
      tone: 'danger',
      confirmLabel: 'Delete template',
    });
    if (!confirmed) return;

    try {
      await deleteTemplateMutation.mutateAsync(template.id);
      setFeedback({ type: 'success', message: 'Template deleted successfully.' });
    } catch (error: any) {
      console.error('Template delete failed:', error);
      setFeedback({
        type: 'error',
        message: `Failed to delete template: ${error.message || 'Unknown error'}`,
      });
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (isCreatingTemplate || editingTemplate) {
    return (
      <div className="p-6">
        <TemplateEditor
          template={editingTemplate || undefined}
          onSave={handleSaveTemplate}
          onCancel={() => {
            setIsCreatingTemplate(false);
            setEditingTemplate(null);
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <button
            onClick={() => navigate(`/cms/projects/${projectId}/blogs`)}
            className="mb-4 text-brand-600 hover:text-brand-800"
          >
            &larr; Back to Blogs
          </button>
          <h1 className="text-2xl font-bold">Template Management</h1>
          <p className="text-gray-600">Create reusable blog starter layouts for this project</p>
        </div>
        
        <Can permission="cms.template.create">
          <button
            onClick={() => {
              setFeedback(null);
              setIsCreatingTemplate(true);
            }}
            className="bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700 flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </button>
        </Can>
      </div>

      {feedback && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {feedback.message}
        </div>
      )}

      <div className="mb-6 rounded-xl border border-brand-100 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
        Project templates and built-in starter templates are shown together here. Built-in templates can be used in blogs, but they remain read-only.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allTemplates.map((template) => {
          const isSampleTemplate = isSampleTemplateId(template.id);
          const showThumbnail = Boolean(template.thumbnail) && !failedThumbnails[template.id];

          return (
            <div key={template.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
              {showThumbnail && (
                <div className="aspect-[16/9] overflow-hidden rounded-t-lg bg-gray-100">
                  <img
                    src={template.thumbnail}
                    alt={template.name}
                    className="h-full w-full object-cover"
                    onError={() =>
                      setFailedThumbnails((prev) => ({
                        ...prev,
                        [template.id]: true,
                      }))
                    }
                  />
                </div>
              )}

              <div className="p-6">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-semibold flex-1">{template.name}</h3>
                  <div className="ml-3 flex flex-col items-end gap-2">
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                      {template.type}
                    </span>
                    {isSampleTemplate && (
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs">
                        Built-in
                      </span>
                    )}
                  </div>
                </div>

                {template.description && (
                  <p className="text-gray-600 mb-4">{template.description}</p>
                )}

                <div className="mb-4 rounded bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  {Array.isArray(template.structure) ? template.structure.length : 0} blocks in template
                </div>

                <div className="text-sm text-gray-500 mb-4">
                  <div className="flex justify-between">
                    <span>{Array.isArray(template.fields) ? template.fields.length : 0} fields</span>
                    <span>{isSampleTemplate ? 'Starter template' : `${template._count?.blogs || 0} blogs`}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {!isSampleTemplate && (
                    <button
                      onClick={() => {
                        setFeedback(null);
                        setEditingTemplate(template);
                      }}
                      className="flex-1 bg-brand-600 text-white px-3 py-2 rounded text-sm hover:bg-brand-700 flex items-center justify-center"
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edit
                    </button>
                  )}

                  <button
                    onClick={() => navigate(`/cms/projects/${projectId}/blogs/create?templateId=${template.id}`)}
                    className={`${isSampleTemplate ? 'w-full' : 'flex-1'} bg-gray-600 text-white px-3 py-2 rounded text-sm hover:bg-gray-700 flex items-center justify-center`}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Use in Blog
                  </button>

                  {!isSampleTemplate && (
                    <button
                      onClick={() => handleDeleteTemplate(template)}
                      className="bg-red-50 text-red-600 px-3 py-2 rounded text-sm hover:bg-red-100 flex items-center justify-center"
                      title="Delete template"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {allTemplates.length === 0 && (
          <div className="col-span-full text-center py-12">
            <div className="text-gray-500 mb-4">
              <Layout className="w-16 h-16 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Templates Found</h3>
              <p>Create your first template to define blog structure</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
