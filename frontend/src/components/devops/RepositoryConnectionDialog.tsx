import React, { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useCreateRepository } from '@/hooks/useDevOps';
import { Button } from '@/components/ui';

interface RepositoryConnectionDialogProps {
  projectId: string;
  onClose: () => void;
}

export function RepositoryConnectionDialog({
  projectId,
  onClose,
}: RepositoryConnectionDialogProps) {
  const [formData, setFormData] = useState({
    provider: 'GITHUB',
    repoOwner: '',
    repoName: '',
    repoUrl: '',
    accessToken: '',
    isPrivate: false,
    defaultBranch: 'main',
  });

  const [error, setError] = useState('');
  const createRepo = useCreateRepository(projectId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.repoOwner || !formData.repoName || !formData.repoUrl) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      await createRepo.mutateAsync(formData);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to connect repository');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-obsidian-bg rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-obsidian-border">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-obsidian-fg">
            Connect Repository
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

          {/* Provider */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Provider
            </label>
            <select
              value={formData.provider}
              onChange={e => setFormData({ ...formData, provider: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg"
            >
              <option value="GITHUB">GitHub</option>
              <option value="GITLAB" disabled>GitLab (coming soon)</option>
              <option value="BITBUCKET" disabled>Bitbucket (coming soon)</option>
            </select>
          </div>

          {/* Owner */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Repository Owner *
            </label>
            <input
              type="text"
              value={formData.repoOwner}
              onChange={e => setFormData({ ...formData, repoOwner: e.target.value })}
              placeholder="e.g., octocat"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Repository Name *
            </label>
            <input
              type="text"
              value={formData.repoName}
              onChange={e => setFormData({ ...formData, repoName: e.target.value })}
              placeholder="e.g., Hello-World"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Repository URL *
            </label>
            <input
              type="url"
              value={formData.repoUrl}
              onChange={e => setFormData({ ...formData, repoUrl: e.target.value })}
              placeholder="https://github.com/owner/repo"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Access Token */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Access Token (optional)
            </label>
            <input
              type="password"
              value={formData.accessToken}
              onChange={e => setFormData({ ...formData, accessToken: e.target.value })}
              placeholder="For private repositories"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Default Branch */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-obsidian-fg mb-1">
              Default Branch
            </label>
            <input
              type="text"
              value={formData.defaultBranch}
              onChange={e => setFormData({ ...formData, defaultBranch: e.target.value })}
              placeholder="main"
              className="w-full px-3 py-2 border border-gray-300 dark:border-obsidian-border rounded-lg bg-white dark:bg-obsidian-raised text-gray-900 dark:text-obsidian-fg placeholder-gray-500 dark:placeholder-obsidian-muted"
            />
          </div>

          {/* Private Checkbox */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPrivate"
              checked={formData.isPrivate}
              onChange={e => setFormData({ ...formData, isPrivate: e.target.checked })}
              className="w-4 h-4 border border-gray-300 rounded cursor-pointer"
            />
            <label htmlFor="isPrivate" className="text-sm text-gray-700 dark:text-obsidian-fg cursor-pointer">
              This is a private repository
            </label>
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
              disabled={createRepo.isPending}
              className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {createRepo.isPending ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
