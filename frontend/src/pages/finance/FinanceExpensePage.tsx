import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { employeesApi, financeApi } from '@/services/api.service'
import { Wallet, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const money = (v: any) => (Math.round(Number(v) || 0)).toLocaleString('ru-RU') + ' сом.'
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const currentYm = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const shiftYm = (ym: string, delta: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const monthLabel = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}` }
const monthRange = (ym: string) => { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` } }

/**
 * «Расходы» — фокус на Зарплате (переиспользуем сотрудников CRM) + сводка
 * расходов по категориям за месяц. Подписки/аренда и долги — следующий этап.
 */
export default function FinanceExpensePage() {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYm())
  const { from, to } = monthRange(ym)

  const { data: employees = [] } = useQuery({ queryKey: ['employees', 'fin'], queryFn: () => employeesApi.list() })
  const { data: salaryTx } = useQuery({
    queryKey: ['finance', 'salary', from, to],
    queryFn: () => financeApi.list({ type: 'expense', category: 'salary', from, to, pageSize: 500 }),
  })
  const { data: byCat = [] } = useQuery({
    queryKey: ['finance', 'by-category', from, to],
    queryFn: () => financeApi.byCategory({ from, to }),
  })

  const activeEmps = useMemo(() => (employees as any[]).filter(e => e.status === 'active'), [employees])
  const salaryItems: any[] = (salaryTx as any)?.items || []
  // Оплачено за месяц по каждому сотруднику — по совпадению имени (counterparty).
  const paidByName = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of salaryItems) {
      const key = (t.counterparty || '').trim().toLowerCase()
      if (key) map[key] = (map[key] || 0) + Number(t.amount || 0)
    }
    return map
  }, [salaryItems])

  const fund = activeEmps.reduce((s, e) => s + (Number(e.salary) || 0), 0)
  const paid = salaryItems.reduce((s, t) => s + Number(t.amount || 0), 0)
  const toPay = Math.max(0, fund - paid)

  const payMut = useMutation({
    mutationFn: (emp: any) => financeApi.create({
      type: 'expense', category: 'salary', amount: emp._remaining, account: 'alif',
      date: `${ym}-10`, counterparty: emp.fullName, description: 'Зарплата', status: 'completed',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] })
      toast.success('Зарплата выплачена')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось провести выплату'),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Wallet size={20} className="text-red-500" />
        <div>
          <h1 className="page-title">Расходы</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Зарплата (по сотрудникам CRM) и расходы по категориям за месяц.</p>
        </div>
      </div>

      {/* Навигация по месяцу */}
      <div className="flex items-center gap-2">
        <button onClick={() => setYm(shiftYm(ym, -1))} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold text-surface-800 dark:text-surface-200 min-w-[140px] text-center capitalize">{monthLabel(ym)}</span>
        <button onClick={() => setYm(shiftYm(ym, 1))} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronRight size={16} /></button>
        {ym !== currentYm() && <button onClick={() => setYm(currentYm())} className="text-xs text-primary-600 hover:underline ml-1">сегодня</button>}
      </div>

      {/* Карточки зарплаты */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card"><p className="text-[11px] uppercase tracking-wide text-surface-400">Фонд ЗП / мес</p><p className="text-xl font-bold tabular-nums">{money(fund)}</p></div>
        <div className="card"><p className="text-[11px] uppercase tracking-wide text-surface-400">Выплачено за месяц</p><p className="text-xl font-bold tabular-nums text-green-600 dark:text-green-400">{money(paid)}</p></div>
        <div className="card"><p className="text-[11px] uppercase tracking-wide text-surface-400">К выплате</p><p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">{money(toPay)}</p></div>
        <div className="card"><p className="text-[11px] uppercase tracking-wide text-surface-400">Сотрудников</p><p className="text-xl font-bold tabular-nums">{activeEmps.length}</p></div>
      </div>

      {/* Таблица зарплат */}
      <div className="card">
        <h3 className="section-title mb-3">Зарплата — {monthLabel(ym)}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className="py-2 pr-3 font-medium">Сотрудник</th>
                <th className="py-2 px-3 font-medium">Должность</th>
                <th className="py-2 px-3 font-medium text-right">Оклад</th>
                <th className="py-2 px-3 font-medium text-right">Выплачено</th>
                <th className="py-2 pl-3 font-medium text-right">Статус</th>
              </tr>
            </thead>
            <tbody>
              {activeEmps.map(e => {
                const salary = Number(e.salary) || 0
                const empPaid = paidByName[(e.fullName || '').trim().toLowerCase()] || 0
                const remaining = Math.max(0, salary - empPaid)
                const isPaid = salary > 0 && empPaid >= salary
                return (
                  <tr key={e.id} className="border-b border-surface-50 dark:border-surface-800/60">
                    <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{e.fullName}</td>
                    <td className="py-2 px-3 text-surface-500 dark:text-surface-400">{e.position || '—'}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{money(salary)}</td>
                    <td className={clsx('py-2 px-3 text-right tabular-nums', empPaid > 0 ? 'text-green-600 dark:text-green-400' : 'text-surface-400')}>{money(empPaid)}</td>
                    <td className="py-2 pl-3 text-right">
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400"><Check size={13} /> выплачено</span>
                      ) : (
                        <button
                          disabled={payMut.isPending || remaining <= 0}
                          onClick={() => payMut.mutate({ ...e, _remaining: remaining })}
                          className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50">
                          Выплатить {money(remaining)}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {activeEmps.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-surface-400">Нет активных сотрудников.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Расходы по категориям за месяц */}
      <div className="card">
        <h3 className="section-title mb-3">Расходы по категориям — {monthLabel(ym)}</h3>
        {(byCat as any[]).length === 0 ? (
          <p className="text-sm text-surface-400 py-2">Нет расходов за месяц.</p>
        ) : (
          <div className="space-y-2">
            {(byCat as any[]).map(c => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="text-sm text-surface-700 dark:text-surface-300 w-40 truncate">{c.category}</span>
                <div className="flex-1 h-2 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
                  <div className="h-full bg-red-400" style={{ width: `${c.percent}%` }} />
                </div>
                <span className="text-sm tabular-nums text-surface-600 dark:text-surface-400 w-28 text-right">{money(c.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-surface-400">Аренда/подписки и долги с графиком погашения — в следующем этапе.</p>
    </div>
  )
}
