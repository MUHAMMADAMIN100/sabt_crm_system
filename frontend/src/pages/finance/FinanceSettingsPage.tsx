import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { financeApi } from '@/services/api.service'
import { Settings, Users, FolderKanban, Tag } from 'lucide-react'
import toast from 'react-hot-toast'

const money = (v: any) => (Math.round(Number(v) || 0)).toLocaleString('ru-RU') + ' сом.'
const ACCOUNTS: { key: string; label: string }[] = [
  { key: 'alif', label: 'Alif' },
  { key: 'dushanbe_city', label: 'Dushanbe City' },
  { key: 'cash', label: 'Наличные' },
]

/** «Счета и справочники» — редактируемые стартовые балансы + балансы из операций. */
export default function FinanceSettingsPage() {
  const qc = useQueryClient()
  const { data: summary } = useQuery({ queryKey: ['finance', 'accounts-summary'], queryFn: financeApi.accountsSummary })
  const { data: opening } = useQuery({ queryKey: ['finance', 'opening-balances'], queryFn: financeApi.openingBalances })

  const [form, setForm] = useState<Record<string, string>>({})
  useEffect(() => {
    if (opening) setForm({ alif: String(opening.alif ?? 0), dushanbe_city: String(opening.dushanbe_city ?? 0), cash: String(opening.cash ?? 0) })
  }, [opening])

  const save = useMutation({
    mutationFn: () => financeApi.setOpeningBalances({
      alif: Number(form.alif) || 0, dushanbe_city: Number(form.dushanbe_city) || 0, cash: Number(form.cash) || 0,
    }),
    onSuccess: () => { toast.success('Стартовые балансы сохранены'); qc.invalidateQueries({ queryKey: ['finance'] }) },
    onError: () => toast.error('Не удалось сохранить'),
  })

  const perAccount: any[] = summary?.perAccount || []
  const total = summary?.total
  const balOf = (k: string) => perAccount.find(a => a.account === k)?.balance ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-surface-500" />
        <div>
          <h1 className="page-title">Счета и справочники</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Стартовые балансы (вводятся вручную) + текущие балансы из операций.</p>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title mb-3">Счета и стартовые балансы</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className="py-2 pr-3 font-medium">Счёт</th>
                <th className="py-2 px-3 font-medium">Стартовый баланс</th>
                <th className="py-2 px-3 font-medium text-right">Приход</th>
                <th className="py-2 px-3 font-medium text-right">Расход</th>
                <th className="py-2 pl-3 font-medium text-right">Текущий баланс</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNTS.map(a => {
                const acc = perAccount.find(x => x.account === a.key)
                return (
                  <tr key={a.key} className="border-b border-surface-50 dark:border-surface-800/60">
                    <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{a.label}</td>
                    <td className="py-2 px-3">
                      <input
                        type="number"
                        value={form[a.key] ?? ''}
                        onChange={e => setForm(f => ({ ...f, [a.key]: e.target.value }))}
                        className="input w-36 py-1 text-right tabular-nums"
                        placeholder="0"
                      />
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(acc?.income)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-red-600 dark:text-red-400">{money(acc?.expense)}</td>
                    <td className="py-2 pl-3 text-right tabular-nums font-semibold">{money(balOf(a.key))}</td>
                  </tr>
                )
              })}
              {total && (
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Итого</td>
                  <td className="py-2 px-3 tabular-nums">{money(total.opening)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(total.income)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-red-600 dark:text-red-400">{money(total.expense)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{money(total.balance)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary text-sm">
            {save.isPending ? 'Сохранение…' : 'Сохранить стартовые балансы'}
          </button>
        </div>
        <p className="text-xs text-surface-400 mt-2">Текущий баланс = стартовый + приход − расход (сквозной, не за месяц).</p>
      </div>

      <div className="card">
        <h3 className="section-title mb-3">Справочники</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link to="/employees" className="flex items-center gap-2 p-3 rounded-xl border border-surface-200 dark:border-surface-700 hover:border-surface-400 dark:hover:border-surface-500 transition-colors">
            <Users size={16} className="text-primary-600" /> <span className="text-sm font-medium">Сотрудники</span>
          </Link>
          <Link to="/projects" className="flex items-center gap-2 p-3 rounded-xl border border-surface-200 dark:border-surface-700 hover:border-surface-400 dark:hover:border-surface-500 transition-colors">
            <FolderKanban size={16} className="text-primary-600" /> <span className="text-sm font-medium">Проекты</span>
          </Link>
          <Link to="/tariffs" className="flex items-center gap-2 p-3 rounded-xl border border-surface-200 dark:border-surface-700 hover:border-surface-400 dark:hover:border-surface-500 transition-colors">
            <Tag size={16} className="text-primary-600" /> <span className="text-sm font-medium">SMM-тарифы</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
