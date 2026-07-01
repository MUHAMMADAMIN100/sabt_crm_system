import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { employeesApi, financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { Wallet, ChevronLeft, ChevronRight, Check, Plus, Trash2, Undo2, Edit } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { monthShort, todayISO, ACCOUNT_OPTIONS } from './financeUtils'

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

      <SubscriptionsSection ym={ym} />

      <DebtsSection />
    </div>
  )
}

// ─── Подписки / аренда ───────────────────────────────────────────────
function SubscriptionsSection({ ym }: { ym: string }) {
  const qc = useQueryClient()
  const { data: subs = [] } = useQuery({ queryKey: ['finance', 'subs-month', ym], queryFn: () => financeApi.subscriptionsMonth(ym) })
  const [edit, setEdit] = useState<any>(null)
  const [adding, setAdding] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })

  const pay = useMutation({ mutationFn: (s: any) => financeApi.paySubscription(s.id, { ym, account: s.accountId || 'alif' }), onSuccess: () => { toast.success('Оплачено'); refresh() }, onError: () => toast.error('Ошибка') })
  const cancel = useMutation({ mutationFn: (s: any) => financeApi.cancelSubscription(s.id, ym), onSuccess: () => { toast.success('Отменено'); refresh() }, onError: () => toast.error('Ошибка') })

  const list = subs as any[]
  const monthly = list.filter(s => s.active).reduce((acc, s) => acc + Number(s.amount || 0), 0)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-title">Аренда и подписки <span className="text-surface-400 font-normal text-sm">· {money(monthly)}/мес</span></h3>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700"><Plus size={14} /> Добавить</button>
      </div>
      {list.length === 0 ? <p className="text-sm text-surface-400 py-2">Нет позиций.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
              <th className="py-2 pr-3 font-medium">Позиция</th><th className="py-2 px-3 font-medium">Тип</th><th className="py-2 px-3 font-medium text-right">Сумма/мес</th><th className="py-2 px-3 font-medium">Статус</th><th className="py-2 pl-3 font-medium text-right">Действия</th>
            </tr></thead>
            <tbody>
              {list.map(s => (
                <tr key={s.id} className={clsx('border-b border-surface-50 dark:border-surface-800/60', !s.active && 'opacity-50')}>
                  <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{s.name}</td>
                  <td className="py-2 px-3 text-surface-500">{s.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{money(s.amount)}</td>
                  <td className="py-2 px-3">{s.paid ? <span className="text-xs font-semibold text-green-600 dark:text-green-400 inline-flex items-center gap-1"><Check size={12} /> оплачено{s.lastDate ? ` · ${s.lastDate.slice(8, 10)}.${s.lastDate.slice(5, 7)}` : ''}</span> : <span className="text-xs text-surface-400">не оплачено</span>}</td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    {s.paid
                      ? <button onClick={() => cancel.mutate(s)} className="text-xs px-2 py-1 rounded text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 inline-flex items-center gap-1"><Undo2 size={12} /> отменить</button>
                      : <button onClick={() => pay.mutate(s)} disabled={!s.active} className="text-xs px-2 py-1 rounded bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">Оплатить</button>}
                    <button onClick={() => setEdit(s)} className="text-xs px-2 py-1 rounded text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 ml-1"><Edit size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(adding || edit) && <SubModal initial={edit} onClose={() => { setAdding(false); setEdit(null) }} onDone={() => { setAdding(false); setEdit(null); refresh() }} />}
    </div>
  )
}

function SubModal({ initial, onClose, onDone }: { initial?: any; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(initial?.name || '')
  const [amount, setAmount] = useState(String(initial?.amount ?? ''))
  const [kind, setKind] = useState<'rent' | 'subscription'>(initial?.kind || 'subscription')
  const [active, setActive] = useState(initial?.active !== false)
  const save = useMutation({
    mutationFn: () => initial ? financeApi.updateSubscription(initial.id, { name, amount: Number(amount), kind, active }) : financeApi.createSubscription({ name, amount: Number(amount), kind, active }),
    onSuccess: () => { toast.success('Сохранено'); onDone() }, onError: () => toast.error('Ошибка'),
  })
  const del = useMutation({ mutationFn: () => financeApi.deleteSubscription(initial.id), onSuccess: () => { toast.success('Удалено'); onDone() } })
  return (
    <Modal open onClose={onClose} title={initial ? 'Позиция' : 'Новая позиция'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Тип</label><select value={kind} onChange={e => setKind(e.target.value as any)} className="input"><option value="subscription">Подписка</option><option value="rent">Аренда</option></select></div>
          <div><label className="label text-xs">Сумма/мес</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input" /></div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4" /> Активна</label>
        <div className="flex justify-between pt-2">
          {initial ? <button onClick={() => del.mutate()} className="text-sm text-red-600 inline-flex items-center gap-1"><Trash2 size={13} /> Удалить</button> : <span />}
          <div className="flex gap-2"><button onClick={onClose} className="btn-secondary text-sm">Отмена</button><button onClick={() => save.mutate()} disabled={!name.trim()} className="btn-primary text-sm">Сохранить</button></div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Долги (матрица × 6 мес) ─────────────────────────────────────────
function DebtsSection() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['finance', 'debts-matrix'], queryFn: () => financeApi.debtsMatrix({ months: 6 }) })
  const [cell, setCell] = useState<{ row: any; ym: string } | null>(null)
  const [form, setForm] = useState<any>(null)
  const months: string[] = data?.months || []
  const rows: any[] = data?.rows || []
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] })
  const totalRemaining = rows.reduce((s, r) => s + Number(r.remaining || 0), 0)

  return (
    <div className="card overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-title">Долги <span className="text-surface-400 font-normal text-sm">· осталось {money(totalRemaining)}</span></h3>
        <button onClick={() => setForm({})} className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700"><Plus size={14} /> Долг</button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-surface-400 py-2">Нет долгов.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
            <th className="py-2 pr-3 font-medium">Долг</th><th className="py-2 px-2 font-medium text-right">Остаток</th>
            {months.map(m => <th key={m} className="py-2 px-2 font-medium text-center capitalize">{monthShort(m)}</th>)}
            <th className="py-2 pl-2 font-medium text-right"></th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-surface-50 dark:border-surface-800/60">
                <td className="py-2 pr-3">
                  <button onClick={() => setForm(r)} className="font-medium text-surface-800 dark:text-surface-200 hover:underline">{r.name}</button>
                  <div className="h-1 mt-1 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden w-28"><div className="h-full bg-amber-500" style={{ width: `${r.total > 0 ? Math.min(100, Math.round(((r.total - r.remaining) / r.total) * 100)) : 0}%` }} /></div>
                </td>
                <td className="py-2 px-2 text-right tabular-nums font-medium">{money(r.remaining)}</td>
                {months.map(ym => {
                  const cells = (r.byMonth[ym] || []) as any[]
                  return (
                    <td key={ym} className="py-1.5 px-1 text-center">
                      <button onClick={() => setCell({ row: r, ym })} className="min-w-[54px] px-1.5 py-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700/60">
                        {cells.length === 0 ? <span className="text-surface-300 dark:text-surface-600 text-lg leading-none">＋</span> : cells.map(p => (
                          <span key={p.id} className={clsx('block text-[10px] font-semibold px-1 py-0.5 rounded tabular-nums', p.status === 'received' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>{money(p.amount).replace(' сом.', '')}</span>
                        ))}
                      </button>
                    </td>
                  )
                })}
                <td className="py-2 pl-2 text-right"><span className="text-[11px] text-surface-400">всего {money(r.total).replace(' сом.', '')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cell && <DebtCellModal row={cell.row} ym={cell.ym} onClose={() => setCell(null)} onDone={refresh} />}
      {form && <DebtModal initial={form.id ? form : undefined} onClose={() => setForm(null)} onDone={() => { setForm(null); refresh() }} />}
    </div>
  )
}

function DebtCellModal({ row, ym, onClose, onDone }: { row: any; ym: string; onClose: () => void; onDone: () => void }) {
  const planned: any[] = row.byMonth[ym] || []
  const [amount, setAmount] = useState('')
  const [paid, setPaid] = useState(false)
  const [account, setAccount] = useState('alif')
  const [date, setDate] = useState(todayISO())
  const done = () => { onDone(); onClose() }
  const add = useMutation({
    mutationFn: () => paid ? financeApi.payDebt(row.id, { ym, amount: Number(amount), account, date }) : financeApi.addDebtPlan(row.id, { ym, amount: Number(amount) }),
    onSuccess: () => { toast.success(paid ? 'Погашение записано' : 'План добавлен'); done() }, onError: () => toast.error('Ошибка'),
  })
  const act = useMutation({
    mutationFn: ({ p, kind }: any) => kind === 'pay' ? financeApi.payDebtPlanned(p.id, { account, date }) : kind === 'unreceive' ? financeApi.unreceiveDebtPlanned(p.id) : financeApi.removeDebtPlanned(p.id),
    onSuccess: () => { toast.success('Готово'); done() }, onError: () => toast.error('Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title={`${row.name} — ${monthShort(ym)}`}>
      <div className="space-y-4">
        {planned.length > 0 && (
          <div className="space-y-1.5">
            {planned.map(p => (
              <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-50 dark:bg-surface-800/50">
                <span className={clsx('text-xs font-semibold px-1.5 py-0.5 rounded', p.status === 'received' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')}>{money(p.amount)}</span>
                <span className="ml-auto flex gap-1">
                  {p.status === 'expected' ? (<>
                    <button onClick={() => act.mutate({ p, kind: 'pay' })} className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1"><Check size={12} /> Оплатить</button>
                    <button onClick={() => act.mutate({ p, kind: 'remove' })} className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 size={12} /></button>
                  </>) : (
                    <button onClick={() => act.mutate({ p, kind: 'unreceive' })} className="text-xs px-2 py-1 rounded text-surface-600 hover:bg-surface-100 dark:hover:bg-surface-700 inline-flex items-center gap-1"><Undo2 size={12} /> Снять</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-surface-100 dark:border-surface-700 pt-3 space-y-3">
          <div><label className="label text-xs">Сумма</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input" placeholder="0" /></div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={paid} onChange={e => setPaid(e.target.checked)} className="w-4 h-4" /> Уже оплачено (создать расход)</label>
          {paid && <div className="grid grid-cols-2 gap-3">
            <div><label className="label text-xs">Счёт</label><select value={account} onChange={e => setAccount(e.target.value)} className="input">{ACCOUNT_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}</select></div>
            <div><label className="label text-xs">Дата</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></div>
          </div>}
          <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-secondary text-sm">Закрыть</button><button onClick={() => add.mutate()} disabled={!(Number(amount) > 0)} className="btn-primary text-sm">{paid ? 'Записать оплату' : 'Добавить план'}</button></div>
        </div>
      </div>
    </Modal>
  )
}

function DebtModal({ initial, onClose, onDone }: { initial?: any; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(initial?.name || '')
  const [counterparty, setCounterparty] = useState(initial?.counterparty || '')
  const [totalAmount, setTotalAmount] = useState(String(initial?.totalAmount ?? ''))
  const [paidBefore, setPaidBefore] = useState(String(initial?.paidBefore ?? '0'))
  const [monthlyPayment, setMonthlyPayment] = useState(String(initial?.monthlyPayment ?? ''))
  const save = useMutation({
    mutationFn: () => {
      const dto = { name, counterparty, totalAmount: Number(totalAmount) || 0, paidBefore: Number(paidBefore) || 0, monthlyPayment: monthlyPayment ? Number(monthlyPayment) : null }
      return initial ? financeApi.updateDebt(initial.id, dto) : financeApi.createDebt(dto)
    },
    onSuccess: () => { toast.success('Сохранено'); onDone() }, onError: () => toast.error('Ошибка'),
  })
  const del = useMutation({ mutationFn: () => financeApi.deleteDebt(initial.id), onSuccess: () => { toast.success('Удалено'); onDone() } })
  return (
    <Modal open onClose={onClose} title={initial ? 'Долг' : 'Новый долг'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Наименование</label><input value={name} onChange={e => setName(e.target.value)} className="input" /></div>
        <div><label className="label text-xs">Контрагент</label><input value={counterparty} onChange={e => setCounterparty(e.target.value)} className="input" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label text-xs">Сумма долга</label><input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} className="input" /></div>
          <div><label className="label text-xs">Погашено до</label><input type="number" value={paidBefore} onChange={e => setPaidBefore(e.target.value)} className="input" /></div>
          <div><label className="label text-xs">Платёж/мес</label><input type="number" value={monthlyPayment} onChange={e => setMonthlyPayment(e.target.value)} className="input" /></div>
        </div>
        <p className="text-[11px] text-surface-400">После сохранения остаток автоматически раскидается по месяцам (платёж/мес).</p>
        <div className="flex justify-between pt-2">
          {initial ? <button onClick={() => del.mutate()} className="text-sm text-red-600 inline-flex items-center gap-1"><Trash2 size={13} /> Удалить</button> : <span />}
          <div className="flex gap-2"><button onClick={onClose} className="btn-secondary text-sm">Отмена</button><button onClick={() => save.mutate()} disabled={!name.trim()} className="btn-primary text-sm">Сохранить</button></div>
        </div>
      </div>
    </Modal>
  )
}
