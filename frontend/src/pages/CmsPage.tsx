import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { useContentProjects, useCreateContentProject, useRegenerateApiKey } from '../hooks/useCms';
import { CmsContentProject } from '../api/cms';
import { Can } from '../components/auth/Can';
import { Plus, Globe, FileText, Copy, RefreshCw, Inbox } from 'lucide-react';
import { CreateProjectDialog } from '../components/cms/CreateProjectDialog';
import { useConfirm } from '@/components/ui';

export default function CmsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedProject, setSelectedProject] = useState<CmsContentProject | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createProjectError, setCreateProjectError] = useState('');
  const [apiKeyMessage, setApiKeyMessage] = useState('');
  const { data: projects, isLoading } = useContentProjects();

  // Honor `state.selectProjectId` so child pages (Blogs / Leads / Settings)
  // can navigate back here and land directly on the project's overview
  // card instead of the project list.
  useEffect(() => {
    const wanted = (location.state as { selectProjectId?: string } | null)?.selectProjectId;
    if (!wanted || selectedProject?.id === wanted) return;
    const list = Array.isArray(projects) ? projects : [];
    const match = list.find((p: CmsContentProject) => p.id === wanted);
    if (match) {
      setSelectedProject(match);
      // Clear the hint so a later back-to-list click isn't overridden.
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, location.state]);
  const createProjectMutation = useCreateContentProject();
  const regenerateApiKeyMutation = useRegenerateApiKey();

  const handleCreateProject = async (data: { name: string; description?: string; domain?: string }) => {
    try {
      setCreateProjectError('');
      await createProjectMutation.mutateAsync(data);
      setIsCreateDialogOpen(false);
      setCreateProjectError('');
    } catch (error: any) {
      console.error('Failed to create project:', error);
      if (axios.isAxiosError(error)) {
        setCreateProjectError(error.response?.data?.error || error.message);
        return;
      }
      setCreateProjectError('Failed to create project');
    }
  };

  const confirm = useConfirm();
  const handleRegenerateApiKey = async () => {
    if (!selectedProject) return;

    const ok = await confirm({
      title: 'Regenerate API key?',
      body: 'The current key will stop working immediately. Any external sites or integrations using it will need to be updated.',
      tone: 'warning',
      confirmLabel: 'Regenerate key',
    });
    if (!ok) return;

    try {
      setApiKeyMessage('');
      const updatedProject = await regenerateApiKeyMutation.mutateAsync(selectedProject.id);
      setSelectedProject(updatedProject);
      setApiKeyMessage('API key regenerated successfully.');
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        setApiKeyMessage(error.response?.data?.error || error.message);
        return;
      }

      setApiKeyMessage('Failed to regenerate API key.');
    }
  };

  const handleCopyApiKey = async () => {
    if (!selectedProject?.apiKey) return;

    try {
      await navigator.clipboard.writeText(selectedProject.apiKey);
      setApiKeyMessage('API key copied to clipboard.');
    } catch {
      setApiKeyMessage('Failed to copy API key.');
    }
  };

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  // Ensure projects is an array (defensive — the API returns one but a
  // partial / mid-flight response could trip pure-array assumptions).
  const projectsArray = Array.isArray(projects) ? projects : [];

  if (selectedProject) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <button
          onClick={() => setSelectedProject(null)}
          className="mb-4 text-brand-600 hover:text-brand-800 text-sm"
        >
          &larr; Back to Projects
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{selectedProject.name}</h1>
              <span className={`px-2 py-0.5 rounded text-xs ${
                selectedProject.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {selectedProject.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {selectedProject.description && (
              <p className="text-gray-600 mt-1">{selectedProject.description}</p>
            )}
          </div>

          {/* API key chip — sits beside the project name */}
          <Can permission="cms.apikey.view">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm max-w-full">
              <Globe className="w-4 h-4 text-gray-500 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">API Key</span>
                <code className="font-mono text-xs truncate" title={selectedProject.apiKey}>
                  {selectedProject.apiKey}
                </code>
              </div>
              <button
                onClick={handleCopyApiKey}
                title="Copy API key"
                className="p-1.5 rounded hover:bg-gray-100 text-gray-600 shrink-0"
              >
                <Copy className="w-4 h-4" />
              </button>
              <Can permission="cms.apikey.manage">
                <button
                  onClick={handleRegenerateApiKey}
                  disabled={regenerateApiKeyMutation.isPending}
                  title="Regenerate API key"
                  className="p-1.5 rounded hover:bg-gray-100 text-yellow-600 disabled:opacity-50 shrink-0"
                >
                  <RefreshCw className={`w-4 h-4 ${regenerateApiKeyMutation.isPending ? 'animate-spin' : ''}`} />
                </button>
              </Can>
              {apiKeyMessage && (
                <span className="text-xs text-gray-600 ml-1 whitespace-nowrap">{apiKeyMessage}</span>
              )}
            </div>
          </Can>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Blogs card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <span className="text-2xl font-semibold text-gray-900 leading-none">
                {selectedProject._count?.blogs ?? 0}
              </span>
            </div>
            <h2 className="text-base font-semibold mb-1">Blogs</h2>
            <p className="text-sm text-gray-500 mb-4">
              Write and publish content for {selectedProject.name}.
            </p>
            <div className="mt-auto">
              <button
                onClick={() => navigate(`/cms/projects/${selectedProject.id}/blogs`)}
                className="inline-flex items-center bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700 text-sm font-medium"
              >
                Manage Blogs
              </button>
            </div>
          </div>

          {/* Leads card */}
          <Can permission="leads.view">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <Inbox className="w-5 h-5" />
                </div>
              </div>
              <h2 className="text-base font-semibold mb-1">Leads</h2>
              <p className="text-sm text-gray-500 mb-4">
                Form submissions ingested from your website via the project API key.
              </p>
              <div className="mt-auto">
                <button
                  onClick={() => navigate(`/cms/projects/${selectedProject.id}/leads`)}
                  className="inline-flex items-center bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700 text-sm font-medium"
                >
                  Manage Leads
                </button>
              </div>
            </div>
          </Can>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Content</h1>
          <p className="text-sm text-gray-500">Blogs and leads for your external websites</p>
        </div>
        <Can permission="cms.project.create">
          <button
            onClick={() => setIsCreateDialogOpen(true)}
            disabled={createProjectMutation.isPending}
            className="bg-brand-600 text-white px-4 py-2 rounded hover:bg-brand-700 flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </button>
        </Can>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {projectsArray.map((project: CmsContentProject) => (
          <div
            key={project.id}
            className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow cursor-pointer"
            onClick={() => setSelectedProject(project)}
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2">{project.name}</h3>
              <p className="text-gray-600 mb-4">{project.description}</p>
              
              <div className="flex justify-between text-sm text-gray-500">
                <span>{project._count?.blogs || 0} blogs</span>
                <span>{project._count?.templates || 0} templates</span>
              </div>
              
              <div className="mt-4 flex items-center justify-between">
                <span className={`px-2 py-1 rounded text-xs ${
                  project.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {project.isActive ? 'Active' : 'Inactive'}
                </span>
                {project.domain && (
                  <span className="text-xs text-gray-500">{project.domain}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        {projectsArray.length === 0 && (
          <div className="col-span-full text-center py-12">
            <div className="text-gray-500 mb-4">
              <Globe className="w-16 h-16 mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No Content Projects</h3>
              <p>Create your first content project to get started</p>
            </div>
          </div>
        )}
      </div>

      <CreateProjectDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setCreateProjectError('');
          setIsCreateDialogOpen(false);
        }}
        onCreate={handleCreateProject}
        isLoading={createProjectMutation.isPending}
        error={createProjectError}
      />
    </div>
  );
}
