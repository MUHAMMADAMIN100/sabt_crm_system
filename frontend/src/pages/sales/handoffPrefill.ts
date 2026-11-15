/**
 * Проект по заявке от продаж (15.11.2026): что из передачи в работу
 * (Handoff, docs/SALES_SPEC.md §5) подставляется в окна создания проекта
 * SMM и разработки и что уходит в POST /projects.
 *
 *   имя проекта           ← название лида
 *   клиент (clientInfo)   ← название лида, контактное лицо, телефон, Instagram
 *   тип проекта (dev)     ← продукт заявки, если это тип разработки
 *   leadId                ← лид — сервер свяжет проект и лид (§6)
 *   salesManagerId        ← менеджер, который передал сделку
 *   сумма                 ← абонплата (SMM) / сумма договора (разработка) —
 *                           поле видит только основатель: остальным сервер
 *                           финансовые поля всё равно не даёт записать.
 */
import type { Handoff } from '@/types/sales'
import { DEV_PROJECT_TYPES, projectTypeLabel } from '@/lib/projectType'

/** Контакты клиента из заявки — в формате projects.clientInfo. */
export function handoffClientInfo(h: Handoff): Record<string, string> {
  const out: Record<string, string> = {}
  const put = (key: string, v: string | null | undefined) => { const t = (v || '').trim(); if (t) out[key] = t }
  put('companyName', h.leadName)
  put('contactPerson', h.contactPerson)
  put('phone', h.contactPhone)
  put('instagram', h.contactInstagram)
  return out
}

/** Тип проекта разработки из продукта заявки: точное значение или подпись
 *  («Разработка» → 'Web сайт'); не распознали — null. */
export function devTypeFromProduct(product: string | null | undefined): string | null {
  const p = (product || '').trim().toLowerCase()
  if (!p) return null
  return DEV_PROJECT_TYPES.find(t => t.toLowerCase() === p || projectTypeLabel(t).toLowerCase() === p) ?? null
}

/** Поля связи с лидом для POST /projects. */
export function handoffLinkFields(h: Handoff): { leadId: string; salesManagerId?: string } {
  return { leadId: h.leadId, ...(h.manager?.id ? { salesManagerId: h.manager.id } : {}) }
}

/** Сумма заявки как строка для поля ввода («12000»); пусто — если суммы нет. */
export function amountDraft(amount: number | string | null | undefined): string {
  const v = Number(amount)
  return amount != null && Number.isFinite(v) && v > 0 ? String(Math.round(v)) : ''
}

/** Разобрать сумму из поля ввода («12 000» → 12000); пусто/мусор — null. */
export function parseAmount(draft: string): number | null {
  const digits = draft.replace(/[^\d]/g, '')
  if (!digits) return null
  const v = Number(digits)
  return Number.isFinite(v) && v > 0 ? v : null
}
