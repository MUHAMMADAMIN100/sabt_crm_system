// Состав dev-проекта: общие типы и подписи (раздел «Разработка»).
// Источник данных — GET /projects/:id (manager/members) и GET /projects
// (manager + membersCount + до 5 members). SMM-ветку не затрагивает.

import { getRoleLabel } from '@/lib/permissions'

/** Человек в команде dev-проекта. Набор полей — по контракту бэка:
 *  {id, name, role, avatar}; дата «в команде с» — только если бэк/юзер её
 *  даёт (joinedAt/memberSince/…), иначе поле отсутствует и дата не рисуется. */
export type DevTeamPerson = {
  id: string
  name: string
  role?: string | null
  avatar?: string | null
  joinedAt?: string | null
  memberSince?: string | null
  addedAt?: string | null
  since?: string | null
}

/** Русские подписи ролей команды. Неизвестные — через общий справочник
 *  (там fallback «как есть»), чтобы PM-админ не светился сырым ключом. */
const DEV_ROLE_LABELS: Record<string, string> = {
  developer: 'Разработчик',
  pm_dev: 'PM',
  dev_director: 'Руководитель',
}

export function devRoleLabel(role?: string | null): string {
  if (!role) return ''
  return DEV_ROLE_LABELS[role] ?? getRoleLabel(role)
}

/** Дата «в команде с …» — только если бэк/юзер даёт дату, иначе null
 *  (вызывающий код дату просто не рисует). */
export function teamSinceOf(m: DevTeamPerson): string | null {
  const raw = m.joinedAt ?? m.memberSince ?? m.addedAt ?? m.since ?? null
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
