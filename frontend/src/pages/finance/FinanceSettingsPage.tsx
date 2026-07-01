import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { financeApi } from '@/services/api.service'
import { Settings, Users, FolderKanban, Tag } from 'lucide-react'

const money = (v: any) => (Math.round(Number(v) || 0)).toLocaleString('ru-RU') + ' сом.'
const ACCOUNT_LABELS: Record<string, string> = { alif: 'Alif', dushanbe_city: 'Dushanbe City', cash: 'Наличные' }

/** «Счета и справочники» — балансы счетов + быстрые ссылки на справочники CRM. */
export default function FinanceSettingsPage() {
  const { data } = useQuery({ queryKey: ['finance', 'accounts-summary'], queryFn: financeApi.accountsSummary })
  const perAccount: any[] = data?.perAccount || []
  const total = data?.total

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Settings size={20} className="text-surface-500" />
        <div>
          <h1 className="page-title">Счета и справочники</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">Балансы счетов (считаются из операций) и справочники системы.</p>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title mb-3">Счета</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                <th className="py-2 pr-3 font-medium">Счёт</th>
                <th className="py-2 px-3 font-medium text-right">Приход</th>
                <th className="py-2 px-3 font-medium text-right">Расход</th>
                <th className="py-2 pl-3 font-medium text-right">Баланс</th>
              </tr>
            </thead>
            <tbody>
              {perAccount.map(a => (
                <tr key={a.account} className="border-b border-surface-50 dark:border-surface-800/60">
                  <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{ACCOUNT_LABELS[a.account] || a.account}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(a.income)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-red-600 dark:text-red-400">{money(a.expense)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums font-semibold">{money(a.balance)}</td>
                </tr>
              ))}
              {total && (
                <tr className="font-semibold">
                  <td className="py-2 pr-3">Итого</td>
                  <td className="py-2 px-3 text-right tabular-nums text-green-600 dark:text-green-400">{money(total.income)}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-red-600 dark:text-red-400">{money(total.expense)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{money(total.balance)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-surface-400 mt-3">Редактируемые стартовые балансы, аренда/подписки и долги — в следующем этапе.</p>
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
