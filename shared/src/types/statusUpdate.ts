import { HealthStatus } from '../enums.js';

export interface StatusUpdate {
  id: string;
  projectId: string;
  authorId: string;
  signal: HealthStatus;
  note?: string | null;
  createdAt: string;
  author?: { id: string; name: string };
}

export interface CreateStatusUpdateInput {
  signal: HealthStatus;
  note?: string;
}
