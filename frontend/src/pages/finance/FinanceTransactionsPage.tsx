import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { Plus, Pencil, Trash2, Wallet2, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  money, formatDate, currentYm, todayISO,
  TYPE_LABEL, TYPE_COLOR, TYPE_SIGN,
} from './financeUtils'
import { MonthNav, Badge, EmptyState, SectionTitle, TableCard } from './financeUi'
import { CatIcon } from './financeIcons'
import OperationModal from './OperationModal'

type TxType = 'income' | 'expense' | 'transfer' | 'saving'

const PAGE_SIZE = 100

const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Все' },
  { key: 'income', label: 'Доход' },
  { key: 'expense', label: 'Расход' },
  { key: 'transfer', label: 'Перевод' },
  { key: 'saving', label: 'Накопление' },
]

const TYPE_TONE: Record<string, 'ok' | 'wait' | 'transfer' | 'neutral' | 'danger'> = {
  income: 'ok', expense: 'danger', transfer: 'transfer', saving: 'neutral',
}

const OP_TABS: { key: TxType; label: string; active: string }[] = [
  { key: 'income', label: 'Доход', active: 'bg-green-600 text-white' },
  { key: 'expense', label: 'Расход', active: 'bg-red-600 text-white' },
  { key: 'transfer', label: 'Перевод', active: 'bg-blue-600 text-white' },
  { key: 'saving', label: 'Накопление', active: 'bg-purple-600 text-white' },
]

export default function FinanceTransactionsPage() {
  const qc = useQueryClient()

  // Фильтры
  const [type, setType] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [ym, setYm] = useState(currentYm())
  const [allTime, setAllTime] = useState(false)
  const [page, setPage] = useState(1)

  // Модалки
  const [showAdd, setShowAdd] = useState(false)
  const [edit, setEdit] = useState<any | null>(null)

  // Дебаунс поиска
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Сброс страницы при смене фильтров
  useEffect(() => { setPage(1) }, [type, search, ym, allTime])

  const from = allTime ? undefined : `${ym}-01`
  // Реальный последний день месяца — иначе `${ym}-31` даёт невалидную дату (напр. 2026-02-31) и 500 на бэкенде.
  const to = allTime ? undefined : (() => {
    const [yy, mm] = ym.split('-').map(Number)
    return `${ym}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`
  })()
  const filters = { type: type || undefined, search: search || undefined, from, to, page }

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'transactions', filters],
    queryFn: () => financeApi.transactions({ ...filters, pageSize: PAGE_SIZE }),
  })

  const items: any[] = data?.items ?? []
  const total: number = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const del = useMutation({
    mutationFn: (id: string) => financeApi.removeTransaction(id),
    onSuccess: () => { toast.success('Операция удалена'); qc.invalidateQueries({ queryKey: ['finance'] }) },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Транзакции</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Журнал всех операций</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary text-sm inline-flex items-center gap-1.5">
          <Plus size={15} /> Операция
        </button>
      </div>

      {/* Панель фильтров */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Сегментированный фильтр по типу */}
        <div className="inline-flex rounded-lg border border-surface-200 dark:border-surface-700 p-0.5">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setType(f.key)}
              className={clsx(
                'px-2.5 py-1 rounded-md text-sm font-medium transition-colors',
                type === f.key
                  ? 'bg-primary-600 text-white'
                  : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Поиск по комментарию / категории…"
          className="input max-w-xs"
        />

        {/* Период */}
        {!allTime && <MonthNav ym={ym} onChange={setYm} />}
        <button
          onClick={() => setAllTime(v => !v)}
          className={clsx(
            'text-sm px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 transition-colors',
            allTime
              ? 'border-primary-300 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-primary-600'
              : 'border-surface-200 dark:border-surface-700 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700',
          )}
          title={allTime ? 'Фильтровать по месяцу' : 'Показать за всё время'}
        >
          <CalendarDays size={15} /> {allTime ? 'За всё время' : 'По месяцам'}
        </button>

        <div className="ml-auto">
          <SectionTitle>Всего: {total}</SectionTitle>
        </div>
      </div>

      {/* Таблица */}
      {isLoading ? (
        <p className="text-sm text-surface-400 animate-pulse py-10 text-center">Загрузка…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Wallet2 size={28} />}>Нет операций</EmptyState>
        </div>
      ) : (
        <TableCard scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className="py-2.5 px-3 font-medium">Дата</th>
                <th className="py-2.5 px-3 font-medium">Тип</th>
                <th className="py-2.5 px-3 font-medium">Категория / проект</th>
                <th className="py-2.5 px-3 font-medium">Счёт</th>
                <th className="py-2.5 px-3 font-medium">Привязка</th>
                <th className="py-2.5 px-3 font-medium text-right">Сумма</th>
                <th className="py-2.5 px-3 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => {
                const bind = [t.projectName, t.employeeName, t.debtName, t.comment].filter(Boolean).join(' · ')
                const catLabel = t.categoryName || t.projectName || (t.type === 'transfer' ? 'Перевод' : '—')
                const account = t.type === 'transfer'
                  ? `${t.fromAccountName || '—'} → ${t.toAccountName || '—'}`
                  : (t.accountName || '—')
                return (
                  <tr
                    key={t.id}
                    onDoubleClick={() => setEdit(t)}
                    className="border-b border-surface-50 dark:border-surface-800/60 hover:bg-surface-50 dark:hover:bg-surface-800/40 group"
                  >
                    <td className="py-2 px-3 tabular-nums text-surface-500 whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="py-2 px-3">
                      <Badge tone={TYPE_TONE[t.type] || 'neutral'}>{TYPE_LABEL[t.type] || t.type}</Badge>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2 text-surface-800 dark:text-surface-200">
                        <span style={{ color: t.categoryColor || undefined }} className="inline-flex shrink-0">
                          <CatIcon name={t.categoryIcon} size={16} />
                        </span>
                        <span className="truncate max-w-[200px]">{catLabel}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-surface-500 whitespace-nowrap">{account}</td>
                    <td className="py-2 px-3 text-surface-400 text-xs">
                      <span className="truncate block max-w-[260px]">{bind || '—'}</span>
                    </td>
                    <td className={clsx('py-2 px-3 text-right tabular-nums font-semibold whitespace-nowrap', TYPE_COLOR[t.type])}>
                      {TYPE_SIGN[t.type]}{money(t.amount)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEdit(t)} title="Изменить"
                          className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { if (confirm('Удалить операцию?')) del.mutate(t.id) }} title="Удалить"
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableCard>
      )}

      {/* Пагинация */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="tabular-nums text-surface-500">Стр. {page} из {pageCount}</span>
          <button
            onClick={() => setPage(p => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount}
            className="p-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Добавление операции */}
      <OperationModal open={showAdd} onClose={() => setShowAdd(false)} defaultTab="expense" />

      {/* Редактирование операции */}
      {edit && <EditTxModal tx={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

/* ── Модалка редактирования операции ─────────────────────────── */
function EditTxModal({ tx, onClose }: { tx: any; onClose: () => void }) {
  const qc = useQueryClient()

  const [type, setType] = useState<TxType>(tx.type)
  const [amount, setAmount] = useState(String(tx.amount ?? ''))
  const [date, setDate] = useState(tx.date || todayISO())
  const [categoryId, setCategoryId] = useState(tx.categoryId || '')
  const [accountId, setAccountId] = useState(tx.accountId || '')
  const [fromAccountId, setFromAccountId] = useState(tx.fromAccountId || '')
  const [toAccountId, setToAccountId] = useState(tx.toAccountId || '')
  const [projectId, setProjectId] = useState(tx.projectId || '')
  const [employeeId, setEmployeeId] = useState(tx.employeeId || '')
  const [debtId, setDebtId] = useState(tx.debtId || '')
  const [comment, setComment] = useState(tx.comment || '')

  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts })
  const { data: categories = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories })
  const { data: projects = [] } = useQuery({ queryKey: ['finance', 'projects'], queryFn: financeApi.projects })
  const { data: employees = [] } = useQuery({ queryKey: ['finance', 'employees'], queryFn: financeApi.employees })
  const { data: debts = [] } = useQuery({ queryKey: ['finance', 'debts'], queryFn: financeApi.debts })

  const catsOfType = (categories as any[]).filter(c => c.type === type)

  const save = useMutation({
    mutationFn: () => {
      const base: any = { type, amount: Number(amount), date, comment: comment || null }
      if (type === 'transfer') {
        Object.assign(base, {
          fromAccountId: fromAccountId || null, toAccountId: toAccountId || null,
          accountId: null, categoryId: null, projectId: null, employeeId: null, debtId: null,
        })
      } else {
        Object.assign(base, {
          accountId: accountId || null,
          categoryId: categoryId || null,
          fromAccountId: null, toAccountId: null,
          projectId: type === 'income' ? (projectId || null) : null,
          employeeId: type === 'expense' ? (employeeId || null) : null,
          debtId: type === 'expense' ? (debtId || null) : null,
        })
      }
      return financeApi.updateTransaction(tx.id, base)
    },
    onSuccess: () => {
      toast.success('Изменения сохранены')
      qc.invalidateQueries({ queryKey: ['finance'] })
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const canSave = Number(amount) > 0 && (
    type === 'transfer'
      ? (!!fromAccountId && !!toAccountId && fromAccountId !== toAccountId)
      : !!accountId
  )

  return (
    <Modal open onClose={onClose} title="Изменить операцию">
      <div className="space-y-4">
        {/* Тип */}
        <div className="grid grid-cols-4 gap-2">
          {OP_TABS.map(tb => (
            <button
              key={tb.key}
              onClick={() => { setType(tb.key); setCategoryId('') }}
              className={clsx('px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                type === tb.key ? tb.active : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600')}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label text-xs">Сумма, сомони</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input" placeholder="0" autoFocus />
          </div>
          <div>
            <label className="label text-xs">Дата</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" />
          </div>
        </div>

        {type === 'transfer' ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Со счёта</label>
              <select value={fromAccountId} onChange={e => setFromAccountId(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {(accounts as any[]).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">На счёт</label>
              <select value={toAccountId} onChange={e => setToAccountId(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {(accounts as any[]).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="label text-xs">Категория</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {catsOfType.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label text-xs">{type === 'expense' ? 'Списать со счёта' : 'Зачислить на счёт'}</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {(accounts as any[]).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            {type === 'income' && (
              <div>
                <label className="label text-xs">Проект / клиент (необязательно)</label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input">
                  <option value="">— не привязан —</option>
                  {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {type === 'expense' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">Сотрудник</label>
                  <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="input">
                    <option value="">— не привязан —</option>
                    {(employees as any[]).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label text-xs">Долг</label>
                  <select value={debtId} onChange={e => setDebtId(e.target.value)} className="input">
                    <option value="">— не привязан —</option>
                    {(debts as any[]).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </>
        )}

        <div>
          <label className="label text-xs">Комментарий</label>
          <input value={comment} onChange={e => setComment(e.target.value)} className="input" placeholder="Например: половина суммы контракта" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={() => save.mutate()} disabled={!canSave || save.isPending} className="btn-primary text-sm">
            {save.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
