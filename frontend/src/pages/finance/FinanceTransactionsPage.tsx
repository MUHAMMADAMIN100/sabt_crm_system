import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Plus, Pencil, Trash2, Wallet2, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { currentYm, monthEndISO } from './financeUtils'
import { MonthNav, EmptyState, SectionTitle, TableCard } from './financeUi'
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

const TYPE_OPTIONS: { key: TxType; label: string }[] = [
  { key: 'income', label: 'Доход' },
  { key: 'expense', label: 'Расход' },
  { key: 'transfer', label: 'Перевод' },
  { key: 'saving', label: 'Накопление' },
]

// Цветной «бейдж» для <select> типа прямо в строке.
const TYPE_SELECT_CLS: Record<string, string> = {
  income: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  expense: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  transfer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  saving: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
}

// Быстрые кнопки добавления.
const QUICK_ADD: { key: TxType; label: string; cls: string }[] = [
  { key: 'income', label: 'Доход', cls: 'bg-green-600 hover:bg-green-700 text-white' },
  { key: 'expense', label: 'Расход', cls: 'bg-red-600 hover:bg-red-700 text-white' },
  { key: 'transfer', label: 'Перевод', cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
]

// Класс ячейки-контрола (совпадает с CellInput из financeUi).
const CELL = 'w-full bg-transparent text-sm px-1.5 py-1 rounded border border-transparent hover:border-surface-200 focus:border-primary-400 dark:hover:border-surface-700 focus:outline-none'

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
  const [addTab, setAddTab] = useState<TxType>('expense')
  const [edit, setEdit] = useState<any | null>(null)

  // Справочники для inline-редактирования
  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts })
  const { data: categories = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories })

  // Дебаунс поиска
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Сброс страницы при смене фильтров
  useEffect(() => { setPage(1) }, [type, search, ym, allTime])

  const from = allTime ? undefined : `${ym}-01`
  // Реальный последний день месяца — иначе `${ym}-31` даёт невалидную дату (напр. 2026-02-31) и 500 на бэкенде.
  const to = allTime ? undefined : monthEndISO(ym)
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

  // Точечное сохранение изменения ячейки строки.
  async function patchTx(id: string, patch: any) {
    try {
      await financeApi.updateTransaction(id, patch)
      qc.invalidateQueries({ queryKey: ['finance'] })
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Ошибка')
    }
  }

  const openAdd = (t: TxType) => { setAddTab(t); setShowAdd(true) }

  return (
    <div className="space-y-5">
      {/* Заголовок */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Транзакции</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Журнал операций — правьте прямо в таблице или добавляйте кнопками</p>
        </div>
        <div className="flex items-center gap-2">
          {QUICK_ADD.map(b => (
            <button
              key={b.key}
              onClick={() => openAdd(b.key)}
              className={clsx('text-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-colors', b.cls)}
            >
              <Plus size={15} /> {b.label}
            </button>
          ))}
        </div>
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
          <EmptyState icon={<Wallet2 size={28} />}>Нет операций — добавьте кнопками сверху</EmptyState>
        </div>
      ) : (
        <TableCard scroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className="py-2.5 px-3 font-medium w-[140px]">Дата</th>
                <th className="py-2.5 px-3 font-medium w-[120px]">Тип</th>
                <th className="py-2.5 px-3 font-medium w-[180px]">Категория</th>
                <th className="py-2.5 px-3 font-medium">Описание</th>
                <th className="py-2.5 px-3 font-medium text-right w-[130px]">Сумма</th>
                <th className="py-2.5 px-3 font-medium w-[160px]">Со счёта</th>
                <th className="py-2.5 px-3 font-medium w-[160px]">На счёт</th>
                <th className="py-2.5 px-3 font-medium text-right w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <TxRow
                  key={t.id}
                  t={t}
                  accounts={accounts as any[]}
                  categories={categories as any[]}
                  onPatch={patchTx}
                  onEdit={() => setEdit(t)}
                  onDelete={() => { if (confirm('Удалить операцию?')) del.mutate(t.id) }}
                />
              ))}
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
      <OperationModal open={showAdd} onClose={() => setShowAdd(false)} defaultTab={addTab} />

      {/* Полное редактирование операции (проект/сотрудник/долг и пр.) */}
      <OperationModal open={!!edit} edit={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

/* ── Редактируемая строка журнала ─────────────────────────────── */
function TxRow({
  t, accounts, categories, onPatch, onEdit, onDelete,
}: {
  t: any
  accounts: any[]
  categories: any[]
  onPatch: (id: string, patch: any) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const type: TxType = t.type
  const cats = categories.filter(c => c.type === type)
  const fromActive = type === 'expense' || type === 'transfer'
  const toActive = type === 'income' || type === 'saving' || type === 'transfer'

  // Смена типа: сбрасываем категорию и очищаем теперь неиспользуемые поля счетов (mirror reference).
  function changeType(nt: TxType) {
    const patch: any = { type: nt, categoryId: null }
    if (nt === 'transfer') {
      patch.accountId = null
      patch.projectId = null; patch.employeeId = null; patch.debtId = null
    } else {
      patch.fromAccountId = null; patch.toAccountId = null
      if (nt !== 'income') patch.projectId = null
      if (nt !== 'expense') { patch.employeeId = null; patch.debtId = null }
    }
    onPatch(t.id, patch)
  }

  const fromValue = type === 'transfer' ? (t.fromAccountId || '') : (type === 'expense' ? (t.accountId || '') : '')
  const toValue = type === 'transfer' ? (t.toAccountId || '') : ((type === 'income' || type === 'saving') ? (t.accountId || '') : '')

  const setFrom = (v: string) => onPatch(t.id, type === 'transfer' ? { fromAccountId: v || null } : { accountId: v || null })
  const setTo = (v: string) => onPatch(t.id, type === 'transfer' ? { toAccountId: v || null } : { accountId: v || null })

  return (
    <tr className="border-b border-surface-50 dark:border-surface-800/60 hover:bg-surface-50 dark:hover:bg-surface-800/40 group align-middle">
      {/* Дата */}
      <td className="py-1.5 px-2">
        <input
          type="date"
          value={(t.date || '').slice(0, 10)}
          onChange={e => { if (e.target.value) onPatch(t.id, { date: e.target.value }) }}
          className={clsx(CELL, 'tabular-nums text-surface-600 dark:text-surface-300')}
        />
      </td>

      {/* Тип (цветной бейдж-select) */}
      <td className="py-1.5 px-2">
        <select
          value={type}
          onChange={e => changeType(e.target.value as TxType)}
          className={clsx('rounded-md px-2 py-0.5 text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-400', TYPE_SELECT_CLS[type])}
        >
          {TYPE_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </td>

      {/* Категория */}
      <td className="py-1.5 px-2">
        {type === 'transfer' ? (
          <span className="text-surface-400 text-xs px-1.5">—</span>
        ) : (
          <select
            value={t.categoryId || ''}
            onChange={e => onPatch(t.id, { categoryId: e.target.value || null })}
            className={clsx(CELL, 'cursor-pointer text-surface-700 dark:text-surface-200')}
          >
            <option value="">—</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </td>

      {/* Описание */}
      <td className="py-1.5 px-2">
        <input
          key={`${t.id}-comment-${t.comment ?? ''}`}
          defaultValue={t.comment ?? ''}
          placeholder="описание"
          onBlur={e => { const v = e.target.value.trim(); if (v !== (t.comment ?? '')) onPatch(t.id, { comment: v || null }) }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className={clsx(CELL, 'text-surface-700 dark:text-surface-200')}
        />
      </td>

      {/* Сумма */}
      <td className="py-1.5 px-2">
        <input
          key={`${t.id}-amount-${t.amount ?? ''}`}
          inputMode="decimal"
          defaultValue={t.amount ?? ''}
          placeholder="0"
          onBlur={e => {
            const v = parseFloat(e.target.value.replace(',', '.')) || 0
            if (v > 0 && v !== Number(t.amount)) onPatch(t.id, { amount: v })
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className={clsx(CELL, 'text-right tabular-nums font-semibold')}
        />
      </td>

      {/* Со счёта */}
      <td className="py-1.5 px-2">
        {fromActive ? (
          <select value={fromValue} onChange={e => setFrom(e.target.value)} className={clsx(CELL, 'cursor-pointer text-surface-600 dark:text-surface-300')}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : <span className="text-surface-400 text-xs px-1.5">—</span>}
      </td>

      {/* На счёт */}
      <td className="py-1.5 px-2">
        {toActive ? (
          <select value={toValue} onChange={e => setTo(e.target.value)} className={clsx(CELL, 'cursor-pointer text-surface-600 dark:text-surface-300')}>
            <option value="">—</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        ) : <span className="text-surface-400 text-xs px-1.5">—</span>}
      </td>

      {/* Действия */}
      <td className="py-1.5 px-2 text-right whitespace-nowrap">
        <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onEdit} title="Изменить (полная форма)"
            className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete} title="Удалить"
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}
