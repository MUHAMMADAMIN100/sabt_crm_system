import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { DatePicker } from '@/components/ui/DatePicker'
import { CollapsibleField } from '@/components/ui/CollapsibleField'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  Plus, Edit, Trash2, Search, ArrowUpRight, ArrowDownRight,
  Wallet, BarChart3, ListOrdered, Loader2, X, Users, FolderOpen,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts'
import { financeApi, projectsApi, employeesApi } from '@/services/api.service'
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
  completed: { label: 'Проведено', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  pending:   { label: 'Ожидание',  color: 'bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400' },
  cancelled: { label: 'Отменено',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

const CATEGORY_COLORS = ['#18181b', '#3f3f46', '#52525b', '#71717a', '#8a8a93', '#a1a1aa', '#b4b4bb', '#d4d4d8']
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
  // Предзаполнение формы транзакции (для кнопок Штраф/Аванс/Платёж).
  const [txPrefill, setTxPrefill] = useState<any>(null)
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

  // Проекты — для выпадающего списка в форме транзакции и блока «Проекты».
  const { data: financeProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  })

  // Сотрудники — для блока «Сотрудники» в обзоре финансов.
  const { data: financeEmployees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
  })

  // Категории — стандартные + добавленные пользователем; для выпадашки в форме.
  const { data: financeCategories } = useQuery({
    queryKey: ['finance-categories'],
    queryFn: () => financeApi.categories(),
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
    qc.invalidateQueries({ queryKey: ['finance-categories'] })
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
          <h1 className="text-2xl font-bold flex items-center gap-2"><Wallet size={22} className="text-green-500" /> Финансы</h1>
          <p className="text-sm text-gray-500">Учёт доходов и расходов по 3 счетам компании.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setView('overview')} className={clsx('px-3 py-1.5 text-sm inline-flex items-center gap-1', view === 'overview' ? 'bg-surface-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
              <BarChart3 size={14} /> Обзор
            </button>
            <button onClick={() => setView('transactions')} className={clsx('px-3 py-1.5 text-sm inline-flex items-center gap-1', view === 'transactions' ? 'bg-surface-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
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
                  ? 'border-surface-500 ring-2 ring-surface-200 dark:ring-surface-900/50'
                  : 'border-gray-200 dark:border-gray-700 hover:border-surface-300',
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
                <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-medium">
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
          <Tile label="Доход"      value={fmtMoney(accountSummary.income)}  accent="text-green-600" />
          <Tile label="Расход"     value={fmtMoney(accountSummary.expense)} accent="text-red-600" />
          <Tile label="Чистый итог" value={fmtMoney(accountSummary.balance)} accent={Number(accountSummary.balance) >= 0 ? 'text-green-600' : 'text-red-600'} />
          <Tile label="Транзакций" value={accountSummary.count ?? 0} />
        </div>
      )}

      {view === 'overview' ? (
        <OverviewSection
          monthly={monthly ?? []}
          byCategory={byCategory ?? []}
          employees={financeEmployees ?? []}
          projects={financeProjects ?? []}
          onCreate={(type) => { setDefaultType(type); setEditTx(null); setTxPrefill(null); setShowForm(true) }}
          onGoTransactions={() => setView('transactions')}
          onQuickTx={(prefill) => { setEditTx(null); setTxPrefill(prefill); setDefaultType(prefill.type || 'expense'); setShowForm(true) }}
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
          categories={financeCategories || []}
          onAdd={() => { setDefaultType('income'); setEditTx(null); setShowForm(true) }}
          onEdit={(tx) => { setEditTx(tx); setShowForm(true) }}
          onDelete={(tx) => setDeleteTx(tx)}
        />
      )}

      {showForm && (
        <Modal open onClose={() => { setShowForm(false); setEditTx(null); setTxPrefill(null) }} title={editTx ? 'Редактировать транзакцию' : 'Новая транзакция'} size="lg">
          <TxForm
            initial={editTx || txPrefill}
            defaultType={defaultType}
            defaultAccount={account === 'all' ? undefined : account}
            projects={financeProjects || []}
            categories={financeCategories || []}
            loading={createMut.isPending || updateMut.isPending}
            onCancel={() => { setShowForm(false); setEditTx(null); setTxPrefill(null) }}
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
function OverviewSection({ monthly, byCategory, employees, projects, onCreate, onGoTransactions, onQuickTx }: any) {
  // Какая панель-вкладка открыта: «Сотрудники», «Проекты» или ничего. По умолчанию закрыто.
  const [panelTab, setPanelTab] = useState<'employees' | 'projects' | null>(null)
  const togglePanel = (tab: 'employees' | 'projects') =>
    setPanelTab(prev => (prev === tab ? null : tab))

  const chartData = (monthly ?? []).map((m: any) => {
    const [_, mm] = m.month.split('-')
    return { name: MONTH_LABELS[parseInt(mm, 10) - 1] ?? m.month, Доход: m.income, Расход: m.expense }
  })

  const fmtMoney = (v: any) => Number(v || 0).toLocaleString('ru-RU')
  const activeEmployees = (employees ?? []).filter((e: any) => e.status !== 'inactive')
  const activeProjects = (projects ?? []).filter((p: any) => !p.isArchived)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => onCreate('income')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm">
          <ArrowUpRight size={14} /> + Доход
        </button>
        <button onClick={() => onCreate('expense')} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm">
          <ArrowDownRight size={14} /> + Расход
        </button>
        <button onClick={onGoTransactions} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
          <ListOrdered size={14} /> К транзакциям
        </button>

        {/* Вкладки-панели: раскрывают список сотрудников / проектов по клику */}
        <div className="w-px self-stretch bg-gray-200 dark:bg-gray-700 mx-1" />
        <button
          onClick={() => togglePanel('employees')}
          className={clsx(
            'inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm border',
            panelTab === 'employees'
              ? 'bg-surface-600 border-surface-600 text-white'
              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
          )}
        >
          <Users size={14} /> Сотрудники
        </button>
        <button
          onClick={() => togglePanel('projects')}
          className={clsx(
            'inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm border',
            panelTab === 'projects'
              ? 'bg-surface-600 border-surface-600 text-white'
              : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800',
          )}
        >
          <FolderOpen size={14} /> Проекты
        </button>
      </div>

      {/* Раскрываемая панель «Сотрудники» */}
      {panelTab === 'employees' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3">👥 Сотрудники</h3>
          {activeEmployees.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500">Нет сотрудников</div>
          ) : (
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {activeEmployees.map((e: any) => (
                <div key={e.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{e.fullName}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {e.position || '—'}{e.salary ? ` · ЗП ${fmtMoney(e.salary)} сом.` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => onQuickTx({
                      type: 'expense', category: 'salary',
                      counterparty: e.fullName,
                      description: `Штраф — ${e.fullName}`,
                      employee: e,
                    })}
                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 shrink-0"
                  >Штраф</button>
                  <button
                    onClick={() => onQuickTx({
                      type: 'expense', category: 'salary',
                      counterparty: e.fullName,
                      description: `Аванс — ${e.fullName}`,
                      employee: e,
                    })}
                    className="px-2 py-1 rounded-md text-[11px] font-medium bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-400 hover:bg-surface-200 shrink-0"
                  >Аванс</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Раскрываемая панель «Проекты» */}
      {panelTab === 'projects' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3">📁 Проекты</h3>
          {activeProjects.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500">Нет активных проектов</div>
          ) : (
            <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
              {activeProjects.map((p: any) => {
                const contractDate = p.startDate || p.createdAt
                const tariffSum = p.tariffPriceSnapshot || p.monthlyFee || p.totalContractValue
                return (
                  <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {contractDate ? new Date(contractDate).toLocaleDateString('ru-RU') : '—'}
                        {tariffSum ? ` · Тариф ${fmtMoney(tariffSum)} сом.` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => onQuickTx({
                        type: 'income', category: 'project',
                        project: p.name,
                        description: `Оплата по проекту — ${p.name}`,
                        amount: tariffSum || undefined,
                      })}
                      className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200 shrink-0"
                    >Платёж</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

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
  categories = [],
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
          {Array.from(new Set([...CATEGORIES.map(c => c.id), ...categories])).map((id: any) => (
            <option key={id} value={id}>{CATEGORIES.find(c => c.id === id)?.label ?? id}</option>
          ))}
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
        <button onClick={onAdd} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-600 hover:bg-surface-700 text-white text-sm">
          <Plus size={14} /> Добавить
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="animate-spin text-surface-500" /></div>
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
                    {Array.isArray(tx.splits) && tx.splits.length > 1 ? (
                      <span
                        className="px-2 py-0.5 rounded-full bg-surface-100 text-surface-700 dark:bg-surface-900/30 dark:text-surface-300 cursor-help"
                        title={tx.splits.map((s: any) =>
                          `${ACCOUNTS.find(a => a.id === s.account)?.label ?? s.account}: ${fmtMoney(s.amount)}`,
                        ).join('\n')}
                      >
                        🔀 Сплит · {tx.splits.length}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                        {ACCOUNTS.find(a => a.id === tx.account)?.label ?? tx.account}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_INFO[tx.status]?.color)}>
                      {STATUS_INFO[tx.status]?.label ?? tx.status}
                    </span>
                  </td>
                  <td className={clsx('px-3 py-2 text-right font-semibold whitespace-nowrap',
                    tx.type === 'income' ? 'text-green-600' : 'text-red-600')}>
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

/** Стаж работы из даты приёма: "2 года 3 мес" / "5 мес" / "—". */
function workDuration(hireDate?: string | Date | null): string {
  if (!hireDate) return '—'
  const start = new Date(hireDate)
  if (isNaN(start.getTime())) return '—'
  const now = new Date()
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months--
  if (months < 0) months = 0
  const years = Math.floor(months / 12)
  const rem = months % 12
  const yWord = (n: number) => n === 1 ? 'год' : (n >= 2 && n <= 4 ? 'года' : 'лет')
  const parts: string[] = []
  if (years > 0) parts.push(`${years} ${yWord(years)}`)
  if (rem > 0 || years === 0) parts.push(`${rem} мес`)
  return parts.join(' ')
}

// ─── Form ───────────────────────────────────────────────────────────
// Категория с возможностью добавить свою прямо в форме. Список = стандартные
// + пришедшие с сервера (ранее добавленные). Новая категория сохраняется
// вместе с транзакцией и затем подхватывается списком на сервере.
function CategorySelect({ value, onChange, categories = [] }: { value: string; onChange: (v: string) => void; categories: string[] }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const ids = Array.from(new Set([...CATEGORIES.map(c => c.id), ...categories]))
  const labelFor = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? id

  const confirm = () => {
    const v = name.trim()
    if (!v) return
    onChange(v)
    setName('')
    setAdding(false)
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); confirm() }
            if (e.key === 'Escape') { setName(''); setAdding(false) }
          }}
          placeholder="Название новой категории"
          className="input flex-1"
        />
        <button type="button" onClick={confirm} className="px-3 py-2 rounded-lg bg-surface-600 text-white text-sm shrink-0">
          Добавить
        </button>
        <button type="button" onClick={() => { setName(''); setAdding(false) }} className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm shrink-0">
          Отмена
        </button>
      </div>
    )
  }

  return (
    <select
      value={value || ''}
      onChange={e => { if (e.target.value === '__add__') setAdding(true); else onChange(e.target.value) }}
      className="input"
    >
      {ids.map(id => <option key={id} value={id}>{labelFor(id)}</option>)}
      {value && !ids.includes(value) && <option value={value}>{value}</option>}
      <option value="__add__">＋ Добавить категорию…</option>
    </select>
  )
}

function TxForm({ initial, defaultType, defaultAccount, projects = [], categories = [], onSubmit, onCancel, loading }: any) {
  const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? defaultType ?? 'income')
  // Счёт — отдельным state'ом, чтобы отрисовать кнопками-сегментами наверху.
  const [account, setAccount] = useState<string>(initial?.account ?? defaultAccount ?? 'alif')
  // Сплит-оплата: часть суммы на один счёт, часть на другой.
  // splitMode: false — обычный режим, один счёт. true — два и более счёта.
  const initialSplits: Array<{ account: string; amount: string }> = Array.isArray(initial?.splits) && initial.splits.length > 1
    ? initial.splits.map((s: any) => ({ account: s.account, amount: String(s.amount) }))
    : [{ account: 'alif', amount: '' }, { account: 'dushanbe_city', amount: '' }]
  const [splitMode, setSplitMode] = useState<boolean>(Array.isArray(initial?.splits) && initial.splits.length > 1)
  const [splits, setSplits] = useState(initialSplits)
  // Транзакция по сотруднику (Штраф/Аванс) — упрощённый вид формы.
  const emp = initial?.employee
  const isEmployeeTx = !!emp
  const todayIso = new Date().toISOString().slice(0, 10)
  const { register, handleSubmit, watch, control, formState: { errors } } = useForm({
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
  const watchedAmount = Number(watch('amount')) || 0
  const splitsSum = splits.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const splitsDelta = Math.round((watchedAmount - splitsSum) * 100) / 100

  const updateSplit = (idx: number, patch: Partial<{ account: string; amount: string }>) =>
    setSplits(prev => prev.map((p, i) => i === idx ? { ...p, ...patch } : p))
  const addSplit = () => setSplits(prev => [...prev, { account: 'cash', amount: '' }])
  const removeSplit = (idx: number) => setSplits(prev => prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx))

  return (
    <form
      onSubmit={handleSubmit((data: any) => {
        const amount = Math.abs(Number(data.amount)) || 0
        let payloadSplits: Array<{ account: string; amount: number }> | null = null
        let resolvedAccount = account
        if (splitMode) {
          payloadSplits = splits.map(s => ({ account: s.account, amount: Number(s.amount) || 0 }))
          const sum = payloadSplits.reduce((s, p) => s + p.amount, 0)
          if (Math.abs(sum - amount) > 0.01) {
            toast.error(`Сумма сплита (${sum}) не равна общей сумме (${amount})`)
            return
          }
          if (payloadSplits.some(p => p.amount <= 0)) {
            toast.error('Каждая часть должна быть больше нуля')
            return
          }
          resolvedAccount = payloadSplits[0].account
        }
        onSubmit({
          ...data,
          type,
          account: resolvedAccount,
          splits: payloadSplits,
          amount,
          paymentMethod: data.paymentMethod || null,
          counterparty: data.counterparty || null,
          project: data.project || null,
          comment: data.comment || null,
        })
      })}
      className="space-y-4 max-h-[75vh] overflow-y-auto pr-1"
    >
      {/* Доход / Расход */}
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <button type="button" onClick={() => setType('income')}
          className={clsx('px-4 py-1.5 text-sm inline-flex items-center gap-1', type === 'income' ? 'bg-green-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
          <ArrowUpRight size={14} /> Доход
        </button>
        <button type="button" onClick={() => setType('expense')}
          className={clsx('px-4 py-1.5 text-sm inline-flex items-center gap-1', type === 'expense' ? 'bg-red-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-800')}>
          <ArrowDownRight size={14} /> Расход
        </button>
      </div>

      {/* Счёт. Кнопки счетов + «Разделить оплату» в одном ряду: одна оплата
          на выбранный счёт vs приём на несколько счетов одной сделкой. */}
      {!isEmployeeTx && (
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">Счёт *</label>

          <div className="flex flex-wrap gap-2">
            {ACCOUNTS.filter(a => a.id !== 'all').map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setSplitMode(false); setAccount(a.id) }}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium border transition-all',
                  !splitMode && account === a.id
                    ? 'bg-surface-600 text-white border-surface-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-surface-300',
                )}
              >
                {a.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSplitMode(true)}
              className={clsx(
                'px-4 py-2 rounded-lg text-sm font-medium border transition-all',
                splitMode
                  ? 'bg-surface-600 text-white border-surface-600'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-surface-300',
              )}
            >
              Разделить оплату
            </button>
          </div>

          {splitMode && (
            <div className="space-y-2 rounded-xl border border-surface-200 dark:border-surface-900/50 bg-surface-50/40 dark:bg-surface-900/10 p-3 mt-2">
              {splits.map((sp, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={sp.amount}
                    onChange={e => updateSplit(idx, { amount: e.target.value })}
                    placeholder="Сумма"
                    className="input w-28 text-sm"
                  />
                  <select
                    value={sp.account}
                    onChange={e => updateSplit(idx, { account: e.target.value })}
                    className="input flex-1 text-sm"
                  >
                    {ACCOUNTS.filter(a => a.id !== 'all').map(a => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                  {splits.length > 2 && (
                    <button type="button" onClick={() => removeSplit(idx)}
                      className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                      title="Удалить часть"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={addSplit} className="text-xs font-medium text-surface-600 hover:underline">
                  + Ещё счёт
                </button>
                <span className={clsx(
                  'text-xs tabular-nums font-medium',
                  Math.abs(splitsDelta) < 0.01 ? 'text-green-600' : 'text-red-600',
                )}>
                  Σ {splitsSum.toLocaleString('ru-RU')} / {watchedAmount.toLocaleString('ru-RU')}
                  {Math.abs(splitsDelta) >= 0.01 && ` (Δ ${splitsDelta > 0 ? '+' : ''}${splitsDelta})`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Карточка сотрудника — для транзакций Штраф/Аванс */}
      {isEmployeeTx && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">ФИО</span>
            <span className="font-semibold">{emp.fullName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Зарплата</span>
            <span className="font-medium">
              {emp.salary ? `${Number(emp.salary).toLocaleString('ru-RU')} сом.` : '—'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Длительность работы</span>
            <span className="font-medium">{workDuration(emp.hireDate)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Сумма (сомони)" required error={errors.amount?.message as string}>
          <input
            type="number" step="0.01" min="0.01"
            onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
            {...register('amount', {
              required: 'Введите сумму',
              validate: (v: any) => Math.abs(Number(v)) > 0 || 'Сумма > 0',
            })}
            className="input" />
        </FormField>
        <FormField label="Дата" required>
          <Controller name="date" control={control} rules={{ required: true }}
            render={({ field }) => <DatePicker value={field.value || ''} onChange={field.onChange} />} />
        </FormField>
        <FormField label="Категория" required>
          <Controller
            name="category"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <CategorySelect value={field.value} onChange={field.onChange} categories={categories} />
            )}
          />
        </FormField>
      </div>

      <FormField label="Описание" required error={errors.description?.message as string}>
        <input {...register('description', { required: 'Описание обязательно' })} className="input" />
      </FormField>

      {/* Клиент / Проект — свёрнуты по умолчанию.
          «Способ оплаты» убран (счёт выбирается выше), «Статус» всегда
          «Проведено» — транзакцию заводят уже после получения средств. */}
      {!isEmployeeTx && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CollapsibleField
              label="Клиент / Контрагент"
              defaultOpen={!!initial?.counterparty}
              hint={initial?.counterparty || ''}
            >
              <input {...register('counterparty')} className="input" placeholder="Имя клиента/поставщика" />
            </CollapsibleField>
            <CollapsibleField
              label="Проект"
              defaultOpen={!!initial?.project}
              hint={initial?.project || ''}
            >
              <select {...register('project')} className="input">
                <option value="">— Не выбран —</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </CollapsibleField>
          </div>
        </>
      )}

      <CollapsibleField
        label="Комментарий"
        defaultOpen={!!initial?.comment}
        hint={initial?.comment ? 'заполнено' : ''}
      >
        <textarea {...register('comment')} rows={2} className="input resize-none" placeholder="Произвольная заметка" />
      </CollapsibleField>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">
          <X size={14} className="inline mr-1" /> Отмена
        </button>
        <button type="submit" disabled={loading}
          className={clsx('px-4 py-2 rounded-lg text-sm text-white disabled:opacity-50',
            type === 'income' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')}>
          {loading ? 'Сохранение...' : (initial ? 'Сохранить' : 'Добавить')}
        </button>
      </div>
    </form>
  )
}
