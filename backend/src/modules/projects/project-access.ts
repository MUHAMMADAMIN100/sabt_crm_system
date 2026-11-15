import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { hasGrant } from '../auth/permissions';
import { DEV_PROJECT_TYPES, getSalesSegmentOfUser, salesRoleOf } from '../../common/sales-segment';

/**
 * Доступ к проекту — одно правило для проектов, умного календаря, профиля,
 * объявлений и плана-факта (15.11.2026). Раньше каждая ручка решала сама:
 * чтение было открыто всем, а SMM-специалист правил любой SMM-проект.
 *
 *  • «Свой проект» = менеджер проекта ∨ участник ∨ назначен SMM-специалистом
 *    (smmData.smmSpecialistIds) — как у отметки сторис (SYSTEM_PROMPT §5 п.7).
 *  • Руководство SMM (admin, founder, smm_director — основной или второй
 *    ролью) правит любой SMM-проект; остальные SMM-роли — только свои.
 *  • Видеть проект может: руководство; грант projects.view (у ролей без
 *    своего направления); своё направление (как в списке /projects); свой
 *    проект; производственная команда проекта и все, у кого в нём есть
 *    работа (карточка подготовки, задача); сторисмейкер — SMM-проекты.
 */

export interface AccessUser {
  id?: string | null;
  role?: string | null;
  secondaryRole?: string | null;
  extraPermissions?: string[] | null;
  deniedPermissions?: string[] | null;
}

export interface AccessProject {
  id: string;
  projectType?: string | null;
  managerId?: string | null;
  salesManagerId?: string | null;
  smmData?: Record<string, any> | null;
  isOneOffSystem?: boolean | null;
}

export interface ProjectAccessRow extends AccessProject {
  memberIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TOP_ROLES = ['admin', 'founder'];
/** Руководство SMM: правит любой SMM-проект. */
export const SMM_MANAGEMENT_ROLES = ['admin', 'founder', 'smm_director'];
/** Направление SMM — как в findAll списка проектов. */
const SMM_SCOPE_ROLES = ['smm_director', 'smm_specialist', 'producer'];
/** Направление разработки — как в findAll списка проектов. */
const DEV_SCOPE_ROLES = ['dev_director', 'pm_dev', 'developer'];
/** Производственная команда проекта (smmData). */
export const CREW_KEYS = ['videographerIds', 'videoEditorIds', 'designerIds'] as const;

/** Обе роли пользователя (основная и вторая). */
export function rolesOf(u?: AccessUser | null): string[] {
  return [u?.role, u?.secondaryRole].filter((r): r is string => typeof r === 'string' && !!r);
}

export function hasAnyRole(u: AccessUser | null | undefined, roles: readonly string[]): boolean {
  return rolesOf(u).some(r => roles.includes(r));
}

export function isTop(u?: AccessUser | null): boolean {
  return hasAnyRole(u, TOP_ROLES);
}

export function isSmmManagement(u?: AccessUser | null): boolean {
  return hasAnyRole(u, SMM_MANAGEMENT_ROLES);
}

export function idsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];
}

export function smmSpecialistIdsOf(smmData: unknown): string[] {
  return idsOf((smmData as any)?.smmSpecialistIds);
}

export function crewIdsOf(smmData: unknown): string[] {
  return CREW_KEYS.flatMap(k => idsOf((smmData as any)?.[k]));
}

/** Свой проект: менеджер ∨ участник ∨ назначенный SMM-специалист. */
export function isOwnProject(
  u: AccessUser | null | undefined,
  p: Pick<AccessProject, 'managerId' | 'smmData'> | null | undefined,
  memberIds: readonly string[] = [],
): boolean {
  const uid = u?.id;
  if (!uid || !p) return false;
  return p.managerId === uid || memberIds.includes(uid) || smmSpecialistIdsOf(p.smmData).includes(uid);
}

/** Правка SMM-контента проекта: руководство — любой проект, остальные — свой. */
export function canEditSmmProject(
  u: AccessUser | null | undefined,
  p: Pick<AccessProject, 'managerId' | 'smmData'> | null | undefined,
  memberIds: readonly string[] = [],
): boolean {
  return isSmmManagement(u) || isOwnProject(u, p, memberIds);
}

/** Менеджер по продажам, назначенный на проект (колонка или smmData). */
export function isAssignedSalesManager(
  u: AccessUser | null | undefined,
  p: Pick<AccessProject, 'salesManagerId' | 'smmData'> | null | undefined,
): boolean {
  const uid = u?.id;
  if (!uid || !p) return false;
  return p.salesManagerId === uid || (p.smmData as any)?.salesManagerId === uid;
}

/**
 * Типы проектов направления пользователя (по обеим ролям, объединением);
 * null — направления нет или это руководство компании: ограничений нет.
 * Тот же круг, что фильтр списка /projects.
 */
export function directionTypesOf(u?: AccessUser | null): string[] | null {
  if (!u || isTop(u)) return null;
  const types = new Set<string>();
  const seg = getSalesSegmentOfUser(u);
  if (seg) seg.projectTypes.forEach(t => types.add(t));
  if (hasAnyRole(u, SMM_SCOPE_ROLES)) types.add('SMM');
  if (hasAnyRole(u, DEV_SCOPE_ROLES)) DEV_PROJECT_TYPES.forEach(t => types.add(t));
  return types.size ? [...types] : null;
}

/** Проект в направлении пользователя (или ограничений нет). */
export function inDirection(u: AccessUser | null | undefined, projectType?: string | null): boolean {
  const types = directionTypesOf(u);
  return !types || types.includes(projectType || '');
}

/** Чистое правило «видит ли проект». ctx — то, что требует запросов. */
export function canViewProject(
  u: AccessUser | null | undefined,
  p: AccessProject,
  ctx: { memberIds?: readonly string[]; isStoryMaker?: boolean; hasWork?: boolean } = {},
): boolean {
  if (!u?.id) return false;
  if (isTop(u)) return true;
  const type = p.projectType || '';
  if (isOwnProject(u, p, ctx.memberIds || [])) return true;
  // Производственная команда и все, у кого в проекте есть работа: видеограф
  // должен открыть проект своей съёмки, даже не будучи участником.
  if (crewIdsOf(p.smmData).includes(u.id)) return true;
  if (ctx.hasWork) return true;
  if (type === 'SMM' && ctx.isStoryMaker) return true;
  const dir = directionTypesOf(u);
  if (dir) {
    if (dir.includes(type)) return true;
    // Раздел «СММ» открыт обоим менеджерам по продажам на просмотр
    // (решение 11.10.2026, подтверждено 15.10.2026).
    if (type === 'SMM' && !!salesRoleOf(u)) return true;
    // Направление грантом не расширяется — как в списке /projects.
    return false;
  }
  return hasGrant(u as any, 'projects.view');
}

/** Строка проекта для проверок доступа: без связей, один запрос. */
export async function loadAccessRow(m: EntityManager, projectId: string): Promise<ProjectAccessRow | null> {
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) return null;
  const rows: any[] = await m.query(
    `SELECT p.id, p."projectType", p."managerId", p."salesManagerId", p."smmData", p."isOneOffSystem",
            COALESCE((SELECT array_agg(pm."usersId"::text) FROM project_members pm
                       WHERE pm."projectsId" = p.id), '{}'::text[]) AS "memberIds"
       FROM projects p WHERE p.id = $1`,
    [projectId],
  );
  const r = rows?.[0];
  if (!r) return null;
  return {
    id: r.id,
    projectType: r.projectType ?? null,
    managerId: r.managerId ?? null,
    salesManagerId: r.salesManagerId ?? null,
    smmData: r.smmData && typeof r.smmData === 'object' ? r.smmData : null,
    isOneOffSystem: !!r.isOneOffSystem,
    memberIds: Array.isArray(r.memberIds) ? r.memberIds.map(String) : [],
  };
}

/** Есть ли у человека работа в проекте: карточка контент-плана или задача. */
async function hasWorkIn(m: EntityManager, projectId: string, userId: string): Promise<boolean> {
  const rows: any[] = await m.query(
    `SELECT 1 AS ok
      WHERE EXISTS (SELECT 1 FROM content_plan_items WHERE "projectId" = $1 AND "assigneeId" = $2)
         OR EXISTS (SELECT 1 FROM tasks WHERE "projectId" = $1 AND "assigneeId" = $2)`,
    [projectId, userId],
  ).catch(() => []);
  return rows.length > 0;
}

async function isStoryMakerUser(m: EntityManager, userId: string): Promise<boolean> {
  const rows: any[] = await m.query(
    `SELECT 1 AS ok FROM employees WHERE "userId" = $1 AND "isStoryMaker" = true LIMIT 1`, [userId],
  ).catch(() => []);
  return rows.length > 0;
}

/** Видит ли пользователь проект (запросы — только когда дешёвые правила не решили). */
export async function canViewProjectRow(m: EntityManager, u: AccessUser | null | undefined, row: ProjectAccessRow): Promise<boolean> {
  if (!u?.id) return false;
  if (canViewProject(u, row, { memberIds: row.memberIds })) return true;
  if (row.projectType === 'SMM' && await isStoryMakerUser(m, u.id)) return true;
  return hasWorkIn(m, row.id, u.id);
}

/** 404, если проекта нет; 403, если его не видно. Возвращает строку доступа. */
export async function assertCanViewProject(
  m: EntityManager, u: AccessUser | null | undefined, projectId: string,
): Promise<ProjectAccessRow> {
  const row = await loadAccessRow(m, projectId);
  if (!row) throw new NotFoundException('Проект не найден');
  if (!(await canViewProjectRow(m, u, row))) throw new ForbiddenException('Нет доступа к этому проекту');
  return row;
}

/** 403, если SMM-контент проекта править нельзя (не руководство и не свой). */
export async function assertCanEditSmmProject(
  m: EntityManager, u: AccessUser | null | undefined, projectId: string,
): Promise<ProjectAccessRow> {
  const row = await loadAccessRow(m, projectId);
  if (!row) throw new NotFoundException('Проект не найден');
  if (!canEditSmmProject(u, row, row.memberIds)) {
    throw new ForbiddenException('Это не ваш проект: править его может менеджер, участник или назначенный SMM-специалист');
  }
  return row;
}

/** SQL «свой проект» для фильтров списков: alias — алиас таблицы projects,
 *  param — имя параметра с id пользователя (без двоеточия). */
export function ownProjectSql(alias: string, param: string): string {
  return `(${alias}."managerId" = :${param}
    OR ${alias}.id IN (SELECT pm."projectsId" FROM project_members pm WHERE pm."usersId" = :${param})
    OR jsonb_exists(COALESCE(${alias}."smmData"->'smmSpecialistIds', '[]'::jsonb), :${param}))`;
}

/** SQL-условие «в производственной команде проекта» (smmData:
 *  videographerIds / videoEditorIds / designerIds) — та же группа, которой
 *  canViewProject открывает проект. Для списков, где «свой» проект узок:
 *  видеограф видит план съёмки, даже не будучи участником. */
export function crewProjectSql(alias: string, param: string): string {
  return '(' + CREW_KEYS
    .map(k => `jsonb_exists(COALESCE(${alias}."smmData"->'${k}', '[]'::jsonb), :${param})`)
    .join(' OR ') + ')';
}

/**
 * Атомарная правка верхних ключей smmData (15.11.2026). Писатели раньше
 * читали smmData целиком, меняли ключ и писали весь объект обратно — две
 * правки одновременно (цикл и профиль, реклама и менеджер) затирали друг
 * друга. Здесь база сама сливает объект: set — заменить/добавить ключи,
 * unset — удалить ключи. Вложенные объекты заменяются целиком.
 */
export async function patchSmmData(
  m: EntityManager, projectId: string, set: Record<string, any>, unset: string[] = [],
): Promise<void> {
  const cleanUnset = unset.filter(k => !(k in set));
  if (!Object.keys(set).length && !cleanUnset.length) return;
  await m.query(
    `UPDATE projects
        SET "smmData" = (CASE WHEN jsonb_typeof("smmData") = 'object' THEN "smmData" ELSE '{}'::jsonb END
                         || $1::jsonb) - $3::text[],
            "updatedAt" = now()
      WHERE id = $2`,
    [JSON.stringify(set), projectId, cleanUnset],
  );
}
