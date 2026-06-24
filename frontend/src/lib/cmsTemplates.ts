import { CmsTemplate } from '../api/cms';
import { sampleTemplates } from '../data/sampleTemplates';

export const SAMPLE_TEMPLATE_ID_PREFIX = 'sample-';

const SAMPLE_TEMPLATE_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export const createSampleTemplateId = (slug: string) => `${SAMPLE_TEMPLATE_ID_PREFIX}${slug}`;

export const isSampleTemplateId = (templateId?: string | null) =>
  Boolean(templateId?.startsWith(SAMPLE_TEMPLATE_ID_PREFIX));

export const buildAvailableTemplates = (projectId: string, templates: CmsTemplate[] = []): CmsTemplate[] => [
  ...templates,
  ...sampleTemplates
    .filter((sampleTemplate) => !templates.some((template) => template.slug === sampleTemplate.slug))
    .map((template) => ({
      ...template,
      id: createSampleTemplateId(template.slug),
      projectId,
      isActive: true,
      createdAt: SAMPLE_TEMPLATE_TIMESTAMP,
      updatedAt: SAMPLE_TEMPLATE_TIMESTAMP,
      _count: { blogs: 0 },
    })),
];
