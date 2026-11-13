import { AsyncLocalStorage } from 'node:async_hooks';
import { SetMetadata } from '@nestjs/common';

/**
 * «Войти как» (13.11.2026) — основатель или администратор открывает кабинет
 * сотрудника и работает в нём так, как видит сам сотрудник.
 *
 * Решения владельца:
 *  - основатель входит к любому, администратор — к любому, кроме основателя,
 *    сооснователя и другого администратора (иначе админ получил бы права
 *    выше своих);
 *  - внутри работает всё, кроме начала/конца смены — табель должен отражать
 *    реальное время человека;
 *  - сотрудник ничего не узнаёт; «Войти как» не оставляет следов нигде
 *    (13.11.2026): ни входа/выхода, ни действий изнутри — ни в «Ленте
 *    событий», ни в журнале безопасности, ни в базе.
 *
 * Токен входа — обычный JWT сотрудника с полем `imp` (id того, кто вошёл).
 * Каждый запрос заново сверяет оба аккаунта с базой (jwt.strategy): если
 * входившего заблокировали или сняли с должности, вход обрывается сразу.
 */

/** Сколько живёт вход за сотрудника. Обычный токен бессрочный, а этот —
 *  нет: забытая вкладка не должна держать чужой кабинет открытым вечно. */
export const IMPERSONATION_TTL = '12h';

/** Кто может входить в чужие кабинеты (роль из базы, как в RolesGuard). */
const ACTOR_ROLES = ['founder', 'admin'];
/** К кому администратору нельзя: эти роли/должности сильнее или равны ему. */
const ADMIN_PROTECTED_ROLES = ['founder', 'admin'];
const ADMIN_PROTECTED_POSITIONS = ['основатель', 'сооснователь', 'администратор'];

type ActorLike = { id: string; role: string; secondaryRole?: string | null };
type TargetLike = {
  id: string; role: string; secondaryRole?: string | null;
  isActive?: boolean; isBlocked?: boolean;
};
type TargetEmployeeLike = { position?: string | null; isSubAdmin?: boolean | null } | null | undefined;

const hasRole = (u: { role: string; secondaryRole?: string | null }, roles: string[]) =>
  roles.includes(u.role) || (!!u.secondaryRole && roles.includes(u.secondaryRole));

/** Основатель ли входящий (по любой из двух ролей). */
export const isFounderActor = (actor: ActorLike) => hasRole(actor, ['founder']);

/** Почему входить нельзя — или null, если можно. Одно правило на всё:
 *  на выдачу входа, на каждый запрос внутри и на кнопку в интерфейсе. */
export function impersonationDenial(
  actor: ActorLike,
  target: TargetLike,
  targetEmployee?: TargetEmployeeLike,
): string | null {
  if (!hasRole(actor, ACTOR_ROLES)) {
    return 'Входить в кабинеты сотрудников могут только основатель и администратор';
  }
  if (actor.id === target.id) return 'Это ваш собственный аккаунт';
  if (target.isActive === false) return 'Аккаунт сотрудника отключён';
  if (target.isBlocked) return 'Сотрудник заблокирован — сначала разблокируйте его';
  if (isFounderActor(actor)) return null;
  const position = String(targetEmployee?.position || '').trim().toLowerCase();
  if (
    hasRole(target, ADMIN_PROTECTED_ROLES)
    || !!targetEmployee?.isSubAdmin
    || ADMIN_PROTECTED_POSITIONS.includes(position)
  ) {
    return 'Администратор не может входить в кабинет основателя, сооснователя или другого администратора';
  }
  return null;
}

/** Запрос сделан «от имени» сотрудника. Журналы проверяют этот контекст и
 *  ничего не пишут — «Войти как» не оставляет следов. Живёт один запрос. */
export interface ImpersonationContext {
  actorId: string;
  targetId: string;
}

export const impersonationStore = new AsyncLocalStorage<ImpersonationContext>();

/** Действие недоступно, пока вошли за сотрудника (смена, пароль, 2FA…). */
export const NO_IMPERSONATION = 'noImpersonation';
export const NoImpersonation = (message: string) => SetMetadata(NO_IMPERSONATION, message);
