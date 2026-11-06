/**
 * Кто ведёт чат «Директа» — те же правила, что на сервере
 * (backend/src/modules/direct/direct-access.ts). Здесь они только решают,
 * что показать; запрещает сервер.
 */

const SALES = ['sales_manager_smm', 'sales_manager_dev']
const TOP = ['admin', 'founder']

type Who = { id: string; role?: string | null; secondaryRole?: string | null } | null | undefined

export const isTopUser = (u: Who): boolean => !!u && TOP.includes(u.role || '')

/** Менеджер продаж основной или второй ролью; руководство им не считается. */
export const isSalesUser = (u: Who): boolean =>
  !!u && !isTopUser(u) && (SALES.includes(u.role || '') || SALES.includes(u.secondaryRole || ''))

/** Может ли писать клиенту: свой или свободный чат, руководство — любой. */
export const canReplyIn = (u: Who, assigneeId: string | null | undefined): boolean =>
  !!u && (isTopUser(u) || !assigneeId || assigneeId === u.id)

/** Может ли передать чат или освободить: руководство — любой, менеджер — свой. */
export const canTransferIn = (u: Who, assigneeId: string | null | undefined): boolean =>
  !!u && (isTopUser(u) || (!!assigneeId && assigneeId === u.id))

/** «Мадина Сафарова» → «Мадина С.» — коротко для строки списка. */
export const shortName = (name: string): string => {
  const [first, last] = name.trim().split(/\s+/)
  return last ? `${first} ${last[0]}.` : first || name
}

export const MANAGER_ROLE: Record<string, string> = {
  sales_manager_smm: 'продажи СММ',
  sales_manager_dev: 'продажи разработки',
}
