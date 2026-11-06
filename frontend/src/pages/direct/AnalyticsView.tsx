import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { directApi, type DirectStatsRow } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { duration, seconds } from './directTime'

const PERIODS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
]

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')

/** Число, а для строк не-менеджеров ноль — прочерком: у них нет своих клиентов. */
const num = (value: number, p: DirectStatsRow) => (value || p.isManager ? String(value) : '—')

/**
 * «Аналитика» «Директа»: по каждому менеджеру продаж — сколько клиентов он
 * ведёт (клиент закрепляется за тем, кто первым ответил), как быстро
 * отвечает, сколько лидов и сделок из его чатов. Нажатие на менеджера
 * открывает его чаты.
 */
export default function AnalyticsView({ onOpenManager }: { onOpenManager: (userId: string) => void }) {
  const [days, setDays] = useState(30)
  const range = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [days])
  const { data, isLoading } = useQuery({
    queryKey: ['direct', 'stats', days],
    queryFn: () => directApi.stats(range),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })

  const people = data?.people ?? []
  const managers = people.filter(p => p.isManager)
  // Руководство, бывшие менеджеры и ответы из приложения — если что-то делали.
  const others = people.filter(p => !p.isManager && (p.replies || p.clients || p.leads))
  const replies = people.reduce((n, p) => n + p.replies, 0)
  const leads = people.reduce((n, p) => n + p.leads, 0)
  const deals = people.reduce((n, p) => n + p.deals, 0)
  // Чаты открываются у тех, за кем могут быть клиенты.
  const canOpen = (p: DirectStatsRow) => !!p.userId && (p.isManager || p.clients > 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(p => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)} aria-pressed={days === p.days}
            className={clsx('min-h-[34px] rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-0',
              days === p.days ? 'bg-primary-600 text-white' : 'border border-surface-200 bg-surface-50 text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300')}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-surface-500">Сейчас ждут ответа</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900 dark:text-white">{data?.waiting.count ?? '—'}</div>
          {data?.waiting.since && (
            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">дольше всех — {duration(Date.now() - new Date(data.waiting.since).getTime())}</div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs text-surface-500">Свободных чатов</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900 dark:text-white">{data?.freeClients ?? '—'}</div>
          <div className="mt-0.5 text-xs text-surface-400">ни за кем не закреплены</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-surface-500">Ответов за период</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900 dark:text-white">{data ? replies : '—'}</div>
          <div className="mt-0.5 text-xs text-surface-400">клиентам, которые ждали</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-surface-500">Лидов из Директа</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900 dark:text-white">{data ? leads : '—'}</div>
          <div className="mt-0.5 text-xs text-surface-400">из них сделок: {data ? deals : '—'}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="card flex justify-center py-10"><Spinner /></div>
      ) : !managers.length && !others.length ? (
        <p className="card px-4 py-10 text-center text-sm text-surface-500">Менеджеров продаж пока нет — и ответов за этот период тоже</p>
      ) : (
        <>
          {/* Телефон: карточка на человека */}
          <div className="space-y-2 md:hidden">
            {[...managers, ...others].map(p => {
              const open = canOpen(p)
              const body = (
                <>
                  <div className="flex items-center gap-2">
                    <span className={clsx('min-w-0 flex-1 truncate text-sm', p.userId ? 'font-semibold text-surface-900 dark:text-white' : 'text-surface-500')}>{p.name}</span>
                    {!p.isManager && p.userId && <span className="shrink-0 text-[11px] text-surface-400">не менеджер продаж</span>}
                    {open && <ChevronRight size={16} className="shrink-0 text-surface-400" aria-hidden />}
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-2 text-[11px] text-surface-500">
                    <Metric label="Клиентов" value={num(p.clients, p)} extra={p.newClients ? `+${p.newClients}` : undefined} />
                    <Metric label="Ждут ответа" value={num(p.waiting, p)} warn={p.waiting > 0} />
                    <Metric label="Ответов" value={String(p.replies)} />
                    <Metric label="Обычно" value={seconds(p.median)} />
                    <Metric label="До 15 минут" value={percent(p.fast, p.replies)} />
                    <Metric label="Лиды · сделки" value={p.leads || p.deals || p.isManager ? `${p.leads} · ${p.deals}` : '—'} />
                  </dl>
                </>
              )
              return open ? (
                <button key={p.userId ?? 'app'} type="button" onClick={() => onOpenManager(p.userId!)}
                  className="card block w-full p-3 text-left transition-colors hover:bg-surface-50 dark:hover:bg-surface-800">
                  {body}
                </button>
              ) : (
                <div key={p.userId ?? 'app'} className="card p-3">{body}</div>
              )
            })}
          </div>

          {/* Компьютер: таблица */}
          <div className="card hidden overflow-x-auto p-0 md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-surface-200 text-left text-xs text-surface-500 dark:border-surface-700">
                  <th className="px-4 py-2.5 font-medium">Менеджер</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Сколько клиентов ведёт сейчас; зелёным — закрепились за период">Клиентов</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ждут ответа</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ответов</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Половина ответов быстрее этого времени">Обычно</th>
                  <th className="px-3 py-2.5 text-right font-medium">В среднем</th>
                  <th className="px-3 py-2.5 text-right font-medium">До 15 минут</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Лиды из чатов «Директа», заведённые за период">Лидов</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Из этих лидов — ставшие клиентами">Сделок</th>
                  <th className="w-8" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {managers.map(p => <TableRow key={p.userId} p={p} open={canOpen(p)} onOpen={onOpenManager} />)}
                {others.length > 0 && (
                  <tr className="border-b border-surface-100 bg-surface-50/70 dark:border-surface-700/60 dark:bg-surface-800/40">
                    <td colSpan={10} className="px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-surface-400">Ещё отвечали клиентам</td>
                  </tr>
                )}
                {others.map(p => <TableRow key={p.userId ?? 'app'} p={p} open={canOpen(p)} onOpen={onOpenManager} />)}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="text-xs leading-relaxed text-surface-400">
        Клиент закрепляется за менеджером продаж, который первым ответил ему из CRM; ответы руководства и из приложения Instagram
        клиента не закрепляют. «Клиентов» — сколько чатов менеджер ведёт сейчас, «+N» — сколько закрепилось за период.
        Время ответа считается от первого сообщения клиента до ответа агентства; ночь и выходные тоже идут в счёт, поэтому главный
        показатель — «Обычно»: половина ответов была быстрее. Лиды — заведённые из чатов «Директа» за период, по владельцу лида.
      </p>
    </div>
  )
}

function Metric({ label, value, extra, warn }: { label: string; value: string; extra?: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="truncate">{label}</dt>
      <dd className={clsx('mt-0.5 text-[13px] font-semibold tabular-nums', warn ? 'text-amber-700 dark:text-amber-300' : 'text-surface-800 dark:text-surface-100')}>
        {value}
        {extra && <span className="ml-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">{extra}</span>}
      </dd>
    </div>
  )
}

function TableRow({ p, open, onOpen }: { p: DirectStatsRow; open: boolean; onOpen: (userId: string) => void }) {
  return (
    <tr onClick={open ? () => onOpen(p.userId!) : undefined}
      className={clsx('border-b border-surface-100 last:border-0 dark:border-surface-700/60', open && 'cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/60')}>
      <td className="px-4 py-2.5">
        {open ? (
          <button type="button" onClick={e => { e.stopPropagation(); onOpen(p.userId!) }} title="Открыть чаты менеджера"
            className="text-left font-medium text-surface-800 hover:text-primary-700 dark:text-surface-100 dark:hover:text-primary-300">
            {p.name}
          </button>
        ) : (
          <span className={p.userId ? 'font-medium text-surface-800 dark:text-surface-100' : 'text-surface-500'}>{p.name}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {num(p.clients, p)}
        {p.newClients > 0 && <span className="ml-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400" title="Закрепились за период">+{p.newClients}</span>}
      </td>
      <td className={clsx('px-3 py-2.5 text-right tabular-nums', p.waiting > 0 && 'font-medium text-amber-700 dark:text-amber-300')}>{num(p.waiting, p)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{p.replies}</td>
      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{seconds(p.median)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-surface-500">{seconds(p.average)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{percent(p.fast, p.replies)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(p.leads, p)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(p.deals, p)}</td>
      <td className="pr-3 text-surface-300">{open && <ChevronRight size={15} aria-hidden />}</td>
    </tr>
  )
}
