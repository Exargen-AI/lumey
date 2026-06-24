export interface PortfolioMetrics {
  totalActiveTasks: number;
  tasksCompletedThisWeek: number;
  tasksCompletedLastWeek: number;
  blockedProjects: number;
  teamUtilization: {
    overloaded: number;
    balanced: number;
    available: number;
  };
}

export interface VelocityDataPoint {
  week: string;
  projectId: string;
  projectName: string;
  completed: number;
}

export interface HealthOverview {
  green: number;
  yellow: number;
  red: number;
}

export interface PhaseDistribution {
  phase: string;
  count: number;
}

export interface TeamUtilizationEntry {
  userId: string;
  userName: string;
  projects: {
    projectId: string;
    projectName: string;
    taskCount: number;
  }[];
  totalTasks: number;
}

export interface BlockerEntry {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  blockerNote?: string | null;
  blockedSince: string;
  daysBlocked: number;
}

export interface ProjectAnalytics {
  tasksByStatus: Record<string, number>;
  completionRate: { date: string; completed: number }[];
  averageCycleTime: Record<string, number>;
  overdueTasks: number;
  blockerHistory: { date: string; count: number }[];
}
