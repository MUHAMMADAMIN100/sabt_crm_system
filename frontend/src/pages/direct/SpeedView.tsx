import { useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import clsx from 'clsx'
import { directApi } from '@/services/direct.api'
import { Spinner } from '@/components/ui'
import { duration, seconds } from './directTime'

const PERIODS = [
  { days: 7, label: '7 дней' },
  { days: 30, label: '30 дней' },
  { days: 90, label: '90 дней' },
]

/** «Скорость ответа»: сколько клиент ждал ответа — по каждому, кто отвечал. */
export default function SpeedView() {
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

  const total = data?.people.reduce((n, p) => n + p.replies, 0) ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map(p => (
          <button key={p.days} type="button" onClick={() => setDays(p.days)}
            className={clsx('rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              days === p.days ? 'bg-primary-600 text-white' : 'border border-surface-200 bg-surface-50 text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-300')}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <div className="text-xs text-surface-500">Сейчас ждут ответа</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900 dark:text-white">{data?.waiting.count ?? '—'}</div>
          {data?.waiting.since && (
            <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">дольше всех — {duration(Date.now() - new Date(data.waiting.since).getTime())}</div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs text-surface-500">Ответов за период</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-surface-900 dark:text-white">{data ? total : '—'}</div>
          <div className="mt-0.5 text-xs text-surface-400">каждый — ответ клиенту, который ждал</div>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !data?.people.length ? (
          <p className="px-4 py-10 text-center text-sm text-surface-500">За этот период ответов ещё не было</p>
        ) : (
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-surface-200 text-left text-xs text-surface-500 dark:border-surface-700">
                <th className="px-4 py-2.5 font-medium">Кто отвечал</th>
                <th className="px-4 py-2.5 text-right font-medium">Ответов</th>
                <th className="px-4 py-2.5 text-right font-medium" title="Половина ответов быстрее этого времени">Обычно</th>
                <th className="px-4 py-2.5 text-right font-medium">В среднем</th>
                <th className="px-4 py-2.5 text-right font-medium">До 15 минут</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map(p => (
                <tr key={p.userId ?? 'app'} className="border-b border-surface-100 last:border-0 dark:border-surface-700/60">
                  <td className={clsx('px-4 py-2.5', p.userId ? 'font-medium text-surface-800 dark:text-surface-100' : 'text-surface-500')}>{p.name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{p.replies}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{seconds(p.median)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-surface-500">{seconds(p.average)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{p.replies ? Math.round((p.fast / p.replies) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs leading-relaxed text-surface-400">
        Время считается от первого сообщения клиента до ответа агентства — из CRM или из приложения Instagram.
        Ночь и выходные тоже идут в счёт, поэтому главный показатель — «Обычно»: половина ответов была быстрее.
      </p>
    </div>
  )
}
