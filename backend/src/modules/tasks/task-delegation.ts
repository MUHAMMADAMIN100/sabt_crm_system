/**
 * Задачи от SMM-специалиста команде производства и приёмка сданных задач
 * автором (решение владельца 17.11.2026, docs/SMM_DELEGATION_SPEC.md §1).
 *
 * Чистые правила отдельно от TasksService — проверяются без базы. Роли —
 * строками, как в task-access.ts.
 */

/** Кому SMM-специалист ставит задачи (кроме себя) — по основной ИЛИ второй роли. */
export const DELEGATE_ROLES: string[] = ['designer', 'producer', 'video_editor', 'videographer'];

export const DELEGATE_DENIED = 'SMM-специалист ставит задачи дизайнерам, продюсеру, монтажёрам и видеографам';
export const DELEGATE_PROJECT_DENIED = 'SMM-специалист ставит задачи без проекта или по своему SMM-проекту';

/** «Ждёт проверки» — только то, что сдано за последние столько дней. */
export const REVIEW_WINDOW_DAYS = 14;

type RoleHolder = { role?: string | null; secondaryRole?: string | null } | null | undefined;

/** SMM-специалист — основной или второй ролью. */
export function isSmmSpecialistUser(u: RoleHolder): boolean {
  return !!u && (u.role === 'smm_specialist' || u.secondaryRole === 'smm_specialist');
}

/** Роль, по которой человеку можно поставить задачу (основная в приоритете);
 *  null — SMM-специалист ставить ему задачи не может. */
export function delegateRoleOf(u: RoleHolder): string | null {
  if (!u) return null;
  if (u.role && DELEGATE_ROLES.includes(u.role)) return u.role;
  if (u.secondaryRole && DELEGATE_ROLES.includes(u.secondaryRole)) return u.secondaryRole;
  return null;
}

export interface ReviewableTask {
  status?: string | null;
  createdById?: string | null;
  assigneeId?: string | null;
  reviewedAt?: Date | string | null;
  completedAt?: Date | string | null;
  /** Очередь исполнителей (task_assignees), как отдаёт loadAssignees. */
  assignees?: Array<{ userId?: string | null } | null> | null;
}

/** Есть ли у задачи исполнитель, кроме этого человека (основной или в очереди). */
export function hasOtherAssignee(task: ReviewableTask, userId: string | null | undefined): boolean {
  if (!userId) return false;
  const ids = [task.assigneeId, ...(task.assignees || []).map(a => a?.userId)].filter(Boolean);
  return ids.some(id => id !== userId);
}

/** «Ждёт проверки»: done, не принята (reviewedAt пуст), сдана не раньше
 *  REVIEW_WINDOW_DAYS дней назад и делал её не только сам автор. */
export function isAwaitingReview(task: ReviewableTask, now: Date = new Date()): boolean {
  if (task.status !== 'done' || task.reviewedAt || !task.completedAt || !task.createdById) return false;
  const doneAt = new Date(task.completedAt as any).getTime();
  if (!Number.isFinite(doneAt) || doneAt < now.getTime() - REVIEW_WINDOW_DAYS * 86400_000) return false;
  return hasOtherAssignee(task, task.createdById);
}
