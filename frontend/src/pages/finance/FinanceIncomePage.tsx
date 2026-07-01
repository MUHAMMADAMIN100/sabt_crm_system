import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { TrendingUp, ChevronLeft, ChevronRight, Check, Undo2, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { money, monthShort, shiftYm, currentYm, todayISO, ACCOUNT_OPTIONS } from './financeUtils'

const DIRECTIONS = [
  { key: 'smm', label: 'SMM', color: '#16a34a' },
  { key: 'development', label: 'Development', color: '#0ea5e9' },
  { key: 'design', label: 'Design', color: '#a855f7' },
]

export default function FinanceIncomePage() {
  const [group, setGroup] = useState('smm')
  const [start, setStart] = useState(() => shiftYm(currentYm(), -5))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <TrendingUp size={20} className="text-green-500" />
        <div>
          <h1 className="page-title">Доходы по направлениям</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Помесячные оплаты по проектам: план (ожидается) и факт (получено).</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {DIRECTIONS.map(d => (
          <button key={d.key} onClick={() => setGroup(d.key)}
            className={clsx('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              group === d.key ? 'bg-primary-600 text-white' : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600')}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} /> {d.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setStart(shiftYm(start, -1))} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronLeft size={16} /></button>
          <button onClick={() => setStart(shiftYm(start, 1))} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><ChevronRight size={16} /></button>
        </div>
      </div>

      <IncomeMatrix group={group} start={start} />
    </div>
  )
}

function IncomeMatrix({ group, start }: { group: string; start: string }) {
  const qc = useQueryClient()
  const key = ['finance', 'income-matrix', group, start]
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => financeApi.incomeMatrix({ group, start, months: 6 }) })
  const [cell, setCell] = useState<{ row: any; ym: string } | null>(null)
  const months: string[] = data?.months || []
  const rows: any[] = data?.rows || []
  const isSmm = group === 'smm'

  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })

  if (isLoading) return <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
  if (rows.length === 0) return <div className="card"><p className="text-sm text-surface-400 py-3">Нет активных проектов направления.</p></div>

  const monthTotal = (ym: string) => rows.reduce((s, r) => s + (r.byMonth[ym] || []).filter((p: any) => p.status === 'received').reduce((a: number, p: any) => a + p.amount, 0), 0)

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
            <th className="py-2 pr-3 font-medium">Проект</th>
            <th className="py-2 px-2 font-medium text-right">Тариф</th>
            {months.map(m => <th key={m} className="py-2 px-2 font-medium text-center capitalize">{monthShort(m)}</th>)}
            <th className="py-2 pl-2 font-medium text-right">Оплачено</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const paidPct = r.tariff > 0 ? Math.min(100, Math.round((r.paidLife / r.tariff) * 100)) : 0
            return (
              <tr key={r.id} className="border-b border-surface-50 dark:border-surface-800/60">
                <td className="py-2 pr-3">
                  <div className="font-medium text-surface-800 dark:text-surface-200">{r.name}</div>
                  <div className="h-1 mt-1 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden w-28"><div className="h-full bg-green-500" style={{ width: `${paidPct}%` }} /></div>
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-surface-500">{money(r.tariff)}</td>
                {months.map(ym => {
                  const cells = (r.byMonth[ym] || []) as any[]
                  return (
                    <td key={ym} className="py-1.5 px-1 text-center align-middle">
                      <button onClick={() => setCell({ row: r, ym })} className="min-w-[54px] px-1.5 py-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700/60 transition-colors">
                        {cells.length === 0 ? (
                          <span className="text-surface-300 dark:text-surface-600 text-lg leading-none">＋</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {cells.map(p => (
                              <span key={p.id} className={clsx('text-[10px] font-semibold px-1 py-0.5 rounded tabular-nums',
                                p.status === 'received' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
                                {isSmm ? `ч${p.partNo}: ` : ''}{money(p.amount).replace(' сом.', '')}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    </td>
                  )
                })}
                <td className="py-2 pl-2 text-right tabular-nums font-medium">{money(r.paidLife)}</td>
              </tr>
            )
          })}
          <tr className="font-semibold text-sm">
            <td className="py-2 pr-3">Итого</td>
            <td className="py-2 px-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + r.tariff, 0))}</td>
            {months.map(m => <td key={m} className="py-2 px-2 text-center tabular-nums text-green-600 dark:text-green-400">{money(monthTotal(m)).replace(' сом.', '')}</td>)}
            <td className="py-2 pl-2 text-right tabular-nums">{money(rows.reduce((s, r) => s + r.paidLife, 0))}</td>
          </tr>
        </tbody>
      </table>

      {cell && <IncomeCellModal group={group} row={cell.row} ym={cell.ym} onClose={() => setCell(null)} onDone={refresh} />}
    </div>
  )
}

function IncomeCellModal({ group, row, ym, onClose, onDone }: { group: string; row: any; ym: string; onClose: () => void; onDone: () => void }) {
  const planned: any[] = row.byMonth[ym] || []
  const isSmm = group === 'smm'
  const [amount, setAmount] = useState(isSmm ? '' : String(Math.max(0, row.tariff)))
  const [partNo, setPartNo] = useState<1 | 2>(1)
  const [received, setReceived] = useState(false)
  const [account, setAccount] = useState('alif')
  const [date, setDate] = useState(todayISO())

  const done = () => { onDone(); onClose() }
  const add = useMutation({
    mutationFn: () => received
      ? financeApi.addReceived({ projectId: row.id, ym, partNo, amount: Number(amount), account, date })
      : financeApi.addPlanned({ projectId: row.id, ym, partNo, amount: Number(amount) }),
    onSuccess: () => { toast.success(received ? 'Оплата записана' : 'План добавлен'); done() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const act = useMutation({
    mutationFn: ({ p, kind }: any) =>
      kind === 'receive' ? financeApi.receivePlanned(p.id, { account, date })
      : kind === 'unreceive' ? financeApi.unreceivePlanned(p.id)
      : financeApi.removePlanned(p.id),
    onSuccess: () => { toast.success('Готово'); done() },
    onError: () => toast.error('Ошибка'),
  })

  return (
    <Modal open onClose={onClose} title={`${row.name} — ${monthShort(ym)}`}>
      <div className="space-y-4">
        {planned.length > 0 && (
          <div className="space-y-1.5">
            {planned.map(p => (
              <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <span className={clsx('text-xs font-semibold px-1.5 py-0.5 rounded', p.status === 'received' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>
                  {isSmm ? `Часть ${p.partNo} · ` : ''}{money(p.amount)}
                </span>
                <span className="ml-auto flex gap-1">
                  {p.status === 'expected' ? (
                    <>
                      <button onClick={() => act.mutate({ p, kind: 'receive' })} className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1"><Check size={12} /> Получено</button>
                      <button onClick={() => act.mutate({ p, kind: 'remove' })} className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={12} /></button>
                    </>
                  ) : (
                    <button onClick={() => act.mutate({ p, kind: 'unreceive' })} className="text-xs px-2 py-1 rounded text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 inline-flex items-center gap-1"><Undo2 size={12} /> Снять</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-surface-100 dark:border-surface-700 pt-3 space-y-3">
          <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Добавить</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label text-xs">Сумма</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input" placeholder="0" /></div>
            {isSmm && <div><label className="label text-xs">Часть</label><select value={partNo} onChange={e => setPartNo(Number(e.target.value) as 1 | 2)} className="input"><option value={1}>Часть 1</option><option value={2}>Часть 2</option></select></div>}
          </div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={received} onChange={e => setReceived(e.target.checked)} className="w-4 h-4" /> Уже получено (создать доход)</label>
          {received && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label text-xs">Счёт</label><select value={account} onChange={e => setAccount(e.target.value)} className="input">{ACCOUNT_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
              <div><label className="label text-xs">Дата</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary text-sm">Закрыть</button>
            <button onClick={() => add.mutate()} disabled={add.isPending || !(Number(amount) > 0)} className="btn-primary text-sm">{received ? 'Записать оплату' : 'Добавить план'}</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
