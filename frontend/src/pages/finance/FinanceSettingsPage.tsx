import { useRef, useState, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { Plus, Pencil, Trash2, Download, Upload, AlertTriangle, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { money, dirLabel, DIRECTIONS, formatDate, currentYm } from './financeUtils'
import { CatIcon } from './financeIcons'
import { Badge } from './financeUi'

export default function FinanceSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Настройки</h1>
        <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Счета, справочники, резервные копии</p>
      </div>
      <AccountsSection />
      <CategoriesSection />
      <ProjectsSection />
      <EmployeesSection />
      <SubscriptionsSection />
      <DebtsSection />
      <BackupSection />
      <DangerSection />
    </div>
  )
}

// ─── общий каркас секции ────────────────────────────────────────────
function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="card p-0 overflow-hidden">{children}</div>
      {onAdd && <button onClick={onAdd} className="btn-secondary text-sm mt-2 inline-flex items-center gap-1.5"><Plus size={15} /> Добавить</button>}
    </div>
  )
}
function Empty({ text }: { text: string }) { return <p className="text-sm text-surface-400 py-8 text-center">{text}</p> }
function useInvalidate() { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ['finance'] }) }
const onErr = (e: any) => toast.error(e?.response?.data?.message || 'Ошибка')

// 8-цветная палитра для счетов/категорий
const PALETTE = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#6366f1']

// Тип счёта
const ACCOUNT_KINDS: { key: 'bank' | 'cash' | 'savings'; label: string }[] = [
  { key: 'bank', label: 'Банк' },
  { key: 'cash', label: 'Наличные' },
  { key: 'savings', label: 'Накопления' },
]

// Статус проекта
const PROJECT_STATUSES: { key: 'lead' | 'active' | 'done' | 'archived'; label: string }[] = [
  { key: 'lead', label: 'Лид' },
  { key: 'active', label: 'Активный' },
  { key: 'done', label: 'Завершён' },
  { key: 'archived', label: 'Архив' },
]

function ColorPalette({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PALETTE.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={clsx('h-7 w-7 rounded-lg border-2 transition-transform', value === c ? 'border-surface-900 dark:border-white scale-110' : 'border-transparent')}
          style={{ background: c }} />
      ))}
    </div>
  )
}

// ─── Счета ──────────────────────────────────────────────────────────
function AccountsSection() {
  const inv = useInvalidate()
  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts })
  const { data: bal } = useQuery({ queryKey: ['finance', 'accounts-balances'], queryFn: financeApi.accountsBalances })
  const [modal, setModal] = useState<any | null>(null)
  const per: any[] = bal?.perAccount ?? []
  const total = bal?.total
  const recOf = (id: string) => per.find(p => p.id === id)

  const del = useMutation({ mutationFn: (id: string) => financeApi.removeAccount(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: onErr })

  return (
    <Section title="Счета и стартовые балансы" onAdd={() => setModal({})}>
      <div className="px-4 py-2.5 text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">Стартовый баланс = сколько было на счёте на момент запуска. Текущий = старт + доходы − расходы.</div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
          <th className="py-2 px-4 font-medium">Счёт</th>
          <th className="py-2 px-4 font-medium text-right">Стартовый</th>
          <th className="py-2 px-4 font-medium text-right">Доход</th>
          <th className="py-2 px-4 font-medium text-right">Расход</th>
          <th className="py-2 px-4 font-medium text-right">Текущий</th>
          <th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(accounts as any[]).length === 0 && <tr><td colSpan={6}><Empty text="Нет счетов" /></td></tr>}
          {(accounts as any[]).map(a => {
            const r = recOf(a.id)
            return (
              <tr key={a.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
                <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.color || '#94a3b8' }} />
                    {a.name}
                  </span>
                </td>
                <td className="py-2 px-4 text-right tabular-nums text-surface-500">{money(r?.startBalance ?? a.startBalance)}</td>
                <td className="py-2 px-4 text-right tabular-nums text-green-600 dark:text-green-400">{money(r?.income ?? 0)}</td>
                <td className="py-2 px-4 text-right tabular-nums text-red-600 dark:text-red-400">{money(r?.expense ?? 0)}</td>
                <td className="py-2 px-4 text-right tabular-nums font-semibold">{money(r?.balance ?? a.startBalance)}</td>
                <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(a)} onDelete={() => { if (confirm('Удалить счёт?')) del.mutate(a.id) }} /></td>
              </tr>
            )
          })}
        </tbody>
        {total && (accounts as any[]).length > 0 && (
          <tfoot><tr className="border-t border-surface-200 dark:border-surface-700 font-semibold">
            <td className="py-2 px-4">Итого</td>
            <td className="py-2 px-4 text-right tabular-nums text-surface-500">{money(total.startBalance)}</td>
            <td className="py-2 px-4 text-right tabular-nums text-green-600 dark:text-green-400">{money(total.income)}</td>
            <td className="py-2 px-4 text-right tabular-nums text-red-600 dark:text-red-400">{money(total.expense)}</td>
            <td className="py-2 px-4 text-right tabular-nums">{money(total.balance)}</td>
            <td></td>
          </tr></tfoot>
        )}
      </table>
      </div>
      {modal && <AccountModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function AccountModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [startBalance, setStartBalance] = useState(String(item.startBalance ?? ''))
  const [color, setColor] = useState(item.color || PALETTE[1])
  const [kind, setKind] = useState(item.kind || 'bank')
  const save = useMutation({
    mutationFn: () => {
      const body = { name, startBalance: Number(startBalance) || 0, color, kind }
      return item.id ? financeApi.updateAccount(item.id, body) : financeApi.createAccount(body)
    },
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: onErr,
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Счёт' : 'Новый счёт'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Например: Alif" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Стартовый баланс</label><input type="number" value={startBalance} onChange={e => setStartBalance(e.target.value)} className="input" placeholder="0" /></div>
          <div><label className="label text-xs">Тип</label>
            <select value={kind} onChange={e => setKind(e.target.value)} className="input">
              {ACCOUNT_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label text-xs">Цвет</label><ColorPalette value={color} onChange={setColor} /></div>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Категории ──────────────────────────────────────────────────────
const CAT_TYPE_LABEL: Record<string, string> = { income: 'Доход', expense: 'Расход', saving: 'Накопление', transfer: 'Перевод' }
const CAT_TYPE_TONE: Record<string, 'ok' | 'danger' | 'transfer' | 'neutral'> = { income: 'ok', expense: 'danger', saving: 'transfer', transfer: 'neutral' }
// Имена иконок для выбора (совпадают с ключами ICON_MAP в financeIcons).
const ICON_NAMES = ['smm', 'development', 'design', 'salary', 'building', 'subscription', 'receipt', 'target', 'ads', 'car', 'printer', 'percent', 'dots', 'plus', 'income', 'expense', 'wallet', 'currency']

function CategoriesSection() {
  const inv = useInvalidate()
  const { data: cats = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories })
  const [modal, setModal] = useState<any | null>(null)
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeCategory(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: onErr })
  return (
    <Section title="Категории" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium">Тип</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(cats as any[]).length === 0 && <tr><td colSpan={3}><Empty text="Пусто" /></td></tr>}
          {(cats as any[]).map(c => (
            <tr key={c.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4">
                <div className="flex items-center gap-2 font-medium text-surface-800 dark:text-surface-200">
                  <span style={{ color: c.color || undefined }}><CatIcon name={c.icon} size={16} /></span>
                  {c.name}
                  {c.builtin && <span className="text-[10px] px-1 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">системная</span>}
                </div>
              </td>
              <td className="py-2 px-4"><Badge tone={CAT_TYPE_TONE[c.type] || 'neutral'}>{CAT_TYPE_LABEL[c.type] || c.type}</Badge></td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(c)} onDelete={c.builtin ? undefined : () => { if (confirm('Удалить категорию?')) del.mutate(c.id) }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <CategoryModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function CategoryModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [type, setType] = useState(item.type || 'expense')
  const [icon, setIcon] = useState(item.icon || 'dots')
  const [color, setColor] = useState(item.color || '#6366f1')
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateCategory(item.id, { name, type, icon, color }) : financeApi.createCategory({ name, type, icon, color }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: onErr,
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Категория' : 'Новая категория'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Реклама, Транспорт, Налоги…" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Тип</label>
            <select value={type} onChange={e => setType(e.target.value)} className="input" disabled={item.builtin}>
              <option value="income">Доход</option><option value="expense">Расход</option><option value="saving">Накопление</option><option value="transfer">Перевод</option>
            </select>
            {item.builtin && <p className="text-[11px] text-surface-400 mt-1">Системная категория — тип менять нельзя.</p>}
          </div>
          <div><label className="label text-xs">Цвет</label>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-transparent p-0.5 cursor-pointer" />
          </div>
        </div>
        <div><label className="label text-xs">Иконка</label>
          <div className="flex flex-wrap gap-1.5">
            {ICON_NAMES.map(n => (
              <button key={n} type="button" onClick={() => setIcon(n)} title={n}
                className={clsx('p-2 rounded-lg border transition-colors', icon === n ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30' : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600')}
                style={{ color }}>
                <CatIcon name={n} size={16} />
              </button>
            ))}
          </div>
        </div>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Проекты/клиенты ────────────────────────────────────────────────
function ProjectsSection() {
  const inv = useInvalidate()
  const { data: rows = [] } = useQuery({ queryKey: ['finance', 'projects'], queryFn: financeApi.projects })
  const [modal, setModal] = useState<any | null>(null)
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeProject(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: onErr })
  return (
    <Section title="Проекты / клиенты" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium">Направление</th><th className="py-2 px-4 font-medium">Контракт</th><th className="py-2 px-4 font-medium text-right">Тариф</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={5}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(p => (
            <tr key={p.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">
                <span className="inline-flex items-center gap-2">
                  {p.name}
                  {p.archived && <span className="text-[10px] px-1 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">архив</span>}
                  {p.multiMonth && <span className="text-[10px] px-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">по месяцам</span>}
                </span>
              </td>
              <td className="py-2 px-4 text-surface-500">{dirLabel(p.direction)}</td>
              <td className="py-2 px-4 text-surface-500 tabular-nums">{p.contractDate ? formatDate(p.contractDate) : '—'}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(p.tariff)}</td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(p)} onDelete={() => { if (confirm('Удалить проект? Связанные доходы и планы также удалятся.')) del.mutate(p.id) }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <ProjectModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function ProjectModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [direction, setDirection] = useState(item.direction || 'smm')
  const [tariff, setTariff] = useState(String(item.tariff ?? ''))
  const [note, setNote] = useState(item.note || '')
  const [contractDate, setContractDate] = useState(item.contractDate || '')
  const [archived, setArchived] = useState(item.archived ?? false)
  const [multiMonth, setMultiMonth] = useState(item.multiMonth ?? false)
  const [status, setStatus] = useState(item.status || 'active')
  const save = useMutation({
    mutationFn: () => {
      const body = { name, direction, tariff: Number(tariff) || 0, note, contractDate: contractDate || undefined, archived, multiMonth, status }
      return item.id ? financeApi.updateProject(item.id, body) : financeApi.createProject(body)
    },
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: onErr,
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Проект / клиент' : 'Новый проект / клиент'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Направление</label><select value={direction} onChange={e => setDirection(e.target.value)} className="input">{DIRECTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
          <div><label className="label text-xs">Тариф (мес)</label><input type="number" value={tariff} onChange={e => setTariff(e.target.value)} className="input" placeholder="0" /></div>
        </div>
        <div><label className="label text-xs">Статус</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="input">
            {PROJECT_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Дата контракта</label><input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} className="input" /></div>
          <div className="flex items-end gap-4 pb-1">
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={multiMonth} onChange={e => setMultiMonth(e.target.checked)} className="w-4 h-4" /> По месяцам</label>
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} className="w-4 h-4" /> Архив</label>
          </div>
        </div>
        <div><label className="label text-xs">Заметка</label><input value={note} onChange={e => setNote(e.target.value)} className="input" placeholder="—" /></div>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Сотрудники ─────────────────────────────────────────────────────
function EmployeesSection() {
  const inv = useInvalidate()
  const { data: rows = [] } = useQuery({ queryKey: ['finance', 'employees'], queryFn: financeApi.employees })
  const [modal, setModal] = useState<any | null>(null)
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeEmployee(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: onErr })
  return (
    <Section title="Сотрудники" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Имя</th><th className="py-2 px-4 font-medium">Роль</th><th className="py-2 px-4 font-medium text-right">Оклад</th><th className="py-2 px-4 font-medium text-right">Аванс</th><th className="py-2 px-4 font-medium">Статус</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={6}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(e => (
            <tr key={e.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">
                {e.name}
                {e.hireDate && <span className="block text-[11px] text-surface-400 tabular-nums">с {formatDate(e.hireDate)}</span>}
              </td>
              <td className="py-2 px-4 text-surface-500">{e.role || '—'}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(e.salary)}</td>
              <td className="py-2 px-4 text-right tabular-nums text-surface-500">{money(e.advance)}</td>
              <td className="py-2 px-4">{e.status === 'active' ? <span className="text-xs text-green-600 dark:text-green-400">активен</span> : <span className="text-xs text-surface-400">уволен</span>}</td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(e)} onDelete={() => { if (confirm('Удалить сотрудника?')) del.mutate(e.id) }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <EmployeeModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function EmployeeModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [role, setRole] = useState(item.role || '')
  const [salary, setSalary] = useState(String(item.salary ?? ''))
  const [advance, setAdvance] = useState(String(item.advance ?? ''))
  const [hireDate, setHireDate] = useState(item.hireDate || '')
  const [status, setStatus] = useState(item.status || 'active')
  const save = useMutation({
    mutationFn: () => {
      const body = { name, role, salary: Number(salary) || 0, advance: Number(advance) || 0, hireDate: hireDate || undefined, status }
      return item.id ? financeApi.updateEmployee(item.id, body) : financeApi.createEmployee(body)
    },
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: onErr,
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Сотрудник' : 'Новый сотрудник'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Имя</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Роль</label><input value={role} onChange={e => setRole(e.target.value)} className="input" placeholder="Например: SMM" /></div>
          <div><label className="label text-xs">Дата приёма</label><input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Оклад</label><input type="number" value={salary} onChange={e => setSalary(e.target.value)} className="input" placeholder="0" /></div>
          <div><label className="label text-xs">Аванс</label><input type="number" value={advance} onChange={e => setAdvance(e.target.value)} className="input" placeholder="0" /></div>
        </div>
        <div><label className="label text-xs">Статус</label><select value={status} onChange={e => setStatus(e.target.value)} className="input"><option value="active">Активен</option><option value="fired">Уволен</option></select></div>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Аренда/подписки ────────────────────────────────────────────────
function SubscriptionsSection() {
  const inv = useInvalidate()
  const { data: rows = [] } = useQuery({ queryKey: ['finance', 'subscriptions'], queryFn: financeApi.subscriptions })
  const [modal, setModal] = useState<any | null>(null)
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeSubscription(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: onErr })
  return (
    <Section title="Аренда и подписки" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium">Тип</th><th className="py-2 px-4 font-medium text-right">Сумма/мес</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={4}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(s => (
            <tr key={s.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">{s.name} {!s.active && <span className="text-[10px] px-1 rounded bg-surface-100 dark:bg-surface-700 text-surface-500">выкл</span>}</td>
              <td className="py-2 px-4 text-surface-500">{s.kind === 'rent' ? 'Аренда' : 'Подписка'}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(s.amount)}</td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(s)} onDelete={() => { if (confirm('Удалить позицию?')) del.mutate(s.id) }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <SubscriptionModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function SubscriptionModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [kind, setKind] = useState(item.kind || 'subscription')
  const [amount, setAmount] = useState(String(item.amount ?? ''))
  const [active, setActive] = useState(item.active !== false)
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateSubscription(item.id, { name, kind, amount: Number(amount) || 0, active }) : financeApi.createSubscription({ name, kind, amount: Number(amount) || 0, active }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: onErr,
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Аренда / подписка' : 'Новая позиция'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Тип</label><select value={kind} onChange={e => setKind(e.target.value)} className="input"><option value="subscription">Подписка</option><option value="rent">Аренда</option></select></div>
          <div><label className="label text-xs">Сумма/мес</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input" placeholder="0" /></div>
        </div>
        <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4" /> Активна (входит в «регулярные/мес»)</label>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Долги ──────────────────────────────────────────────────────────
function DebtsSection() {
  const inv = useInvalidate()
  const { data: rows = [] } = useQuery({ queryKey: ['finance', 'debts'], queryFn: financeApi.debts })
  const [modal, setModal] = useState<any | null>(null)
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeDebt(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: onErr })
  const regen = useMutation({ mutationFn: (id: string) => financeApi.regenerateDebtSchedule(id), onSuccess: () => { toast.success('График пересобран'); inv() }, onError: onErr })
  return (
    <Section title="Долги" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium text-right">Сумма</th><th className="py-2 px-4 font-medium text-right">Остаток</th><th className="py-2 px-4 font-medium text-right">Платёж/мес</th><th className="py-2 px-4 w-24"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={5}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(d => (
            <tr key={d.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">
                {d.name}
                {d.counterparty && <span className="block text-[11px] text-surface-400">{d.counterparty}</span>}
              </td>
              <td className="py-2 px-4 text-right tabular-nums text-surface-500">{money(d.totalAmount)}</td>
              <td className="py-2 px-4 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">{money(d.remaining)}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(d.monthlyPayment)}</td>
              <td className="py-2 px-4 text-right">
                <RowActions
                  onEdit={() => setModal(d)}
                  onDelete={() => { if (confirm('Удалить долг?')) del.mutate(d.id) }}
                  extra={<button onClick={() => regen.mutate(d.id)} disabled={regen.isPending} title="Пересобрать график" className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><RefreshCw size={14} /></button>}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <DebtModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function DebtModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [counterparty, setCounterparty] = useState(item.counterparty || '')
  const [totalAmount, setTotalAmount] = useState(String(item.totalAmount ?? ''))
  const [paidBefore, setPaidBefore] = useState(String(item.paidBefore ?? ''))
  const [monthlyPayment, setMonthlyPayment] = useState(String(item.monthlyPayment ?? ''))
  const [note, setNote] = useState(item.note || '')
  const save = useMutation({
    mutationFn: () => {
      const body = { name, counterparty, totalAmount: Number(totalAmount) || 0, paidBefore: Number(paidBefore) || 0, monthlyPayment: Number(monthlyPayment) || 0, note }
      return item.id ? financeApi.updateDebt(item.id, body) : financeApi.createDebt(body)
    },
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: onErr,
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Долг' : 'Новый долг'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
          <div><label className="label text-xs">Контрагент</label><input value={counterparty} onChange={e => setCounterparty(e.target.value)} className="input" placeholder="Кому должны" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Сумма долга</label><input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} className="input" placeholder="0" /></div>
          <div><label className="label text-xs">Погашено до старта</label><input type="number" value={paidBefore} onChange={e => setPaidBefore(e.target.value)} className="input" placeholder="0" /></div>
        </div>
        <div><label className="label text-xs">Платёж/мес</label><input type="number" value={monthlyPayment} onChange={e => setMonthlyPayment(e.target.value)} className="input" placeholder="0" /></div>
        <div><label className="label text-xs">Заметка</label><input value={note} onChange={e => setNote(e.target.value)} className="input" placeholder="—" /></div>
        <p className="text-xs text-surface-400">График платежей пересобирается автоматически при сохранении. Остаток уменьшается расходами, привязанными к этому долгу.</p>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Резервная копия ────────────────────────────────────────────────
function BackupSection() {
  const inv = useInvalidate()
  const fileRef = useRef<HTMLInputElement>(null)
  const exportJson = async () => {
    try {
      const data = await financeApi.exportAll()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `finance-backup-${currentYm()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success('Файл выгружен')
    } catch { toast.error('Не удалось выгрузить') }
  }
  const importJson = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!confirm('Импорт заменит текущие финансовые данные. Продолжить?')) return
      await financeApi.importAll(data)
      toast.success('Импортировано'); inv()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Неверный файл')
    }
  }
  return (
    <div>
      <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">Резервная копия</h3>
      <div className="card flex flex-wrap gap-2">
        <button onClick={exportJson} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Download size={15} /> Экспорт JSON</button>
        <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Upload size={15} /> Импорт JSON</button>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
      </div>
    </div>
  )
}

// ─── Опасная зона ───────────────────────────────────────────────────
function DangerSection() {
  const inv = useInvalidate()
  const reset = useMutation({ mutationFn: () => financeApi.resetAll(), onSuccess: () => { toast.success('Данные сброшены'); inv() }, onError: onErr })
  const onReset = () => {
    if (!confirm('Удалить ВСЕ финансовые данные (операции, счета, справочники) и вернуть дефолты? Это необратимо.')) return
    if (!confirm('Вы точно уверены? Отменить это действие будет невозможно.')) return
    reset.mutate()
  }
  return (
    <div>
      <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><AlertTriangle size={13} /> Опасная зона</h3>
      <div className="card border-red-200 dark:border-red-900/50">
        <button
          onClick={onReset}
          disabled={reset.isPending}
          className="text-sm px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
        >
          Сбросить все финансовые данные
        </button>
      </div>
    </div>
  )
}

// ─── общие мелочи ───────────────────────────────────────────────────
function RowActions({ onEdit, onDelete, extra }: { onEdit: () => void; onDelete?: () => void; extra?: ReactNode }) {
  return (
    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {extra}
      <button onClick={onEdit} className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Pencil size={14} /></button>
      {onDelete && <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600"><Trash2 size={14} /></button>}
    </div>
  )
}
function SaveBar({ onClose, onSave, disabled }: { onClose: () => void; onSave: () => void; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
      <button onClick={onSave} disabled={disabled} className="btn-primary text-sm">Сохранить</button>
    </div>
  )
}
