import clsx from 'clsx'
import { Check, Phone, PhoneCall } from 'lucide-react'
import { Pagination } from '@/components/ui'
import { isActive } from '@/lib/salesStages'
import type { SalesLead } from '@/types/sales'
import StageBadge from '@/components/sales/StageBadge'
import { ACTION_TEXT_CLASS, formatMoney, moneyValue, nextActionOf, phoneHref, relTime } from '@/components/sales/leadUtils'
import RowMenu, { type RowMenuItem } from './RowMenu'

export interface ListHandlers {
  onOpen: (lead: SalesLead) => void
  onCall: (lead: SalesLead) => void
  onToggleHold: (lead: SalesLead) => void
  onDelete: (lead: SalesLead) => void
  onCallRequest: (ids: string[], flag: boolean) => void
}

/** Отметка «Позвонить» (руководитель): квадрат 18 px, область нажатия 44 px. */
function CallMark({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      aria-label={label}
      title={on ? 'Снять отметку «Позвонить»' : 'Назначить звонок менеджеру'}
      className={clsx(
        "relative inline-flex h-[18px] w-[18px] items-center justify-center rounded-md border-2 transition-colors after:absolute after:-inset-3 after:content-[''] disabled:opacity-50",
        on ? 'border-amber-500 bg-amber-500 text-white' : 'border-surface-300 text-transparent hover:border-amber-400 dark:border-surface-600',
      )}
    >
      <Check size={12} strokeWidth={3.5} aria-hidden="true" />
    </button>
  )
}

/**
 * Список «Клиенты» (15.11.2026): на компьютере — таблица, на телефоне —
 * карточки (название, этап, сумма, ближайшее действие цветом, звонок 44 px,
 * меню «⋯»). Строка открывается кнопкой с названием — с клавиатуры тоже.
 */
export default function ClientsList({ items, total, page, pageSize, onPage, fetching, showOwner, isBoss, callPending, h }: {
  items: SalesLead[]
  total: number
  page: number
  pageSize: number
  onPage: (p: number) => void
  fetching: boolean
  showOwner: boolean
  isBoss: boolean
  callPending: boolean
  h: ListHandlers
}) {
  const allMarked = items.length > 0 && items.every(l => l.callRequested)
  const menuOf = (l: SalesLead): RowMenuItem[] => {
    const out: RowMenuItem[] = []
    if (isActive(l.status)) out.push({ label: l.onHold ? 'Снять с паузы' : 'На паузу', onSelect: () => h.onToggleHold(l) })
    if (l.callRequested) out.push({ label: 'Позвонил — снять отметку', onSelect: () => h.onCallRequest([l.id], false) })
    out.push({ label: 'Удалить', danger: true, onSelect: () => h.onDelete(l) })
    return out
  }

  return (
    <div className={clsx('transition-opacity', fetching && 'opacity-70')}>
      {/* Компьютер — таблица */}
      <div className="card hidden overflow-x-auto p-0 lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200 text-left dark:border-surface-700">
              {isBoss && (
                <th scope="col" className="w-10 px-3 py-3 text-center">
                  <CallMark on={allMarked} disabled={callPending} label="Назначить звонок всем на странице"
                    onToggle={() => items.length && h.onCallRequest(items.map(l => l.id), !allMarked)} />
                </th>
              )}
              <th scope="col" className="px-4 py-3">Клиент</th>
              <th scope="col" className="px-4 py-3">Этап</th>
              {showOwner && <th scope="col" className="px-4 py-3">Ведёт</th>}
              <th scope="col" className="px-4 py-3 text-right">Сумма</th>
              <th scope="col" className="px-4 py-3">Следующее действие</th>
              <th scope="col" className="px-4 py-3">Активность</th>
              <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map(l => {
              const a = nextActionOf(l)
              const act = relTime(l.lastActivityAt || l.updatedAt)
              const meta = [l.sphere, l.leadSource].filter(Boolean).join(' · ')
              return (
                <tr
                  key={l.id}
                  // Мышью — по всей строке; с клавиатуры — кнопка с названием.
                  onClick={e => { if (!(e.target as HTMLElement).closest('button, a, input, select')) h.onOpen(l) }}
                  className={clsx(
                    'cursor-pointer border-b border-surface-100 transition-colors last:border-0 hover:bg-surface-100/70 dark:border-surface-700/60 dark:hover:bg-surface-700/40',
                    l.callRequested && 'bg-amber-50 dark:bg-amber-900/15',
                    l.onHold && 'opacity-75',
                  )}
                >
                  {isBoss && (
                    <td className="px-3 py-3 text-center align-top">
                      <CallMark on={!!l.callRequested} disabled={callPending} label={`Назначить звонок: ${l.name}`}
                        onToggle={() => h.onCallRequest([l.id], !l.callRequested)} />
                    </td>
                  )}
                  <td className="max-w-[320px] px-4 py-3 align-top">
                    <button type="button" onClick={() => h.onOpen(l)} className="text-left font-medium text-surface-900 hover:underline dark:text-surface-50">
                      {l.name}
                    </button>
                    {meta && <p className="mt-0.5 truncate text-xs text-surface-500 dark:text-surface-400">{meta}</p>}
                    <RowBadges lead={l} />
                  </td>
                  <td className="px-4 py-3 align-top"><StageBadge status={l.status} /></td>
                  {showOwner && <td className="px-4 py-3 align-top text-surface-700 dark:text-surface-200">{l.owner?.name || <span className="text-surface-400">—</span>}</td>}
                  <td className="px-4 py-3 text-right align-top tabular-nums">
                    {moneyValue(l.dealPotential) > 0 ? formatMoney(l.dealPotential) : <span className="text-surface-400">—</span>}
                  </td>
                  <td className={clsx('px-4 py-3 align-top text-xs', isActive(l.status) ? ACTION_TEXT_CLASS[a.tone] : 'text-surface-400')}>
                    {isActive(l.status) ? a.label : '—'}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-surface-500 dark:text-surface-400">
                    {act ? <time title={act.title}>{act.text}</time> : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right align-top">
                    <span className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => h.onCall(l)} aria-label={`Записать звонок: ${l.name}`} title="Записать звонок"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700">
                        <Phone size={16} aria-hidden="true" />
                      </button>
                      <RowMenu label={`Действия: ${l.name}`} items={menuOf(l)} />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Телефон — карточки */}
      {isBoss && items.length > 0 && (
        <div className="mb-2 flex justify-end lg:hidden">
          <button type="button" disabled={callPending} aria-pressed={allMarked}
            onClick={() => h.onCallRequest(items.map(l => l.id), !allMarked)}
            className="btn-secondary min-h-[44px]">
            <PhoneCall size={15} aria-hidden="true" /> {allMarked ? 'Снять «Позвонить» на странице' : 'Позвонить всем на странице'}
          </button>
        </div>
      )}
      <ul className="space-y-2 lg:hidden">
        {items.map(l => {
          const a = nextActionOf(l)
          const pot = moneyValue(l.dealPotential)
          return (
            <li key={l.id} className={clsx('card flex items-stretch !p-0',
              l.callRequested && 'border-l-4 border-l-amber-500', l.onHold && 'opacity-80')}>
              {isBoss && (
                <span className="flex items-center pl-3">
                  <CallMark on={!!l.callRequested} disabled={callPending} label={`Назначить звонок: ${l.name}`}
                    onToggle={() => h.onCallRequest([l.id], !l.callRequested)} />
                </span>
              )}
              <button type="button" onClick={() => h.onOpen(l)} className="min-w-0 flex-1 p-3 text-left">
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words font-medium leading-snug text-surface-900 dark:text-surface-50">{l.name}</span>
                  <StageBadge status={l.status} className="shrink-0" />
                </span>
                {(pot > 0 || l.sphere || (showOwner && l.owner?.name)) && (
                  <span className="mt-0.5 block truncate text-xs text-surface-500 dark:text-surface-400">
                    {[pot > 0 ? formatMoney(pot) : null, l.sphere, showOwner ? l.owner?.name : null].filter(Boolean).join(' · ')}
                  </span>
                )}
                {isActive(l.status) && <span className={clsx('mt-1 block truncate text-xs font-medium', ACTION_TEXT_CLASS[a.tone])}>{a.label}</span>}
                <RowBadges lead={l} />
              </button>
              <span className="flex shrink-0 flex-col items-center justify-center gap-1 pr-1">
                {l.contactPhone ? (
                  // Звонок с телефона: набираем номер и сразу открываем шторку
                  // «Записать звонок» — вернулись из разговора, итог под рукой.
                  <a href={phoneHref(l.contactPhone)} onClick={() => window.setTimeout(() => h.onCall(l), 400)}
                    aria-label={`Позвонить: ${l.name}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-primary-700 hover:bg-surface-100 dark:text-primary-300 dark:hover:bg-surface-700">
                    <Phone size={18} aria-hidden="true" />
                  </a>
                ) : (
                  <button type="button" onClick={() => h.onCall(l)} aria-label={`Записать звонок: ${l.name}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700">
                    <Phone size={18} aria-hidden="true" />
                  </button>
                )}
                <RowMenu label={`Действия: ${l.name}`} items={menuOf(l)} />
              </span>
            </li>
          )
        })}
      </ul>

      <Pagination page={page} total={total} pageSize={pageSize} onChange={onPage} />
    </div>
  )
}

function RowBadges({ lead }: { lead: SalesLead }) {
  if (!lead.onHold && !lead.callRequested) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {lead.onHold && <span className="rounded bg-surface-200 px-1.5 py-0.5 text-[10px] font-semibold text-surface-700 dark:bg-surface-700 dark:text-surface-200">На паузе</span>}
      {lead.callRequested && (
        <span className="inline-flex items-center gap-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-800/50 dark:text-amber-200"
          title={lead.callRequestedByName ? `Отметил: ${lead.callRequestedByName}` : undefined}>
          <PhoneCall size={10} aria-hidden="true" /> Позвонить
        </span>
      )}
    </span>
  )
}

export function ListSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="card hidden space-y-3 lg:block">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-10 w-full" />)}
      </div>
      <div className="space-y-2 lg:hidden">
        {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-24 w-full" />)}
      </div>
    </div>
  )
}
