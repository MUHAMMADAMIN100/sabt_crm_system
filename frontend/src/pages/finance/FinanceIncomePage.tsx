import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { ChevronLeft, ChevronRight, ArrowLeft, Plus, Volume2, Code2, Palette } from 'lucide-react'
import { money, monthLabel, shiftYm, currentYm, dirLabel } from './financeUtils'
import OperationModal from './OperationModal'
import clsx from 'clsx'

const DIR_ICON: Record<string, any> = { smm: Volume2, development: Code2, design: Palette }
const DIR_COLOR: Record<string, string> = { smm: 'text-green-500', development: 'text-sky-500', design: 'text-purple-500' }

export default function FinanceIncomePage() {
  const [ym, setYm] = useState(currentYm())
  const [dir, setDir] = useState<string | null>(null)
  const [op, setOp] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {dir && <button onClick={() => setDir(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ArrowLeft size={18} /></button>}
          <div>
            <h1 className="page-title flex items-center gap-2">Доход{dir && <span className="text-surface-400 font-normal">/ {dirLabel(dir)}</span>}</h1>
            <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">{dir ? 'Оплаты по проектам за месяц: получено и тариф.' : 'Три направления — нажмите, чтобы открыть проекты'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MonthNav ym={ym} setYm={setYm} />
          <button onClick={() => setOp(true)} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={16} /> Доход</button>
        </div>
      </div>

      {dir ? <DirectionDetail dir={dir} ym={ym} /> : <Directions ym={ym} onOpen={setDir} />}

      <OperationModal open={op} onClose={() => setOp(false)} defaultTab="income" />
    </div>
  )
}

function Directions({ ym, onOpen }: { ym: string; onOpen: (d: string) => void }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['finance', 'income-dirs', ym], queryFn: () => financeApi.incomeDirections(ym) })
  if (isLoading) return <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(data as any[]).map(d => {
          const Icon = DIR_ICON[d.direction] || Volume2
          return (
            <button key={d.direction} onClick={() => onOpen(d.direction)} className="card text-left hover:border-primary-300 dark:hover:border-primary-800 transition-colors">
              <span className={clsx('flex items-center gap-1.5 font-semibold', DIR_COLOR[d.direction])}><Icon size={16} /> {dirLabel(d.direction)}</span>
              <p className="text-2xl font-bold mt-2 tabular-nums text-surface-800 dark:text-surface-100">{money(d.received)}</p>
              <p className="text-xs text-surface-400 mt-1">{d.projectCount} проектов · план {money(d.plan)}</p>
              <p className="text-xs text-primary-600 mt-2">Открыть →</p>
            </button>
          )
        })}
      </div>
      <p className="text-xs text-surface-400">Месяц: {ym} — суммы считаются по доходным операциям выбранного месяца.</p>
    </>
  )
}

function DirectionDetail({ dir, ym }: { dir: string; ym: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'income-dir', dir, ym], queryFn: () => financeApi.incomeDirectionDetail(dir, ym) })
  if (isLoading) return <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
  const rows: any[] = data?.rows ?? []
  if (rows.length === 0) return <div className="card"><p className="text-sm text-surface-400 py-3 text-center">Нет проектов направления. Добавьте их в «Настройки → Проекты/Клиенты».</p></div>
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
            <th className="py-2 pr-3 font-medium">Проект</th>
            <th className="py-2 px-3 font-medium text-right">Тариф</th>
            <th className="py-2 px-3 font-medium text-right">Получено за месяц</th>
            <th className="py-2 pl-3 font-medium text-right">Получено всего</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const pct = r.tariff > 0 ? Math.min(100, Math.round((r.received / r.tariff) * 100)) : 0
            return (
              <tr key={r.id} className="border-b border-surface-50 dark:border-surface-800/60">
                <td className="py-2 pr-3">
                  <div className="font-medium text-surface-800 dark:text-surface-200">{r.name}</div>
                  <div className="h-1 mt-1 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden w-28"><div className="h-full bg-green-500" style={{ width: `${pct}%` }} /></div>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-surface-500">{money(r.tariff)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400 font-medium">{money(r.received)}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{money(r.receivedLife)}</td>
              </tr>
            )
          })}
          <tr className="font-semibold">
            <td className="py-2 pr-3">Итого</td>
            <td className="py-2 px-3 text-right tabular-nums">{money(rows.reduce((s, r) => s + r.tariff, 0))}</td>
            <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(data?.totalReceived ?? 0)}</td>
            <td className="py-2 pl-3 text-right tabular-nums">{money(rows.reduce((s, r) => s + r.receivedLife, 0))}</td>
          </tr>
        </tbody>
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
