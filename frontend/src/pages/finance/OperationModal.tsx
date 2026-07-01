import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { TrendingUp, TrendingDown, ArrowLeftRight, PiggyBank } from 'lucide-react'
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

/** Универсальная модалка добавления операции (Доход/Расход/Перевод/Накопление). */
export default function OperationModal({
  open, onClose, defaultTab = 'income', defaultDate,
}: {
  open: boolean; onClose: () => void; defaultTab?: TxType; defaultDate?: string
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

  const save = useMutation({
    mutationFn: () => financeApi.createOperation({
      type: tab, amount: Number(amount), date, comment: comment || null,
      categoryId: categoryId || null, accountId: accountId || null,
      fromAccountId: fromAccountId || null, toAccountId: toAccountId || null,
      projectId: projectId || null, employeeId: employeeId || null, debtId: debtId || null,
    }),
    onSuccess: () => {
      toast.success('Операция добавлена')
      qc.invalidateQueries({ queryKey: ['finance'] })
      reset(); onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const canSave = Number(amount) > 0 && (
    tab === 'transfer' ? (fromAccountId && toAccountId && fromAccountId !== toAccountId) : !!accountId
  )

  return (
    <Modal open={open} onClose={onClose} title="Новая операция">
      <div className="space-y-4">
        {/* Вкладки типа */}
        <div className="grid grid-cols-4 gap-2">
          {TABS.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
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
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="input">
                <option value="">— выбрать —</option>
                {catsOfTab.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
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
            {save.isPending ? 'Добавление…' : 'Добавить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
