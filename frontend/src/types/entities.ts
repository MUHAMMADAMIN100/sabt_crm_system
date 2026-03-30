// ─── Status / Priority union types ───────────────────────────────────────────

export type UserRole = 'admin' | 'employee';

export type EmployeeStatus = 'active' | 'inactive';

export type ProjectStatus = 'planning' | 'in_progress' | 'completed' | 'archived' | 'on_hold';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type TaskStatus = 'new' | 'in_progress' | 'review' | 'done' | 'cancelled';

// ─── Core entities ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Employee {
  id: string;
  fullName: string;
  /** Alias for fullName */
  name: string;
  position: string;
  department: string;
  email: string;
  phone: string | null;
  telegram: string | null;
  instagram: string | null;
  hireDate: string;
  status: EmployeeStatus;
  avatar: string | null;
  bio: string | null;
  salary: number | null;
  isSubAdmin: boolean;
  userId: string | null;
  user: User | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  managerId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ProjectStatus;
  color: string | null;
  budget: number | null;
  progress: number;
  members: User[];
  tasks: Task[];
  projectType: string | null;
  smmData: Record<string, string> | null;
  clientInfo: Record<string, string> | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  projectId: string;
  project: Project | null;
  assigneeId: string | null;
  assignee: User | null;
  createdById: string | null;
  createdBy: User | null;
  priority: TaskPriority;
  status: TaskStatus;
  deadline: string | null;
  estimatedHours: number;
  loggedHours: number;
  comments: Comment[];
  files: FileAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: string;
  message: string;
  taskId: string;
  authorId: string;
  author: User | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  taskId: string | null;
  projectId: string | null;
  createdAt: string;
}

export interface FileAttachment {
  id: string;
  originalName: string;
  filename: string;
  mimetype: string;
  size: number;
  path: string;
  taskId: string | null;
  projectId: string | null;
  uploadedById: string | null;
  createdAt: string;
}

export interface DailyReport {
  id: string;
  employeeId: string;
  employee: User | null;
  date: string;
  timeSpent: number;
  projectId: string | null;
  project: Project | null;
  taskId: string | null;
  task: Task | null;
  description: string;
  comments: string | null;
  createdAt: string;
}

export interface TimeLog {
  id: string;
  employeeId: string;
  employee: User | null;
  taskId: string;
  task: Task | null;
  timeSpent: number;
  date: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
}
