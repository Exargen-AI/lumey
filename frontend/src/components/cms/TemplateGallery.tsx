import { useState } from 'react';
import { CmsTemplate, TemplateType } from '@exargen/shared';
import { Eye, Edit, Trash2, Plus, Search, Filter } from 'lucide-react';

interface TemplateGalleryProps {
  templates: CmsTemplate[];
  onSelect?: (template: CmsTemplate) => void;
  onEdit?: (template: CmsTemplate) => void;
  onDelete?: (templateId: string) => void;
  onCreate?: (type: TemplateType) => void;
  selectedTemplateId?: string;
}

export function TemplateGallery({ 
  templates, 
  onSelect, 
  onEdit, 
  onDelete, 
  onCreate,
  selectedTemplateId 
}: TemplateGalleryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<TemplateType | 'all'>('all');
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, boolean>>({});

  const templateTypes: { type: TemplateType; label: string; description: string }[] = [
    { type: 'ARTICLE', label: 'Article', description: 'Blog posts and articles' },
    { type: 'BLOG_POST', label: 'Blog Post', description: 'Standard blog post layout' },
    { type: 'LANDING_PAGE', label: 'Landing Page', description: 'Marketing landing pages' },
    { type: 'PRODUCT_PAGE', label: 'Product Page', description: 'Product showcase' },
    { type: 'CASE_STUDY', label: 'Case Study', description: 'Customer success stories' },
    { type: 'TUTORIAL', label: 'Tutorial', description: 'Step-by-step guides' },
    { type: 'NEWS', label: 'News', description: 'News and announcements' },
    { type: 'ANNOUNCEMENT', label: 'Announcement', description: 'Company announcements' },
    { type: 'PORTFOLIO', label: 'Portfolio', description: 'Work showcase' },
    { type: 'ABOUT', label: 'About', description: 'About pages' },
    { type: 'CONTACT', label: 'Contact', description: 'Contact forms' },
    { type: 'CUSTOM', label: 'Custom', description: 'Custom layouts' },
  ];

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (template.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || template.type === filterType;
    
    return matchesSearch && matchesType;
  });

  const TemplateCard = ({ template }: { template: CmsTemplate }) => {
    const isSelected = selectedTemplateId === template.id;
    const showThumbnail = Boolean(template.thumbnail) && !failedThumbnails[template.id];
    
    return (
      <div
        className={`border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
          isSelected ? 'border-brand-600 ring-2 ring-brand-600' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => onSelect?.(template)}
      >
        {/* Template Preview */}
        <div className="aspect-video bg-gradient-to-br from-brand-50 to-purple-50 relative">
          {showThumbnail ? (
            <img
              src={template.thumbnail}
              alt={template.name}
              className="w-full h-full object-cover"
              onError={() =>
                setFailedThumbnails((prev) => ({
                  ...prev,
                  [template.id]: true,
                }))
              }
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-brand-200 rounded-lg mx-auto mb-2 flex items-center justify-center">
                  <span className="text-brand-600 font-bold text-xl">
                    {template.name.charAt(0)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">Preview</p>
              </div>
            </div>
          )}
          
          {template.isDefault && (
            <div className="absolute top-2 right-2 bg-green-600 text-white text-xs px-2 py-1 rounded">
              Default
            </div>
          )}
        </div>

        {/* Template Info */}
        <div className="p-4 bg-white">
          <div className="flex items-start justify-between mb-2">
            <div>
              <h3 className="font-semibold text-gray-900">{template.name}</h3>
              <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded mt-1">
                {templateTypes.find(t => t.type === template.type)?.label}
              </span>
            </div>
            
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {onEdit && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(template);
                  }}
                  className="p-1 hover:bg-gray-100 rounded"
                  title="Edit template"
                >
                  <Edit className="w-4 h-4 text-gray-600" />
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(template.id);
                  }}
                  className="p-1 hover:bg-red-50 rounded"
                  title="Delete template"
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </button>
              )}
            </div>
          </div>
          
          <p className="text-sm text-gray-600 line-clamp-2">{template.description || 'Reusable starter layout'}</p>
          
          <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
            <span>{template.structure.length} blocks</span>
            <span>{template.fields.length} fields</span>
          </div>
        </div>
      </div>
    );
  };

  const CreateTemplateCard = ({ type }: { type: TemplateType }) => {
    const typeInfo = templateTypes.find(t => t.type === type);
    
    return (
      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-all group"
        onClick={() => onCreate?.(type)}
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-lg mx-auto mb-4 flex items-center justify-center group-hover:bg-brand-100 transition-colors">
            <Plus className="w-8 h-8 text-gray-400 group-hover:text-brand-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">{typeInfo?.label}</h3>
          <p className="text-sm text-gray-600 mb-3">{typeInfo?.description}</p>
          <button className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 text-sm">
            Create Template
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Template Gallery</h2>
          <p className="text-gray-600">Choose from pre-built templates or create your own</p>
        </div>
        
        {onCreate && (
          <div className="flex gap-2">
            <button
              onClick={() => onCreate('ARTICLE')}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
            >
              <Plus className="w-4 h-4" />
              Create Template
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>

        <div className="flex gap-2">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          >
            <option value="all">All Types</option>
            {templateTypes.map(({ type, label }) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredTemplates.map(template => (
          <div key={template.id} className="group">
            <TemplateCard template={template} />
          </div>
        ))}
        
        {onCreate && filterType !== 'all' && (
          <CreateTemplateCard type={filterType as TemplateType} />
        )}
      </div>

      {/* Empty State */}
      {filteredTemplates.length === 0 && !onCreate && (
        <div className="text-center py-12">
          <div className="text-gray-500">
            <Filter className="w-16 h-16 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No templates found</h3>
            <p>Try adjusting your search or filters</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="text-sm text-gray-500 border-t pt-4">
        Showing {filteredTemplates.length} of {templates.length} templates
      </div>
    </div>
  );
}
