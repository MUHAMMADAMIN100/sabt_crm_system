import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { ChevronLeft, ChevronRight, ArrowLeft, Plus, Users, Building2, Landmark, MoreHorizontal } from 'lucide-react'
import { money, monthLabel, shiftYm, currentYm } from './financeUtils'
import OperationModal from './OperationModal'
import { TxRow } from './FinanceOverviewPage'
import clsx from 'clsx'

const CARDS = [
  { kind: 'salary', label: 'Зарплата', icon: Users, color: 'text-orange-500', unit: 'сотрудников', hint: '' },
  { kind: 'subscriptions', label: 'Аренда и подписки', icon: Building2, color: 'text-red-500', unit: 'позиций', hint: '' },
  { kind: 'debts', label: 'Долги', icon: Landmark, color: 'text-amber-600', unit: 'долгов', hint: '' },
  { kind: 'other', label: 'Прочее', icon: MoreHorizontal, color: 'text-surface-500', unit: '', hint: 'реклама, транспорт, налоги…' },
]

export default function FinanceExpensePage() {
  const [ym, setYm] = useState(currentYm())
  const [kind, setKind] = useState<string | null>(null)
  const [op, setOp] = useState(false)

  const card = CARDS.find(c => c.kind === kind)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {kind && <button onClick={() => setKind(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ArrowLeft size={18} /></button>}
          <div>
            <h1 className="page-title flex items-center gap-2">Расход{card && <span className="text-surface-400 font-normal">/ {card.label}</span>}</h1>
            <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">{kind ? 'Детализация статьи за месяц.' : 'Нажмите карточку, чтобы открыть детали'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav ym={ym} setYm={setYm} />
          <button onClick={() => setOp(true)} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={16} /> Расход</button>
        </div>
      </div>

      {kind ? <ExpenseDetail kind={kind} ym={ym} /> : <Cards ym={ym} onOpen={setKind} />}

      <OperationModal open={op} onClose={() => setOp(false)} defaultTab="expense" />
    </div>
  )
}

function Cards({ ym, onOpen }: { ym: string; onOpen: (k: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-summary', ym], queryFn: () => financeApi.expenseSummary(ym) })
  if (isLoading) return <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {CARDS.map(c => {
        const d = (data as any)?.[c.kind] || {}
        const sub = c.kind === 'other' ? c.hint : `${d.count ?? 0} ${c.unit}`
        return (
          <button key={c.kind} onClick={() => onOpen(c.kind)} className="card text-left hover:border-primary-300 dark:hover:border-primary-800 transition-colors">
            <span className={clsx('flex items-center gap-1.5 font-semibold', c.color)}><c.icon size={16} /> {c.label}</span>
            <p className="text-2xl font-bold mt-2 tabular-nums text-surface-800 dark:text-surface-100">{money(d.spent ?? 0)}</p>
            <p className="text-xs text-surface-400 mt-1">{sub}</p>
            <p className="text-xs text-primary-600 mt-2">Открыть →</p>
          </button>
        )
      })}
    </div>
  )
}

function ExpenseDetail({ kind, ym }: { kind: string; ym: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-detail', kind, ym], queryFn: () => financeApi.expenseDetail(kind, ym) })
  if (isLoading) return <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
  const rows: any[] = data?.rows ?? []

  if (kind === 'salary') {
    return (
      <TableCard head={['Сотрудник', 'Оклад', 'Выплачено', 'К выплате']} empty={rows.length === 0} emptyText="Нет сотрудников. Добавьте в «Настройки → Сотрудники».">
        {rows.map(r => (
          <tr key={r.id} className="border-b border-surface-50 dark:border-surface-800/60">
            <td className="py-2 pr-3">
              <span className="font-medium text-surface-800 dark:text-surface-200">{r.name}</span>
              {r.role && <span className="text-xs text-surface-400 ml-1.5">{r.role}</span>}
              {r.status === 'inactive' && <span className="text-[10px] ml-1.5 px-1 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">неактивен</span>}
            </td>
            <td className="py-2 px-3 text-right tabular-nums text-surface-500">{money(r.salary)}</td>
            <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(r.paid)}</td>
            <td className="py-2 pl-3 text-right tabular-nums font-medium">{money(r.toPay)}</td>
          </tr>
        ))}
      </TableCard>
    )
  }
  if (kind === 'subscriptions') {
    return (
      <>
        <TableCard head={['Название', 'Тип', 'Сумма/мес', 'Статус']} empty={rows.length === 0} emptyText="Нет позиций. Добавьте в «Настройки → Аренда и подписки».">
          {rows.map(r => (
            <tr key={r.id} className="border-b border-surface-50 dark:border-surface-800/60">
              <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{r.name}</td>
              <td className="py-2 px-3 text-surface-500">{r.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
              <td className="py-2 px-3 text-right tabular-nums">{money(r.amount)}</td>
              <td className="py-2 pl-3 text-right">{r.active ? <span className="text-xs text-green-600 dark:text-green-400">активна</span> : <span className="text-xs text-surface-400">выключена</span>}</td>
            </tr>
          ))}
        </TableCard>
        <p className="text-sm text-surface-500">Оплачено за месяц (аренда+подписки): <span className="font-semibold text-red-600 dark:text-red-400">{money(data?.spent ?? 0)}</span></p>
      </>
    )
  }
  if (kind === 'debts') {
    return (
      <>
        <TableCard head={['Долг', 'Сумма', 'Погашено', 'Остаток']} empty={rows.length === 0} emptyText="Нет долгов. Добавьте в «Настройки → Долги».">
          {rows.map(r => (
            <tr key={r.id} className="border-b border-surface-50 dark:border-surface-800/60">
              <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{r.name}<span className="text-xs text-surface-400 ml-1.5">план {money(r.monthlyPayment)}/мес</span></td>
              <td className="py-2 px-3 text-right tabular-nums text-surface-500">{money(r.totalAmount)}</td>
              <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(r.paid)}</td>
              <td className="py-2 pl-3 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">{money(r.remaining)}</td>
            </tr>
          ))}
        </TableCard>
        <p className="text-sm text-surface-500">Погашено в этом месяце: <span className="font-semibold text-red-600 dark:text-red-400">{money(data?.spentThisMonth ?? 0)}</span></p>
      </>
    )
  }
  // other
  return (
    <div className="card">
      {rows.length === 0 ? (
        <p className="text-sm text-surface-400 py-6 text-center">Нет прочих расходов за месяц.</p>
      ) : (
        <ul className="divide-y divide-surface-50 dark:divide-surface-800/60">{rows.map(t => <TxRow key={t.id} t={t} />)}</ul>
      )}
    </div>
  )
}

function TableCard({ head, children, empty, emptyText }: { head: string[]; children: React.ReactNode; empty?: boolean; emptyText?: string }) {
  if (empty) return <div className="card"><p className="text-sm text-surface-400 py-3 text-center">{emptyText}</p></div>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
            {head.map((h, i) => <th key={h} className={clsx('py-2 font-medium', i === 0 ? 'pr-3' : 'px-3 text-right', i === head.length - 1 && 'pl-3 pr-0')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function MonthNav({ ym, setYm }: { ym: string; setYm: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-surface-200 dark:border-surface-700 px-1 py-0.5">
      <button onClick={() => setYm(shiftYm(ym, -1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronLeft size={16} /></button>
      <span className="text-sm font-medium px-2 min-w-[110px] text-center">{monthLabel(ym)}</span>
      <button onClick={() => setYm(shiftYm(ym, 1))} className="p-1 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronRight size={16} /></button>
    </div>
  )
}
