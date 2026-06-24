import { useMemo, useState } from 'react';
import { CmsContentBlock } from '@exargen/shared';
import { CmsTemplate } from '../../api/cms';
import { RichContentEditor } from './RichContentEditor';

interface TemplateEditorProps {
  template?: CmsTemplate;
  onSave: (data: {
    name: string;
    type: CmsTemplate['type'];
    description?: string;
    structure: CmsContentBlock[];
  }) => void;
  onCancel: () => void;
}

const createStarterBlocks = (): CmsContentBlock[] => [
  {
    id: `template_block_${Date.now()}_header`,
    type: 'header',
    data: {
      text: 'Template Heading',
      level: 1,
      alignment: 'left',
    },
  },
  {
    id: `template_block_${Date.now()}_paragraph`,
    type: 'paragraph',
    data: {
      text: 'Start building your reusable layout here.',
      alignment: 'left',
    },
  },
];

export function TemplateEditor({ template, onSave, onCancel }: TemplateEditorProps) {
  const initialStructure = useMemo(() => {
    if (Array.isArray(template?.structure) && template!.structure.length > 0) {
      return template!.structure;
    }

    return createStarterBlocks();
  }, [template]);

  const [formData, setFormData] = useState({
    name: template?.name || '',
    type: template?.type || 'ARTICLE',
    description: template?.description || '',
    structure: initialStructure,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: formData.name.trim(),
      type: formData.type,
      description: formData.description.trim() || undefined,
      structure: formData.structure,
    });
  };

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b px-6 py-5">
        <h2 className="text-xl font-bold">{template ? 'Edit Template' : 'Create Template'}</h2>
        <p className="mt-1 text-sm text-gray-500">
          Templates are reusable starter layouts. When applied to a blog, the blocks are copied and remain fully editable.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Template Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              placeholder="Case Study Starter"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Template Type</label>
            <select
              value={formData.type}
              onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value as CmsTemplate['type'] }))}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value="ARTICLE">Article</option>
              <option value="TUTORIAL">Tutorial</option>
              <option value="NEWS">News</option>
              <option value="CASE_STUDY">Case Study</option>
              <option value="ANNOUNCEMENT">Announcement</option>
            </select>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            rows={3}
            placeholder="Explain when this template should be used."
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Template Content</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <RichContentEditor
              content={formData.structure}
              onChange={(structure) => setFormData((prev) => ({ ...prev, structure }))}
              mediaAssets={[]}
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
          >
            {template ? 'Update Template' : 'Create Template'}
          </button>
        </div>
      </form>
    </div>
  );
}
