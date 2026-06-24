import api from './client';

export type ExternalLinkState = 'OPEN' | 'MERGED' | 'CLOSED';
export type ExternalLinkKind = 'GITHUB_PR';

export interface TaskExternalLink {
  id: string;
  taskId: string;
  kind: ExternalLinkKind;
  externalId: string;
  url: string;
  title: string | null;
  state: ExternalLinkState;
  authorName: string | null;
  authorAvatar: string | null;
  openedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIntegrationConfig {
  repoOwner: string;
  repoName: string;
  autoCloseOnMerge: boolean;
  /** Last successful webhook delivery (event accepted + processed). */
  lastWebhookAt: string | null;
  /** Last failed webhook delivery — null once a success follows. */
  lastWebhookErrorAt: string | null;
  /** Truncated message describing the latest error (if any). */
  lastWebhookError: string | null;
}

// Connect-time response surfaces the freshly-minted webhook secret + the URL
// to paste into GitHub. Both are shown ONCE — the GET endpoint never echoes
// the secret back, so the admin should copy them immediately.
export interface GitHubConnectResponse extends GitHubIntegrationConfig {
  webhookSecret: string;
  webhookUrl: string;
}

export async function getTaskExternalLinks(taskId: string): Promise<TaskExternalLink[]> {
  const { data } = await api.get(`/tasks/${taskId}/external-links`);
  return data.data;
}

export async function getGitHubIntegration(projectId: string): Promise<GitHubIntegrationConfig | null> {
  const { data } = await api.get(`/projects/${projectId}/integrations/github`);
  return data.data;
}

export async function connectGitHub(projectId: string, payload: { repoOwner: string; repoName: string; autoCloseOnMerge?: boolean }): Promise<GitHubConnectResponse> {
  const { data } = await api.post(`/projects/${projectId}/integrations/github`, payload);
  return data.data;
}

export async function disconnectGitHub(projectId: string): Promise<void> {
  await api.delete(`/projects/${projectId}/integrations/github`);
}
