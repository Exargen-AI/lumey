import React from 'react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';

interface StatusBadgeProps {
  status?: string;
  className?: string;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon?: string }> = {
  // Deployment statuses
  'PENDING': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  'IN_PROGRESS': { bg: 'bg-blue-100', text: 'text-blue-800' },
  'SUCCESS': { bg: 'bg-green-100', text: 'text-green-800' },
  'FAILED': { bg: 'bg-red-100', text: 'text-red-800' },
  'ROLLED_BACK': { bg: 'bg-orange-100', text: 'text-orange-800' },

  // Environment statuses
  'HEALTHY': { bg: 'bg-green-100', text: 'text-green-800' },
  'DEGRADED': { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  'DOWN': { bg: 'bg-red-100', text: 'text-red-800' },
  'UNKNOWN': { bg: 'bg-gray-100', text: 'text-gray-800' },

  // Pipeline statuses
  'QUEUED': { bg: 'bg-gray-100', text: 'text-gray-800' },
  'RUNNING': { bg: 'bg-blue-100', text: 'text-blue-800' },
  'CANCELLED': { bg: 'bg-gray-100', text: 'text-gray-800' },

  // Provider badges
  'GITHUB': { bg: 'bg-slate-100', text: 'text-slate-800' },
  'GITLAB': { bg: 'bg-orange-100', text: 'text-orange-800' },
  'BITBUCKET': { bg: 'bg-blue-100', text: 'text-blue-800' },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalizedStatus = status?.toString().trim() || 'UNKNOWN';
  const config = STATUS_CONFIG[normalizedStatus] || STATUS_CONFIG['UNKNOWN'];
  const displayName = normalizedStatus
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  return (
    <span className={cn(config.bg, config.text, 'px-2 py-1 rounded text-xs font-medium', className)}>
      {displayName}
    </span>
  );
}

export function DeploymentStatusIcon({ status }: { status: string }) {
  if (status === 'SUCCESS') return <span className="text-green-600">✓</span>;
  if (status === 'FAILED') return <span className="text-red-600">✕</span>;
  if (status === 'IN_PROGRESS') return <span className="text-blue-600 animate-spin">⧉</span>;
  return <span className="text-gray-400">◯</span>;
}

interface EnvironmentCardProps {
  name: string;
  type?: string;
  status?: string;
  branchName?: string;
  deploymentUrl?: string;
  latestDeployment?: {
    version: string;
    deploymentStatus: string;
    deploymentTime?: string;
  };
  onClick?: () => void;
}

export function EnvironmentCard({
  name,
  type,
  status,
  branchName,
  deploymentUrl,
  latestDeployment,
  onClick,
}: EnvironmentCardProps) {
  const displayType = type ? type.charAt(0).toUpperCase() + type.slice(1).toLowerCase() : 'Unknown';

  return (
    <div
      onClick={onClick}
      className="border border-gray-200 dark:border-obsidian-border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-gray-900 dark:text-obsidian-fg">{name}</h3>
          <p className="text-xs text-gray-500 dark:text-obsidian-faded mt-0.5">
            {displayType}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="space-y-2 mb-3">
        {branchName && (
          <div className="text-xs text-gray-600 dark:text-obsidian-muted">
            <span className="font-medium">Branch:</span> {branchName}
          </div>
        )}
        {deploymentUrl && (
          <div className="text-xs">
            <a
              href={deploymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 dark:text-brand-400 hover:underline"
              onClick={e => e.stopPropagation()}
            >
              Visit →
            </a>
          </div>
        )}
      </div>

      {latestDeployment && (
        <div className="pt-2 border-t border-gray-100 dark:border-obsidian-border">
          <p className="text-xs text-gray-500 dark:text-obsidian-faded mb-1">Latest</p>
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-gray-700 dark:text-obsidian-fg">
              v{latestDeployment.version}
            </span>
            <DeploymentStatusIcon status={latestDeployment.deploymentStatus} />
          </div>
          {latestDeployment.deploymentTime && (
            <p className="text-xs text-gray-400 dark:text-obsidian-faded mt-1">
              {new Date(latestDeployment.deploymentTime).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface ActivityTimelineProps {
  activities: any[];
  onCreateTask?: (activity: any) => void;
  onViewDetails?: (activity: any) => void;
}

export function ActivityTimeline({
  activities,
  onCreateTask,
  onViewDetails,
}: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-obsidian-muted">
        No activities found
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity, idx) => (
        <div key={activity.id} className="flex gap-4">
          {/* Timeline dot */}
          <div className="flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-brand-500 mt-1.5" />
            {idx < activities.length - 1 && <div className="w-0.5 h-12 bg-gray-200 dark:bg-obsidian-border mt-1" />}
          </div>

          {/* Activity card */}
          <div className="flex-1 pb-4">
            <div className="bg-gray-50 dark:bg-obsidian-raised rounded-lg p-3">
              <div className="flex items-start justify-between mb-1">
                <h4 className="font-medium text-sm text-gray-900 dark:text-obsidian-fg">
                  {activity.title}
                </h4>
                <span className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-obsidian-border rounded text-gray-600 dark:text-obsidian-muted">
                  {activity.activityType.replace(/_/g, ' ')}
                </span>
              </div>

              {activity.description && (
                <p className="text-xs text-gray-600 dark:text-obsidian-muted mb-2 line-clamp-2">
                  {activity.description}
                </p>
              )}

              <div className="flex items-center justify-between">
                <div className="flex gap-2 text-xs text-gray-500 dark:text-obsidian-faded">
                  {activity.authorName && <span>{activity.authorName}</span>}
                  {activity.branchName && <span>•</span>}
                  {activity.branchName && <span>{activity.branchName}</span>}
                  <span>•</span>
                  <span>{new Date(activity.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-2">
                  {activity.activityUrl && (
                    <a
                      href={activity.activityUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      View
                    </a>
                  )}
                  {onCreateTask && (
                    <button
                      onClick={() => onCreateTask(activity)}
                      className="text-xs text-brand-600 dark:text-brand-400 hover:underline"
                    >
                      Task
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface PipelineRunBadgeProps {
  status: string;
  conclusion?: string;
}

export function PipelineRunBadge({ status, conclusion }: PipelineRunBadgeProps) {
  return <StatusBadge status={conclusion || status} />;
}
