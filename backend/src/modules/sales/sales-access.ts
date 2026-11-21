import { getSalesSegmentOfUser, salesRoleOf } from '../../common/sales-segment';
import { AccessUser, hasAnyRole, isTop, rolesOf } from '../projects/project-access';

/**
 * Кто что может в /api/sales (15.11.2026, SALES_SPEC §5). Чистые функции —
 * их проверяют спеки, сервис только вызывает.
 *
 * Роль в req.user уже «рабочая»: помощник администратора приходит как admin
 * (effectiveRoleOf в JwtStrategy). Сооснователя как роли больше нет — его
 * перевели в admin (25.09.2026), поэтому «руководство» = admin + founder.
 */

export type SalesUser = AccessUser & { id: string; name?: string | null };

/** Минимум полей лида для решения о доступе. */
export interface LeadAccessRow {
  ownerId?: string | null;
  direction?: string | null;
}

/** Руководство: основатель, админ (и помощник админа). Работа с лидами —
 *  звонки, встречи, лента, передача в работу из карточки клиента. */
export const isSalesTop = (u?: SalesUser | null): boolean => isTop(u);

/** Владелец раздела «Продажи» — только основатель (решение владельца,
 *  21.11.2026): аналитика, все заявки, привязка заявки к проекту, нормы и
 *  комиссия, уведомления о заявках. Админ работает с клиентами (isSalesTop),
 *  но раздела не видит. Роль — основная или вторая. */
export const isSalesOwner = (u?: SalesUser | null): boolean => rolesOf(u).includes('founder');

/** Нормы KPI меняет только основатель (21.11.2026; раньше и админ). */
export const canEditNorms = (u?: SalesUser | null): boolean => isSalesOwner(u);

/** Комиссию менеджеров — только основатель: это деньги. */
export const canEditCommission = (u?: SalesUser | null): boolean => isSalesOwner(u);

/** Направление МП (основная или вторая роль); null — не МП. */
export const salesDirectionOf = (u?: SalesUser | null): 'smm' | 'development' | null =>
  getSalesSegmentOfUser(u)?.leadDirection ?? null;

export const isSalesManagerUser = (u?: { role?: string | null; secondaryRole?: string | null } | null): boolean =>
  !!salesRoleOf(u);

/**
 * Действие над лидом (звонок, письмо, встреча, комментарий, передача):
 * владелец; лид без владельца своего направления — любой МП направления
 * (старые лиды без направления — тоже, как в списке /clients); руководство —
 * любой. Чужой лид коллеги — нет. МП и свой лид чужого направления не
 * трогает — ровно как ClientsService.updateWithAuth (иначе звонок записался
 * бы, а смена этапа через ClientsService молча не прошла).
 */
export function canActOnLead(u: SalesUser | null | undefined, lead: LeadAccessRow): boolean {
  if (!u?.id) return false;
  if (isSalesTop(u)) return true;
  const dir = salesDirectionOf(u);
  if (dir && lead.direction && lead.direction !== dir) return false;
  if (lead.ownerId) return lead.ownerId === u.id;
  if (!dir) return false;
  return !lead.direction || lead.direction === dir;
}

/**
 * Чтение ленты событий: шире, чем действие. Карточку лида коллеги своего
 * направления МП открыть может (ClientsService.findOne пускает по
 * направлению), значит и историю в ней должен видеть — иначе карточка
 * открывается, а лента отвечает 403.
 */
export function canViewLead(u: SalesUser | null | undefined, lead: LeadAccessRow): boolean {
  if (!u?.id) return false;
  if (isSalesTop(u)) return true;
  const dir = salesDirectionOf(u);
  // Как ClientsService.findOne: лид чужого направления МП не открывает.
  if (dir && lead.direction && lead.direction !== dir) return false;
  if (lead.ownerId && lead.ownerId === u.id) return true;
  if (!dir) return false;
  return !lead.direction || lead.direction === dir;
}

/**
 * Чьи передачи в работу видит пользователь: null — все (руководство);
 * список направлений — директор направления (основной или второй ролью);
 * пустой список — никаких (403).
 */
export function handoffDirectionsFor(u?: SalesUser | null): Array<'smm' | 'development'> | null {
  // Все заявки — основателю; админ — как все прочие (21.11.2026).
  if (isSalesOwner(u)) return null;
  const out: Array<'smm' | 'development'> = [];
  if (hasAnyRole(u, ['smm_director'])) out.push('smm');
  if (hasAnyRole(u, ['dev_director'])) out.push('development');
  return out;
}

/** Роль руководителя направления, которому уходит передача. */
export const directorRoleFor = (direction: string): 'smm_director' | 'dev_director' =>
  direction === 'development' ? 'dev_director' : 'smm_director';
