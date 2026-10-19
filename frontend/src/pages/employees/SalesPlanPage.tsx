// «Сотрудники → План продаж» (макет владельца 19.10.2026, вариант А):
// основатель ставит каждому менеджеру по продажам сумму на месяц, рядом —
// сколько уже получено от его клиентов по «Финансам». Видит только
// основатель; менеджер видит своё окошко в профиле на телефоне.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Avatar, EmptyState, PageLoader } from '@/components/ui'
import { salesPlanApi, type SalesPlanRow, type SalesPlans } from '@/services/api.service'
import { currentYm, shiftYm } from '@/pages/finance/finlib'

const MONTH = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const MONTH_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре']
const monthOf = (ym: string) => MONTH[Number(ym.slice(5, 7)) - 1] || ''
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} с.`
const ROLE: Record<string, string> = { sales_manager_smm: 'МП по SMM', sales_manager_dev: 'МП по разработке' }

/** Какая доля месяца прошла: прошлый месяц — весь, будущий — ничего. */
function elapsedShare(ym: string): number {
  const cur = currentYm()
  if (ym < cur) return 1
  if (ym > cur) return 0
  const now = new Date()
  return now.getDate() / new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
}

/** Идёт ли по графику: сделано не меньше прошедшей доли месяца. */
export function paceTone(pct: number, share: number) {
  return pct >= 100 || pct >= share * 100 ? 'ok' : 'behind'
}

function PlanInput({ row, onSave }: { row: SalesPlanRow; onSave: (v: number | null) => void }) {
  const shown = row.plan ? Math.round(row.plan).toLocaleString('ru-RU') : ''
  const [draft, setDraft] = useState(shown)
  useEffect(() => { setDraft(shown) }, [shown])
  const commit = () => {
    const digits = draft.replace(/\D/g, '')
    const next = digits ? Number(digits) : null
    if ((next || null) !== (row.plan || null)) onSave(next)
    else setDraft(shown)
  }
  return (
    <label className={clsx('flex items-center gap-1.5 h-11 lg:h-[38px] rounded-[9px] border bg-white dark:bg-surface-900 px-3',
      row.plan ? 'border-surface-300 dark:border-surface-600' : 'border-dashed border-surface-300 dark:border-surface-600')}>
      <span className="lg:hidden text-[12.5px] text-surface-400 dark:text-surface-500">План</span>
      <input value={draft} inputMode="numeric" placeholder="0" aria-label={`План на месяц: ${row.name}`}
        onChange={e => setDraft(e.target.value.replace(/[^\d\s]/g, ''))}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="flex-1 min-w-0 bg-transparent outline-none text-right text-[15px] lg:text-sm font-semibold tabular-nums text-surface-900 dark:text-surface-100" />
      <span className="text-[13px] text-surface-400 dark:text-surface-500">с.</span>
    </label>
  )
}

export default function SalesPlanPage() {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYm)
  const key = ['sales-plans', ym]
  const { data } = useQuery({ queryKey: key, queryFn: () => salesPlanApi.list(ym) })
  const put = (d: SalesPlans) => qc.setQueryData(key, d)
  const onErr = (e: any) => toast.error(e?.response?.data?.message || 'Не получилось сохранить')
  const save = useMutation({
    mutationFn: (v: { userId: string; amount: number | null }) => salesPlanApi.set(v.userId, ym, v.amount),
    onSuccess: put, onError: onErr,
  })
  const copy = useMutation({ mutationFn: () => salesPlanApi.copy(ym), onSuccess: put, onError: onErr })

  if (!data) return <PageLoader />
  const share = elapsedShare(ym)
  const pctOf = (r: SalesPlanRow) => (r.plan ? Math.round((r.received / r.plan) * 100) : 0)
  const totalPct = data.total.plan ? Math.round((data.total.received / data.total.plan) * 100) : 0
  const prevMonth = MONTH_PREP[Number(data.prevYm.slice(5, 7)) - 1] || ''

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <h1 className="page-title mr-auto lg:mr-2">План продаж</h1>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setYm(shiftYm(ym, -1))} aria-label="Прошлый месяц"
            className="w-9 h-9 lg:w-[30px] lg:h-[30px] rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-700"><ChevronLeft size={15} /></button>
          <span className="min-w-[120px] text-center text-sm text-surface-600 dark:text-surface-300 first-letter:uppercase">{monthOf(ym)} {ym.slice(0, 4)}</span>
          <button type="button" onClick={() => setYm(shiftYm(ym, 1))} aria-label="Следующий месяц"
            className="w-9 h-9 lg:w-[30px] lg:h-[30px] rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 flex items-center justify-center hover:bg-surface-100 dark:hover:bg-surface-700"><ChevronRight size={15} /></button>
        </div>
        <button type="button" onClick={() => copy.mutate()} disabled={copy.isPending || !data.managers.length}
          className="w-full lg:w-auto lg:ml-auto h-11 lg:h-9 px-3.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-700/60 text-surface-600 dark:text-surface-300 text-[13px] hover:bg-surface-200 dark:hover:bg-surface-700">
          Как в {prevMonth}
        </button>
      </div>

      {!data.managers.length ? <EmptyState title="Менеджеров по продажам пока нет" /> : (
    <section className="card !p-4 sm:!px-[22px] sm:!py-[18px] flex flex-col gap-3.5">
      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1.4fr)_190px_150px_minmax(0,1fr)] lg:items-center gap-x-5 gap-y-3">
        <span className="hidden lg:block text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">Менеджер</span>
        <span className="hidden lg:block text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">План на месяц</span>
        <span className="hidden lg:block text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">Получено</span>
        <span className="hidden lg:block text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">Выполнение</span>
        {data.managers.map(r => {
          const pct = pctOf(r)
          const ok = paceTone(pct, share) === 'ok'
          return (
            <div key={r.id} className="contents">
              <div className="flex flex-col gap-2.5 py-3 border-t border-surface-100 dark:border-surface-700/60 lg:contents">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={r.name} src={r.avatar || undefined} size={36} />
                  <div className="flex flex-col min-w-0">
                    <b className="text-sm font-semibold text-surface-900 dark:text-surface-100 truncate">{r.name}</b>
                    <span className="text-xs text-surface-400 dark:text-surface-500">{ROLE[r.role] || 'Менеджер по продажам'}</span>
                  </div>
                </div>
                <PlanInput row={r} onSave={amount => save.mutate({ userId: r.id, amount })} />
                <span className="hidden lg:block text-sm font-semibold tabular-nums text-surface-900 dark:text-surface-100">{money(r.received)}</span>
                <div className="flex items-center gap-2.5 text-[12.5px] lg:text-[13px]">
                  <span className="lg:hidden text-surface-500 dark:text-surface-400 whitespace-nowrap">получено <b className="text-surface-900 dark:text-surface-100">{money(r.received)}</b></span>
                  {r.plan ? (
                    <>
                      <div className="flex-1 h-[7px] rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
                        <div className={clsx('h-full rounded-full', ok ? 'bg-green-500' : 'bg-amber-400')} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <b className={clsx('w-11 text-right tabular-nums', ok ? 'text-green-600 dark:text-green-400' : 'text-amber-500 dark:text-amber-400')}>{pct} %</b>
                    </>
                  ) : (
                    <span className="ml-auto lg:ml-0 text-surface-400 dark:text-surface-500">план не задан</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {data.total.plan > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-3 border-t border-surface-100 dark:border-surface-700/60 text-[12.5px] lg:text-[13px] text-surface-500 dark:text-surface-400">
          <span>Итого план <b className="text-surface-900 dark:text-surface-100">{money(data.total.plan)}</b></span>
          <span>получено <b className="text-surface-900 dark:text-surface-100">{money(data.total.received)}</b></span>
          <span className={clsx('ml-auto lg:ml-0 font-semibold', paceTone(totalPct, share) === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-amber-500 dark:text-amber-400')}>{totalPct} %</span>
        </div>
      )}
    </section>
      )}
    </div>
  )
}
