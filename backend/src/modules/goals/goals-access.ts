/**
 * Доступ к «Компасу компании» (16.11.2026, docs/GOALS_SPEC.md §6).
 * Чистые правила без базы — руководителей отделов передаёт сервис.
 *
 *  - isTop — основатель или админ (основной или второй ролью);
 *  - details — isTop или руководитель хотя бы одного отдела: экраны отделов,
 *    «Требует внимания», цели людей, перенос месяца;
 *  - цели и КР компании читают все, правит — isTop;
 *  - КР отдела читают details и члены отдела, правят isTop и руководитель;
 *  - отметку недели и ручную цифру ставят: у КР отдела — isTop и руководитель,
 *    у КР компании — isTop и ответственный.
 */
import { DEPT_KEYS, TOP_ROLES, departmentOfRole } from './departments';
import type { DeptKey } from './goals.types';

export interface GoalActor {
  id: string;
  role?: string | null;
  secondaryRole?: string | null;
}

export interface GoalAccess {
  actorId: string;
  isTop: boolean;
  /** Отделы, которыми руководит. */
  leads: DeptKey[];
  /** Отдел по основной роли. */
  department: DeptKey | null;
  details: boolean;
}

/** То, что нужно от КР для проверки прав. */
export interface KrRef {
  level: string;
  department?: string | null;
  ownerId?: string | null;
}

export function isTopActor(a: GoalActor | null | undefined): boolean {
  if (!a) return false;
  return TOP_ROLES.includes(a.role || '') || TOP_ROLES.includes(a.secondaryRole || '');
}

export function accessOf(actor: GoalActor, leads: DeptKey[]): GoalAccess {
  const isTop = isTopActor(actor);
  const own = Array.from(new Set(leads || []));
  return {
    actorId: actor.id,
    isTop,
    leads: own,
    department: departmentOfRole(actor.role),
    details: isTop || own.length > 0,
  };
}

/** Цели и КР компании: создавать, править, удалять. */
export function canManageCompany(acc: GoalAccess): boolean {
  return acc.isTop;
}

/** КР отдела и экран отдела: details — все отделы, член — свой. */
export function canReadDepartment(acc: GoalAccess, key: string): boolean {
  return acc.details || acc.department === key;
}

export function canEditDepartment(acc: GoalAccess, key: string | null | undefined): boolean {
  if (acc.isTop) return true;
  return !!key && (acc.leads as string[]).includes(key);
}

export function canEditKr(acc: GoalAccess, kr: KrRef): boolean {
  if (kr.level === 'company') return acc.isTop;
  return canEditDepartment(acc, kr.department);
}

/** Отметка недели и ручная цифра. */
export function canCheckinKr(acc: GoalAccess, kr: KrRef): boolean {
  if (kr.level === 'company') return acc.isTop || (!!kr.ownerId && kr.ownerId === acc.actorId);
  return canEditDepartment(acc, kr.department);
}

/** Инициативы — те же, кто правит КР. */
export function canEditInitiatives(acc: GoalAccess, kr: KrRef): boolean {
  return canEditKr(acc, kr);
}

/** «Требует внимания», экраны отделов, цели людей, «Перенести месяц». */
export function canSeeDetails(acc: GoalAccess): boolean {
  return acc.details;
}

/** Настройки руководителей — только isTop. */
export function canManageSettings(acc: GoalAccess): boolean {
  return acc.isTop;
}

/** Что можно перенести из прошлого месяца: isTop — всё, руководитель — свои отделы. */
export function copyScope(acc: GoalAccess): { company: boolean; departments: DeptKey[] } {
  if (acc.isTop) return { company: true, departments: [...DEPT_KEYS] };
  return { company: false, departments: [...acc.leads] };
}

/** Руководитель отдела ставит цели месяца членам своего отдела (не себе и
 *  не руководству). */
export function leadsMember(
  actor: { id: string },
  leads: DeptKey[],
  target: { id: string; role?: string | null },
): boolean {
  if (!target || actor.id === target.id) return false;
  if (TOP_ROLES.includes(target.role || '')) return false;
  const dept = departmentOfRole(target.role);
  return !!dept && leads.includes(dept);
}
