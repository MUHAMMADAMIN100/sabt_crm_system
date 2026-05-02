import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  Plus, Edit, Trash2, Search, ArrowUpRight, ArrowDownRight,
  Wallet, BarChart3, ListOrdered, Loader2, X,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts'
import { financeApi } from '@/services/api.service'
import { Modal, FormField, ConfirmDialog, EmptyState, PageLoader } from '@/components/ui'

// ─── Constants ───────────────────────────────────────────────────────
type Account = 'all' | 'alif' | 'dushanbe_city' | 'cash'

const ACCOUNTS: { id: Account; label: string }[] = [
  { id: 'all',           label: 'Все счета' },
  { id: 'alif',          label: 'Alif Bank' },
  { id: 'dushanbe_city', label: 'Dushanbe City' },
  { id: 'cash',          label: 'Наличка' },
]

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'salary',       label: 'Зарплата' },
  { id: 'project',      label: 'Проект' },
  { id: 'subscription', label: 'Подписка' },
  { id: 'rent',         label: 'Аренда' },
  { id: 'marketing',    label: 'Маркетинг' },
  { id: 'tools',        label: 'Инструменты' },
  { id: 'transport',    label: 'Транспорт' },
  { id: 'other',        label: 'Другое' },
]

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  completed: { label: 'Проведено', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  pending:   { label: 'Ожидание',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  cancelled: { label: 'Отменено',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: 'transfer', label: 'Перевод' },
  { id: 'card',     label: 'Карта' },
  { id: 'cash',     label: 'Наличные' },
  { id: 'qr',       label: 'QR-платёж' },
]

const CATEGORY_COLORS = ['#6B4FCF', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#64748b']
const MONTH_LABELS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

const fmtMoney = (v: any) => {
  const n = Math.round(Number(v) || 0)
  return n.toLocaleString('ru-RU') + ' сом.'
}

// ─── Page ────────────────────────────────────────────────────────────
export default function FinancePage() {
  const qc = useQueryClient()
  const [account, setAccount] = useState<Account>('all')
  const [view, setView] = useState<'overview' | 'transactions'>('overview')
  const [filterType, setFilterType] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'week' | 'month' | 'year'>('all')
  const [sort, setSort] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 15

  const [showForm, setShowForm] = useState(false)
  const [editTx, setEditTx] = useState<any>(null)
  const [deleteTx, setDeleteTx] = useState<any>(null)
  const [defaultType, setDefaultType] = useState<'income' | 'expense'>('income')

  // Период → from/to
  const periodRange = useMemo(() => {
    if (filterPeriod === 'all') return {}
    const now = new Date()
    const to = now.toISOString().slice(0, 10)
    let from = ''
    if (filterPeriod === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString().slice(0, 10)
    } else if (filterPeriod === 'month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1); from = d.toISOString().slice(0, 10)
    } else if (filterPeriod === 'year') {
      const d = new Date(now.getFullYear(), 0, 1); from = d.toISOString().slice(0, 10)
    }
    return { from, to }
  }, [filterPeriod])

  const listParams = {
    account: account === 'all' ? undefined : account,
    type: filterType || undefined,
    category: filterCategory || undefined,
    search: search || undefined,
    from: periodRange.from || undefined,
    to: periodRange.to || undefined,
    sort, page, pageSize: PAGE_SIZE,
  }

  useEffect(() => { setPage(1) }, [account, filterType, filterCategory, filterPeriod, sort, search])

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: ['finance-list', listParams],
    queryFn: () => financeApi.list(listParams),
  })

  const { data: summary } = useQuery({
    queryKey: ['finance-summary'],
    queryFn: financeApi.accountsSummary,
  })

  const { data: monthly } = useQuery({
    queryKey: ['finance-monthly', account],
    queryFn: () => financeApi.monthly({ account: account === 'all' ? undefined : account, months: 6 }),
    enabled: view === 'overview',
  })

  const { data: byCategory } = useQuery({
    queryKey: ['finance-by-category', account, periodRange.from, periodRange.to],
    queryFn: () => financeApi.byCategory({
      account: account === 'all' ? undefined : account,
      from: periodRange.from || undefined,
      to: periodRange.to || undefined,
    }),
    enabled: view === 'overview',
  })

  // Метрики (фильтр по выбранному счёту)
  const accountSummary = useMemo(() => {
    if (!summary) return null
    if (account === 'all') return summary.total
    return summary.perAccount?.find((a: any) => a.account === account) ?? null
  }, [summary, account])

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['finance-list'] })
    qc.invalidateQueries({ queryKey: ['finance-summary'] })
    qc.invalidateQueries({ queryKey: ['finance-monthly'] })
    qc.invalidateQueries({ queryKey: ['finance-by-category'] })
  }

  const createMut = useMutation({
    mutationFn: financeApi.create,
    onSuccess: () => { invalidateAll(); setShowForm(false); toast.success('Транзакция добавлена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => financeApi.update(id, data),
    onSuccess: () => { invalidateAll(); setEditTx(null); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const removeMut = useMutation({
    mutationFn: financeApi.remove,
    onSuccess: () => { invalidateAll(); setDeleteTx(null); toast.success('Удалено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  if (!summary && txLoading) return <PageLoader />

  const items = txData?.items ?? []
  const total = txData?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet size={22} className="text-emerald-500" /> Финансы</h1>
          <p className="text-sm text-gray-500">Учёт доходов и расходов по 3 счетам компании.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setView('overview')} className={clsx('px-3 py-1.5 text-sm inline-flex items-center gap-1', view === 'overview' ? 'bg-purple-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
              <BarChart3 size={14} /> Обзор
            </button>
            <button onClick={() => setView('transactions')} className={clsx('px-3 py-1.5 text-sm inline-flex items-center gap-1', view === 'transactions' ? 'bg-purple-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
              <ListOrdered size={14} /> Транзакции
            </button>
          </div>
        </div>
      </header>

      {/* Account cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {ACCOUNTS.map(a => {
          const data = a.id === 'all'
            ? summary?.total
            : summary?.perAccount?.find((x: any) => x.account === a.id)
          const isActive = account === a.id
          return (
            <button
              key={a.id}
              onClick={() => setAccount(a.id)}
              className={clsx(
                'rounded-xl border p-4 text-left transition-colors',
                isActive
                  ? 'border-purple-500 ring-2 ring-purple-200 dark:ring-purple-900/50'
                  : 'border-gray-200 dark:border-gray-700 hover:border-purple-300',
                'bg-white dark:bg-gray-900',
              )}
            >
              <div className="text-xs text-gray-500 mb-1">{a.label}</div>
              <div className={clsx(
                'text-xl font-bold mb-2',
                Number(data?.balance ?? 0) >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-red-600',
              )}>
                {fmtMoney(data?.balance ?? 0)}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-medium">
                  +{fmtMoney(data?.income ?? 0)}
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
                  −{fmtMoney(data?.expense ?? 0)}
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Metrics tiles */}
      {accountSummary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Доход"      value={fmtMoney(accountSummary.income)}  accent="text-emerald-600" />
          <Tile label="Расход"     value={fmtMoney(accountSummary.expense)} accent="text-red-600" />
          <Tile label="Чистый итог" value={fmtMoney(accountSummary.balance)} accent={Number(accountSummary.balance) >= 0 ? 'text-emerald-600' : 'text-red-600'} />
          <Tile label="Транзакций" value={accountSummary.count ?? 0} />
        </div>
      )}

      {view === 'overview' ? (
        <OverviewSection
          monthly={monthly ?? []}
          byCategory={byCategory ?? []}
          onCreate={(type) => { setDefaultType(type); setEditTx(null); setShowForm(true) }}
          onGoTransactions={() => setView('transactions')}
        />
      ) : (
        <TransactionsSection
          items={items}
          totalPages={totalPages} page={page} setPage={setPage}
          rangeStart={rangeStart} rangeEnd={rangeEnd} total={total}
          loading={txLoading}
          filterType={filterType} setFilterType={setFilterType}
          filterCategory={filterCategory} setFilterCategory={setFilterCategory}
          filterPeriod={filterPeriod} setFilterPeriod={setFilterPeriod}
          sort={sort} setSort={setSort}
          search={search} setSearch={setSearch}
          onAdd={() => { setDefaultType('income'); setEditTx(null); setShowForm(true) }}
          onEdit={(tx) => { setEditTx(tx); setShowForm(true) }}
          onDelete={(tx) => setDeleteTx(tx)}
        />
      )}

      {showForm && (
        <Modal open onClose={() => { setShowForm(false); setEditTx(null) }} title={editTx ? 'Редактировать транзакцию' : 'Новая транзакция'} size="lg">
          <TxForm
            initial={editTx}
            defaultType={defaultType}
            defaultAccount={account === 'all' ? undefined : account}
            loading={createMut.isPending || updateMut.isPending}
            onCancel={() => { setShowForm(false); setEditTx(null) }}
            onSubmit={(data) => {
              if (editTx) updateMut.mutate({ id: editTx.id, data })
              else createMut.mutate(data)
            }}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteTx}
        onClose={() => setDeleteTx(null)}
        onConfirm={() => deleteTx && removeMut.mutate(deleteTx.id)}
        title="Удалить транзакцию?"
        message={deleteTx ? `${deleteTx.description} — ${fmtMoney(deleteTx.amount)}. Это действие нельзя отменить.` : ''}
        danger
      />
    </div>
  )
}

// ─── Tile ─────────────────────────────────────────────────────────────
function Tile({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={clsx('text-xl font-bold', accent || 'text-gray-900 dark:text-gray-100')}>{value}</div>
    </div>
  )
}

// ─── Overview ────────────────────────────────────────────────────────
function OverviewSection({ monthly, byCategory, onCreate, onGoTransactions }: any) {
  const chartData = (monthly ?? []).map((m: any) => {
    const [_, mm] = m.month.split('-')
    return { name: MONTH_LABELS[parseInt(mm, 10) - 1] ?? m.month, Доход: m.income, Расход: m.expense }
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onCreate('income')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
          <ArrowUpRight size={14} /> + Доход
        </button>
        <button onClick={() => onCreate('expense')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">
          <ArrowDownRight size={14} /> + Расход
        </button>
        <button onClick={onGoTransactions} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          <ListOrdered size={14} /> К транзакциям
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3">Динамика 6 месяцев</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v: any) => Number(v).toLocaleString('ru-RU')} />
              <Tooltip formatter={(v: any) => `${Number(v).toLocaleString('ru-RU')} сом.`} />
              <Legend />
              <Bar dataKey="Доход" fill="#22c55e" />
              <Bar dataKey="Расход" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3">Расходы по категориям</h3>
          {byCategory.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-500">Нет данных</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byCategory.map((c: any) => ({ name: catLabel(c.category), value: c.total }))}
                    dataKey="value" nameKey="name" innerRadius={50} outerRadius={85}>
                    {byCategory.map((_: any, i: number) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: any) => `${Number(v).toLocaleString('ru-RU')} сом.`} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-1.5 text-xs">
                {byCategory.map((c: any, i: number) => (
                  <li key={c.category} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 truncate">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                      {catLabel(c.category)}
                    </span>
                    <span className="font-medium tabular-nums">{c.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function catLabel(id: string) {
  return CATEGORIES.find(c => c.id === id)?.label ?? id
}

// ─── Transactions section ────────────────────────────────────────────
function TransactionsSection({
  items, totalPages, page, setPage, rangeStart, rangeEnd, total, loading,
  filterType, setFilterType, filterCategory, setFilterCategory,
  filterPeriod, setFilterPeriod, sort, setSort, search, setSearch,
  onAdd, onEdit, onDelete,
}: any) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="">Все типы</option>
          <option value="income">Доход</option>
          <option value="expense">Расход</option>
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="">Все категории</option>
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value as any)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="all">Весь период</option>
          <option value="week">Эта неделя</option>
          <option value="month">Этот месяц</option>
          <option value="year">Этот год</option>
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as any)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="date_desc">Дата ↓</option>
          <option value="date_asc">Дата ↑</option>
          <option value="amount_desc">Сумма ↓</option>
          <option value="amount_asc">Сумма ↑</option>
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..." className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm" />
        </div>
        <button onClick={onAdd} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm">
          <Plus size={14} /> Добавить
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-purple-500" /></div>
        ) : items.length === 0 ? (
          <EmptyState title="Транзакций нет" description="Добавьте первую через кнопку «+ Добавить»." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Дата</th>
                <th className="text-left px-3 py-2 font-medium">Описание</th>
                <th className="text-left px-3 py-2 font-medium">Категория</th>
                <th className="text-left px-3 py-2 font-medium">Счёт</th>
                <th className="text-left px-3 py-2 font-medium">Статус</th>
                <th className="text-right px-3 py-2 font-medium">Сумма</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((tx: any) => (
                <tr key={tx.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 align-top">
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {new Date(tx.date).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-3 py-2 max-w-[260px]">
                    <div className="truncate font-medium">{tx.description}</div>
                    {(tx.counterparty || tx.project || tx.comment) && (
                      <div className="text-[11px] text-gray-500 truncate">
                        {[tx.counterparty, tx.project, tx.comment].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">{catLabel(tx.category)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                      {ACCOUNTS.find(a => a.id === tx.account)?.label ?? tx.account}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_INFO[tx.status]?.color)}>
                      {STATUS_INFO[tx.status]?.label ?? tx.status}
                    </span>
                  </td>
                  <td className={clsx('px-3 py-2 text-right font-semibold whitespace-nowrap',
                    tx.type === 'income' ? 'text-emerald-600' : 'text-red-600')}>
                    {tx.type === 'income' ? '+' : '−'}{fmtMoney(tx.amount)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => onEdit(tx)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="Редактировать">
                      <Edit size={14} />
                    </button>
                    <button onClick={() => onDelete(tx)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 rounded" title="Удалить">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{rangeStart}–{rangeEnd} из {total}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p: number) => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40">‹ Назад</button>
            <span className="px-2">стр. {page} из {totalPages}</span>
            <button onClick={() => setPage((p: number) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-40">Вперёд ›</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Form ───────────────────────────────────────────────────────────
function TxForm({ initial, defaultType, defaultAccount, onSubmit, onCancel, loading }: any) {
  const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? defaultType ?? 'income')
  const todayIso = new Date().toISOString().slice(0, 10)
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      amount: initial?.amount ?? '',
      date: initial?.date ? String(initial.date).slice(0, 10) : todayIso,
      account: initial?.account ?? defaultAccount ?? 'alif',
      category: initial?.category ?? 'project',
      description: initial?.description ?? '',
      counterparty: initial?.counterparty ?? '',
      project: initial?.project ?? '',
      paymentMethod: initial?.paymentMethod ?? '',
      status: initial?.status ?? 'completed',
      comment: initial?.comment ?? '',
    },
  })

  return (
    <form
      onSubmit={handleSubmit((data: any) => onSubmit({
        ...data,
        type,
        amount: Number(data.amount),
        paymentMethod: data.paymentMethod || null,
        counterparty: data.counterparty || null,
        project: data.project || null,
        comment: data.comment || null,
      }))}
      className="space-y-4 max-h-[75vh] overflow-y-auto pr-1"
    >
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button type="button" onClick={() => setType('income')}
          className={clsx('px-4 py-1.5 text-sm inline-flex items-center gap-1', type === 'income' ? 'bg-emerald-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
          <ArrowUpRight size={14} /> Доход
        </button>
        <button type="button" onClick={() => setType('expense')}
          className={clsx('px-4 py-1.5 text-sm inline-flex items-center gap-1', type === 'expense' ? 'bg-red-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
          <ArrowDownRight size={14} /> Расход
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Сумма (сомони)" required error={errors.amount?.message as string}>
          <input type="number" step="0.01" min="0.01"
            {...register('amount', { required: 'Введите сумму', validate: (v: any) => Number(v) > 0 || 'Сумма > 0' })}
            className="input" />
        </FormField>
        <FormField label="Дата" required>
          <input type="date" {...register('date', { required: true })} className="input" />
        </FormField>
        <FormField label="Счёт" required>
          <select {...register('account', { required: true })} className="input">
            {ACCOUNTS.filter(a => a.id !== 'all').map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </FormField>
        <FormField label="Категория" required>
          <select {...register('category', { required: true })} className="input">
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </FormField>
      </div>

      <FormField label="Описание" required error={errors.description?.message as string}>
        <input {...register('description', { required: 'Описание обязательно' })} className="input" />
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Клиент / Контрагент">
          <input {...register('counterparty')} className="input" placeholder="Имя клиента/поставщика" />
        </FormField>
        <FormField label="Проект">
          <input {...register('project')} className="input" placeholder="Название проекта" />
        </FormField>
        <FormField label="Способ оплаты">
          <select {...register('paymentMethod')} className="input">
            <option value="">— Не указан —</option>
            {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </FormField>
        <FormField label="Статус" required>
          <select {...register('status', { required: true })} className="input">
            {Object.entries(STATUS_INFO).map(([id, info]) => (
              <option key={id} value={id}>{info.label}</option>
            ))}
          </select>
        </FormField>
      </div>

      <FormField label="Комментарий">
        <textarea {...register('comment')} rows={2} className="input resize-none" placeholder="Произвольная заметка" />
      </FormField>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">
          <X size={14} className="inline mr-1" /> Отмена
        </button>
        <button type="submit" disabled={loading}
          className={clsx('px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50',
            type === 'income' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700')}>
          {loading ? 'Сохранение...' : (initial ? 'Сохранить' : 'Добавить')}
        </button>
      </div>
    </form>
  )
}
