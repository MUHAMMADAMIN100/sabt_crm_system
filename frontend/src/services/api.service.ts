import api from '@/lib/api'

// ─── Auth ────────────────────────────────────────────────
export const authApi = {
  me: () => api.get('/auth/me').then(r => r.data),
  changePassword: (data: any) => api.patch('/auth/change-password', data).then(r => r.data),
  sessions: (days = 7) => api.get('/auth/sessions', { params: { days } }).then(r => r.data),
}

// ─── Users ───────────────────────────────────────────────
export const usersApi = {
  list: (role?: string) => api.get('/users', { params: { role } }).then(r => r.data),
  get: (id: string) => api.get(`/users/${id}`).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data).then(r => r.data),
  toggleActive: (id: string) => api.patch(`/users/${id}/toggle-active`).then(r => r.data),
  block: (id: string, reason?: string) => api.patch(`/users/${id}/block`, { reason }).then(r => r.data),
  unblock: (id: string) => api.patch(`/users/${id}/unblock`).then(r => r.data),
  resetPassword: (id: string, newPassword?: string) => api.patch(`/users/${id}/reset-password`, { newPassword }).then(r => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then(r => r.data),
  cleanupOrphans: () => api.post('/users/cleanup-orphans').then(r => r.data),
}

// ─── Employees ───────────────────────────────────────────
export const employeesApi = {
  list: (params?: any) => api.get('/employees', { params }).then(r => r.data),
  get: (id: string) => api.get(`/employees/${id}`).then(r => r.data),
  create: (data: any) => api.post('/employees', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/employees/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/employees/${id}`).then(r => r.data),
  toggleSubAdmin: (id: string) => api.patch(`/employees/${id}/toggle-sub-admin`).then(r => r.data),
  departments: () => api.get('/employees/departments').then(r => r.data),
  stats: () => api.get('/employees/stats').then(r => r.data),
}

// ─── Projects ────────────────────────────────────────────
export const projectsApi = {
  list: (params?: any) => api.get('/projects', { params }).then(r => r.data),
  get: (id: string) => api.get(`/projects/${id}`).then(r => r.data),
  create: (data: any) => api.post('/projects', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/projects/${id}`, data).then(r => r.data),
  archive: (id: string) => api.patch(`/projects/${id}/archive`).then(r => r.data),
  sendPaymentRequest: (id: string, message?: string) =>
    api.post(`/projects/${id}/send-payment-request`, { message }).then(r => r.data),
  restore: (id: string) => api.patch(`/projects/${id}/restore`).then(r => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`).then(r => r.data),
  stats: () => api.get('/projects/stats').then(r => r.data),
}

// ─── Tasks ───────────────────────────────────────────────
export const tasksApi = {
  list: (params?: any) => api.get('/tasks', { params }).then(r => r.data),
  get: (id: string) => api.get(`/tasks/${id}`).then(r => r.data),
  create: (data: any) => api.post('/tasks', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/tasks/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/tasks/${id}`).then(r => r.data),
  my: () => api.get('/tasks/my').then(r => r.data),
  overdue: () => api.get('/tasks/overdue').then(r => r.data),
  stats: (projectId?: string) => api.get('/tasks/stats', { params: { projectId } }).then(r => r.data),
  approve: (id: string) => api.post(`/tasks/${id}/approve`).then(r => r.data),
  returnTask: (id: string, reason: string) => api.post(`/tasks/${id}/return`, { reason }).then(r => r.data),
  bulk: (ids: string[], action: 'status' | 'delete' | 'assign', value?: string) =>
    api.post('/tasks/bulk', { ids, action, value }).then(r => r.data),
}

// ─── Task Checklists ──────────────────────────────────────
export const taskChecklistApi = {
  list: (taskId: string) => api.get(`/tasks/${taskId}/checklist`).then(r => r.data),
  create: (taskId: string, text: string) => api.post(`/tasks/${taskId}/checklist`, { text }).then(r => r.data),
  toggle: (taskId: string, id: string) => api.patch(`/tasks/${taskId}/checklist/${id}/toggle`).then(r => r.data),
  update: (taskId: string, id: string, text: string) => api.patch(`/tasks/${taskId}/checklist/${id}`, { text }).then(r => r.data),
  remove: (taskId: string, id: string) => api.delete(`/tasks/${taskId}/checklist/${id}`).then(r => r.data),
}

// ─── Task Results ─────────────────────────────────────────
export const taskResultsApi = {
  list: (taskId: string) => api.get(`/tasks/${taskId}/results`).then(r => r.data),
  create: (taskId: string, data: { type: string; content: string; fileName?: string; filePath?: string }) =>
    api.post(`/tasks/${taskId}/results`, data).then(r => r.data),
  remove: (taskId: string, id: string) => api.delete(`/tasks/${taskId}/results/${id}`).then(r => r.data),
}

// ─── Comments ────────────────────────────────────────────
export const commentsApi = {
  list: (taskId: string) => api.get(`/tasks/${taskId}/comments`).then(r => r.data),
  create: (taskId: string, message: string) => api.post(`/tasks/${taskId}/comments`, { message }).then(r => r.data),
  update: (taskId: string, id: string, message: string) => api.patch(`/tasks/${taskId}/comments/${id}`, { message }).then(r => r.data),
  remove: (taskId: string, id: string) => api.delete(`/tasks/${taskId}/comments/${id}`).then(r => r.data),
}

// ─── TimeTracker ─────────────────────────────────────────
export const timeTrackerApi = {
  my: (params?: any) => api.get('/time-tracker/my', { params }).then(r => r.data),
  byTask: (taskId: string) => api.get(`/time-tracker/task/${taskId}`).then(r => r.data),
  running: () => api.get('/time-tracker/running').then(r => r.data),
  start: (taskId: string) => api.post('/time-tracker/start', { taskId }).then(r => r.data),
  stop: () => api.post('/time-tracker/stop').then(r => r.data),
  log: (data: any) => api.post('/time-tracker/log', data).then(r => r.data),
  remove: (id: string) => api.delete(`/time-tracker/${id}`).then(r => r.data),
  summary: (employeeId: string, from: string, to: string) =>
    api.get(`/time-tracker/summary/${employeeId}`, { params: { from, to } }).then(r => r.data),
}

// ─── Notifications ───────────────────────────────────────
export const notificationsApi = {
  list: (unread?: boolean) => api.get('/notifications', { params: { unread } }).then(r => r.data),
  unreadCount: () => api.get('/notifications/unread-count').then(r => r.data),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`).then(r => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then(r => r.data),
  remove: (id: string) => api.delete(`/notifications/${id}`).then(r => r.data),
}

// ─── Reports ─────────────────────────────────────────────
export const reportsApi = {
  list: (params?: any) => api.get('/reports', { params }).then(r => r.data),
  my: () => api.get('/reports/my').then(r => r.data),
  get: (id: string) => api.get(`/reports/${id}`).then(r => r.data),
  create: (data: any) => api.post('/reports', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/reports/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/reports/${id}`).then(r => r.data),
}

// ─── Analytics ───────────────────────────────────────────
export const analyticsApi = {
  dashboard: () => api.get('/analytics/dashboard').then(r => r.data),
  overview: () => api.get('/analytics/overview').then(r => r.data),
  projectsByStatus: () => api.get('/analytics/projects-by-status').then(r => r.data),
  tasksByStatus: () => api.get('/analytics/tasks-by-status').then(r => r.data),
  tasksByPriority: () => api.get('/analytics/tasks-by-priority').then(r => r.data),
  employeeActivity: (params?: any) => api.get('/analytics/employee-activity', { params }).then(r => r.data),
  hoursPerDay: (params?: any) => api.get('/analytics/hours-per-day', { params }).then(r => r.data),
  projectsPerformance: () => api.get('/analytics/projects-performance').then(r => r.data),
  employeeEfficiency: () => api.get('/analytics/employee-efficiency').then(r => r.data),
  employeeWorkload: () => api.get('/analytics/employee-workload').then(r => r.data),
  monthlyReport: (year: number, month: number) => api.get('/analytics/monthly-report', { params: { year, month } }).then(r => r.data),
  departmentStats: () => api.get('/analytics/department-stats').then(r => r.data),
  avgCompletion: () => api.get('/analytics/avg-completion').then(r => r.data),
  payroll: (params?: { from?: string; to?: string }) =>
    api.get('/analytics/payroll', { params }).then(r => r.data),
  sales: () => api.get('/analytics/sales').then(r => r.data),
  incomeExpense: (params?: { from?: string; to?: string; projectId?: string }) =>
    api.get('/analytics/income-expense', { params }).then(r => r.data),
  storiesGlobal: (from: string, to: string) =>
    api.get('/analytics/stories-global', { params: { from, to } }).then(r => r.data),
  updateEmployeeSalary: (employeeId: string, salary: number) => api.patch(`/employees/${employeeId}`, { salary }).then(r => r.data),
}

// ─── Calendar ────────────────────────────────────────────
export const calendarApi = {
  events: (params: any) => api.get('/calendar/events', { params }).then(r => r.data),
}

// ─── Project ads (SMM "Важное") ──────────────────────────
export const projectAdsApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/ads`).then(r => r.data),
  create: (projectId: string, data: any) => api.post(`/projects/${projectId}/ads`, data).then(r => r.data),
  update: (projectId: string, id: string, data: any) => api.patch(`/projects/${projectId}/ads/${id}`, data).then(r => r.data),
  remove: (projectId: string, id: string) => api.delete(`/projects/${projectId}/ads/${id}`).then(r => r.data),
}

// ─── Project announcements ("Важное") ───────────────────
export const projectAnnouncementsApi = {
  list: (projectId: string) => api.get(`/projects/${projectId}/announcements`).then(r => r.data),
  create: (projectId: string, data: any) => api.post(`/projects/${projectId}/announcements`, data).then(r => r.data),
  remove: (projectId: string, id: string) => api.delete(`/projects/${projectId}/announcements/${id}`).then(r => r.data),
}

// ─── Clients (sales CRM) ─────────────────────────────────
export const clientsApi = {
  list: (params?: { search?: string; status?: string; interest?: string; sphere?: string; ownerId?: string; source?: string }) =>
    api.get('/clients', { params }).then(r => r.data),
  stats: () => api.get('/clients/stats').then(r => r.data),
  get: (id: string) => api.get(`/clients/${id}`).then(r => r.data),
  create: (data: any) => api.post('/clients', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/clients/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/clients/${id}`).then(r => r.data),
}

// ─── Stories ─────────────────────────────────────────────
export const storiesApi = {
  my: (from: string, to: string) => api.get('/stories/my', { params: { from, to } }).then(r => r.data),
  all: (from: string, to: string) => api.get('/stories', { params: { from, to } }).then(r => r.data),
  upsert: (data: { projectId: string; date: string; storiesCount: number }) => api.post('/stories', data).then(r => r.data),
}

// ─── Files ───────────────────────────────────────────────
export const filesApi = {
  byProject: (projectId: string) => api.get(`/files/project/${projectId}`).then(r => r.data),
  byTask: (taskId: string) => api.get(`/files/task/${taskId}`).then(r => r.data),
  upload: (file: File, projectId?: string, taskId?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post('/files/upload', fd, { params: { projectId, taskId }, headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
  },
  remove: (id: string) => api.delete(`/files/${id}`).then(r => r.data),
}

// ─── AI Assistant ────────────────────────────────────────
export const aiApi = {
  chat: (message: string, model?: string) => api.post('/ai/chat', { message, model }).then(r => r.data),
  models: () => api.get('/ai/models').then(r => r.data),
}
