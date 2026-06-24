/* eslint-disable no-alert -- Phase 4 migration target: every `alert()` here
   should become a toast (success / error variants) once the toast system
   ships. The `useConfirm` modal is already used for the destructive
   regenerate-api-key prompt. */

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContentProject, useUpdateContentProject, useRegenerateApiKey } from '../../hooks/useCms';
import { Can } from '../../components/auth/Can';
import { useConfirm } from '@/components/ui';
import { Settings, Globe, Copy, RefreshCw } from 'lucide-react';

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    domain: '',
    isActive: true,
  });
  // Scope toggles live outside the basic-info edit flow because we want
  // them editable any time (without entering "edit" mode).
  const [scopesSaving, setScopesSaving] = useState(false);
  const [scopesMessage, setScopesMessage] = useState<string>('');
  
  const { data: project, isLoading } = useContentProject(projectId!);
  const updateProjectMutation = useUpdateContentProject();
  const regenerateApiKeyMutation = useRegenerateApiKey();

  // Update form data when project loads
  if (project && !isEditing) {
    setFormData({
      name: project.name,
      description: project.description || '',
      domain: project.domain || '',
      isActive: project.isActive,
    });
  }

  const handleUpdateProject = async () => {
    try {
      await updateProjectMutation.mutateAsync({
        id: projectId!,
        data: formData,
      });
      setIsEditing(false);
      alert('Project updated successfully!');
    } catch (error: any) {
      alert('Failed to update project: ' + (error.message || 'Unknown error'));
    }
  };

  const confirm = useConfirm();
  const handleRegenerateApiKey = async () => {
    const ok = await confirm({
      title: 'Regenerate API key?',
      body: 'The current key will stop working immediately. Any external sites using it will need to be updated.',
      tone: 'warning',
      confirmLabel: 'Regenerate key',
    });
    if (!ok) return;

    try {
      await regenerateApiKeyMutation.mutateAsync(projectId!);
      alert('API key regenerated successfully!');
    } catch (error: any) {
      alert('Failed to regenerate API key: ' + (error.message || 'Unknown error'));
    }
  };

  const copyApiKey = () => {
    if (project?.apiKey) {
      navigator.clipboard.writeText(project.apiKey);
      alert('API key copied to clipboard!');
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/cms', { state: { selectProjectId: projectId } })}
          className="mb-4 text-brand-600 hover:text-brand-800"
        >
          &larr; Back to {project?.name ?? 'project'}
        </button>
        <h1 className="text-2xl font-bold">Project Settings</h1>
        <p className="text-gray-600">Configure project details and API access</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Basic Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Settings className="w-5 h-5 mr-2" />
            Basic Information
          </h2>
          
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Project Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  rows={3}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Domain (Optional)
                </label>
                <input
                  type="text"
                  value={formData.domain}
                  onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                  placeholder="example.com"
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                />
              </div>
              
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="isActive" className="text-sm text-gray-700">
                  Project is active
                </label>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={handleUpdateProject}
                  disabled={updateProjectMutation.isPending}
                  className="bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700"
                >
                  {updateProjectMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Name</p>
                <p className="font-medium">{project?.name}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Description</p>
                <p className="font-medium">{project?.description || 'No description'}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Domain</p>
                <p className="font-medium">{project?.domain || 'Not set'}</p>
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <span className={`inline-block px-2 py-1 rounded text-xs ${
                  project?.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {project?.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              
              <Can permission="cms.project.edit">
                <button
                  onClick={() => setIsEditing(true)}
                  className="bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700"
                >
                  Edit Settings
                </button>
              </Can>
            </div>
          )}
        </div>

        {/* API Configuration */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Globe className="w-5 h-5 mr-2" />
            API Configuration
          </h2>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-500 mb-2">API Key</p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={project?.apiKey || ''}
                  readOnly
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 font-mono text-sm"
                />
                <button
                  onClick={copyApiKey}
                  className="bg-gray-600 text-white px-3 py-2 rounded hover:bg-gray-700 flex items-center"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Use this key to access your content via the public API
              </p>
            </div>
            
            <div>
              <p className="text-sm text-gray-500 mb-2">Key Permissions (scopes)</p>
              <p className="text-xs text-gray-500 mb-2">
                Controls what this single API key is allowed to do. Leave both on so the same key works for blogs and lead-form ingestion.
              </p>
              {(() => {
                const scopes = project?.apiKeyScopes || [];
                // Empty scopes = legacy "everything allowed" (back-compat).
                // blogs.read is always implicitly granted; we only expose
                // the leads.ingest toggle since that's the gateable surface.
                const leadsOn = scopes.length === 0 || scopes.includes('leads.ingest');
                const toggleLeads = async (next: boolean) => {
                  if (!projectId) return;
                  setScopesSaving(true);
                  setScopesMessage('');
                  try {
                    // ON  -> [] (legacy, blogs + leads both allowed)
                    // OFF -> ['blogs.read'] (non-empty + missing leads.ingest = blocked)
                    const nextScopes = next ? [] : ['blogs.read'];
                    await updateProjectMutation.mutateAsync({
                      id: projectId,
                      data: { apiKeyScopes: nextScopes },
                    });
                    setScopesMessage('Permissions updated.');
                  } catch (e: any) {
                    setScopesMessage(e?.response?.data?.error || 'Failed to update permissions');
                  } finally {
                    setScopesSaving(false);
                  }
                };
                return (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked readOnly />
                      <span><strong>blogs.read</strong> — fetch published blogs (always on)</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={leadsOn}
                        disabled={scopesSaving}
                        onChange={(e) => toggleLeads(e.target.checked)}
                      />
                      <span><strong>leads.ingest</strong> — accept form submissions from your website</span>
                    </label>
                    {scopesMessage && (
                      <p className="text-xs text-gray-600">{scopesMessage}</p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-2">Public API Endpoints</p>
              <div className="bg-gray-50 rounded p-3 text-xs font-mono space-y-1">
                <div>GET /api/v1/cms/public/blogs?apiKey={project?.apiKey}</div>
                <div>GET /api/v1/cms/public/{project?.apiKey}/blogs/:slug</div>
                <div>POST /api/v1/public/{project?.apiKey}/leads</div>
              </div>
            </div>
            
            <Can permission="cms.apikey.manage">
              <button
                onClick={handleRegenerateApiKey}
                disabled={regenerateApiKeyMutation.isPending}
                className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 flex items-center"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {regenerateApiKeyMutation.isPending ? 'Regenerating...' : 'Regenerate API Key'}
              </button>
            </Can>
          </div>
        </div>
      </div>
    </div>
  );
}
