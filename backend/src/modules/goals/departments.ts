/**
 * Отделы «Компаса компании» (16.11.2026, docs/GOALS_SPEC.md §2).
 *
 * Отдельной таблицы нет — отделы собираются из ролей. Член отдела — по
 * ОСНОВНОЙ роли и только действующий. Руководитель: назначенный вручную в
 * goal_settings.leaders, иначе по умолчанию (роль руководителя основной или
 * второй ролью; несколько — первый по имени), никого — основатель.
 *
 * Файл без DI Nest: им пользуются и «Компас», и цели месяца в профиле.
 */
import type { DeptKey, PersonRef } from './goals.types';

/** Что-то, у чего есть query: DataSource, EntityManager, QueryRunner. */
export interface Queryable {
  query(sql: string, params?: any[]): Promise<any>;
}

export interface DepartmentDef {
  key: DeptKey;
  name: string;
  /** Основные роли членов отдела. */
  roles: string[];
}

export const DEPARTMENTS: DepartmentDef[] = [
  { key: 'sales', name: 'Продажи', roles: ['sales_manager_smm', 'sales_manager_dev'] },
  {
    key: 'smm',
    name: 'SMM-производство',
    roles: ['smm_director', 'smm_specialist', 'designer', 'videographer', 'video_editor', 'producer', 'targetologist', 'stories_checker'],
  },
  { key: 'dev', name: 'Разработка', roles: ['dev_director', 'pm_dev', 'developer'] },
  { key: 'management', name: 'Управление и финансы', roles: ['admin', 'founder', 'employee'] },
];

export const DEPT_KEYS: DeptKey[] = DEPARTMENTS.map(d => d.key);

export const DEPT_NAME: Record<DeptKey, string> = {
  sales: 'Продажи',
  smm: 'SMM-производство',
  dev: 'Разработка',
  management: 'Управление и финансы',
};

/** Руководство: целей месяца у них нет, отделом «Управление» руководит основатель. */
export const TOP_ROLES = ['admin', 'founder'];

/** Роль руководителя отдела по умолчанию; null — основатель. */
const DEFAULT_LEAD_ROLE: Record<DeptKey, string | null> = {
  sales: null,
  smm: 'smm_director',
  dev: 'dev_director',
  management: null,
};

export function isDeptKey(v: unknown): v is DeptKey {
  return typeof v === 'string' && (DEPT_KEYS as string[]).includes(v);
}

/** Отдел по основной роли; роль вне отделов — null. */
export function departmentOfRole(role?: string | null): DeptKey | null {
  if (!role) return null;
  const d = DEPARTMENTS.find(x => x.roles.includes(role));
  return d ? d.key : null;
}

/** Сотрудник — то, что нужно отделам. */
export interface DeptUser {
  id: string;
  name: string;
  avatar?: string | null;
  role: string;
  secondaryRole?: string | null;
  isActive?: boolean;
  isBlocked?: boolean;
}

export type Leaders = Record<DeptKey, PersonRef | null>;
export type LeaderOverrides = Partial<Record<DeptKey, string | null>>;

const isLive = (u: DeptUser) => u.isActive !== false && !u.isBlocked;
const byName = (a: DeptUser, b: DeptUser) => String(a.name || '').localeCompare(String(b.name || ''), 'ru');

export function personRef(u: { id: string; name: string; avatar?: string | null } | null | undefined): PersonRef | null {
  return u ? { id: u.id, name: u.name, avatar: u.avatar ?? null } : null;
}

/** Руководители отделов по правилу §2 — чистая функция (для тестов). */
export function pickLeaders(users: DeptUser[], overrides: LeaderOverrides): Leaders {
  const live = users.filter(isLive).sort(byName);
  const founder = live.find(u => u.role === 'founder') || null;
  const out = {} as Leaders;
  for (const d of DEPARTMENTS) {
    const overId = overrides?.[d.key];
    const over = overId ? live.find(u => u.id === overId) : undefined;
    if (over) { out[d.key] = personRef(over); continue; }
    const role = DEFAULT_LEAD_ROLE[d.key];
    const def = role ? live.find(u => u.role === role || u.secondaryRole === role) : undefined;
    out[d.key] = personRef(def || founder);
  }
  return out;
}

/** Отделы, которыми руководит пользователь. */
export function leadsOf(user: { id: string } | null | undefined, leaders: Leaders): DeptKey[] {
  if (!user) return [];
  return DEPT_KEYS.filter(k => leaders[k]?.id === user.id);
}

/** Действующие члены отдела — по основной роли. */
export function membersOf(users: DeptUser[], key: DeptKey): DeptUser[] {
  const def = DEPARTMENTS.find(d => d.key === key);
  if (!def) return [];
  return users.filter(u => isLive(u) && def.roles.includes(u.role)).sort(byName);
}

/** Все пользователи (и уволенные — у них могут быть старые КР). */
export async function loadDeptUsers(db: Queryable): Promise<DeptUser[]> {
  const rows: any[] = await db.query(
    `SELECT id, name, avatar, role, "secondaryRole",
            COALESCE("isActive", true) AS "isActive", COALESCE("isBlocked", false) AS "isBlocked"
       FROM users ORDER BY name`,
  ).catch(() => []);
  return (rows || []).map(r => ({
    id: String(r.id),
    name: String(r.name || ''),
    avatar: r.avatar ?? null,
    role: String(r.role || ''),
    secondaryRole: r.secondaryRole ?? null,
    isActive: r.isActive !== false,
    isBlocked: !!r.isBlocked,
  }));
}

/** Ручные назначения руководителей (goal_settings.leaders). Таблицы ещё нет — пусто. */
export async function loadLeaderOverrides(db: Queryable): Promise<LeaderOverrides> {
  const rows: any[] = await db.query(`SELECT value FROM goal_settings WHERE key = 'leaders' LIMIT 1`).catch(() => []);
  const v = rows?.[0]?.value;
  const out: LeaderOverrides = {};
  if (v && typeof v === 'object') {
    for (const k of DEPT_KEYS) {
      if (typeof v[k] === 'string' && v[k]) out[k] = v[k];
    }
  }
  return out;
}

/** Действующие руководители отделов. users — если уже загружены. */
export async function resolveLeaders(db: Queryable, users?: DeptUser[]): Promise<Leaders> {
  const [list, overrides] = await Promise.all([
    users ? Promise.resolve(users) : loadDeptUsers(db),
    loadLeaderOverrides(db),
  ]);
  return pickLeaders(list, overrides);
}
