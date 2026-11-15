/**
 * Кто ведёт лид (15.11.2026, SALES_SPEC §4): правила владельца.
 *
 *  · Руководство — admin, founder (основной или второй ролью; помощник
 *    администратора приходит с ролью admin — см. effectiveRoleOf; роль
 *    co_founder с 25.09.2026 перенесена в admin). Ставит владельцем любого
 *    менеджера продаж направления лида или себя/другого руководителя.
 *  · Менеджер продаж передаёт только СВОЙ лид и только другому менеджеру
 *    продаж того же направления (основная или вторая роль).
 *  · Лид без владельца менеджер берёт себе («Взять себе», /claim), если
 *    он его направления.
 * Раньше ownerId принимался любой строкой — лид можно было «подарить»
 * дизайнеру, и он пропадал из всех списков продаж.
 */
import { getSalesSegment, getSalesSegmentOfUser, LeadDirection } from '../../common/sales-segment';

export const LEAD_TOP_ROLES = ['admin', 'founder'];

export interface LeadActor {
  id: string;
  role?: string | null;
  secondaryRole?: string | null;
  name?: string | null;
}

export interface OwnerCandidate {
  id: string;
  name?: string | null;
  role?: string | null;
  secondaryRole?: string | null;
  isActive?: boolean | null;
  isBlocked?: boolean | null;
}

const DIRECTION_RU: Record<LeadDirection, string> = { smm: 'СММ', development: 'Разработка' };

const rolesOf = (u?: { role?: string | null; secondaryRole?: string | null } | null) =>
  [u?.role, u?.secondaryRole].filter((r): r is string => !!r);

/** Руководство — основной или второй ролью. */
export function isLeadTop(u?: { role?: string | null; secondaryRole?: string | null } | null): boolean {
  return rolesOf(u).some(r => LEAD_TOP_ROLES.includes(r));
}

/** Направление лидов менеджера продаж (основная роль важнее второй). */
export function leadDirectionOf(u?: { role?: string | null; secondaryRole?: string | null } | null): LeadDirection | null {
  return getSalesSegmentOfUser(u)?.leadDirection ?? null;
}

/** Все направления продаж человека — по обеим ролям. */
export function salesDirectionsOf(u?: { role?: string | null; secondaryRole?: string | null } | null): LeadDirection[] {
  const out: LeadDirection[] = [];
  for (const r of rolesOf(u)) {
    const d = getSalesSegment(r)?.leadDirection;
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** Можно ли сделать candidate владельцем лида направления leadDirection.
 *  null — можно; строка — почему нельзя (это 400, а не 403: запрос
 *  понятен, неверен выбранный человек). Право МП передавать именно ЭТОТ
 *  лид (свой ли он) проверяет сервис. */
export function ownerCandidateError(
  actor: LeadActor,
  candidate: OwnerCandidate | null | undefined,
  leadDirection: string | null | undefined,
): string | null {
  if (!candidate) return 'Сотрудник не найден';
  if (candidate.isActive === false || candidate.isBlocked) return 'Сотрудник неактивен или заблокирован';
  const dirs = salesDirectionsOf(candidate);
  const leadDir = (leadDirection === 'smm' || leadDirection === 'development') ? leadDirection : null;
  if (!isLeadTop(actor)) {
    // Менеджер — только менеджеру продаж своего направления.
    const dir = leadDir ?? leadDirectionOf(actor);
    if (!dirs.length) return 'Передать лид можно только менеджеру продаж';
    if (dir && !dirs.includes(dir)) return `Передать лид можно только менеджеру продаж направления «${DIRECTION_RU[dir]}»`;
    return null;
  }
  if (isLeadTop(candidate)) return null;
  if (!dirs.length) return 'Вести лид может менеджер продаж или руководство';
  if (leadDir && !dirs.includes(leadDir)) {
    return `Лид направления «${DIRECTION_RU[leadDir]}» ведёт менеджер продаж этого направления`;
  }
  return null;
}
