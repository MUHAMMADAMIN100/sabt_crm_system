import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { Plus, Pencil, Trash2, Download, Upload, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { money, dirLabel, DIRECTIONS } from './financeUtils'

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
function Section({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
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

// ─── Счета ──────────────────────────────────────────────────────────
function AccountsSection() {
  const inv = useInvalidate()
  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts })
  const { data: bal } = useQuery({ queryKey: ['finance', 'accounts-balances'], queryFn: financeApi.accountsBalances })
  const [modal, setModal] = useState<any | null>(null)
  const per: any[] = bal?.perAccount ?? []
  const curOf = (id: string) => per.find(p => p.id === id)?.balance ?? 0

  const del = useMutation({ mutationFn: (id: string) => financeApi.removeAccount(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка') })

  return (
    <Section title="Счета и стартовые балансы" onAdd={() => setModal({})}>
      <div className="px-4 py-2.5 text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">Стартовый баланс = сколько было на счёте на момент запуска. Текущий = старт + операции.</div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
          <th className="py-2 px-4 font-medium">Счёт</th><th className="py-2 px-4 font-medium text-right">Стартовый</th><th className="py-2 px-4 font-medium text-right">Текущий</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(accounts as any[]).length === 0 && <tr><td colSpan={4}><Empty text="Нет счетов" /></td></tr>}
          {(accounts as any[]).map(a => (
            <tr key={a.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">{a.name}</td>
              <td className="py-2 px-4 text-right tabular-nums text-surface-500">{money(a.startBalance)}</td>
              <td className="py-2 px-4 text-right tabular-nums font-semibold">{money(curOf(a.id))}</td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(a)} onDelete={() => { if (confirm('Удалить счёт?')) del.mutate(a.id) }} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {modal && <AccountModal item={modal} onClose={() => setModal(null)} onDone={inv} />}
    </Section>
  )
}
function AccountModal({ item, onClose, onDone }: any) {
  const [name, setName] = useState(item.name || '')
  const [startBalance, setStartBalance] = useState(String(item.startBalance ?? ''))
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateAccount(item.id, { name, startBalance: Number(startBalance) || 0 }) : financeApi.createAccount({ name, startBalance: Number(startBalance) || 0 }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Счёт' : 'Новый счёт'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Например: Alif" autoFocus /></div>
        <div><label className="label text-xs">Стартовый баланс</label><input type="number" value={startBalance} onChange={e => setStartBalance(e.target.value)} className="input" placeholder="0" /></div>
        <SaveBar onClose={onClose} onSave={() => save.mutate()} disabled={!name.trim() || save.isPending} />
      </div>
    </Modal>
  )
}

// ─── Категории ──────────────────────────────────────────────────────
const CAT_TYPE_LABEL: Record<string, string> = { income: 'Доход', expense: 'Расход', saving: 'Накопление' }
function CategoriesSection() {
  const inv = useInvalidate()
  const { data: cats = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories })
  const [modal, setModal] = useState<any | null>(null)
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeCategory(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка') })
  return (
    <Section title="Категории" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium">Тип</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(cats as any[]).map(c => (
            <tr key={c.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">{c.name}</td>
              <td className="py-2 px-4 text-surface-500">{CAT_TYPE_LABEL[c.type] || c.type}</td>
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
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateCategory(item.id, { name, type }) : financeApi.createCategory({ name, type }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Категория' : 'Новая категория'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div><label className="label text-xs">Тип</label>
          <select value={type} onChange={e => setType(e.target.value)} className="input" disabled={item.builtin}>
            <option value="income">Доход</option><option value="expense">Расход</option><option value="saving">Накопление</option>
          </select>
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
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeProject(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: () => toast.error('Ошибка') })
  return (
    <Section title="Проекты / клиенты" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium">Направление</th><th className="py-2 px-4 font-medium text-right">Тариф</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={4}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(p => (
            <tr key={p.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">{p.name}</td>
              <td className="py-2 px-4 text-surface-500">{dirLabel(p.direction)}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(p.tariff)}</td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(p)} onDelete={() => { if (confirm('Удалить проект?')) del.mutate(p.id) }} /></td>
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
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateProject(item.id, { name, direction, tariff: Number(tariff) || 0 }) : financeApi.createProject({ name, direction, tariff: Number(tariff) || 0 }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: () => toast.error('Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Проект / клиент' : 'Новый проект / клиент'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Направление</label><select value={direction} onChange={e => setDirection(e.target.value)} className="input">{DIRECTIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
          <div><label className="label text-xs">Тариф (мес)</label><input type="number" value={tariff} onChange={e => setTariff(e.target.value)} className="input" placeholder="0" /></div>
        </div>
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
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeEmployee(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: () => toast.error('Ошибка') })
  return (
    <Section title="Сотрудники" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Имя</th><th className="py-2 px-4 font-medium">Роль</th><th className="py-2 px-4 font-medium text-right">Оклад</th><th className="py-2 px-4 font-medium">Статус</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={5}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(e => (
            <tr key={e.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">{e.name}</td>
              <td className="py-2 px-4 text-surface-500">{e.role || '—'}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(e.salary)}</td>
              <td className="py-2 px-4">{e.status === 'active' ? <span className="text-xs text-green-600 dark:text-green-400">активен</span> : <span className="text-xs text-surface-400">неактивен</span>}</td>
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
  const [status, setStatus] = useState(item.status || 'active')
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateEmployee(item.id, { name, role, salary: Number(salary) || 0, status }) : financeApi.createEmployee({ name, role, salary: Number(salary) || 0, status }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: () => toast.error('Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Сотрудник' : 'Новый сотрудник'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Имя</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Роль</label><input value={role} onChange={e => setRole(e.target.value)} className="input" placeholder="Например: SMM" /></div>
          <div><label className="label text-xs">Оклад</label><input type="number" value={salary} onChange={e => setSalary(e.target.value)} className="input" placeholder="0" /></div>
        </div>
        <div><label className="label text-xs">Статус</label><select value={status} onChange={e => setStatus(e.target.value)} className="input"><option value="active">Активен</option><option value="inactive">Неактивен</option></select></div>
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
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeSubscription(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: () => toast.error('Ошибка') })
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
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: () => toast.error('Ошибка'),
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
  const del = useMutation({ mutationFn: (id: string) => financeApi.removeDebt(id), onSuccess: () => { toast.success('Удалено'); inv() }, onError: () => toast.error('Ошибка') })
  return (
    <Section title="Долги" onAdd={() => setModal({})}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700"><th className="py-2 px-4 font-medium">Название</th><th className="py-2 px-4 font-medium text-right">Сумма</th><th className="py-2 px-4 font-medium text-right">Остаток</th><th className="py-2 px-4 font-medium text-right">Платёж/мес</th><th className="py-2 px-4 w-16"></th></tr></thead>
        <tbody>
          {(rows as any[]).length === 0 && <tr><td colSpan={5}><Empty text="Пусто" /></td></tr>}
          {(rows as any[]).map(d => (
            <tr key={d.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
              <td className="py-2 px-4 font-medium text-surface-800 dark:text-surface-200">{d.name}</td>
              <td className="py-2 px-4 text-right tabular-nums text-surface-500">{money(d.totalAmount)}</td>
              <td className="py-2 px-4 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">{money(d.remaining)}</td>
              <td className="py-2 px-4 text-right tabular-nums">{money(d.monthlyPayment)}</td>
              <td className="py-2 px-4 text-right"><RowActions onEdit={() => setModal(d)} onDelete={() => { if (confirm('Удалить долг?')) del.mutate(d.id) }} /></td>
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
  const [totalAmount, setTotalAmount] = useState(String(item.totalAmount ?? ''))
  const [monthlyPayment, setMonthlyPayment] = useState(String(item.monthlyPayment ?? ''))
  const save = useMutation({
    mutationFn: () => item.id ? financeApi.updateDebt(item.id, { name, totalAmount: Number(totalAmount) || 0, monthlyPayment: Number(monthlyPayment) || 0 }) : financeApi.createDebt({ name, totalAmount: Number(totalAmount) || 0, monthlyPayment: Number(monthlyPayment) || 0 }),
    onSuccess: () => { toast.success('Сохранено'); onDone(); onClose() }, onError: () => toast.error('Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title={item.id ? 'Долг' : 'Новый долг'}>
      <div className="space-y-3">
        <div><label className="label text-xs">Название</label><input value={name} onChange={e => setName(e.target.value)} className="input" autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Сумма долга</label><input type="number" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} className="input" placeholder="0" /></div>
          <div><label className="label text-xs">Платёж/мес</label><input type="number" value={monthlyPayment} onChange={e => setMonthlyPayment(e.target.value)} className="input" placeholder="0" /></div>
        </div>
        <p className="text-xs text-surface-400">Остаток уменьшается автоматически при расходах, привязанных к этому долгу.</p>
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
      a.download = `finance-backup-${data.exportedAt?.slice(0, 10) || 'export'}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch { toast.error('Не удалось выгрузить') }
  }
  const importJson = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!confirm('Импорт заменит текущие финансовые данные. Продолжить?')) return
      await financeApi.importAll(data)
      toast.success('Импортировано'); inv()
    } catch { toast.error('Неверный файл') }
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
  const reset = useMutation({ mutationFn: () => financeApi.resetAll(), onSuccess: () => { toast.success('Данные сброшены'); inv() }, onError: () => toast.error('Ошибка') })
  return (
    <div>
      <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><AlertTriangle size={13} /> Опасная зона</h3>
      <div className="card border-red-200 dark:border-red-900/50">
        <button
          onClick={() => { if (confirm('Удалить ВСЕ финансовые данные (операции, счета, справочники) и вернуть дефолты? Это необратимо.')) reset.mutate() }}
          className="text-sm px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          Сбросить все данные
        </button>
      </div>
    </div>
  )
}

// ─── общие мелочи ───────────────────────────────────────────────────
function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete?: () => void }) {
  return (
    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
