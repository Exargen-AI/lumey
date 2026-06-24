import { useState, useCallback, useRef } from 'react';
import { CmsMediaAsset } from '@exargen/shared';
import { Search, Upload, X, Eye, Download, Trash2, Image as ImageIcon, Video, FileText, Grid, List } from 'lucide-react';

interface MediaManagerProps {
  assets: CmsMediaAsset[];
  onUpload: (files: File[]) => Promise<unknown>;
  onSelect?: (asset: CmsMediaAsset) => void;
  onDelete?: (assetId: string) => void;
  multiSelect?: boolean;
  maxSelection?: number;
}

export function MediaManager({ 
  assets, 
  onUpload, 
  onSelect, 
  onDelete, 
  multiSelect = false,
  maxSelection = 10 
}: MediaManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'document'>('all');
  const [uploadError, setUploadError] = useState('');
  const [failedPreviews, setFailedPreviews] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         asset.originalName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'all' || 
                       (filterType === 'image' && asset.mimeType.startsWith('image/')) ||
                       (filterType === 'video' && asset.mimeType.startsWith('video/')) ||
                       (filterType === 'document' && asset.mimeType.includes('document'));
    
    return matchesSearch && matchesType;
  });

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      try {
        setUploadError('');
        await onUpload(files);
      } catch (error) {
        console.error('Media upload failed:', error);
        const message =
          typeof error === 'object' &&
          error !== null &&
          'response' in error &&
          typeof (error as any).response?.data?.error === 'string'
            ? (error as any).response.data.error
            : 'Media upload failed';
        setUploadError(message);
      }
    }
    e.target.value = '';
  }, [onUpload]);

  const handleAssetSelect = useCallback((asset: CmsMediaAsset) => {
    if (multiSelect) {
      const newSelection = selectedAssets.includes(asset.id)
        ? selectedAssets.filter(id => id !== asset.id)
        : [...selectedAssets, asset.id].slice(0, maxSelection);
      
      setSelectedAssets(newSelection);
    } else if (onSelect) {
      onSelect(asset);
    }
  }, [multiSelect, selectedAssets, maxSelection, onSelect]);

  const handleDelete = useCallback((assetId: string) => {
    if (onDelete) {
      onDelete(assetId);
      setSelectedAssets(prev => prev.filter(id => id !== assetId));
    }
  }, [onDelete]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getAssetIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return ImageIcon;
    if (mimeType.startsWith('video/')) return Video;
    return FileText;
  };

  const AssetCard = ({ asset }: { asset: CmsMediaAsset }) => {
    const Icon = getAssetIcon(asset.mimeType);
    const isSelected = selectedAssets.includes(asset.id);
    const isImage = asset.mimeType.startsWith('image/') && !failedPreviews[asset.id];
    const isVideo = asset.mimeType.startsWith('video/');

    return (
      <div
        className={`relative group border-2 rounded-lg overflow-hidden cursor-pointer transition-all ${
          isSelected ? 'border-brand-600 ring-2 ring-brand-600' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => handleAssetSelect(asset)}
      >
        <div className="aspect-square bg-gray-50 flex items-center justify-center">
          {isImage ? (
            <img
              src={asset.url}
              alt={asset.altText || asset.originalName}
              className="w-full h-full object-cover"
              onError={() =>
                setFailedPreviews((prev) => ({
                  ...prev,
                  [asset.id]: true,
                }))
              }
            />
          ) : isVideo ? (
            <video
              src={asset.url}
              className="w-full h-full object-cover"
              muted
            />
          ) : (
            <Icon className="w-16 h-16 text-gray-400" />
          )}
        </div>

        <div className="p-3 bg-white">
          <div className="truncate text-sm font-medium text-gray-900" title={asset.originalName}>
            {asset.originalName}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {formatFileSize(asset.size)} · {formatDate(asset.createdAt)}
          </div>
        </div>

        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex gap-1">
            {multiSelect && (
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                isSelected ? 'bg-brand-600 border-brand-600' : 'bg-white border-gray-300'
              }`}>
                {isSelected && <span className="text-white text-xs">·</span>}
              </div>
            )}
            {!multiSelect && onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(asset.id);
                }}
                className="p-1 bg-white rounded shadow hover:bg-red-50"
              >
                <Trash2 className="w-3 h-3 text-red-600" />
              </button>
            )}
          </div>
        </div>

        {asset.altText && (
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded max-w-[80%] truncate">
            {asset.altText}
          </div>
        )}
      </div>
    );
  };

  const AssetListItem = ({ asset }: { asset: CmsMediaAsset }) => {
    const Icon = getAssetIcon(asset.mimeType);
    const isSelected = selectedAssets.includes(asset.id);
    const isImage = asset.mimeType.startsWith('image/') && !failedPreviews[asset.id];

    return (
      <div
        className={`flex items-center gap-4 p-4 border rounded-lg cursor-pointer transition-all ${
          isSelected ? 'border-brand-600 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
        }`}
        onClick={() => handleAssetSelect(asset)}
      >
        <div className="w-16 h-16 bg-gray-50 rounded flex items-center justify-center flex-shrink-0">
          {isImage ? (
            <img
              src={asset.url}
              alt={asset.altText || asset.originalName}
              className="w-full h-full object-cover rounded"
              onError={() =>
                setFailedPreviews((prev) => ({
                  ...prev,
                  [asset.id]: true,
                }))
              }
            />
          ) : (
            <Icon className="w-8 h-8 text-gray-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium text-gray-900" title={asset.originalName}>
            {asset.originalName}
          </div>
          <div className="text-xs text-gray-500">
            {formatFileSize(asset.size)} · {asset.mimeType} · {formatDate(asset.createdAt)}
          </div>
          {asset.altText && (
            <div className="text-xs text-gray-600 mt-1 truncate">Alt: {asset.altText}</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {multiSelect && (
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
              isSelected ? 'bg-brand-600 border-brand-600' : 'bg-white border-gray-300'
            }`}>
              {isSelected && <span className="text-white text-xs">·</span>}
            </div>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(asset.id);
              }}
              className="p-1 hover:bg-red-50 rounded"
            >
              <Trash2 className="w-4 h-4 text-red-600" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Media Library</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,.pdf,.doc,.docx"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      </div>

      {uploadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {uploadError}
        </div>
      )}

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search media..."
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
            <option value="image">Images</option>
            <option value="video">Videos</option>
            <option value="document">Documents</option>
          </select>

          <div className="flex border border-gray-300 rounded-lg">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 ${viewMode === 'grid' ? 'bg-gray-100' : ''}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 ${viewMode === 'list' ? 'bg-gray-100' : ''}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Selection Info */}
      {multiSelect && selectedAssets.length > 0 && (
        <div className="flex items-center justify-between p-3 bg-brand-50 border border-brand-200 rounded-lg">
          <span className="text-sm text-brand-800">
            {selectedAssets.length} item{selectedAssets.length !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setSelectedAssets([])}
            className="text-sm text-brand-600 hover:text-brand-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Media Grid/List */}
      {filteredAssets.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-gray-500">
            {searchQuery || filterType !== 'all' ? (
              <>
                <Search className="w-16 h-16 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No media found</h3>
                <p>Try adjusting your search or filters</p>
              </>
            ) : (
              <>
                <Upload className="w-16 h-16 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No media yet</h3>
                <p>Upload your first media files to get started</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4' : 'space-y-2'}>
          {filteredAssets.map(asset => 
            viewMode === 'grid' ? (
              <AssetCard key={asset.id} asset={asset} />
            ) : (
              <AssetListItem key={asset.id} asset={asset} />
            )
          )}
        </div>
      )}

      {/* Stats */}
      <div className="text-sm text-gray-500 border-t pt-4">
        Showing {filteredAssets.length} of {assets.length} items
      </div>
    </div>
  );
}
