import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Plus, Users, Building2, Landmark, MoreHorizontal,
  Receipt, Pencil, Undo2, Check, ChevronDown, ChevronRight, Wallet2, CheckCircle2,
} from 'lucide-react'
import clsx from 'clsx'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { money, monthLabel, currentYm, todayISO, formatDate } from './financeUtils'
import { MonthNav, MonthRangeNav, Stat, Badge, ProgressBar, EmptyState, TableCard } from './financeUi'
import { CatIcon } from './financeIcons'

/* ------------------------------------------------------------------ *
 * Страница «Расход» с детализацией: Зарплата / Аренда и подписки /
 * Долги / Прочее. Дрилл-даун внутри страницы через useState(kind).
 * ------------------------------------------------------------------ */

type Kind = 'salary' | 'subscriptions' | 'debts' | 'other' | null

const KIND_LABEL: Record<string, string> = {
  salary: 'Зарплата',
  subscriptions: 'Аренда и подписки',
  debts: 'Долги',
  other: 'Прочее',
}

// ── общие мелочи стиля ──────────────────────────────────────────────
const iconBtn = 'p-1.5 rounded-md text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors disabled:opacity-40'
const chipBtn = 'inline-flex items-center gap-1 rounded-md border border-surface-200 dark:border-surface-700 px-2 py-1 text-xs hover:bg-surface-50 dark:hover:bg-surface-700 transition-colors disabled:opacity-40'
const thL = 'px-3 py-2 font-medium first:pl-4'
const thR = 'px-3 py-2 font-medium text-right'
const tdL = 'px-3 py-2 first:pl-4 align-middle'
const tdR = 'px-3 py-2 text-right align-middle tabular-nums'

const num = (s: any) => parseFloat(String(s ?? '').replace(',', '.')) || 0
const errMsg = (e: any) => e?.response?.data?.message || 'Ошибка'

function Loading() {
  return <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
}

/** Мутация раздела «Финансы»: инвалидация + тост + колбэк (закрыть модалку). */
function useFinMutation<TArgs = void>(fn: (a: TArgs) => Promise<any>, successMsg?: string, onDone?: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance'] })
      if (successMsg) toast.success(successMsg)
      onDone?.()
    },
    onError: (e: any) => toast.error(errMsg(e)),
  })
}

function useAccountsQuery() {
  return useQuery({ queryKey: ['finance', 'accounts'], queryFn: () => financeApi.accounts() as Promise<any[]> })
}

// ══════════════════════════════════════════════════════════════════
// Главная страница
// ══════════════════════════════════════════════════════════════════
export default function FinanceExpensePage() {
  const [ym, setYm] = useState(currentYm())
  const [kind, setKind] = useState<Kind>(null)
  const [debtStart, setDebtStart] = useState(currentYm())

  const label = kind ? KIND_LABEL[kind] : null

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {kind && (
            <button onClick={() => setKind(null)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500" title="Назад">
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <h1 className="page-title flex items-center gap-2">
              Расход{label && <span className="text-surface-400 font-normal">/ {label}</span>}
            </h1>
            <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">
              {kind ? 'Детализация статьи за месяц.' : 'Нажмите карточку, чтобы открыть детали'}
            </p>
          </div>
        </div>
        <MonthNav ym={ym} onChange={setYm} />
      </div>

      {kind === null && <ExpenseCards ym={ym} onOpen={setKind} />}
      {kind === 'salary' && <SalarySection ym={ym} />}
      {kind === 'subscriptions' && <SubscriptionsSection ym={ym} />}
      {kind === 'debts' && <DebtsSection ym={ym} start={debtStart} setStart={setDebtStart} />}
      {kind === 'other' && <OtherSection ym={ym} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// Список статей (kind === null)
// ══════════════════════════════════════════════════════════════════
function ExpenseCards({ ym, onOpen }: { ym: string; onOpen: (k: Kind) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-summary', ym], queryFn: () => financeApi.expenseSummary(ym) })
  if (isLoading) return <Loading />

  const s = data?.salary || {}
  const subs = data?.subscriptions || {}
  const debts = data?.debts || {}
  const other = data?.other || {}

  const cards = [
    { kind: 'salary' as Kind, label: 'Зарплата', Icon: Users, color: 'text-orange-500', value: s.spent, sub: `${s.count ?? 0} сотрудников`, hint: `к выплате ${money(s.toPay ?? 0)}` },
    { kind: 'subscriptions' as Kind, label: 'Аренда и подписки', Icon: Building2, color: 'text-red-500', value: subs.spent, sub: `${subs.count ?? 0} позиций`, hint: `${money(subs.monthly ?? 0)}/мес` },
    { kind: 'debts' as Kind, label: 'Долги', Icon: Landmark, color: 'text-amber-600', value: debts.spent, sub: `осталось ${money(debts.remaining ?? 0)}`, hint: `в этом месяце ${money(debts.dueMonth ?? 0)}` },
    { kind: 'other' as Kind, label: 'Прочее', Icon: MoreHorizontal, color: 'text-surface-500', value: other.spent, sub: 'реклама, транспорт, налоги…', hint: '' },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <button
          key={c.kind}
          onClick={() => onOpen(c.kind)}
          className="card text-left hover:border-primary-300 dark:hover:border-primary-800 transition-colors"
        >
          <span className={clsx('flex items-center gap-1.5 font-semibold', c.color)}><c.Icon size={16} /> {c.label}</span>
          <p className="text-2xl font-bold mt-2 tabular-nums text-surface-800 dark:text-surface-100">{money(c.value ?? 0)}</p>
          <p className="text-xs text-surface-400 mt-1">{c.sub}</p>
          {c.hint && <p className="text-xs text-surface-400 mt-0.5">{c.hint}</p>}
          <p className="text-xs text-primary-600 mt-2">Открыть →</p>
        </button>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// Зарплата
// ══════════════════════════════════════════════════════════════════
function SalarySection({ ym }: { ym: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-detail', 'salary', ym], queryFn: () => financeApi.expenseDetail('salary', ym) })
  const { data: employees = [] } = useQuery({ queryKey: ['finance', 'employees'], queryFn: () => financeApi.employees() as Promise<any[]> })
  const [empModal, setEmpModal] = useState<any>(null)   // employee | 'new' | null
  const [payFor, setPayFor] = useState<any>(null)
  const [showFired, setShowFired] = useState(false)

  const empById = useMemo(() => new Map(employees.map((e: any) => [e.id, e])), [employees])

  const undo = useFinMutation(async (employeeId: string) => {
    const res = await financeApi.transactions({ from: `${ym}-01`, to: `${ym}-31`, type: 'expense' })
    const targets = (res?.items ?? []).filter((t: any) => t.employeeId === employeeId && t.group === 'salary')
    for (const t of targets) await financeApi.removeTransaction(t.id)
  }, 'Выплата отменена')

  if (isLoading) return <Loading />

  const cards = data?.cards || {}
  const rows: any[] = data?.rows ?? []
  const fired: any[] = data?.fired ?? []

  const editEmployee = (id: string, fallback: any) => setEmpModal(empById.get(id) ?? fallback)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Фонд ЗП / мес" value={money(cards.fund ?? 0)} />
        <Stat label="Авансы (выдано)" value={money(cards.advances ?? 0)} />
        <Stat label="Выплачено за месяц" value={money(cards.paid ?? 0)} tone="pos" />
        <Stat label="К выплате за месяц" value={money(cards.toPay ?? 0)} tone="neg" sub="фонд − авансы − выплачено" />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-100 dark:bg-surface-700/60 px-2.5 py-1 text-xs text-surface-600 dark:text-surface-300">
          <Receipt size={14} /> Выплата ЗП — каждое 10-е число месяца
        </span>
        <button onClick={() => setEmpModal('new')} className="btn-primary text-sm inline-flex items-center gap-1.5">
          <Plus size={16} /> Сотрудник
        </button>
      </div>

      <TableCard scroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
              <th className={thL}>ФИО</th>
              <th className={thL}>Должность</th>
              <th className={thL}>Дата приёма</th>
              <th className={thR}>ЗП</th>
              <th className={thR}>Аванс</th>
              <th className={thL}>Статус</th>
              <th className="px-3 py-2 w-12" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isPaid = r.salary > 0 && (r.paid ?? 0) >= r.salary
              return (
                <tr key={r.id} onDoubleClick={() => editEmployee(r.id, r)} className="border-b border-surface-50 dark:border-surface-800/60 hover:bg-surface-50/60 dark:hover:bg-surface-800/30">
                  <td className={tdL}><span className="font-medium text-surface-800 dark:text-surface-200">{r.name}</span></td>
                  <td className={clsx(tdL, 'text-surface-500')}>{r.role || '—'}</td>
                  <td className={clsx(tdL, 'text-surface-500 whitespace-nowrap')}>{r.hireDate ? formatDate(r.hireDate) : '—'}</td>
                  <td className={tdR}>{money(r.salary)}</td>
                  <td className={clsx(tdR, 'text-surface-500')}>{r.advance ? money(r.advance) : '—'}</td>
                  <td className={tdL}>
                    {isPaid ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Badge tone="ok" check>выплачено</Badge>
                        <button className={iconBtn} title="Отменить выплату" disabled={undo.isPending} onClick={() => undo.mutate(r.id)}><Undo2 size={15} /></button>
                      </span>
                    ) : (
                      <button className="btn-primary text-xs" onClick={() => setPayFor(r)}>Выплатить</button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className={iconBtn} title="Редактировать" onClick={() => editEmployee(r.id, r)}><Pencil size={15} /></button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-surface-400">Нет активных сотрудников</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-surface-100 dark:border-surface-700 font-semibold">
              <td className="px-4 py-2" colSpan={3}>Итого</td>
              <td className={tdR}>{money(cards.fund ?? 0)}</td>
              <td className={tdR}>{money(cards.advances ?? 0)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </TableCard>

      {fired.length > 0 && (
        <div>
          <button onClick={() => setShowFired(v => !v)} className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
            {showFired ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Ушедшие сотрудники ({fired.length})
          </button>
          {showFired && (
            <TableCard className="mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                    <th className={thL}>ФИО</th>
                    <th className={thL}>Должность</th>
                    <th className={thR}>ЗП</th>
                    <th className="px-3 py-2 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {fired.map(f => (
                    <tr key={f.id} onDoubleClick={() => editEmployee(f.id, { ...f, status: 'fired' })} className="border-b border-surface-50 dark:border-surface-800/60 opacity-70">
                      <td className={tdL}><span className="font-medium text-surface-800 dark:text-surface-200">{f.name}</span></td>
                      <td className={clsx(tdL, 'text-surface-500')}>{f.role || '—'}</td>
                      <td className={clsx(tdR, 'text-surface-500')}>{money(f.salary)}</td>
                      <td className="px-3 py-2 text-right">
                        <button className={iconBtn} title="Редактировать" onClick={() => editEmployee(f.id, { ...f, status: 'fired' })}><Pencil size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
        </div>
      )}

      {empModal && <EmployeeFormModal employee={empModal === 'new' ? undefined : empModal} onClose={() => setEmpModal(null)} />}
      {payFor && <SalaryPayModal employee={payFor} ym={ym} alreadyPaid={payFor.paid ?? 0} onClose={() => setPayFor(null)} />}
    </div>
  )
}

function EmployeeFormModal({ employee, onClose }: { employee?: any; onClose: () => void }) {
  const [name, setName] = useState(employee?.name ?? '')
  const [role, setRole] = useState(employee?.role ?? '')
  const [hireDate, setHireDate] = useState(employee?.hireDate ?? '')
  const [salary, setSalary] = useState(employee ? String(employee.salary ?? '') : '')
  const [advance, setAdvance] = useState(employee ? String(employee.advance ?? '') : '')
  const [status, setStatus] = useState<string>(employee?.status ?? 'active')

  const save = useFinMutation(() => {
    const p = { name: name.trim(), role: role.trim() || undefined, hireDate: hireDate || undefined, salary: num(salary), advance: num(advance), status }
    return employee?.id ? financeApi.updateEmployee(employee.id, p) : financeApi.createEmployee(p)
  }, employee?.id ? 'Сохранено' : 'Сотрудник добавлен', onClose)

  const del = useFinMutation(() => financeApi.removeEmployee(employee.id), 'Сотрудник удалён', onClose)

  return (
    <Modal open onClose={onClose} title={employee?.id ? 'Сотрудник' : 'Новый сотрудник'}>
      <div className="space-y-3">
        <div>
          <label className="label">ФИО</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Должность</label><input value={role} onChange={e => setRole(e.target.value)} className="input" /></div>
          <div><label className="label">Дата приёма</label><input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">ЗП / мес</label><input inputMode="decimal" value={salary} onChange={e => setSalary(e.target.value)} className="input" /></div>
          <div><label className="label">Аванс</label><input inputMode="decimal" value={advance} onChange={e => setAdvance(e.target.value)} className="input" /></div>
        </div>
        <div>
          <label className="label">Статус</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="input">
            <option value="active">Работает</option>
            <option value="fired">Ушёл</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-5">
        {employee?.id && (
          <button
            className="btn btn-danger mr-auto"
            disabled={del.isPending}
            onClick={() => { if (window.confirm('Удалить сотрудника? История выплат сохранится в транзакциях.')) del.mutate() }}
          >Удалить</button>
        )}
        <button className="btn-secondary ml-auto" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
          {employee?.id ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </Modal>
  )
}

function SalaryPayModal({ employee, ym, alreadyPaid, onClose }: { employee: any; ym: string; alreadyPaid: number; onClose: () => void }) {
  const { data: accounts = [] } = useAccountsQuery()
  const remaining = Math.max(0, (employee.salary ?? 0) - alreadyPaid)
  const [amount, setAmount] = useState(String(remaining || employee.salary || ''))
  const [date, setDate] = useState(`${ym}-10`)
  const [accountId, setAccountId] = useState('')
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id) }, [accounts, accountId])

  const amt = num(amount)
  const pay = useFinMutation(
    () => financeApi.createOperation({ type: 'expense', amount: amt, date, accountId, employeeId: employee.id }),
    'Зарплата выплачена', onClose,
  )

  return (
    <Modal open onClose={onClose} title={`Выплата ЗП · ${employee.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="input" /></div>
          <div><label className="label">Дата выплаты</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></div>
        </div>
        <div>
          <label className="label">Со счёта</label>
          <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input">
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-surface-400">По умолчанию — 10-е число месяца. Остаток к выплате: {money(remaining)}.</p>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button className="btn-secondary" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!(amt > 0) || !accountId || pay.isPending} onClick={() => pay.mutate()}>Выплатить</button>
      </div>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════
// Аренда и подписки
// ══════════════════════════════════════════════════════════════════
function SubscriptionsSection({ ym }: { ym: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-detail', 'subscriptions', ym], queryFn: () => financeApi.expenseDetail('subscriptions', ym) })
  const { data: accounts = [] } = useAccountsQuery()
  const [subModal, setSubModal] = useState<any>(null)  // sub | 'new' | null

  const pay = useFinMutation(
    (s: any) => financeApi.createOperation({ type: 'expense', amount: s.amount, date: todayISO(), accountId: accounts[0]?.id, subscriptionId: s.id }),
    'Оплачено',
  )
  const undo = useFinMutation(async (subscriptionId: string) => {
    const res = await financeApi.transactions({ from: `${ym}-01`, to: `${ym}-31`, type: 'expense' })
    const targets = (res?.items ?? []).filter((t: any) => t.subscriptionId === subscriptionId)
    for (const t of targets) await financeApi.removeTransaction(t.id)
  }, 'Оплата отменена')

  if (isLoading) return <Loading />

  const rows: any[] = data?.rows ?? []
  const monthly = data?.monthly ?? 0
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Аренда + подписки / мес" value={money(monthly)} />
      </div>

      <div className="flex justify-end">
        <button onClick={() => setSubModal('new')} className="btn-primary text-sm inline-flex items-center gap-1.5">
          <Plus size={16} /> Добавить расход
        </button>
      </div>

      <TableCard scroll>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
              <th className={thL}>Позиция</th>
              <th className={thL}>Тип</th>
              <th className={thR}>Сумма/мес</th>
              <th className={thL}>Статус месяца</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isPaid = (r.paidMonth ?? 0) >= r.amount
              return (
                <tr key={r.id} onDoubleClick={() => setSubModal(r)} className={clsx('border-b border-surface-50 dark:border-surface-800/60 hover:bg-surface-50/60 dark:hover:bg-surface-800/30', !r.active && 'opacity-50')}>
                  <td className={tdL}><span className="font-medium text-surface-800 dark:text-surface-200">{r.name}</span></td>
                  <td className={clsx(tdL, 'text-surface-500')}>{r.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
                  <td className={tdR}>{money(r.amount)}</td>
                  <td className={tdL}>
                    {isPaid ? (
                      <span className="inline-flex items-center gap-2">
                        <Badge tone="ok" check>оплачено</Badge>
                        {r.lastPaidDate && <span className="text-xs text-surface-400">{formatDate(r.lastPaidDate)}</span>}
                      </span>
                    ) : (
                      <Badge tone="wait">не оплачено</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      {isPaid ? (
                        <button className={iconBtn} title="Отменить оплату" disabled={undo.isPending} onClick={() => undo.mutate(r.id)}><Undo2 size={15} /></button>
                      ) : (
                        <button className={chipBtn} disabled={!accounts.length || pay.isPending} onClick={() => pay.mutate(r)}><Check size={13} /> оплатить</button>
                      )}
                      <button className={iconBtn} title="Редактировать" onClick={() => setSubModal(r)}><Pencil size={15} /></button>
                    </span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-surface-400">Нет позиций. Нажмите «＋ Добавить расход».</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t border-surface-100 dark:border-surface-700 font-semibold">
              <td className="px-4 py-2" colSpan={2}>Итого</td>
              <td className={tdR}>{money(total)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </TableCard>

      {subModal && <SubFormModal sub={subModal === 'new' ? undefined : subModal} onClose={() => setSubModal(null)} />}
    </div>
  )
}

function SubFormModal({ sub, onClose }: { sub?: any; onClose: () => void }) {
  const [name, setName] = useState(sub?.name ?? '')
  const [kind, setKind] = useState<string>(sub?.kind ?? 'subscription')
  const [amount, setAmount] = useState(sub ? String(sub.amount ?? '') : '')

  const save = useFinMutation(() => {
    const p = { name: name.trim(), kind, amount: num(amount), active: sub?.active ?? true }
    return sub?.id ? financeApi.updateSubscription(sub.id, p) : financeApi.createSubscription(p)
  }, sub?.id ? 'Сохранено' : 'Добавлено', onClose)

  const del = useFinMutation(() => financeApi.removeSubscription(sub.id), 'Удалено', onClose)

  return (
    <Modal open onClose={onClose} title={sub?.id ? 'Расход' : 'Новый расход'}>
      <div className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Аренда, Adobe, Server…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Тип</label>
            <select value={kind} onChange={e => setKind(e.target.value)} className="input">
              <option value="rent">Аренда</option>
              <option value="subscription">Подписка</option>
            </select>
          </div>
          <div><label className="label">Сумма / мес</label><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="input" /></div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-5">
        {sub?.id && (
          <button className="btn btn-danger mr-auto" disabled={del.isPending} onClick={() => { if (window.confirm('Удалить позицию?')) del.mutate() }}>Удалить</button>
        )}
        <button className="btn-secondary ml-auto" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{sub?.id ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════
// Долги
// ══════════════════════════════════════════════════════════════════
function DebtsSection({ ym, start, setStart }: { ym: string; start: string; setStart: (v: string) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-detail', 'debts', ym, start], queryFn: () => financeApi.expenseDetail('debts', ym, start) })
  const { data: debtsList = [] } = useQuery({ queryKey: ['finance', 'debts'], queryFn: () => financeApi.debts() as Promise<any[]> })
  const [cellFor, setCellFor] = useState<any>(null)  // { debt, ym, plan? }
  const [debtModal, setDebtModal] = useState<any>(null)  // debt | 'new' | null

  const debtById = useMemo(() => new Map(debtsList.map((d: any) => [d.id, d])), [debtsList])
  const openDebt = (debt: any) => setDebtModal(debtById.get(debt.id) ?? debt)

  const stats = data?.stats || {}
  const totals = data?.totals || { total: 0, perMonth: [] }
  const months: string[] = data?.months ?? []
  const rows: any[] = data?.rows ?? []
  const perMonth: any[] = totals.perMonth ?? []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Всего должны" value={money(stats.totalDebt ?? 0)} tone="neg" sub={`из ${money(totals.total ?? 0)}`} />
        <Stat label="Должны за месяц" value={money(stats.dueMonth ?? 0)} sub={monthLabel(ym)} />
        <Stat label="Долгов" value={stats.count ?? 0} />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <MonthRangeNav start={start} onChange={setStart} />
        <button onClick={() => setDebtModal('new')} className="btn-primary text-sm inline-flex items-center gap-1.5">
          <Plus size={16} /> Долг
        </button>
      </div>

      {isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card"><EmptyState icon={<CheckCircle2 size={30} />}>Долгов нет — нажмите «＋ Долг»</EmptyState></div>
      ) : (
        <TableCard scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className={clsx(thL, 'min-w-[180px]')}>Наименование</th>
                <th className={thR}>Сумма</th>
                {months.map(m => <th key={m} className={clsx(thR, 'whitespace-nowrap')}>{monthLabel(m)}</th>)}
                <th className="px-3 py-2 w-12" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.debt.id} onDoubleClick={() => openDebt(r.debt)} className="border-b border-surface-50 dark:border-surface-800/60 hover:bg-surface-50/60 dark:hover:bg-surface-800/30">
                  <td className={clsx(tdL, 'min-w-[180px] align-top')}>
                    <div className="font-medium text-surface-800 dark:text-surface-200">{r.debt.name}</div>
                    <div className="mt-1.5"><ProgressBar pct={r.progress ?? 0} color="#d97706" /></div>
                    <div className="text-xs text-surface-400 mt-1">осталось {money(r.remaining ?? 0)} из {money(r.debt.totalAmount ?? 0)}</div>
                  </td>
                  <td className={clsx(tdR, 'align-top')}>{money(r.debt.totalAmount ?? 0)}</td>
                  {months.map((m, i) => {
                    const cell = r.cells?.[i]
                    const plans: any[] = cell?.plans ?? []
                    return (
                      <td key={m} className={clsx(tdR, 'align-top')}>
                        {plans.length === 0 ? (
                          <button className={iconBtn} title="Добавить платёж" onClick={() => setCellFor({ debt: r.debt, ym: m })}><Plus size={14} /></button>
                        ) : (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {plans.map(p => (
                              <Badge
                                key={p.id}
                                tone={p.status === 'received' ? 'ok' : 'wait'}
                                check={p.status === 'received'}
                                onClick={() => setCellFor({ debt: r.debt, ym: m, plan: p })}
                                title={p.status === 'received' ? 'Оплачено — нажмите для управления' : 'Запланировано — нажмите, чтобы погасить'}
                              >{money(p.amount)}</Badge>
                            ))}
                          </div>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right align-top">
                    <button className={iconBtn} title="Редактировать" onClick={() => openDebt(r.debt)}><Pencil size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-surface-100 dark:border-surface-700 font-semibold">
                <td className="px-4 py-2">Итого</td>
                <td className={tdR}>{money(totals.total ?? 0)}</td>
                {months.map((m, i) => <td key={m} className={tdR}>{money(perMonth[i]?.total ?? 0)}</td>)}
                <td />
              </tr>
            </tfoot>
          </table>
        </TableCard>
      )}

      {cellFor && <DebtCellModal debt={cellFor.debt} ym={cellFor.ym} plan={cellFor.plan} onClose={() => setCellFor(null)} />}
      {debtModal && <DebtFormModal debt={debtModal === 'new' ? undefined : debtModal} onClose={() => setDebtModal(null)} />}
    </div>
  )
}

function DebtCellModal({ debt, ym, plan, onClose }: { debt: any; ym: string; plan?: any; onClose: () => void }) {
  const { data: accounts = [] } = useAccountsQuery()
  const { data: plansData } = useQuery({ queryKey: ['finance', 'planned-payments'], queryFn: () => financeApi.plannedPayments(), enabled: !plan })

  const [amount, setAmount] = useState(String(plan?.amount ?? debt.monthlyPayment ?? ''))
  const [paidNow, setPaidNow] = useState(false)
  const [date, setDate] = useState(todayISO())
  const [accountId, setAccountId] = useState('')
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id) }, [accounts, accountId])

  const amt = num(amount)
  const allPlans: any[] = Array.isArray(plansData) ? plansData : (plansData?.items ?? [])
  const scheduled = allPlans.filter((p: any) => p.debtId === debt.id).reduce((s: number, p: any) => s + (p.amount ?? 0), 0)
  const remaining = (debt.totalAmount ?? 0) - scheduled
  const overLimit = (debt.totalAmount ?? 0) > 0 && amt > remaining

  const createNew = useFinMutation(async () => {
    if (paidNow) return financeApi.payNow({ debtId: debt.id, ym, amount: amt, accountId, date })
    return financeApi.createPlanned({ debtId: debt.id, ym, amount: amt })
  }, paidNow ? 'Оплата записана' : 'План добавлен', onClose)

  const markPaid = useFinMutation(() => financeApi.receivePlanned(plan.id, { accountId, date }), 'Отмечено оплаченным', onClose)
  const deletePlan = useFinMutation(() => financeApi.removePlanned(plan.id), 'План удалён', onClose)
  const undo = useFinMutation(() => financeApi.unreceivePlanned(plan.id), 'Оплата отменена', onClose)

  return (
    <Modal open onClose={onClose} title={`${debt.name} · ${monthLabel(ym)}`}>
      {plan ? (
        <>
          {plan.status === 'received' ? (
            <p className="text-sm text-surface-600 dark:text-surface-300">Платёж <b>{money(plan.amount)}</b> отмечен как оплаченный.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-surface-600 dark:text-surface-300">Запланировано <b>{money(plan.amount)}</b>. Отметить оплаченным?</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Дата оплаты</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></div>
                <div>
                  <label className="label">Со счёта</label>
                  <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input">
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 mt-5">
            {plan.status === 'received' ? (
              <button className="btn btn-danger mr-auto" disabled={undo.isPending} onClick={() => undo.mutate()}>Отменить оплату</button>
            ) : (
              <button className="btn btn-danger mr-auto" disabled={deletePlan.isPending} onClick={() => deletePlan.mutate()}>Удалить план</button>
            )}
            <button className="btn-secondary ml-auto" onClick={onClose}>Закрыть</button>
            {plan.status === 'expected' && (
              <button className="btn-primary" disabled={!accountId || markPaid.isPending} onClick={() => markPaid.mutate()}>Отметить оплаченным</button>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-3">
            <div><label className="label">Сумма, сомони</label><input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="input" /></div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={paidNow} onChange={e => setPaidNow(e.target.checked)} />
              Уже оплачено (создать расход)
            </label>
            {paidNow && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Дата оплаты</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></div>
                <div>
                  <label className="label">Со счёта</label>
                  <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input">
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              </div>
            )}
            {overLimit ? (
              <p className="text-xs text-red-600 dark:text-red-400">Больше остатка по долгу. Доступно ещё {money(Math.max(0, remaining))} из {money(debt.totalAmount ?? 0)}.</p>
            ) : (
              <p className="text-xs text-surface-400">Без галочки — план на {monthLabel(ym)}. Остаток по долгу: {money(Math.max(0, remaining))}.</p>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-secondary" onClick={onClose}>Отмена</button>
            <button
              className="btn-primary"
              disabled={!(amt > 0) || overLimit || (paidNow && !accountId) || createNew.isPending}
              onClick={() => createNew.mutate()}
            >{paidNow ? 'Записать оплату' : 'Добавить план'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

function DebtFormModal({ debt, onClose }: { debt?: any; onClose: () => void }) {
  const [name, setName] = useState(debt?.name ?? '')
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? '')
  const [monthlyPayment, setMonthlyPayment] = useState(debt?.monthlyPayment ? String(debt.monthlyPayment) : '')
  const [totalAmount, setTotalAmount] = useState(debt ? String(debt.totalAmount ?? '') : '')
  const [paidBefore, setPaidBefore] = useState(String(debt?.paidBefore ?? 0))

  const save = useFinMutation(() => {
    const p = { name: name.trim(), counterparty: counterparty.trim() || undefined, monthlyPayment: num(monthlyPayment) || undefined, totalAmount: num(totalAmount), paidBefore: num(paidBefore) }
    return debt?.id ? financeApi.updateDebt(debt.id, p) : financeApi.createDebt(p)
  }, debt?.id ? 'Сохранено' : 'Долг добавлен', onClose)

  const del = useFinMutation(() => financeApi.removeDebt(debt.id), 'Долг удалён', onClose)

  return (
    <Modal open onClose={onClose} title={debt?.id ? 'Долг' : 'Новый долг'}>
      <div className="space-y-3">
        <div>
          <label className="label">Наименование</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Камера в рассрочку…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Контрагент</label><input value={counterparty} onChange={e => setCounterparty(e.target.value)} className="input" /></div>
          <div><label className="label">Платёж / мес</label><input inputMode="decimal" value={monthlyPayment} onChange={e => setMonthlyPayment(e.target.value)} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Сумма долга</label><input inputMode="decimal" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} className="input" /></div>
          <div><label className="label">Погашено до старта</label><input inputMode="decimal" value={paidBefore} onChange={e => setPaidBefore(e.target.value)} className="input" /></div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-5">
        {debt?.id && (
          <button className="btn btn-danger mr-auto" disabled={del.isPending} onClick={() => { if (window.confirm('Удалить долг? График погашения тоже удалится.')) del.mutate() }}>Удалить</button>
        )}
        <button className="btn-secondary ml-auto" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{debt?.id ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════
// Прочее
// ══════════════════════════════════════════════════════════════════
function OtherSection({ ym }: { ym: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['finance', 'expense-detail', 'other', ym], queryFn: () => financeApi.expenseDetail('other', ym) })
  if (isLoading) return <Loading />

  const rows: any[] = data?.rows ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="Прочие расходы за месяц" value={money(total)} tone="neg" />
      </div>

      {rows.length === 0 ? (
        <div className="card"><EmptyState icon={<Wallet2 size={30} />}>Нет прочих расходов за месяц</EmptyState></div>
      ) : (
        <TableCard scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className={thL}>Категория</th>
                <th className={thR}>Сумма</th>
                <th className={clsx(thL, 'w-52')}>Доля</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.categoryId ?? r.name} className="border-b border-surface-50 dark:border-surface-800/60">
                  <td className={tdL}>
                    <span className="inline-flex items-center gap-2 font-medium text-surface-800 dark:text-surface-200">
                      <span style={{ color: r.color }} className="inline-flex"><CatIcon name={r.icon} size={16} /></span>
                      {r.name}
                    </span>
                  </td>
                  <td className={tdR}>{money(r.total)}</td>
                  <td className={clsx(tdL, 'w-52')}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1"><ProgressBar pct={r.share ?? 0} color={r.color} /></div>
                      <span className="text-xs text-surface-400 tabular-nums w-9 text-right">{r.share ?? 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-surface-100 dark:border-surface-700 font-semibold">
                <td className="px-4 py-2">Итого</td>
                <td className={tdR}>{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </TableCard>
      )}

      <p className="text-xs text-surface-400">Сюда попадают расходы с категориями вне ЗП / Аренда+Подписки / Долги. Заводи такие операции на странице «Транзакции».</p>
    </div>
  )
}
