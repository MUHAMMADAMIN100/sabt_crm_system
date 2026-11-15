import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { directionScopeOf } from '../../common/direction-scope';

/**
 * Доступ к задаче и её вложениям (чек-лист, результаты, учёт времени,
 * исполнители) — одно правило (15.11.2026). Раньше GET этих ручек отдавал
 * данные любой задачи по id, а свои списки PM-ролей в модулях отставали
 * (без dev_director и pm_dev). Правило чтения — то же, что в
 * TasksService.findOne.
 *
 * Отдельный файл, а не метод TasksService: модуль результатов импортирует
 * TasksModule наоборот, и инъекция сервиса дала бы циклическую зависимость.
 */

/** Роли с PM-полномочиями по задачам — основная ИЛИ вторая роль. */
export const TASK_PM_ROLES = ['admin', 'founder', 'smm_director', 'dev_director', 'pm_dev'];

export interface TaskViewer {
  id: string;
  role?: string | null;
  secondaryRole?: string | null;
}

export interface TaskAccessRow {
  assigneeId: string | null;
  createdById: string | null;
  scope: string | null;
  fromFounder: boolean;
  projectType: string | null;
  managerId: string | null;
  /** Со-исполнитель (task_assignees). */
  co: boolean;
  /** Участник проекта задачи. */
  member: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTaskPm(u?: { role?: string | null; secondaryRole?: string | null } | null): boolean {
  return !!u && (TASK_PM_ROLES.includes(u.role || '') || TASK_PM_ROLES.includes(u.secondaryRole || ''));
}

/** PM-роль действует в задаче: руководитель направления — только в своей
 *  сфере (безпроектные задачи направлением не ограничены). */
export function isPmForTask(viewer: TaskViewer | null | undefined, projectType?: string | null): boolean {
  if (!isTaskPm(viewer)) return false;
  const dir = directionScopeOf(viewer as any);
  if (!dir || !projectType) return true;
  return dir.projectTypes.includes(projectType);
}

/** Строка доступа к задаче; null — задачи нет (или id не uuid). */
export async function loadTaskAccess(
  manager: EntityManager,
  taskId: string,
  viewerId: string,
): Promise<TaskAccessRow | null> {
  if (!UUID_RE.test(String(taskId || ''))) return null;
  const rows: any[] = await manager.query(
    `SELECT t."assigneeId"::text AS "assigneeId", t."createdById"::text AS "createdById",
            t.scope::text AS scope, COALESCE(t."fromFounder", false) AS "fromFounder",
            p."projectType" AS "projectType", p."managerId"::text AS "managerId",
            EXISTS (SELECT 1 FROM task_assignees ta
                    WHERE ta."taskId" = t.id AND ta."userId"::text = $2) AS co,
            EXISTS (SELECT 1 FROM project_members pm
                    WHERE pm."projectsId" = t."projectId" AND pm."usersId"::text = $2) AS member
     FROM tasks t
     LEFT JOIN projects p ON p.id = t."projectId"
     WHERE t.id = $1`,
    [taskId, String(viewerId || '')],
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    assigneeId: r.assigneeId ?? null,
    createdById: r.createdById ?? null,
    scope: r.scope ?? null,
    fromFounder: !!r.fromFounder,
    projectType: r.projectType ?? null,
    managerId: r.managerId ?? null,
    co: !!r.co,
    member: !!r.member,
  };
}

/** Работать с задачей (чек-лист, результат): PM в своей сфере, исполнитель,
 *  со-исполнитель или автор. */
export function canWorkOnTask(row: TaskAccessRow, viewer: TaskViewer): boolean {
  return isPmForTask(viewer, row.projectType)
    || row.assigneeId === viewer.id
    || row.createdById === viewer.id
    || row.co;
}

/** Читать задачу: всё, что выше, плюс менеджер и участники проекта и общая
 *  задача от основателя (её видит вся компания). */
export function canReadTask(row: TaskAccessRow, viewer: TaskViewer): boolean {
  return canWorkOnTask(row, viewer)
    || (!!row.managerId && row.managerId === viewer.id)
    || row.member
    || (row.scope === 'general' && row.fromFounder);
}

/** 404 / 403 для чтения вложений задачи. Возвращает строку доступа. */
export async function assertTaskReadable(
  manager: EntityManager,
  taskId: string,
  viewer: TaskViewer,
): Promise<TaskAccessRow> {
  const row = await loadTaskAccess(manager, taskId, viewer.id);
  if (!row) throw new NotFoundException('Task not found');
  if (!canReadTask(row, viewer)) throw new ForbiddenException('Нет доступа к этой задаче');
  return row;
}
