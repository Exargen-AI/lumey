import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useCreateEnvironment } from '@/hooks/useDevOps';

interface EnvironmentManagementDialogProps {
  projectId: string;
  onClose: () => void;
}

export function EnvironmentManagementDialog({
  projectId,
  onClose,
}: EnvironmentManagementDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'DEVELOPMENT',
    branchName: '',
    deploymentUrl: '',
    description: '',
  });

  const [error, setError] = useState('');
  const createEnv = useCreateEnvironment(projectId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name) {
      setError('Environment name is required');
      return;
    }

    try {
      await createEnv.mutateAsync(formData);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to create environment');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-obsidian-bg rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-obsidian-border">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-obsidian-fg">
            Add Environment
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-obsidian-raised rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900 rounded text-red-800 dark:text-red-300 text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Environment Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Production"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Environment Type
            </label>
            <select
              value={formData.type}
              onChange={e => setFormData({ ...formData, type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg"
            >
              <option value="DEVELOPMENT">Development</option>
              <option value="STAGING">Staging</option>
              <option value="PRODUCTION">Production</option>
            </select>
          </div>

          {/* Branch Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Branch Name
            </label>
            <input
              type="text"
              value={formData.branchName}
              onChange={e => setFormData({ ...formData, branchName: e.target.value })}
              placeholder="e.g., main, develop"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Deployment URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Deployment URL
            </label>
            <input
              type="url"
              value={formData.deploymentUrl}
              onChange={e => setFormData({ ...formData, deploymentUrl: e.target.value })}
              placeholder="https://prod.example.com"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional notes about this environment"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg text-gray-700 dark:text-obsidian-fg hover:bg-gray-50 dark:hover:bg-obsidian-raised transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createEnv.isPending}
              className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {createEnv.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
