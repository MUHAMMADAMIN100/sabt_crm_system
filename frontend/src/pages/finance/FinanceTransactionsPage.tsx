import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { Plus, Wallet2, Pencil, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { money, todayISO } from './financeUtils'
import OperationModal from './OperationModal'

const TYPE_LABEL: Record<string, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод', saving: 'Накопление' }
const TYPE_COLOR: Record<string, string> = {
  income: 'text-green-600 dark:text-green-400', expense: 'text-red-600 dark:text-red-400',
  transfer: 'text-blue-600 dark:text-blue-400', saving: 'text-purple-600 dark:text-purple-400',
}
const SIGN: Record<string, string> = { income: '+', expense: '−', transfer: '', saving: '' }

export default function FinanceTransactionsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [op, setOp] = useState<null | 'income' | 'expense' | 'transfer'>(null)
  const [edit, setEdit] = useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['finance', 'transactions', type, search],
    queryFn: () => financeApi.transactions({ type: type || undefined, search: search || undefined, pageSize: 300 }),
  })
  const items: any[] = data?.items ?? []

  const del = useMutation({
    mutationFn: (id: string) => financeApi.removeTransaction(id),
    onSuccess: () => { toast.success('Удалено'); qc.invalidateQueries({ queryKey: ['finance'] }) },
    onError: () => toast.error('Ошибка'),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Транзакции</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Журнал операций — добавляйте через кнопки или правьте записи</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOp('income')} className="text-sm px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1.5"><Plus size={15} /> Доход</button>
          <button onClick={() => setOp('expense')} className="text-sm px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 inline-flex items-center gap-1.5"><Plus size={15} /> Расход</button>
          <button onClick={() => setOp('transfer')} className="text-sm px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1.5"><Plus size={15} /> Перевод</button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск…" className="input max-w-xs" />
        <select value={type} onChange={e => setType(e.target.value)} className="input max-w-[160px]">
          <option value="">Все типы</option>
          <option value="income">Доход</option>
          <option value="expense">Расход</option>
          <option value="transfer">Перевод</option>
          <option value="saving">Накопление</option>
        </select>
        <span className="text-sm text-surface-400">{items.length} операций</span>
      </div>

      <div className="card">
        {isLoading ? (
          <p className="text-sm text-surface-400 animate-pulse py-6 text-center">Загрузка…</p>
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-surface-400">
            <Wallet2 size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Нет операций — добавьте кнопками сверху</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                  <th className="py-2 pr-3 font-medium">Дата</th>
                  <th className="py-2 px-3 font-medium">Тип</th>
                  <th className="py-2 px-3 font-medium">Категория / детали</th>
                  <th className="py-2 px-3 font-medium">Счёт</th>
                  <th className="py-2 px-3 font-medium text-right">Сумма</th>
                  <th className="py-2 pl-3 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(t => (
                  <tr key={t.id} className="border-b border-surface-50 dark:border-surface-800/60 group">
                    <td className="py-2 pr-3 tabular-nums text-surface-500 whitespace-nowrap">{t.date}</td>
                    <td className="py-2 px-3"><span className={clsx('text-xs font-medium', TYPE_COLOR[t.type])}>{TYPE_LABEL[t.type]}</span></td>
                    <td className="py-2 px-3">
                      <div className="text-surface-800 dark:text-surface-200">
                        {t.type === 'transfer' ? `${t.fromAccountName || '—'} → ${t.toAccountName || '—'}` : (t.categoryName || '—')}
                      </div>
                      {[t.projectName, t.employeeName, t.debtName, t.comment].filter(Boolean).length > 0 && (
                        <div className="text-xs text-surface-400 truncate max-w-[280px]">{[t.projectName, t.employeeName, t.debtName, t.comment].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-surface-500">{t.accountName || t.toAccountName || '—'}</td>
                    <td className={clsx('py-2 px-3 text-right tabular-nums font-semibold', TYPE_COLOR[t.type])}>{SIGN[t.type]}{money(t.amount)}</td>
                    <td className="py-2 pl-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => setEdit(t)} className="p-1.5 rounded hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Pencil size={14} /></button>
                        <button onClick={() => { if (confirm('Удалить операцию?')) del.mutate(t.id) }} className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <OperationModal open={!!op} onClose={() => setOp(null)} defaultTab={op || 'income'} />
      {edit && <EditModal tx={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function EditModal({ tx, onClose }: { tx: any; onClose: () => void }) {
  const qc = useQueryClient()
  const [amount, setAmount] = useState(String(tx.amount))
  const [date, setDate] = useState(tx.date || todayISO())
  const [comment, setComment] = useState(tx.comment || '')
  const save = useMutation({
    mutationFn: () => financeApi.updateTransaction(tx.id, { amount: Number(amount), date, comment: comment || null }),
    onSuccess: () => { toast.success('Сохранено'); qc.invalidateQueries({ queryKey: ['finance'] }); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  return (
    <Modal open onClose={onClose} title="Редактировать операцию">
      <div className="space-y-3">
        <p className="text-xs text-surface-400">{TYPE_LABEL[tx.type]} · {tx.categoryName || (tx.type === 'transfer' ? `${tx.fromAccountName} → ${tx.toAccountName}` : '')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label text-xs">Сумма</label><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input" /></div>
          <div><label className="label text-xs">Дата</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></div>
        </div>
        <div><label className="label text-xs">Комментарий</label><input value={comment} onChange={e => setComment(e.target.value)} className="input" /></div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button onClick={() => save.mutate()} disabled={!(Number(amount) > 0) || save.isPending} className="btn-primary text-sm">Сохранить</button>
        </div>
      </div>
    </Modal>
  )
}
