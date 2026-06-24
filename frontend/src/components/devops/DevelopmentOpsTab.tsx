import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDevOpsOverview,
  useRepositories,
  useEnvironmentsWithStatus,
  useProjectActivities,
  useProjectDeployments,
  useLatestReleases,
  usePipelines,
  useLatestPipelineRun,
  useSyncActivities,
} from '@/hooks/useDevOps';
import { Plus, GitBranch, Zap, Archive, Tag, ActivitySquare } from 'lucide-react';
import { EnvironmentCard, ActivityTimeline, StatusBadge, PipelineRunBadge } from './StatusBadges';
import { RepositoryConnectionDialog } from './RepositoryConnectionDialog';
import { EnvironmentManagementDialog } from './EnvironmentManagementDialog';

interface DevelopmentOpsTabProps {
  projectId: string;
}

const DEVOPS_TABS = [
  { id: 'overview', label: 'Overview', icon: ActivitySquare },
  { id: 'repositories', label: 'Repositories', icon: GitBranch },
  { id: 'activities', label: 'Activity Feed', icon: ActivitySquare },
  { id: 'pipelines', label: 'Pipelines', icon: Zap },
  { id: 'environments', label: 'Environments', icon: Archive },
  { id: 'deployments', label: 'Deployments', icon: Archive },
  { id: 'releases', label: 'Releases', icon: Tag },
];

export function DevelopmentOpsTab({ projectId }: DevelopmentOpsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [showRepoDialog, setShowRepoDialog] = useState(false);
  const [showEnvDialog, setShowEnvDialog] = useState(false);
  const navigate = useNavigate();

  const { data: overviewResponse, isLoading: overviewLoading } = useDevOpsOverview(projectId);
  const { data: repositoriesResponse } = useRepositories(projectId);
  const { data: environmentsResponse } = useEnvironmentsWithStatus(projectId);
  const { data: activitiesResponse } = useProjectActivities(projectId);
  const { data: deploymentsResponse } = useProjectDeployments(projectId);
  const { data: releasesResponse } = useLatestReleases(projectId);

  const overview = overviewResponse?.data?.data;
  const repositories = (repositoriesResponse?.data?.data ?? []) as any[];
  const environments = (environmentsResponse?.data?.data ?? []) as any[];
  const activities = (activitiesResponse?.data?.data ?? []) as any[];
  const deployments = (deploymentsResponse?.data?.data ?? []) as any[];
  const releases = (releasesResponse?.data?.data ?? []) as any[];

  if (overviewLoading) {
    return <div className="text-center py-12 text-gray-400">Loading DevelopmentOps...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-obsidian-border overflow-x-auto">
        <div className="flex gap-1">
          {DEVOPS_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
                  activeSubTab === tab.id
                    ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                    : 'border-transparent text-gray-600 dark:text-obsidian-muted hover:text-gray-900 dark:hover:text-obsidian-fg'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard label="Repositories" value={overview?.repositoriesCount || 0} />
            <StatCard label="Environments" value={overview?.environmentsCount || 0} />
            <StatCard label="Recent Activities" value={overview?.recentActivitiesCount || 0} />
            <StatCard label="Recent Deployments" value={overview?.recentDeploymentsCount || 0} />
            <StatCard label="Recent Releases" value={overview?.recentReleasesCount || 0} />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg">Connected Repositories</h3>
                <button
                  onClick={() => setShowRepoDialog(true)}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors"
                >
                  <Plus size={14} />
                  Connect
                </button>
              </div>
              {overview?.repositories && overview.repositories.length > 0 ? (
                <div className="space-y-2">
                  {overview.repositories.map((repo: any) => (
                    <div key={repo.id} className="p-3 border border-gray-200 dark:border-obsidian-border rounded">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-gray-900 dark:text-obsidian-fg">
                            {repo.repoOwner}/{repo.repoName}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-obsidian-faded mt-0.5">{repo.provider}</p>
                        </div>
                        {repo.isPrivate && (
                          <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded">Private</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-obsidian-muted">
                  No repositories connected. <br />
                  <button
                    onClick={() => setShowRepoDialog(true)}
                    className="text-brand-600 dark:text-brand-400 hover:underline text-sm mt-2"
                  >
                    Connect one →
                  </button>
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg mb-4">Recent Deployments</h3>
              {deployments && deployments.length > 0 ? (
                <div className="space-y-2">
                  {deployments.slice(0, 5).map((deploy: any) => (
                    <div key={deploy.id} className="p-3 border border-gray-200 dark:border-obsidian-border rounded">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-gray-900 dark:text-obsidian-fg">v{deploy.version}</p>
                          <p className="text-xs text-gray-500 dark:text-obsidian-faded mt-0.5">{deploy.environmentId}</p>
                        </div>
                        <StatusBadge status={deploy.deploymentStatus} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-obsidian-muted">No deployments yet</div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg">Environments</h3>
              <button
                onClick={() => setShowEnvDialog(true)}
                className="flex items-center gap-1 px-3 py-1 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
            {environments && environments.length > 0 ? (
              <div className="grid md:grid-cols-3 gap-4">
                {environments.map((env: any) => (
                  <EnvironmentCard
                    key={env.id}
                    name={env.name}
                    type={env.type}
                    status={env.status}
                    branchName={env.branchName}
                    deploymentUrl={env.deploymentUrl}
                    latestDeployment={env.latestDeployment}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-obsidian-muted">No environments configured</div>
            )}
          </div>

          <div>
            <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg mb-4">Recent Activities</h3>
            {activities && activities.length > 0 ? (
              <ActivityTimeline activities={activities.slice(0, 10)} />
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-obsidian-muted">No activities found</div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === 'repositories' && (
        <RepositoriesView
          projectId={projectId}
          onAddClick={() => setShowRepoDialog(true)}
          onViewActivities={() => setActiveSubTab('activities')}
        />
      )}

      {activeSubTab === 'activities' && <ActivityFeedView projectId={projectId} />}

      {activeSubTab === 'pipelines' && <PipelinesView projectId={projectId} />}

      {activeSubTab === 'environments' && (
        <EnvironmentsView projectId={projectId} onAddClick={() => setShowEnvDialog(true)} />
      )}

      {activeSubTab === 'deployments' && <DeploymentsView projectId={projectId} />}

      {activeSubTab === 'releases' && <ReleasesView projectId={projectId} />}

      {showRepoDialog && <RepositoryConnectionDialog projectId={projectId} onClose={() => setShowRepoDialog(false)} />}
      {showEnvDialog && <EnvironmentManagementDialog projectId={projectId} onClose={() => setShowEnvDialog(false)} />}
    </div>
  );
}

// ─── HELPER COMPONENTS ───

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 dark:bg-obsidian-raised rounded-lg p-4 text-center">
      <p className="text-2xl font-bold text-gray-900 dark:text-obsidian-fg">{value}</p>
      <p className="text-xs text-gray-600 dark:text-obsidian-muted mt-1">{label}</p>
    </div>
  );
}

function RepositoriesView({
  projectId,
  onAddClick,
  onViewActivities,
}: {
  projectId: string;
  onAddClick: () => void;
  onViewActivities: () => void;
}) {
  const { data: repositoriesResponse } = useRepositories(projectId);
  const repositories = (repositoriesResponse?.data?.data ?? []) as any[];

  return (
    <div>
      <button
        onClick={onAddClick}
        className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 mb-4"
      >
        <Plus size={16} />
        Connect Repository
      </button>

      {repositories && repositories.length > 0 ? (
        <div className="space-y-3">
          {repositories.map((repo: any) => (
            <RepositoryCard key={repo.id} repository={repo} onViewActivities={onViewActivities} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">No repositories connected</div>
      )}
    </div>
  );
}

function RepositoryCard({ repository, onViewActivities }: { repository: any; onViewActivities: () => void }) {
  const syncActivities = useSyncActivities(repository.id);

  return (
    <div className="border border-gray-200 dark:border-obsidian-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-obsidian-fg">{repository.repoOwner}/{repository.repoName}</h4>
          <p className="text-sm text-gray-600 dark:text-obsidian-muted">{repository.repoUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={repository.provider} />
          {repository.isPrivate && (
            <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded">Private</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-500 dark:text-obsidian-muted">
        <div>
          <span className="block font-medium text-gray-700 dark:text-obsidian-fg">Branch</span>
          <span>{repository.defaultBranch}</span>
        </div>
        <div>
          <span className="block font-medium text-gray-700 dark:text-obsidian-fg">Last activity</span>
          <span>{repository.latestActivityTitle || 'No activity yet'}</span>
        </div>
        <div>
          <span className="block font-medium text-gray-700 dark:text-obsidian-fg">Last synced</span>
          <span>{repository.lastSyncedAt ? new Date(repository.lastSyncedAt).toLocaleDateString() : 'Never'}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => syncActivities.mutate()}
          disabled={syncActivities.isPending}
          className="px-3 py-2 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {syncActivities.isPending ? 'Syncing…' : 'Check Updates'}
        </button>
        <button
          type="button"
          onClick={onViewActivities}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-obsidian-border rounded hover:bg-gray-50 dark:hover:bg-obsidian-raised transition-colors"
        >
          View Activity
        </button>
        <a
          href={repository.repoUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="px-3 py-2 text-sm border border-gray-300 dark:border-obsidian-border rounded hover:bg-gray-50 dark:hover:bg-obsidian-raised transition-colors"
        >
          Open in GitHub
        </a>
      </div>
    </div>
  );
}

function ActivityFeedView({ projectId }: { projectId: string }) {
  const { data: activitiesResponse, isLoading } = useProjectActivities(projectId);
  const activities = activitiesResponse?.data?.data || [];
  const navigate = useNavigate();

  const handleCreateTask = (activity: any) => {
    const params = new URLSearchParams();
    params.set('title', activity.title);
    if (activity.description) {
      params.set('description', activity.description);
    }
    navigate(`/projects/${projectId}/tasks/new?${params.toString()}`);
  };

  return (
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg mb-4">Activity Feed</h3>
      {isLoading ? (
        <div className="text-center py-10 text-gray-500 dark:text-obsidian-muted">Loading activity feed…</div>
      ) : (
        <ActivityTimeline activities={activities} onCreateTask={handleCreateTask} />
      )}
    </div>
  );
}

function EnvironmentsView({ projectId, onAddClick }: { projectId: string; onAddClick: () => void }) {
  const { data: environmentsResponse, isLoading } = useEnvironmentsWithStatus(projectId);
  const environments = (environmentsResponse?.data?.data ?? []) as any[];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg">Environments</h3>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted">Manage deployment targets and health status.</p>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          className="flex items-center gap-1 px-3 py-1 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 transition-colors"
        >
          <Plus size={14} />
          Add Environment
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-500 dark:text-obsidian-muted">Loading environments…</div>
      ) : environments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {environments.map((env: any) => (
            <EnvironmentCard
              key={env.id}
              name={env.name}
              type={env.type}
              status={env.status}
              branchName={env.branchName}
              deploymentUrl={env.deploymentUrl}
              latestDeployment={env.latestDeployment}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">No environments configured</div>
      )}
    </div>
  );
}

function PipelinesView({ projectId }: { projectId: string }) {
  const { data: repositoriesResponse, isLoading } = useRepositories(projectId);
  const repositories = (repositoriesResponse?.data?.data ?? []) as any[];

  return (
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg mb-4">CI/CD Pipelines</h3>
      {isLoading ? (
        <div className="text-center py-10 text-gray-500 dark:text-obsidian-muted">Loading pipelines…</div>
      ) : repositories && repositories.length > 0 ? (
        <div className="space-y-4">
          {repositories.map((repo: any) => (
            <RepositoryPipelineBlock key={repo.id} repository={repo} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">No repositories connected</div>
      )}
    </div>
  );
}

function RepositoryPipelineBlock({ repository }: { repository: any }) {
  const { data: pipelinesResponse, isLoading } = usePipelines(repository.id);
  const pipelines = pipelinesResponse?.data?.data;
  const syncActivities = useSyncActivities(repository.id);

  return (
    <div className="border border-gray-200 dark:border-obsidian-border rounded-lg p-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h4 className="font-medium text-gray-900 dark:text-obsidian-fg">{repository.repoOwner}/{repository.repoName}</h4>
          <p className="text-xs text-gray-500 dark:text-obsidian-muted">Sync GitHub Actions workflows and runs</p>
        </div>
        <button
          type="button"
          onClick={() => syncActivities.mutate()}
          disabled={syncActivities.isPending}
          className="px-3 py-2 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {syncActivities.isPending ? 'Refreshing…' : 'Sync workflows'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 dark:text-obsidian-muted">Loading pipeline history…</div>
      ) : pipelines && pipelines.length > 0 ? (
        <div className="space-y-3">
          {pipelines.map((pipeline: any) => (
            <PipelineSummary key={pipeline.id} pipeline={pipeline} />
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-500 dark:text-obsidian-muted">
          No workflow pipelines discovered yet. Use Check Updates on the repository to populate workflows from GitHub.
        </div>
      )}
    </div>
  );
}

function PipelineSummary({ pipeline }: { pipeline: any }) {
  const { data: latestRunResponse } = useLatestPipelineRun(pipeline.id);
  const latestRun = latestRunResponse?.data?.data;

  return (
    <div className="border border-gray-200 dark:border-obsidian-border rounded-lg p-3 bg-gray-50 dark:bg-obsidian-raised">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-obsidian-fg">{pipeline.pipelineName}</p>
          <p className="text-xs text-gray-500 dark:text-obsidian-muted">Workflow ID {pipeline.externalPipelineId}</p>
        </div>
        {latestRun ? (
          <PipelineRunBadge status={latestRun.status} conclusion={latestRun.conclusion} />
        ) : (
          <span className="text-xs text-gray-500 dark:text-obsidian-muted">No runs yet</span>
        )}
      </div>
      {latestRun && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-500 dark:text-obsidian-muted">
          <div>
            <span className="block text-gray-700 dark:text-obsidian-fg">Run</span>
            <span>#{latestRun.runNumber}</span>
          </div>
          <div>
            <span className="block text-gray-700 dark:text-obsidian-fg">Branch</span>
            <span>{latestRun.branch || 'unknown'}</span>
          </div>
          <div>
            <span className="block text-gray-700 dark:text-obsidian-fg">Finished</span>
            <span>{latestRun.completedAt ? new Date(latestRun.completedAt).toLocaleDateString() : 'in progress'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DeploymentsView({ projectId }: { projectId: string }) {
  const { data: deploymentsResponse, isLoading } = useProjectDeployments(projectId);
  const deployments = deploymentsResponse?.data?.data;

  return (
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg mb-4">Deployments</h3>
      {isLoading ? (
        <div className="text-center py-10 text-gray-500 dark:text-obsidian-muted">Loading deployments…</div>
      ) : deployments && deployments.length > 0 ? (
        <div className="space-y-3">
          {deployments.map((deployment: any) => (
            <div key={deployment.id} className="border border-gray-200 dark:border-obsidian-border rounded-lg p-4 bg-gray-50 dark:bg-obsidian-raised">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-obsidian-fg">{deployment.version}</p>
                  <p className="text-xs text-gray-500 dark:text-obsidian-muted">Environment: {deployment.environmentId}</p>
                </div>
                <StatusBadge status={deployment.deploymentStatus} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-500 dark:text-obsidian-muted">
                <div>
                  <span className="block text-gray-700 dark:text-obsidian-fg">Deployed</span>
                  <span>{deployment.deploymentTime ? new Date(deployment.deploymentTime).toLocaleString() : 'pending'}</span>
                </div>
                <div>
                  <span className="block text-gray-700 dark:text-obsidian-fg">Commit</span>
                  <span>{deployment.commitSha || 'unknown'}</span>
                </div>
                <div>
                  <span className="block text-gray-700 dark:text-obsidian-fg">By</span>
                  <span>{deployment.deployedBy || 'system'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">No deployments have been recorded.</div>
      )}
    </div>
  );
}

function ReleasesView({ projectId }: { projectId: string }) {
  const { data: releasesResponse, isLoading } = useLatestReleases(projectId);
  const releases = releasesResponse?.data?.data;

  return (
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-obsidian-fg mb-4">Releases</h3>
      {isLoading ? (
        <div className="text-center py-10 text-gray-500 dark:text-obsidian-muted">Loading releases…</div>
      ) : releases && releases.length > 0 ? (
        <div className="space-y-3">
          {releases.map((release: any) => (
            <div key={release.id} className="border border-gray-200 dark:border-obsidian-border rounded-lg p-4 bg-gray-50 dark:bg-obsidian-raised">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div>
                  <p className="font-medium text-gray-900 dark:text-obsidian-fg">{release.releaseTag}</p>
                  <p className="text-xs text-gray-500 dark:text-obsidian-muted">
                    {release.repoOwner && release.repoName ? `${release.repoOwner}/${release.repoName}` : 'Repository unknown'}
                  </p>
                </div>
                <span className="text-xs text-gray-500 dark:text-obsidian-muted">{release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : 'Unpublished'}</span>
              </div>
              {release.releaseName && <p className="text-sm text-gray-700 dark:text-obsidian-fg mb-2">{release.releaseName}</p>}
              {release.releaseNotes && <p className="text-xs text-gray-500 dark:text-obsidian-muted line-clamp-3">{release.releaseNotes}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500 dark:text-obsidian-muted">No releases found yet.</div>
      )}
    </div>
  );
}
