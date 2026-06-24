import { useState, useCallback, useRef } from 'react';
import { 
  CmsContentBlock, 
  ContentBlockType, 
  CmsMediaAsset,
  HeaderBlockData,
  ParagraphBlockData,
  ImageBlockData,
  VideoBlockData,
  QuoteBlockData,
  ListBlockData,
  CodeBlockData,
  EmbedBlockData,
  ButtonBlockData,
  GalleryBlockData,
  HeroBlockData,
  StatsBlockData,
  PricingBlockData,
  TeamBlockData,
  ContactBlockData
} from '@exargen/shared';
import { 
  Type, 
  Image as ImageIcon, 
  Video, 
  Quote, 
  List, 
  Code, 
  Link, 
  Square as ButtonIcon, 
  Grid, 
  User, 
  BarChart, 
  CreditCard, 
  Phone, 
  Plus, 
  Trash2, 
  GripVertical,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

interface RichContentEditorProps {
  content: CmsContentBlock[];
  onChange: (content: CmsContentBlock[]) => void;
  mediaAssets?: CmsMediaAsset[];
  onUploadMedia?: (file: File) => Promise<CmsMediaAsset>;
  readonly?: boolean;
  showPreview?: boolean;
}

export function RichContentEditor({ 
  content, 
  onChange, 
  mediaAssets = [], 
  onUploadMedia,
  readonly = false,
  showPreview = false 
}: RichContentEditorProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);

  const blockTypes: { type: ContentBlockType; label: string; icon: React.ElementType }[] = [
    { type: 'header', label: 'Header', icon: Type },
    { type: 'paragraph', label: 'Paragraph', icon: Type },
    { type: 'image', label: 'Image', icon: ImageIcon },
    { type: 'video', label: 'Video', icon: Video },
    { type: 'quote', label: 'Quote', icon: Quote },
    { type: 'list', label: 'List', icon: List },
    { type: 'code', label: 'Code', icon: Code },
    { type: 'embed', label: 'Embed', icon: Link },
    { type: 'button', label: 'Button', icon: ButtonIcon },
    { type: 'gallery', label: 'Gallery', icon: Grid },
    { type: 'hero', label: 'Hero', icon: Type },
    { type: 'stats', label: 'Stats', icon: BarChart },
    { type: 'pricing', label: 'Pricing', icon: CreditCard },
    { type: 'team', label: 'Team', icon: User },
    { type: 'contact', label: 'Contact', icon: Phone },
  ];

  const addBlock = useCallback((type: ContentBlockType, index?: number) => {
    const newBlock: CmsContentBlock = {
      id: `block_${Date.now()}`,
      type,
      data: getDefaultBlockData(type),
    };

    const newContent = [...content];
    if (index !== undefined) {
      newContent.splice(index + 1, 0, newBlock);
    } else {
      newContent.push(newBlock);
    }
    
    onChange(newContent);
    setSelectedBlockId(newBlock.id);
  }, [content, onChange]);

  const updateBlock = useCallback((blockId: string, data: any) => {
    const newContent = content.map(block => 
      block.id === blockId ? { ...block, data } : block
    );
    onChange(newContent);
  }, [content, onChange]);

  const deleteBlock = useCallback((blockId: string) => {
    const newContent = content.filter(block => block.id !== blockId);
    onChange(newContent);
    setSelectedBlockId(null);
  }, [content, onChange]);

  const moveBlock = useCallback((fromIndex: number, toIndex: number) => {
    const newContent = [...content];
    const [movedBlock] = newContent.splice(fromIndex, 1);
    newContent.splice(toIndex, 0, movedBlock);
    onChange(newContent);
  }, [content, onChange]);

  const moveBlockByOffset = useCallback((index: number, offset: number) => {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= content.length) {
      return;
    }

    moveBlock(index, targetIndex);
    setSelectedBlockId(content[targetIndex]?.id || content[index]?.id || null);
  }, [content, moveBlock]);

  const handleImageUpload = useCallback(async (file: File, blockId: string) => {
    if (!onUploadMedia) return;
    
    try {
      const asset = await onUploadMedia(file);
      updateBlock(blockId, { assetId: asset.id });
    } catch (error) {
      console.error('Failed to upload image:', error);
    }
  }, [onUploadMedia, updateBlock]);

  const renderBlockEditor = (block: CmsContentBlock) => {
    const isSelected = selectedBlockId === block.id;
    
    switch (block.type) {
      case 'header':
        return <HeaderEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'paragraph':
        return <ParagraphEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'image':
        return <ImageEditor block={block} onUpdate={updateBlock} onUpload={handleImageUpload} mediaAssets={mediaAssets} isSelected={isSelected} />;
      case 'video':
        return <VideoEditor block={block} onUpdate={updateBlock} onUpload={handleImageUpload} mediaAssets={mediaAssets} isSelected={isSelected} />;
      case 'quote':
        return <QuoteEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'list':
        return <ListEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'code':
        return <CodeEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'embed':
        return <EmbedEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'button':
        return <ButtonEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'gallery':
        return <GalleryEditor block={block} onUpdate={updateBlock} onUpload={handleImageUpload} mediaAssets={mediaAssets} isSelected={isSelected} />;
      case 'hero':
        return <HeroEditor block={block} onUpdate={updateBlock} onUpload={handleImageUpload} mediaAssets={mediaAssets} isSelected={isSelected} />;
      case 'stats':
        return <StatsEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'pricing':
        return <PricingEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      case 'team':
        return <TeamEditor block={block} onUpdate={updateBlock} onUpload={handleImageUpload} mediaAssets={mediaAssets} isSelected={isSelected} />;
      case 'contact':
        return <ContactEditor block={block} onUpdate={updateBlock} isSelected={isSelected} />;
      default:
        return <div className="p-4 border border-gray-200 rounded">Unknown block type: {block.type}</div>;
    }
  };

  const renderBlockPreview = (block: CmsContentBlock) => {
    switch (block.type) {
      case 'header':
        return <HeaderPreview block={block} />;
      case 'paragraph':
        return <ParagraphPreview block={block} />;
      case 'image':
        return <ImagePreview block={block} mediaAssets={mediaAssets} />;
      case 'video':
        return <VideoPreview block={block} mediaAssets={mediaAssets} />;
      case 'quote':
        return <QuotePreview block={block} />;
      case 'list':
        return <ListPreview block={block} />;
      case 'code':
        return <CodePreview block={block} />;
      case 'embed':
        return <EmbedPreview block={block} />;
      case 'button':
        return <ButtonPreview block={block} />;
      case 'gallery':
        return <GalleryPreview block={block} mediaAssets={mediaAssets} />;
      case 'hero':
        return <HeroPreview block={block} mediaAssets={mediaAssets} />;
      case 'stats':
        return <StatsPreview block={block} />;
      case 'pricing':
        return <PricingPreview block={block} />;
      case 'team':
        return <TeamPreview block={block} mediaAssets={mediaAssets} />;
      case 'contact':
        return <ContactPreview block={block} />;
      default:
        return <div className="p-4">Unknown block type: {block.type}</div>;
    }
  };

  if (showPreview) {
    return (
      <div className="prose prose-lg max-w-none">
        {content.map((block) => (
          <div key={block.id}>
            {renderBlockPreview(block)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!readonly && (
        <div className="flex items-center gap-2 p-4 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium text-gray-700">Add Block:</span>
          <div className="flex flex-wrap gap-2">
            {blockTypes.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                onClick={() => addBlock(type)}
                className="flex items-center gap-1 px-3 py-2 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50"
                title={label}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {content.map((block, index) => (
          <div
            key={block.id}
            className={`relative group ${selectedBlockId === block.id ? 'ring-2 ring-brand-500' : ''}`}
            onClick={() => !readonly && setSelectedBlockId(block.id)}
            onDragOver={(e) => {
              if (!readonly && draggedBlockId && draggedBlockId !== block.id) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }
            }}
            onDrop={(e) => {
              if (readonly) return;
              e.preventDefault();

              const draggedId = draggedBlockId || e.dataTransfer.getData('text/plain');
              if (!draggedId || draggedId === block.id) {
                setDraggedBlockId(null);
                return;
              }

              const draggedIndex = content.findIndex((item) => item.id === draggedId);
              if (draggedIndex !== -1) {
                moveBlock(draggedIndex, index);
                setSelectedBlockId(draggedId);
              }
              setDraggedBlockId(null);
            }}
          >
            {!readonly && (
              <div className="absolute left-0 top-0 -translate-x-full flex items-center gap-1 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="flex flex-col gap-1">
                  <button
                    className="p-1 bg-white border border-gray-300 rounded cursor-grab active:cursor-grabbing"
                    draggable
                    onDragStart={(e) => {
                      setDraggedBlockId(block.id);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', block.id);
                    }}
                    onDragEnd={() => {
                      setDraggedBlockId(null);
                    }}
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => moveBlockByOffset(index, -1)}
                    disabled={index === 0}
                    className="p-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Move up"
                  >
                    <ChevronUp className="w-4 h-4 text-gray-700" />
                  </button>
                  <button
                    onClick={() => moveBlockByOffset(index, 1)}
                    disabled={index === content.length - 1}
                    className="p-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Move down"
                  >
                    <ChevronDown className="w-4 h-4 text-gray-700" />
                  </button>
                  <button
                    onClick={() => deleteBlock(block.id)}
                    className="p-1 bg-white border border-gray-300 rounded hover:bg-red-50 hover:border-red-300"
                    title="Delete block"
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                </div>
              </div>
            )}

            {renderBlockEditor(block)}
          </div>
        ))}

        {content.length === 0 && !readonly && (
          <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
            <p className="text-gray-500 mb-4">Start building your content</p>
            <div className="flex justify-center gap-2">
              {blockTypes.slice(0, 4).map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper function to get default block data
function getDefaultBlockData(type: ContentBlockType): any {
  switch (type) {
    case 'header':
      return { text: 'Your heading here', level: 2, alignment: 'left' };
    case 'paragraph':
      return { text: 'Your paragraph content here...', alignment: 'left' };
    case 'image':
      return { assetId: '', alt: '', caption: '', alignment: 'center' };
    case 'video':
      return { assetId: '', caption: '', autoplay: false, controls: true, loop: false, alignment: 'center' };
    case 'quote':
      return { text: 'Your quote here...', author: '', alignment: 'center', style: 'default' };
    case 'list':
      return { items: ['Item 1', 'Item 2', 'Item 3'], ordered: false, style: 'default' };
    case 'code':
      return { code: '// Your code here', language: 'javascript', theme: 'dark', showLineNumbers: true };
    case 'embed':
      return { url: '', title: '', type: 'custom', aspectRatio: '16:9' };
    case 'button':
      return { text: 'Click me', url: '#', variant: 'primary', size: 'medium', alignment: 'center' };
    case 'gallery':
      return { images: [], columns: 3, spacing: 'medium', lightbox: true };
    case 'hero':
      return { title: 'Hero Title', subtitle: 'Hero subtitle', alignment: 'center', overlay: false, overlayOpacity: 0.5 };
    case 'stats':
      return { stats: [{ label: 'Stat 1', value: '100', description: 'Description' }], columns: 3, style: 'default' };
    case 'pricing':
      return { plans: [{ name: 'Basic', price: '$9/mo', description: 'Basic plan', features: ['Feature 1'], highlighted: false }], columns: 3, style: 'cards' };
    case 'team':
      return { members: [{ name: 'Team Member', role: 'Role', bio: 'Bio' }], columns: 3, style: 'cards' };
    case 'contact':
      return { title: 'Contact Us', description: 'Get in touch', fields: [{ name: 'email', type: 'email', label: 'Email', required: true }], submitButtonText: 'Send', alignment: 'center' };
    default:
      return {};
  }
}

// Block Editor Components
function HeaderEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as HeaderBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.level}
            onChange={(e) => onUpdate(block.id, { ...data, level: parseInt(e.target.value) as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
            <option value={4}>H4</option>
            <option value={5}>H5</option>
            <option value={6}>H6</option>
          </select>
          <select
            value={data.alignment}
            onChange={(e) => onUpdate(block.id, { ...data, alignment: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </div>
        <input
          type="text"
          value={data.text}
          onChange={(e) => onUpdate(block.id, { ...data, text: e.target.value })}
          className="w-full text-lg font-medium border border-gray-300 rounded px-3 py-2"
          placeholder="Enter heading text"
        />
      </div>
    </div>
  );
}

function ParagraphEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as ParagraphBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.alignment}
            onChange={(e) => onUpdate(block.id, { ...data, alignment: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <select
            value={data.fontSize || 'medium'}
            onChange={(e) => onUpdate(block.id, { ...data, fontSize: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
            <option value="xlarge">X-Large</option>
          </select>
        </div>
        <textarea
          value={data.text}
          onChange={(e) => onUpdate(block.id, { ...data, text: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          rows={4}
          placeholder="Enter paragraph text"
        />
      </div>
    </div>
  );
}

function ImageEditor({ block, onUpdate, onUpload, mediaAssets, isSelected }: { 
  block: CmsContentBlock; 
  onUpdate: (id: string, data: any) => void; 
  onUpload: (file: File, blockId: string) => Promise<void>;
  mediaAssets: CmsMediaAsset[];
  isSelected: boolean;
}) {
  const data = block.data as ImageBlockData;
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const selectedAsset = mediaAssets.find(asset => asset.id === data.assetId);
  // Support external URLs injected by the Content Engine (data.url field)
  const externalUrl = (data as any).url as string | undefined;
  const displaySrc = selectedAsset?.url ?? externalUrl ?? null;
  const displayAlt = data.alt || selectedAsset?.altText || '';

  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.alignment}
            onChange={(e) => onUpdate(block.id, { ...data, alignment: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="full">Full Width</option>
          </select>
        </div>

        {displaySrc ? (
          <div className="space-y-2">
            <img
              src={displaySrc}
              alt={displayAlt}
              className="max-w-full h-auto rounded"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1 text-sm bg-brand-600 text-white rounded hover:bg-brand-700"
              >
                Replace with Upload
              </button>
              <button
                onClick={() => onUpdate(block.id, { ...data, assetId: '', url: '' })}
                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-gray-300 rounded p-8 text-center">
            <ImageIcon className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p className="text-gray-500 mb-2">No image selected</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
            >
              Upload Image
            </button>
          </div>
        )}
        
        <input
          type="text"
          value={data.alt || ''}
          onChange={(e) => onUpdate(block.id, { ...data, alt: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Alt text"
        />
        
        <input
          type="text"
          value={data.caption || ''}
          onChange={(e) => onUpdate(block.id, { ...data, caption: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Caption (optional)"
        />
        
        <input
          type="url"
          value={data.link || ''}
          onChange={(e) => onUpdate(block.id, { ...data, link: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Link URL (optional)"
        />
        
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onUpload(file, block.id);
            }
          }}
        />
      </div>
    </div>
  );
}

// Preview Components
function HeaderPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as HeaderBlockData;
  const Tag = `h${data.level}` as keyof JSX.IntrinsicElements;
  const alignmentClass = data.alignment === 'center' ? 'text-center' : data.alignment === 'right' ? 'text-right' : 'text-left';
  
  return (
    <Tag className={`font-bold mb-4 ${alignmentClass}`}>
      {data.text}
    </Tag>
  );
}

function ParagraphPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as ParagraphBlockData;
  const alignmentClass = data.alignment === 'center' ? 'text-center' : data.alignment === 'right' ? 'text-right' : 'text-left';
  const sizeClass = data.fontSize === 'small' ? 'text-sm' : data.fontSize === 'large' ? 'text-lg' : data.fontSize === 'xlarge' ? 'text-xl' : 'text-base';
  
  return (
    <p className={`mb-4 ${alignmentClass} ${sizeClass}`}>
      {data.text}
    </p>
  );
}

function ImagePreview({ block, mediaAssets }: { block: CmsContentBlock; mediaAssets: CmsMediaAsset[] }) {
  const data = block.data as ImageBlockData & { url?: string };
  const asset = mediaAssets.find(a => a.id === data.assetId);
  // Support both CMS-uploaded assets (assetId) and external URLs (url field)
  const src = asset?.url ?? (data as any).url ?? null;
  const alt = data.alt || asset?.altText || '';
  const alignmentClass = data.alignment === 'center' ? 'mx-auto' : data.alignment === 'right' ? 'ml-auto' : data.alignment === 'full' ? 'w-full' : '';

  if (!src) return null;

  return (
    <div className="mb-4">
      <img
        src={src}
        alt={alt}
        className={`${alignmentClass} rounded`}
        style={{ maxWidth: data.alignment === 'full' ? '100%' : '600px' }}
      />
      {data.caption && (
        <p className="text-center text-sm text-gray-600 mt-2 italic">{data.caption}</p>
      )}
    </div>
  );
}

// Add more editor and preview components as needed...
function VideoEditor({ block, onUpdate, onUpload, mediaAssets, isSelected }: { 
  block: CmsContentBlock; 
  onUpdate: (id: string, data: any) => void; 
  onUpload: (file: File, blockId: string) => Promise<void>;
  mediaAssets: CmsMediaAsset[];
  isSelected: boolean;
}) {
  const data = block.data as VideoBlockData;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAsset = mediaAssets.find(asset => asset.id === data.assetId);
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.alignment}
            onChange={(e) => onUpdate(block.id, { ...data, alignment: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="full">Full Width</option>
          </select>
        </div>
        
        {selectedAsset ? (
          <div className="space-y-2">
            <video 
              src={selectedAsset.url}
              controls={data.controls}
              autoPlay={data.autoplay}
              loop={data.loop}
              className="max-w-full h-auto rounded"
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1 text-sm bg-brand-600 text-white rounded hover:bg-brand-700"
              >
                Change Video
              </button>
              <button
                onClick={() => onUpdate(block.id, { ...data, assetId: '' })}
                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="border-2 border-dashed border-gray-300 rounded p-8 text-center">
            <Video className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p className="text-gray-500 mb-2">No video selected</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
            >
              Upload Video
            </button>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={data.controls}
              onChange={(e) => onUpdate(block.id, { ...data, controls: e.target.checked })}
            />
            <span className="text-sm">Show Controls</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={data.autoplay}
              onChange={(e) => onUpdate(block.id, { ...data, autoplay: e.target.checked })}
            />
            <span className="text-sm">Autoplay</span>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={data.loop}
              onChange={(e) => onUpdate(block.id, { ...data, loop: e.target.checked })}
            />
            <span className="text-sm">Loop</span>
          </label>
        </div>
        
        <input
          type="text"
          value={data.caption || ''}
          onChange={(e) => onUpdate(block.id, { ...data, caption: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Caption (optional)"
        />
        
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              onUpload(file, block.id);
            }
          }}
        />
      </div>
    </div>
  );
}

function VideoPreview({ block, mediaAssets }: { block: CmsContentBlock; mediaAssets: CmsMediaAsset[] }) {
  const data = block.data as VideoBlockData;
  const asset = mediaAssets.find(a => a.id === data.assetId);
  const alignmentClass = data.alignment === 'center' ? 'mx-auto' : data.alignment === 'right' ? 'ml-auto' : data.alignment === 'full' ? 'w-full' : '';
  
  if (!asset) return null;
  
  return (
    <div className="mb-4">
      <video 
        src={asset.url}
        controls={data.controls}
        autoPlay={data.autoplay}
        loop={data.loop}
        className={`${alignmentClass} rounded`}
        style={{ maxWidth: data.alignment === 'full' ? '100%' : '600px' }}
      />
      {data.caption && (
        <p className="text-center text-sm text-gray-600 mt-2 italic">{data.caption}</p>
      )}
    </div>
  );
}

// Add placeholder implementations for remaining editor components
function QuoteEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as QuoteBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.alignment}
            onChange={(e) => onUpdate(block.id, { ...data, alignment: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
          </select>
          <select
            value={data.style}
            onChange={(e) => onUpdate(block.id, { ...data, style: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="default">Default</option>
            <option value="pull">Pull Quote</option>
            <option value="testimonial">Testimonial</option>
          </select>
        </div>
        <textarea
          value={data.text}
          onChange={(e) => onUpdate(block.id, { ...data, text: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          rows={3}
          placeholder="Quote text"
        />
        <input
          type="text"
          value={data.author || ''}
          onChange={(e) => onUpdate(block.id, { ...data, author: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Author (optional)"
        />
      </div>
    </div>
  );
}

function QuotePreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as QuoteBlockData;
  const alignmentClass = data.alignment === 'center' ? 'text-center' : 'text-left';
  const styleClass = data.style === 'pull' ? 'border-l-4 border-brand-600 pl-4 italic' : data.style === 'testimonial' ? 'bg-gray-50 p-4 rounded' : '';
  
  return (
    <blockquote className={`mb-4 ${alignmentClass} ${styleClass}`}>
      <p className="text-lg italic">"{data.text}"</p>
      {data.author && <footer className="text-sm text-gray-600 mt-2">- {data.author}</footer>}
    </blockquote>
  );
}

// Add minimal implementations for remaining components
function ListEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as ListBlockData;
  
  const addItem = () => {
    onUpdate(block.id, { ...data, items: [...data.items, ''] });
  };
  
  const removeItem = (index: number) => {
    onUpdate(block.id, { ...data, items: data.items.filter((_, i) => i !== index) });
  };
  
  const updateItem = (index: number, value: string) => {
    const newItems = [...data.items];
    newItems[index] = value;
    onUpdate(block.id, { ...data, items: newItems });
  };
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={data.ordered}
              onChange={(e) => onUpdate(block.id, { ...data, ordered: e.target.checked })}
            />
            <span className="text-sm">Ordered List</span>
          </label>
        </div>
        
        {data.items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{data.ordered ? `${index + 1}.` : '·'}</span>
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(index, e.target.value)}
              className="flex-1 border border-gray-300 rounded px-3 py-2"
              placeholder="List item"
            />
            <button
              onClick={() => removeItem(index)}
              className="p-1 text-red-600 hover:bg-red-50 rounded"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        
        <button
          onClick={addItem}
          className="px-3 py-1 text-sm bg-brand-600 text-white rounded hover:bg-brand-700"
        >
          Add Item
        </button>
      </div>
    </div>
  );
}

function ListPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as ListBlockData;
  const ListTag = data.ordered ? 'ol' : 'ul';
  
  return (
    <ListTag className="mb-4 space-y-1">
      {data.items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ListTag>
  );
}

function CodeEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as CodeBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.language || 'javascript'}
            onChange={(e) => onUpdate(block.id, { ...data, language: e.target.value })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="json">JSON</option>
            <option value="bash">Bash</option>
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={data.showLineNumbers}
              onChange={(e) => onUpdate(block.id, { ...data, showLineNumbers: e.target.checked })}
            />
            <span className="text-sm">Line Numbers</span>
          </label>
        </div>
        <textarea
          value={data.code}
          onChange={(e) => onUpdate(block.id, { ...data, code: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm"
          rows={8}
          placeholder="// Your code here"
        />
      </div>
    </div>
  );
}

function CodePreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as CodeBlockData;
  
  return (
    <pre className={`mb-4 p-4 bg-gray-900 text-gray-100 rounded overflow-x-auto ${data.theme === 'dark' ? '' : 'bg-gray-100 text-gray-900'}`}>
      <code className={`language-${data.language || 'javascript'}`}>
        {data.code}
      </code>
    </pre>
  );
}

function EmbedEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as EmbedBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <input
          type="url"
          value={data.url}
          onChange={(e) => onUpdate(block.id, { ...data, url: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Embed URL (YouTube, Twitter, etc.)"
        />
        <input
          type="text"
          value={data.title || ''}
          onChange={(e) => onUpdate(block.id, { ...data, title: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Title (optional)"
        />
      </div>
    </div>
  );
}

function EmbedPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as EmbedBlockData;
  
  if (!data.url) return null;
  
  return (
    <div className="mb-4">
      <div className="border border-gray-200 rounded p-4">
        <p className="text-gray-600">Embed: {data.url}</p>
        {data.title && <p className="font-medium mt-2">{data.title}</p>}
      </div>
    </div>
  );
}

function ButtonEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as ButtonBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <select
            value={data.variant}
            onChange={(e) => onUpdate(block.id, { ...data, variant: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="outline">Outline</option>
            <option value="ghost">Ghost</option>
          </select>
          <select
            value={data.size}
            onChange={(e) => onUpdate(block.id, { ...data, size: e.target.value as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
        <input
          type="text"
          value={data.text}
          onChange={(e) => onUpdate(block.id, { ...data, text: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Button text"
        />
        <input
          type="url"
          value={data.url}
          onChange={(e) => onUpdate(block.id, { ...data, url: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Button URL"
        />
      </div>
    </div>
  );
}

function ButtonPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as ButtonBlockData;
  const alignmentClass = data.alignment === 'center' ? 'text-center' : data.alignment === 'right' ? 'text-right' : 'text-left';
  
  const variantClasses = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'bg-gray-600 text-white hover:bg-gray-700',
    outline: 'border border-brand-600 text-brand-600 hover:bg-brand-50',
    ghost: 'text-brand-600 hover:bg-brand-50'
  };
  
  const sizeClasses = {
    small: 'px-3 py-1 text-sm',
    medium: 'px-4 py-2',
    large: 'px-6 py-3 text-lg'
  };
  
  return (
    <div className={`mb-4 ${alignmentClass}`}>
      <a 
        href={data.url}
        className={`inline-block rounded ${variantClasses[data.variant || 'primary']} ${sizeClasses[data.size || 'medium']}`}
      >
        {data.text}
      </a>
    </div>
  );
}

// Add minimal implementations for remaining components
function GalleryEditor({ block, onUpdate, onUpload, mediaAssets, isSelected }: { 
  block: CmsContentBlock; 
  onUpdate: (id: string, data: any) => void; 
  onUpload: (file: File, blockId: string) => Promise<void>;
  mediaAssets: CmsMediaAsset[];
  isSelected: boolean;
}) {
  const data = block.data as GalleryBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Gallery Editor - {data.images.length} images</p>
        <div className="flex items-center gap-2">
          <select
            value={data.columns}
            onChange={(e) => onUpdate(block.id, { ...data, columns: parseInt(e.target.value) as any })}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value={1}>1 Column</option>
            <option value={2}>2 Columns</option>
            <option value={3}>3 Columns</option>
            <option value={4}>4 Columns</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function GalleryPreview({ block, mediaAssets }: { block: CmsContentBlock; mediaAssets: CmsMediaAsset[] }) {
  const data = block.data as GalleryBlockData;
  
  return (
    <div className="mb-4">
      <div className={`grid grid-cols-${data.columns} gap-4`}>
        {data.images.map((image, index) => {
          const asset = mediaAssets.find(a => a.id === image.assetId);
          if (!asset) return null;
          
          return (
            <img 
              key={index}
              src={asset.url} 
              alt={image.alt || asset.altText}
              className="w-full h-auto rounded"
            />
          );
        })}
      </div>
    </div>
  );
}

function HeroEditor({ block, onUpdate, onUpload, mediaAssets, isSelected }: { 
  block: CmsContentBlock; 
  onUpdate: (id: string, data: any) => void; 
  onUpload: (file: File, blockId: string) => Promise<void>;
  mediaAssets: CmsMediaAsset[];
  isSelected: boolean;
}) {
  const data = block.data as HeroBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <input
          type="text"
          value={data.title}
          onChange={(e) => onUpdate(block.id, { ...data, title: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Hero title"
        />
        <input
          type="text"
          value={data.subtitle || ''}
          onChange={(e) => onUpdate(block.id, { ...data, subtitle: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Hero subtitle (optional)"
        />
      </div>
    </div>
  );
}

function HeroPreview({ block, mediaAssets }: { block: CmsContentBlock; mediaAssets: CmsMediaAsset[] }) {
  const data = block.data as HeroBlockData;
  const alignmentClass = data.alignment === 'center' ? 'text-center' : data.alignment === 'right' ? 'text-right' : 'text-left';
  
  return (
    <div className="mb-4 p-8 bg-gradient-to-r from-brand-600 to-purple-600 text-white rounded">
      <div className={alignmentClass}>
        <h1 className="text-4xl font-bold mb-4">{data.title}</h1>
        {data.subtitle && <p className="text-xl">{data.subtitle}</p>}
      </div>
    </div>
  );
}

function StatsEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as StatsBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Stats Editor - {data.stats.length} stats</p>
      </div>
    </div>
  );
}

function StatsPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as StatsBlockData;
  
  return (
    <div className="mb-4 p-6 bg-gray-50 rounded">
      <div className={`grid grid-cols-${data.columns} gap-6 text-center`}>
        {data.stats.map((stat, index) => (
          <div key={index}>
            <div className="text-3xl font-bold text-brand-600">{stat.value}</div>
            <div className="text-gray-600">{stat.label}</div>
            {stat.description && <div className="text-sm text-gray-500 mt-1">{stat.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as PricingBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Pricing Editor - {data.plans.length} plans</p>
      </div>
    </div>
  );
}

function PricingPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as PricingBlockData;
  
  return (
    <div className="mb-4">
      <div className={`grid grid-cols-${data.columns} gap-6`}>
        {data.plans.map((plan, index) => (
          <div key={index} className={`border border-gray-200 rounded p-6 ${plan.highlighted ? 'border-brand-600 shadow-lg' : ''}`}>
            <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
            <div className="text-3xl font-bold mb-4">{plan.price}</div>
            {plan.description && <p className="text-gray-600 mb-4">{plan.description}</p>}
            <ul className="space-y-2 mb-6">
              {plan.features.map((feature, i) => (
                <li key={i} className="flex items-center">
                  <span className="text-green-600 mr-2">·</span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamEditor({ block, onUpdate, onUpload, mediaAssets, isSelected }: { 
  block: CmsContentBlock; 
  onUpdate: (id: string, data: any) => void; 
  onUpload: (file: File, blockId: string) => Promise<void>;
  mediaAssets: CmsMediaAsset[];
  isSelected: boolean;
}) {
  const data = block.data as TeamBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Team Editor - {data.members.length} members</p>
      </div>
    </div>
  );
}

function TeamPreview({ block, mediaAssets }: { block: CmsContentBlock; mediaAssets: CmsMediaAsset[] }) {
  const data = block.data as TeamBlockData;
  
  return (
    <div className="mb-4">
      <div className={`grid grid-cols-${data.columns} gap-6`}>
        {data.members.map((member, index) => (
          <div key={index} className="text-center">
            {member.image && (
              <img 
                src={member.image}
                alt={member.name}
                className="w-24 h-24 rounded-full mx-auto mb-4"
              />
            )}
            <h3 className="text-lg font-semibold">{member.name}</h3>
            <p className="text-gray-600">{member.role}</p>
            {member.bio && <p className="text-sm text-gray-500 mt-2">{member.bio}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactEditor({ block, onUpdate, isSelected }: { block: CmsContentBlock; onUpdate: (id: string, data: any) => void; isSelected: boolean }) {
  const data = block.data as ContactBlockData;
  
  return (
    <div className={`p-4 border border-gray-200 rounded ${isSelected ? 'bg-brand-50' : 'bg-white'}`}>
      <div className="space-y-3">
        <input
          type="text"
          value={data.title || ''}
          onChange={(e) => onUpdate(block.id, { ...data, title: e.target.value })}
          className="w-full border border-gray-300 rounded px-3 py-2"
          placeholder="Contact form title"
        />
        <p className="text-sm text-gray-600">Contact form with {data.fields.length} fields</p>
      </div>
    </div>
  );
}

function ContactPreview({ block }: { block: CmsContentBlock }) {
  const data = block.data as ContactBlockData;
  const alignmentClass = data.alignment === 'center' ? 'text-center' : 'text-left';
  
  return (
    <div className="mb-4 p-6 bg-gray-50 rounded">
      <div className={alignmentClass}>
        {data.title && <h2 className="text-2xl font-bold mb-4">{data.title}</h2>}
        {data.description && <p className="text-gray-600 mb-6">{data.description}</p>}
        <div className="space-y-4 max-w-md mx-auto">
          {data.fields.map((field, index) => (
            <div key={index}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {field.label}
                {field.required && <span className="text-red-600">*</span>}
              </label>
              <input
                type={field.type === 'email' ? 'email' : 'text'}
                placeholder={field.placeholder}
                className="w-full border border-gray-300 rounded px-3 py-2"
                disabled
              />
            </div>
          ))}
          <button className="w-full bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700">
            {data.submitButtonText || 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
