import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { TrendingUp, TrendingDown, ArrowLeftRight, PiggyBank, X } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { todayISO } from './financeUtils'

type TxType = 'income' | 'expense' | 'transfer' | 'saving'

const TABS: { key: TxType; label: string; icon: any; active: string }[] = [
  { key: 'income', label: 'Доход', icon: TrendingUp, active: 'bg-green-600 text-white' },
  { key: 'expense', label: 'Расход', icon: TrendingDown, active: 'bg-red-600 text-white' },
  { key: 'transfer', label: 'Перевод', icon: ArrowLeftRight, active: 'bg-blue-600 text-white' },
  { key: 'saving', label: 'Накопление', icon: PiggyBank, active: 'bg-purple-600 text-white' },
]

/**
 * Универсальная модалка операции (Доход/Расход/Перевод/Накопление).
 * Режим создания (по умолчанию) полностью совместим со старым API.
 * Если передан `edit` (существующая транзакция) — модалка работает в режиме
 * редактирования: поля предзаполняются, заголовок «Изменить операцию»,
 * а сохранение вызывает updateTransaction вместо createOperation.
 */
export default function OperationModal({
  open, onClose, defaultTab = 'income', defaultDate, edit,
}: {
  open: boolean; onClose: () => void; defaultTab?: TxType; defaultDate?: string; edit?: any
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<TxType>(defaultTab)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(defaultDate || todayISO())
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [debtId, setDebtId] = useState('')
  const [comment, setComment] = useState('')

  // Встроенное создание категории
  const [addingCat, setAddingCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')

  const { data: accounts = [] } = useQuery({ queryKey: ['finance', 'accounts'], queryFn: financeApi.accounts, enabled: open })
  const { data: categories = [] } = useQuery({ queryKey: ['finance', 'categories'], queryFn: financeApi.categories, enabled: open })
  const { data: projects = [] } = useQuery({ queryKey: ['finance', 'projects'], queryFn: financeApi.projects, enabled: open })
  const { data: employees = [] } = useQuery({ queryKey: ['finance', 'employees'], queryFn: financeApi.employees, enabled: open })
  const { data: debts = [] } = useQuery({ queryKey: ['finance', 'debts'], queryFn: financeApi.debts, enabled: open })

  const catsOfTab = (categories as any[]).filter(c => c.type === tab)

  const reset = () => {
    setAmount(''); setCategoryId(''); setAccountId(''); setFromAccountId(''); setToAccountId('')
    setProjectId(''); setEmployeeId(''); setDebtId(''); setComment('')
  }

  // Предзаполнение при открытии (и синхронизация с defaultTab / edit).
  useEffect(() => {
    if (!open) return
    setAddingCat(false); setNewCatName('')
    if (edit) {
      setTab((edit.type as TxType) || 'expense')
      setAmount(String(edit.amount ?? ''))
      setDate(edit.date ? String(edit.date).slice(0, 10) : todayISO())
      setCategoryId(edit.categoryId || '')
      setAccountId(edit.accountId || '')
      setFromAccountId(edit.fromAccountId || '')
      setToAccountId(edit.toAccountId || '')
      setProjectId(edit.projectId || '')
      setEmployeeId(edit.employeeId || '')
      setDebtId(edit.debtId || '')
      setComment(edit.comment || '')
    } else {
      setTab(defaultTab)
      setDate(defaultDate || todayISO())
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, edit?.id])

  const buildBody = () => {
    const base: any = { type: tab, amount: Number(amount), date, comment: comment || null }
    if (tab === 'transfer') {
      Object.assign(base, {
        fromAccountId: fromAccountId || null, toAccountId: toAccountId || null,
        accountId: null, categoryId: null, projectId: null, employeeId: null, debtId: null,
      })
    } else {
      Object.assign(base, {
        accountId: accountId || null,
        categoryId: categoryId || null,
        fromAccountId: null, toAccountId: null,
        projectId: tab === 'income' ? (projectId || null) : null,
        employeeId: tab === 'expense' ? (employeeId || null) : null,
        debtId: tab === 'expense' ? (debtId || null) : null,
      })
    }
    return base
  }

  const save = useMutation({
    mutationFn: () => edit
      ? financeApi.updateTransaction(edit.id, buildBody())
      : financeApi.createOperation(buildBody()),
    onSuccess: () => {
      toast.success(edit ? 'Изменения сохранены' : 'Операция добавлена')
      qc.invalidateQueries({ queryKey: ['finance'] })
      if (!edit) reset()
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const createCat = useMutation({
    mutationFn: () => financeApi.createCategory({ name: newCatName.trim(), type: tab }),
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ['finance', 'categories'] })
      if (created?.id) setCategoryId(created.id)
      setAddingCat(false); setNewCatName('')
      toast.success('Категория создана')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const canSave = Number(amount) > 0 && (
    tab === 'transfer' ? (!!fromAccountId && !!toAccountId && fromAccountId !== toAccountId) : !!accountId
  )

  const onCatSelect = (v: string) => {
    if (v === '__new__') { setAddingCat(true) }
    else { setCategoryId(v); setAddingCat(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title={edit ? 'Изменить операцию' : 'Новая операция'}>
      <div className="space-y-4">
        {/* Вкладки типа */}
        <div className="grid grid-cols-4 gap-2">
          {TABS.map(tb => (
            <button key={tb.key} onClick={() => { setTab(tb.key); setCategoryId(''); setAddingCat(false) }}
              className={clsx('px-2 py-2 rounded-lg text-sm font-medium transition-colors',
                tab === tb.key ? tb.active : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600')}>
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

        {tab === 'transfer' ? (
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
              <select value={addingCat ? '__new__' : categoryId} onChange={e => onCatSelect(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {catsOfTab.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">＋ Новая категория…</option>
              </select>
              {addingCat && (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    autoFocus
                    value={newCatName}
                    onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && newCatName.trim()) createCat.mutate() }}
                    className="input"
                    placeholder="Название категории"
                  />
                  <button
                    onClick={() => createCat.mutate()}
                    disabled={!newCatName.trim() || createCat.isPending}
                    className="btn-primary text-sm whitespace-nowrap"
                  >
                    {createCat.isPending ? '…' : 'Создать'}
                  </button>
                  <button
                    onClick={() => { setAddingCat(false); setNewCatName('') }}
                    className="p-2 rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700"
                    title="Отмена"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {tab === 'expense' && (
                <p className="text-[11px] text-surface-400 mt-1">Новые категории (кроме ЗП/Аренды/Долгов) суммируются в «Прочее».</p>
              )}
            </div>
            <div>
              <label className="label text-xs">{tab === 'expense' ? 'Списать со счёта' : 'Зачислить на счёт'}</label>
              <select value={accountId} onChange={e => setAccountId(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {(accounts as any[]).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            {tab === 'income' && (
              <div>
                <label className="label text-xs">Проект / клиент (необязательно)</label>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input">
                  <option value="">— не привязан —</option>
                  {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {tab === 'expense' && (
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
            {save.isPending ? (edit ? 'Сохранение…' : 'Добавление…') : (edit ? 'Сохранить' : 'Добавить')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
