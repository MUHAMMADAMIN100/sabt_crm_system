/**
 * Кабинет задач («Мне» / «Я поставил») и быстрая форма SMM-специалиста
 * (docs/SMM_DELEGATION_SPEC.md, 17.11.2026). Формы ответов сервера —
 * GET /tasks/from-management, /tasks/assigned-by-me, /tasks/delegation/options.
 */

export interface TaskPerson {
  id: string
  name: string
  avatar?: string | null
}

/** Исполнитель из task_assignees. Сервер отдаёт { userId, user: {…} };
 *  на случай плоской формы { id, name, avatar } понимаем и её. */
export interface CabinetAssignee {
  userId?: string
  id?: string
  name?: string
  avatar?: string | null
  isDone?: boolean
  doneAt?: string | null
  /** Заметка исполнителя к своей части («Готово» с комментарием). */
  note?: string | null
  user?: TaskPerson | null
}

export interface CabinetTask {
  id: string
  title: string
  description?: string | null
  status: string
  priority?: string | null
  deadline?: string | null
  createdAt?: string
  updatedAt?: string
  /** Когда исполнитель отметил «Готово». */
  completedAt?: string | null
  /** Когда автор нажал «Принять». */
  reviewedAt?: string | null
  reworkCount?: number | null
  returnReason?: string | null
  /** «Ждёт проверки»: done, не принята, сдана за последние 14 дней, автор ≠ исполнитель. */
  awaitingReview?: boolean
  projectId?: string | null
  project?: { id: string; name: string } | null
  createdById?: string | null
  createdBy?: TaskPerson | null
  assigneeId?: string | null
  assignee?: TaskPerson | null
  assignees?: CabinetAssignee[]
}

/** Человек в «Кому» быстрой формы. inTeam — в команде выбранного проекта. */
export interface DelegationPerson {
  id: string
  name: string
  avatar: string | null
  role: string
  inTeam: boolean
}

export interface DelegationOptions {
  people: DelegationPerson[]
  projects: Array<{ id: string; name: string }>
}

/** Результат задачи (task_results). */
export interface TaskResultItem {
  id: string
  type: 'file' | 'link' | 'comment' | 'media' | string
  content: string
  fileName?: string | null
  filePath?: string | null
  createdAt?: string
  submittedBy?: TaskPerson | null
}

/** Файл, прикреплённый к задаче (files). */
export interface TaskFileItem {
  id: string
  originalName: string
  path: string
  mimetype: string
  size?: number
  createdAt?: string
}
