import axios, { AxiosInstance } from 'axios';
import { ValidationError } from '../utils/errors';
import { RepositoryActivityType } from '@prisma/client';

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt?: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
  commit: {
    sha: string;
    url: string;
  };
}

export interface GitHubRelease {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
}

export interface RepositoryActivity {
  id: string;
  type: RepositoryActivityType;
  title: string;
  description?: string;
  author?: string;
  branch?: string;
  url?: string;
  timestamp: Date;
}

/**
 * GitHub API integration service
 * Handles all GitHub API calls for repository operations
 */
export class GitHubProvider {
  private client: AxiosInstance;
  private baseUrl = 'https://api.github.com';

  constructor(private accessToken?: string) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: this.getHeaders(),
      timeout: 30000,
    });
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `token ${this.accessToken}`;
    }

    return headers;
  }

  private formatGitHubError(operation: string, error: unknown): ValidationError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      const githubMessage = error.response?.data?.message;
      const baseDetails = [
        status !== undefined ? `status=${status}` : null,
        statusText ? statusText : null,
      ]
        .filter(Boolean)
        .join(' ');

      let message = `Failed to ${operation}`;
      if (status === 404) {
        message = `Failed to ${operation}: repository not found or access denied. ` +
          'If this is a private repo, add a valid GitHub access token and try again.';
      }

      const details = [
        githubMessage ? `github=${githubMessage}` : null,
        baseDetails ? baseDetails : null,
      ]
        .filter(Boolean)
        .join(' ');

      return new ValidationError(
        `${message}${details ? `: ${details}` : ''}`,
      );
    }

    return new ValidationError(
      `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /**
   * Validate repository access
   */
  async validateRepository(owner: string, repo: string): Promise<boolean> {
    try {
      await this.client.get(`/repos/${owner}/${repo}`);
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false;
      }
      throw new ValidationError('Failed to validate GitHub repository');
    }
  }

  /**
   * Fetch recent commits
   */
  async getCommits(
    owner: string,
    repo: string,
    branch: string = 'main',
    since?: Date,
  ): Promise<GitHubCommit[]> {
    try {
      const params: Record<string, any> = {
        per_page: 100,
        sha: branch,
      };

      if (since) {
        params.since = since.toISOString();
      }

      const response = await this.client.get(`/repos/${owner}/${repo}/commits`, { params });

      return response.data.map((commit: any) => ({
        sha: commit.sha,
        message: commit.commit.message,
        author: commit.commit.author.name,
        timestamp: commit.commit.author.date,
        url: commit.html_url,
      }));
    } catch (error) {
      throw this.formatGitHubError('fetch GitHub commits', error);
    }
  }

  /**
   * Fetch pull requests
   */
  async getPullRequests(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'all',
    since?: Date,
  ): Promise<GitHubPullRequest[]> {
    try {
      const params: Record<string, any> = {
        state,
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
      };

      const response = await this.client.get(`/repos/${owner}/${repo}/pulls`, { params });

      return response.data
        .filter((pr: any) => !since || new Date(pr.updated_at) > since)
        .map((pr: any) => ({
          number: pr.number,
          title: pr.title,
          body: pr.body,
          state: pr.state,
          merged: pr.merged,
          mergedAt: pr.merged_at,
          user: pr.user.login,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          url: pr.html_url,
        }));
    } catch (error) {
      throw this.formatGitHubError('fetch GitHub pull requests', error);
    }
  }

  /**
   * Fetch branches
   */
  async getBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    try {
      const params = { per_page: 100 };
      const response = await this.client.get(`/repos/${owner}/${repo}/branches`, { params });

      return response.data.map((branch: any) => ({
        name: branch.name,
        protected: branch.protected,
        commit: {
          sha: branch.commit.sha,
          url: branch.commit.url,
        },
      }));
    } catch (error) {
      throw this.formatGitHubError('fetch GitHub branches', error);
    }
  }

  /**
   * Fetch releases
   */
  async getReleases(owner: string, repo: string, since?: Date): Promise<GitHubRelease[]> {
    try {
      const params = { per_page: 100 };
      const response = await this.client.get(`/repos/${owner}/${repo}/releases`, { params });

      return response.data
        .filter((release: any) => !since || new Date(release.published_at) > since)
        .map((release: any) => ({
          tagName: release.tag_name,
          name: release.name,
          body: release.body,
          publishedAt: release.published_at,
          url: release.html_url,
        }));
    } catch (error) {
      throw this.formatGitHubError('fetch GitHub releases', error);
    }
  }

  /**
   * Fetch workflow runs
   */
  async getWorkflowRuns(
    owner: string,
    repo: string,
    since?: Date,
  ): Promise<any[]> {
    try {
      const params: Record<string, any> = {
        per_page: 100,
        created: since ? `>${since.toISOString().split('T')[0]}` : undefined,
      };

      const response = await this.client.get(
        `/repos/${owner}/${repo}/actions/runs`,
        { params },
      );

      return response.data.workflow_runs || [];
    } catch (error) {
      throw this.formatGitHubError('fetch GitHub workflow runs', error);
    }
  }

  /**
   * Get current rate limit status
   */
  async getRateLimit(): Promise<{ limit: number; remaining: number; reset: Date }> {
    try {
      const response = await this.client.get('/rate_limit');
      const core = response.data.resources.core;

      return {
        limit: core.limit,
        remaining: core.remaining,
        reset: new Date(core.reset * 1000),
      };
    } catch (error) {
      throw new ValidationError('Failed to fetch GitHub rate limit');
    }
  }
}

/**
 * Provider factory for different Git providers
 */
export class GitProviderFactory {
  static getProvider(provider: string, accessToken?: string) {
    switch (provider.toUpperCase()) {
      case 'GITHUB':
        return new GitHubProvider(accessToken);
      case 'GITLAB':
        throw new ValidationError('GitLab integration coming in Phase 2');
      case 'BITBUCKET':
        throw new ValidationError('Bitbucket integration coming in Phase 2');
      default:
        throw new ValidationError(`Unknown provider: ${provider}`);
    }
  }
}
