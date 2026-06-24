import { TaskStatus, TaskPriority } from '../enums.js';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  creatorId: string;
  dueDate?: string | null;
  labels: string[];
  subtasks: Subtask[];
  isBlocked: boolean;
  blockerNote?: string | null;
  clientVisible: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskWithRelations extends Task {
  assignee?: { id: string; name: string } | null;
  creator: { id: string; name: string };
  project?: { id: string; name: string; slug: string };
  _count?: { comments: number };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  dueDate?: string;
  labels?: string[];
  subtasks?: Subtask[];
  clientVisible?: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  dueDate?: string | null;
  labels?: string[];
  subtasks?: Subtask[];
  isBlocked?: boolean;
  blockerNote?: string | null;
  clientVisible?: boolean;
  sortOrder?: number;
}

export interface MoveTaskInput {
  status: TaskStatus;
  sortOrder?: number;
}
