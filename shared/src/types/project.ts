import { ProjectCategory, ProjectPhase, HealthStatus, UserRole } from '../enums.js';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  clientDescription?: string | null;
  category: ProjectCategory;
  phase: ProjectPhase;
  healthStatus: HealthStatus;
  autoHealth: boolean;
  tags: string[];
  startDate?: string | null;
  targetDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberInfo {
  id: string;
  userId: string;
  role: UserRole;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface ProjectWithDetails extends Project {
  members: ProjectMemberInfo[];
  _count?: {
    tasks: number;
  };
  taskCounts?: {
    total: number;
    inProgress: number;
    done: number;
    blocked: number;
  };
}

export interface CreateProjectInput {
  name: string;
  slug?: string;
  description?: string;
  clientDescription?: string;
  category: ProjectCategory;
  phase?: ProjectPhase;
  healthStatus?: HealthStatus;
  tags?: string[];
  startDate?: string;
  targetDate?: string;
  memberIds?: { userId: string; role: UserRole }[];
}

export interface UpdateProjectInput {
  name?: string;
  slug?: string;
  description?: string | null;
  clientDescription?: string | null;
  category?: ProjectCategory;
  phase?: ProjectPhase;
  healthStatus?: HealthStatus;
  autoHealth?: boolean;
  tags?: string[];
  startDate?: string | null;
  targetDate?: string | null;
}
