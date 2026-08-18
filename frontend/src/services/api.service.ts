import api from '@/lib/api'
import { celebrateTask } from '@/lib/taskCelebration'

// ─── Auth ────────────────────────────────────────────────
export const authApi = {
  me: () => api.get('/auth/me').then(r => r.data),
  changePassword: (data: any) => api.patch('/auth/change-password', data).then(r => r.data),
  sessions: (days = 7) => api.get('/auth/sessions', { params: { days } }).then(r => r.data),
  heartbeat: () => api.post('/auth/heartbeat').then(r => r.data),
  setTheme: (themeColor: string | null) => api.patch('/auth/theme', { themeColor }).then(r => r.data),
}

// helper для multipart/form-data загрузки аватара
const avatarFormData = (file: File) => {
  const fd = new FormData()
  fd.append('avatar', file)
  return fd
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
  // Доступы сотрудников (персональные гранты поверх роли)
  accessCatalog: () => api.get('/users/access/catalog').then(r => r.data),
  listAccess: () => api.get('/users/access').then(r => r.data),
  // permissions — что выдать поверх роли, denied — что отнять из прав роли.
  setAccess: (id: string, permissions: string[], denied: string[] = []) =>
    api.patch(`/users/${id}/access`, { permissions, denied }).then(r => r.data),
  // Обои интерфейса — персональные, хранятся в БД (диск на Railway эфемерный).
  getMyBackground: () => api.get('/users/me/background').then(r => r.data),
  uploadMyBackground: (blob: Blob, opts: { dim: number; scale: number; ratio: number }) => {
    const fd = new FormData()
    // Имя файла обязательно: без него multer не проставит mimetype.
    fd.append('background', blob, 'background.jpg')
    fd.append('dim', String(opts.dim))
    fd.append('scale', String(opts.scale))
    // Пропорции считает браузер: sharp на бэкенде нет, а без них не выразить
    // масштаб относительно «заполнить экран».
    fd.append('ratio', String(opts.ratio))
    return api.patch('/users/me/background', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data)
  },
  setMyBackgroundView: (patch: { dim?: number; scale?: number }) =>
    api.patch('/users/me/background/view', patch).then(r => r.data),
  clearMyBackground: () => api.delete('/users/me/background').then(r => r.data),

  // Аватары — multipart/form-data загрузка картинки
  uploadMyAvatar: (file: File) =>
    api.patch('/users/me/avatar', avatarFormData(file), {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  uploadAvatarFor: (userId: string, file: File) =>
    api.patch(`/users/${userId}/avatar`, avatarFormData(file), {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
}

// ─── Employees ───────────────────────────────────────────
export const employeesApi = {
  list: (params?: any) => api.get('/employees', { params }).then(r => r.data),
  get: (id: string) => api.get(`/employees/${id}`).then(r => r.data),
  create: (data: any) => api.post('/employees', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/employees/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/employees/${id}`).then(r => r.data),
  toggleSubAdmin: (id: string) => api.patch(`/employees/${id}/toggle-sub-admin`).then(r => r.data),
  toggleStoryMaker: (id: string) => api.patch(`/employees/${id}/toggle-story-maker`).then(r => r.data),
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
  // Этап разработки (доска «Разработка», [10%]…[100%]).
  setDevStage: (id: string, devStage: number) => api.patch(`/projects/${id}/dev-stage`, { devStage }).then(r => r.data),
  // Архив историй сторисмейкера (не настоящий архив проекта).
  setStoriesArchived: (id: string, archived: boolean) =>
    api.patch(`/projects/${id}/stories-archive`, { archived }).then(r => r.data),
  sendPaymentRequest: (id: string, message?: string) =>
    api.post(`/projects/${id}/send-payment-request`, { message }).then(r => r.data),
  payments: (id: string) => api.get(`/projects/${id}/payments`).then(r => r.data),
  restore: (id: string) => api.patch(`/projects/${id}/restore`).then(r => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`).then(r => r.data),
  stats: () => api.get('/projects/stats').then(r => r.data),
  // SMM-бриф клиента
  saveBrief: (id: string, brief: any) => api.patch(`/projects/${id}/brief`, brief).then(r => r.data),
  clearBrief: (id: string) => api.delete(`/projects/${id}/brief`).then(r => r.data),
  briefShareLink: (id: string) => api.post(`/projects/${id}/brief/share-link`).then(r => r.data),
}

/** Публичные эндпоинты брифа (для клиентской ссылки без auth). */
export const publicBriefApi = {
  get: (token: string) => api.get(`/public/brief/${token}`).then(r => r.data),
  save: (token: string, brief: any) => api.patch(`/public/brief/${token}`, brief).then(r => r.data),
}

// ─── Tasks ───────────────────────────────────────────────
export const tasksApi = {
  list: (params?: any) => api.get('/tasks', { params }).then(r => r.data),
  get: (id: string) => api.get(`/tasks/${id}`).then(r => r.data),
  create: (data: any) => api.post('/tasks', data).then(r => r.data),
  // Статус задачи меняется из шести экранов, поэтому «Печать успеха»
  // запускается отсюда — из единственной точки, через которую проходят все.
  update: (id: string, data: any) => api.patch(`/tasks/${id}`, data).then(r => {
    if (data?.status === 'done') celebrateTask(id)
    return r.data
  }),
  remove: (id: string, reason?: string) =>
    api.delete(`/tasks/${id}`, { params: reason ? { reason } : undefined }).then(r => r.data),
  my: () => api.get('/tasks/my').then(r => r.data),
  /** Раздел «Задачи от руководителя»: поручения, выданные мне руководством. */
  fromManagement: () => api.get('/tasks/from-management').then(r => r.data),
  /** Вкладка «Я выдал»: задачи, которые поставил текущий пользователь. */
  assignedByMe: () => api.get('/tasks/assigned-by-me').then(r => r.data),
  overdue: () => api.get('/tasks/overdue').then(r => r.data),
  stats: (projectId?: string) => api.get('/tasks/stats', { params: { projectId } }).then(r => r.data),
  approve: (id: string) => api.post(`/tasks/${id}/approve`).then(r => r.data),
  returnTask: (id: string, reason: string) => api.post(`/tasks/${id}/return`, { reason }).then(r => r.data),
  bulk: (ids: string[], action: 'status' | 'delete' | 'assign', value?: string) =>
    api.post('/tasks/bulk', { ids, action, value }).then(r => {
      // Закрыли пачку — печать одна: двадцать подряд превратят награду
      // в раздражитель. Ключом берём первую задачу.
      if (action === 'status' && value === 'done' && ids.length) celebrateTask(ids[0])
      return r.data
    }),
  // Multi-assignee: получить состав исполнителей и пометить свою часть готовой
  assignees: (id: string) => api.get(`/tasks/${id}/assignees`).then(r => r.data),
  // Свою задачу человек чаще всего закрывает именно этой кнопкой, а идёт она
  // мимо update. Печать ставим только когда задача закрыта ЦЕЛИКОМ: если
  // остались другие исполнители, работа ещё не закончена.
  markMyPartDone: (id: string, note?: string) =>
    api.post(`/tasks/${id}/my-part-done`, { note }).then(r => {
      // allDone говорит только о том, что все исполнители отметились. У
      // отменённой задачи бэкенд намеренно не ставит done — поздравлять там
      // не с чем, поэтому смотрим на реальный статус.
      if (r.data?.allDone && r.data?.task?.status === 'done') celebrateTask(id)
      return r.data
    }),
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
  reportProjects: (period: 'week' | 'month', projectId?: string) =>
    api.get('/analytics/report/projects', { params: { period, projectId } }).then(r => r.data),
  reportEmployees: (period: 'week' | 'month', employeeId?: string) =>
    api.get('/analytics/report/employees', { params: { period, employeeId } }).then(r => r.data),
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

// ─── KPI (Wave 13: универсальный KPI всех сотрудников) ────
export const kpiApi = {
  /** KPI всех сотрудников (admin/founder/co_founder only). */
  all: (params?: { from?: string; to?: string }) => api.get('/kpi/all', { params }).then(r => r.data),
  /** KPI конкретного юзера. */
  user: (userId: string, params?: { from?: string; to?: string }) =>
    api.get(`/kpi/user/${userId}`, { params }).then(r => r.data),
  /** Детализация конкретной KPI-метрики — массив записей для модалки. */
  details: (userId: string, metric: string, params?: { from?: string; to?: string }) =>
    api.get(`/kpi/user/${userId}/details`, { params: { metric, ...params } }).then(r => r.data),
  /** Ежедневный автоотчёт СММ (только основатель). */
  smmDaily: (date?: string, scope?: 'all' | 'smm') =>
    api.get('/kpi/smm-daily', { params: { date, scope } }).then(r => r.data),
}

// ─── Clients (sales CRM) ─────────────────────────────────
export const clientsApi = {
  list: (params?: { search?: string; status?: string; interest?: string; sphere?: string; ownerId?: string; source?: string }) =>
    api.get('/clients', { params }).then(r => r.data),
  stats: () => api.get('/clients/stats').then(r => r.data),
  kpi: (params?: { from?: string; to?: string }) => api.get('/clients/kpi', { params }).then(r => r.data),
  /** KPI всех МП — для дашборда основателя (admin/founder/co_founder only). */
  kpiAll: (params?: { from?: string; to?: string }) => api.get('/clients/kpi/all', { params }).then(r => r.data),
  /** KPI конкретного МП по userId — для карточки/страницы сотрудника. */
  kpiOfUser: (userId: string, params?: { from?: string; to?: string }) =>
    api.get(`/clients/kpi/user/${userId}`, { params }).then(r => r.data),
  get: (id: string) => api.get(`/clients/${id}`).then(r => r.data),
  create: (data: any) => api.post('/clients', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/clients/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/clients/${id}`).then(r => r.data),
  /** «Позвонить»: руководитель отмечает/снимает лидов для обзвона. */
  callRequest: (ids: string[], flag: boolean) =>
    api.post('/clients/call-request', { ids, flag }).then(r => r.data),
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

// ─── Activity Log ────────────────────────────────────────
export const activityLogApi = {
  list: (params?: { userId?: string; entity?: string; entityId?: string; limit?: number }) =>
    api.get('/activity-log', { params }).then(r => r.data),
}

// ─── SMM Tariffs (Wave 1) ────────────────────────────────
export const smmTariffsApi = {
  list: (params?: { search?: string; isActive?: boolean }) =>
    api.get('/smm-tariffs', { params }).then(r => r.data),
  get: (id: string) => api.get(`/smm-tariffs/${id}`).then(r => r.data),
  create: (data: any) => api.post('/smm-tariffs', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/smm-tariffs/${id}`, data).then(r => r.data),
  toggleActive: (id: string) => api.patch(`/smm-tariffs/${id}/toggle-active`).then(r => r.data),
  clone: (id: string) => api.post(`/smm-tariffs/${id}/clone`).then(r => r.data),
  remove: (id: string) => api.delete(`/smm-tariffs/${id}`).then(r => r.data),
}

// ─── Content Plan (Wave 4) ───────────────────────────────
export const contentPlanApi = {
  list: (params?: any) => api.get('/content-plan', { params }).then(r => r.data),
  get: (id: string) => api.get(`/content-plan/${id}`).then(r => r.data),
  create: (data: any) => api.post('/content-plan', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/content-plan/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/content-plan/${id}`).then(r => r.data),
  planFact: (projectId: string) => api.get(`/content-plan/plan-fact/${projectId}`).then(r => r.data),
}

// ─── Project Launch Checklist (Wave 7) ───────────────────
export const launchApi = {
  get: (projectId: string) => api.get(`/projects/${projectId}/launch-checklist`).then(r => r.data),
  setItem: (projectId: string, item: string, value: boolean) =>
    api.patch(`/projects/${projectId}/launch-checklist`, { item, value }).then(r => r.data),
}

// ─── Teams (rotation/management — founder/co_founder only) ───────
export const teamsApi = {
  list: (includeInactive?: boolean) =>
    api.get('/teams', { params: { includeInactive: includeInactive ? 'true' : undefined } }).then(r => r.data),
  get: (id: string) => api.get(`/teams/${id}`).then(r => r.data),
  members: (id: string) => api.get(`/teams/${id}/members`).then(r => r.data),
  create: (data: any) => api.post('/teams', data).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/teams/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/teams/${id}`).then(r => r.data),
  setMembers: (id: string, userIds: string[]) =>
    api.patch(`/teams/${id}/members`, { userIds }).then(r => r.data),
  setUserTeam: (userId: string, teamId: string | null) =>
    api.patch(`/teams/user/${userId}`, { teamId }).then(r => r.data),
}

// ─── Finance (Founder/Co-founder only) ──────────────────
export const financeApi = {
  // Дашборды / расчёты
  overview: (ym: string) => api.get('/finance/overview', { params: { ym } }).then(r => r.data),
  incomeDirections: (ym: string) => api.get('/finance/income/directions', { params: { ym } }).then(r => r.data),
  incomeDirectionDetail: (direction: string, ym: string, start?: string) =>
    api.get(`/finance/income/directions/${direction}`, { params: { ym, start } }).then(r => r.data),
  expenseSummary: (ym: string) => api.get('/finance/expense/summary', { params: { ym } }).then(r => r.data),
  expenseDetail: (kind: string, ym: string, start?: string) => api.get(`/finance/expense/detail/${kind}`, { params: { ym, start } }).then(r => r.data),
  accountsBalances: () => api.get('/finance/accounts/balances').then(r => r.data),
  forecast: (params: { start: string; months: number; scenario: string }) => api.get('/finance/forecast', { params }).then(r => r.data),
  createForecastAdjustment: (data: any) => api.post('/finance/forecast/adjustments', data).then(r => r.data),
  updateForecastAdjustment: (id: string, data: any) => api.patch(`/finance/forecast/adjustments/${id}`, data).then(r => r.data),
  removeForecastAdjustment: (id: string) => api.delete(`/finance/forecast/adjustments/${id}`).then(r => r.data),
  /** Разбивка карточки по под-типам (мини-окно при наведении). */
  breakdown: (params: { ym: string; kind: string; id?: string; txType?: string }) =>
    api.get('/finance/breakdown', { params }).then(r => r.data),

  // Транзакции
  transactions: (params?: any) => api.get('/finance/transactions', { params }).then(r => r.data),
  createOperation: (data: any) => api.post('/finance/operations', data).then(r => r.data),
  updateTransaction: (id: string, data: any) => api.patch(`/finance/transactions/${id}`, data).then(r => r.data),
  removeTransaction: (id: string) => api.delete(`/finance/transactions/${id}`).then(r => r.data),
  // Снять расходы месяца по сотруднику/подписке одной транзакцией на бэке.
  removeMonthExpenses: (data: { ym: string; employeeId?: string; subscriptionId?: string; kind?: 'advance' | 'bonus' }) =>
    api.post('/finance/operations/remove-month', data).then(r => r.data),

  // Счета
  accounts: () => api.get('/finance/accounts').then(r => r.data),
  createAccount: (data: any) => api.post('/finance/accounts', data).then(r => r.data),
  updateAccount: (id: string, data: any) => api.patch(`/finance/accounts/${id}`, data).then(r => r.data),
  removeAccount: (id: string) => api.delete(`/finance/accounts/${id}`).then(r => r.data),

  // Категории
  categories: () => api.get('/finance/categories').then(r => r.data),
  createCategory: (data: any) => api.post('/finance/categories', data).then(r => r.data),
  updateCategory: (id: string, data: any) => api.patch(`/finance/categories/${id}`, data).then(r => r.data),
  removeCategory: (id: string) => api.delete(`/finance/categories/${id}`).then(r => r.data),

  // Проекты/клиенты
  projects: () => api.get('/finance/projects').then(r => r.data),
  createProject: (data: any) => api.post('/finance/projects', data).then(r => r.data),
  updateProject: (id: string, data: any) => api.patch(`/finance/projects/${id}`, data).then(r => r.data),
  removeProject: (id: string) => api.delete(`/finance/projects/${id}`).then(r => r.data),
  // Отменить все оплаты проекта (планы + операции) одной транзакцией на бэке.
  cancelProjectPayments: (id: string) => api.post(`/finance/projects/${id}/cancel-payments`, {}).then(r => r.data),

  // Сотрудники
  employees: () => api.get('/finance/employees').then(r => r.data),
  createEmployee: (data: any) => api.post('/finance/employees', data).then(r => r.data),
  updateEmployee: (id: string, data: any) => api.patch(`/finance/employees/${id}`, data).then(r => r.data),
  removeEmployee: (id: string) => api.delete(`/finance/employees/${id}`).then(r => r.data),
  setEmployeeBonus: (id: string, data: { ym: string; amount: number }) => api.post(`/finance/employees/${id}/bonus`, data).then(r => r.data),
  // История оклада и выплат. scope='all' — вся доступная история.
  employeePayouts: (id: string, scope?: number | 'all') =>
    api.get(`/finance/employees/${id}/payouts`, {
      params: scope === 'all' ? { scope: 'all' } : scope ? { months: scope } : undefined,
    }).then(r => r.data),
  setEmployeeAdvance: (id: string, data: { ym: string; amount: number }) => api.post(`/finance/employees/${id}/advance`, data).then(r => r.data),
  setEmployeeFine: (id: string, data: { ym: string; amount: number }) => api.post(`/finance/employees/${id}/fine`, data).then(r => r.data),
  salaryPeriod: (ym?: string) => api.get('/finance/salary/period', { params: ym ? { ym } : undefined }).then(r => r.data),
  // Закрытие разрешено только после реальных выплат по всем сотрудникам.
  closeSalaryMonth: (ym: string) => api.post('/finance/salary/close-month', { ym }).then(r => r.data),
  reopenSalaryMonth: (ym: string) => api.post('/finance/salary/reopen-month', { ym }).then(r => r.data),
  // Журнал активности финансов (кто/что/когда).
  activity: (limit = 50, offset = 0) => api.get('/finance/activity', { params: { limit, offset } }).then(r => r.data),

  // Инвентарь
  assets: () => api.get('/finance/assets').then(r => r.data),
  createAsset: (data: any) => api.post('/finance/assets', data).then(r => r.data),
  updateAsset: (id: string, data: any) => api.patch(`/finance/assets/${id}`, data).then(r => r.data),
  removeAsset: (id: string) => api.delete(`/finance/assets/${id}`).then(r => r.data),
  updatePlanned: (id: string, data: { amount?: number; dueDate?: string | null }) => api.patch(`/finance/planned-payments/${id}`, data).then(r => r.data),

  // Аренда/подписки
  subscriptions: () => api.get('/finance/subscriptions').then(r => r.data),
  createSubscription: (data: any) => api.post('/finance/subscriptions', data).then(r => r.data),
  updateSubscription: (id: string, data: any) => api.patch(`/finance/subscriptions/${id}`, data).then(r => r.data),
  removeSubscription: (id: string) => api.delete(`/finance/subscriptions/${id}`).then(r => r.data),
  // Отметка «оплачено без операции» — балансы счетов не меняются.
  markSubPaid: (id: string, data: { ym?: string; date?: string }) => api.post(`/finance/subscriptions/${id}/mark-paid`, data).then(r => r.data),
  unmarkSubPaid: (id: string, data: { ym?: string }) => api.post(`/finance/subscriptions/${id}/unmark-paid`, data).then(r => r.data),

  // Долги
  debts: () => api.get('/finance/debts').then(r => r.data),
  createDebt: (data: any) => api.post('/finance/debts', data).then(r => r.data),
  updateDebt: (id: string, data: any) => api.patch(`/finance/debts/${id}`, data).then(r => r.data),
  removeDebt: (id: string) => api.delete(`/finance/debts/${id}`).then(r => r.data),
  regenerateDebtSchedule: (id: string) => api.post(`/finance/debts/${id}/regenerate-schedule`, {}).then(r => r.data),

  // Планируемые оплаты (SMM части 1/2, матрицы Development/Design, график долгов)
  plannedPayments: (params?: any) => api.get('/finance/planned-payments', { params }).then(r => r.data),
  createPlanned: (data: any) => api.post('/finance/planned-payments', data).then(r => r.data),
  receivePlanned: (id: string, data: any) => api.post(`/finance/planned-payments/${id}/receive`, data).then(r => r.data),
  unreceivePlanned: (id: string) => api.post(`/finance/planned-payments/${id}/unreceive`, {}).then(r => r.data),
  removePlanned: (id: string) => api.delete(`/finance/planned-payments/${id}`).then(r => r.data),
  payNow: (data: any) => api.post('/finance/planned-payments/pay-now', data).then(r => r.data),

  // Резервная копия / сброс
  exportAll: () => api.get('/finance/backup/export').then(r => r.data),
  importAll: (data: any) => api.post('/finance/backup/import', data).then(r => r.data),
  resetAll: () => api.post('/finance/reset', {}).then(r => r.data),

  // Снимки данных (автобэкап кроном + ручные)
  backups: () => api.get('/finance/backups').then(r => r.data),
  createBackup: () => api.post('/finance/backups', {}).then(r => r.data),
  getBackup: (id: string) => api.get(`/finance/backups/${id}`).then(r => r.data),
  restoreBackup: (id: string) => api.post(`/finance/backups/${id}/restore`, {}).then(r => r.data),
}

// ─── Risk Analytics (Wave 5) ─────────────────────────────
export const riskApi = {
  planFact: (projectId: string) => api.get(`/risk-analytics/plan-fact/${projectId}`).then(r => r.data),
  workloadEmployees: (employeeId?: string) =>
    api.get('/risk-analytics/workload/employees', { params: { employeeId } }).then(r => r.data),
  workloadPm: (pmId?: string) =>
    api.get('/risk-analytics/workload/pm', { params: { pmId } }).then(r => r.data),
  projectRisks: () => api.get('/risk-analytics/risks/projects').then(r => r.data),
  projectRiskDetail: (id: string) => api.get(`/risk-analytics/risks/projects/${id}`).then(r => r.data),
  employeeRisks: () => api.get('/risk-analytics/risks/employees').then(r => r.data),
  employeeRiskDetail: (id: string) => api.get(`/risk-analytics/risks/employees/${id}`).then(r => r.data),
}

// ─── Workflow — доска «Процесс работы» SMM-проекта ──────
export const workflowApi = {
  list: (projectId: string) => api.get(`/workflow/project/${projectId}`).then(r => r.data),
  listAll: () => api.get('/workflow/all').then(r => r.data),
  /** Карточки, где текущий пользователь — исполнитель (кабинет сотрудника). */
  myCards: () => api.get('/workflow/my').then(r => r.data),
  /** Просроченные карточки доски (в зоне видимости) — для дашбордов. */
  overdue: () => api.get('/workflow/overdue').then(r => r.data),
  /** Глобальная занятость дат (публикации/съёмки всех проектов) — для
   *  подсветки календаря при планировании. */
  publicationLoad: () => api.get('/workflow/publication-load').then(r => r.data),
  /** Видеоролики, запланированные к публикации на ближайшие N дней (по
   *  умолчанию 1–2 дня) — для кабинета публикатора и дашбордов. */
  upcomingPublications: (days = 2) =>
    api.get('/workflow/upcoming-publications', { params: { days } }).then(r => r.data),
  create: (projectId: string, data: any) => api.post(`/workflow/project/${projectId}`, data).then(r => r.data),
  /** M3: сгенерировать план месяца из тарифа (рилсы + макеты). */
  generatePlan: (projectId: string, month?: string) =>
    api.post(`/workflow/project/${projectId}/generate-plan`, { month }).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/workflow/${id}`, data).then(r => r.data),
  move: (id: string, data: { stage: string; position?: number }) =>
    api.patch(`/workflow/${id}/move`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/workflow/${id}`).then(r => r.data),
  /** Движок переходов: действие выхода этапа (ТЗ §10). */
  transition: (id: string, action: string, payload?: any) =>
    api.post(`/workflow/${id}/transition`, { action, payload }).then(r => r.data),
  /** История событий карточки. */
  events: (id: string) => api.get(`/workflow/${id}/events`).then(r => r.data),
  /** §9.1/§9.2: сгруппировать рилсы в съёмку + пакетно подтвердить. */
  createShootSession: (projectId: string, data: any) =>
    api.post(`/workflow/project/${projectId}/shoot-session`, data).then(r => r.data),
  /** §11: настройка отступов дедлайнов. */
  getDeadlineSettings: () => api.get('/workflow/settings/deadlines').then(r => r.data),
  updateDeadlineSettings: (data: any) => api.patch('/workflow/settings/deadlines', data).then(r => r.data),
  /** Контент-план: сохранить КП → карточки «Рилсы»/«Макеты». */
  saveContentPlan: (projectId: string, data: { reels?: any[]; macros?: any[] }) =>
    api.post(`/workflow/project/${projectId}/content-plan`, data).then(r => r.data),
  /** Обновить элементы групповой карточки. */
  updateItems: (id: string, items: any[]) =>
    api.patch(`/workflow/${id}/items`, { items }).then(r => r.data),
  /** Все исполнители по ролям (видеографы/дизайнеры) для селекта. */
  assignees: (roles: string[]) =>
    api.get('/workflow/assignees', { params: { roles: roles.join(',') } }).then(r => r.data),
  /** Вынести один элемент группы как отдельную карточку на следующий этап. */
  advanceItem: (cardId: string, itemId: string) =>
    api.post(`/workflow/${cardId}/item/${itemId}/advance`, {}).then(r => r.data),
  /** Очистить всю доску (для тестов) — только руководитель. */
  clearAll: () => api.post('/workflow/clear', {}).then(r => r.data),
  /** «История» — архивные карточки (опубликованы > 6 дней назад). */
  archive: () => api.get('/workflow/archive').then(r => r.data),
  projectArchive: (projectId: string) => api.get(`/workflow/project/${projectId}/archive`).then(r => r.data),
}

/** Справочники организатора съёмок: клиенты / модели / места (полный CRUD).
 *  kind: 'clients' | 'models' | 'places'. Доступ — грант organizer.directory. */
export const organizerApi = {
  list: (kind: string, search?: string) =>
    api.get(`/organizer-directory/${kind}`, { params: { search } }).then(r => r.data),
  create: (kind: string, data: any) =>
    api.post(`/organizer-directory/${kind}`, data).then(r => r.data),
  update: (kind: string, id: string, data: any) =>
    api.patch(`/organizer-directory/${kind}/${id}`, data).then(r => r.data),
  remove: (kind: string, id: string) =>
    api.delete(`/organizer-directory/${kind}/${id}`).then(r => r.data),
  // Фото модели — multipart/form-data. Возвращает { filename }, которое
  // затем сохраняется в поле photo при создании/обновлении записи.
  uploadPhoto: (file: File) => {
    const fd = new FormData()
    fd.append('photo', file)
    return api.post('/organizer-directory/models/photo', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data as { filename: string })
  },
}

/** Личные заметки («Заметки» сторисмейкера). Бэк всегда скоупит по
 *  владельцу из JWT — API возвращает и меняет только СВОИ заметки. */
export const notesApi = {
  list: () => api.get('/my-notes').then(r => r.data),
  create: (data: { text: string; date?: string | null }) =>
    api.post('/my-notes', data).then(r => r.data),
  update: (id: string, data: { text?: string; date?: string | null; done?: boolean }) =>
    api.patch(`/my-notes/${id}`, data).then(r => r.data),
  remove: (id: string) => api.delete(`/my-notes/${id}`).then(r => r.data),
}
