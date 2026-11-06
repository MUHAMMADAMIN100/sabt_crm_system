/**
 * Кто ведёт чат «Директа» (решение владельца 06.11.2026).
 *
 *  - Клиент закрепляется за МЕНЕДЖЕРОМ ПРОДАЖ, который первым ответил ему из
 *    CRM. Ответы админа и основателя (и ответы с телефона из приложения
 *    Instagram) не закрепляют.
 *  - Закреплённый чат пишет только его менеджер и руководство; остальные
 *    читают и оставляют заметки для команды.
 *  - Передать или освободить чат может руководство — любой, менеджер — свой.
 *  - Тот, кто ведёт, больше не может вести клиентов (уволен, заблокирован,
 *    ушёл из продаж), а клиент ждёт ответа — чат открывается для команды.
 *
 * Здесь — чистые правила без базы, чтобы их проверяли тесты.
 */
import { hasGrant } from '../auth/permissions';

export const SALES_ROLES = ['sales_manager_smm', 'sales_manager_dev'];
export const TOP_ROLES = ['admin', 'founder'];

export interface Who {
  id: string;
  role?: string | null;
  secondaryRole?: string | null;
}

/** Сотрудник целиком — для вопроса «может ли он вести клиентов». */
export interface Staff extends Who {
  isActive?: boolean | null;
  isBlocked?: boolean | null;
  extraPermissions?: string[] | null;
  deniedPermissions?: string[] | null;
}

export const isTop = (user: Who): boolean => TOP_ROLES.includes(user.role || '');

/** Менеджер продаж основной или второй ролью; руководство им не считается. */
export const isSalesManager = (user: Who): boolean =>
  !isTop(user) && (SALES_ROLES.includes(user.role || '') || SALES_ROLES.includes(user.secondaryRole || ''));

/** Может ли вести клиентов: работает (не уволен и не заблокирован), менеджер
 *  продаж и видит «Директ» (доступ к Базе клиентов не отняли). */
export function canLead(user: Staff): boolean {
  return user.isActive !== false && !user.isBlocked && isSalesManager(user) && hasGrant(user as any, 'clients.view');
}

/** Может ли сотрудник писать клиенту в этом чате. */
export function canReply(user: Who, assigneeId: string | null | undefined): boolean {
  return isTop(user) || !assigneeId || assigneeId === user.id;
}

/** Закрепит ли этот ответ клиента за сотрудником: свободный чат и менеджер продаж. */
export function bindsOnReply(user: Who, assigneeId: string | null | undefined): boolean {
  return !assigneeId && isSalesManager(user);
}

/** Может ли сотрудник передать чат коллеге или освободить его. */
export function canTransfer(user: Who, assigneeId: string | null | undefined): boolean {
  return isTop(user) || (!!assigneeId && assigneeId === user.id);
}
