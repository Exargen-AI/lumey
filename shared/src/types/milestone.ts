import { MilestoneStatus } from '../enums.js';

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  date: string;
  status: MilestoneStatus;
  clientVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMilestoneInput {
  title: string;
  description?: string;
  date: string;
  status?: MilestoneStatus;
  clientVisible?: boolean;
}

export interface UpdateMilestoneInput {
  title?: string;
  description?: string | null;
  date?: string;
  status?: MilestoneStatus;
  clientVisible?: boolean;
}
