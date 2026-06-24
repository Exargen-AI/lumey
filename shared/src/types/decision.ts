import { DecisionStatus } from '../enums.js';

export interface Decision {
  id: string;
  projectId: string;
  title: string;
  rationale: string;
  alternatives?: string | null;
  status: DecisionStatus;
  tags: string[];
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionInput {
  title: string;
  rationale: string;
  alternatives?: string;
  status?: DecisionStatus;
  tags?: string[];
}

export interface UpdateDecisionInput {
  title?: string;
  rationale?: string;
  alternatives?: string | null;
  status?: DecisionStatus;
  tags?: string[];
}
