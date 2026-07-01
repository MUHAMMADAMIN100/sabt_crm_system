import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { projectsApi } from '@/services/api.service'
import { TrendingUp } from 'lucide-react'
import clsx from 'clsx'

const money = (v: any) => (Math.round(Number(v) || 0)).toLocaleString('ru-RU') + ' сом.'

/** Направления дохода — переиспользуем существующие проекты CRM по типу. */
const DIRECTIONS: { key: string; label: string; color: string; match: (p: any) => boolean }[] = [
  { key: 'smm', label: 'SMM', color: '#16a34a', match: p => p.projectType === 'SMM' },
  { key: 'design', label: 'Design', color: '#a855f7', match: p => /дизайн|design/i.test(p.projectType || '') },
  { key: 'development', label: 'Development', color: '#0ea5e9', match: p => p.projectType !== 'SMM' && !/дизайн|design/i.test(p.projectType || '') },
]

/**
 * «Доходы» — сводка по 3 направлениям на основе реальных проектов CRM:
 * план = сумма тарифов/абонплат активных проектов, факт = оплачено (paidAmount).
 * Детальные помесячные матрицы оплат — следующий этап.
 */
export default function FinanceIncomePage() {
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects', 'all-fin'], queryFn: () => projectsApi.list() })

  const groups = useMemo(() => {
    const active = (projects as any[]).filter(p => !p.isArchived && p.status !== 'planning')
    return DIRECTIONS.map(d => {
      const list = active.filter(d.match)
      const plan = list.reduce((s, p) => s + (Number(p.monthlyFee) || 0), 0)
      const paid = list.reduce((s, p) => s + (Number(p.paidAmount) || 0), 0)
      return { ...d, list, plan, paid }
    })
  }, [projects])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <TrendingUp size={20} className="text-green-500" />
        <div>
          <h1 className="page-title">Доходы по направлениям</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-0.5 text-sm">
            План и факт по проектам SMM / Development / Design (данные из проектов CRM).
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-surface-400 animate-pulse">Загрузка…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {groups.map(g => (
              <div key={g.key} className="card">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="font-semibold text-surface-800 dark:text-surface-100">{g.label}</span>
                  <span className="ml-auto text-xs text-surface-400">{g.list.length} проектов</span>
                </div>
                <p className="text-2xl font-bold text-surface-900 dark:text-surface-100 tabular-nums">{money(g.paid)}</p>
                <p className="text-xs text-surface-400 mt-0.5">получено · план {money(g.plan)}</p>
              </div>
            ))}
          </div>

          {groups.map(g => (
            <div key={g.key} className="card">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                <h3 className="section-title">{g.label}</h3>
                <span className="ml-auto text-xs text-surface-400">получено {money(g.paid)} / план {money(g.plan)}</span>
              </div>
              {g.list.length === 0 ? (
                <p className="text-sm text-surface-400 py-3">Нет активных проектов направления.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-surface-400 border-b border-surface-100 dark:border-surface-700">
                        <th className="py-2 pr-3 font-medium">Проект</th>
                        <th className="py-2 px-3 font-medium">Тариф</th>
                        <th className="py-2 px-3 font-medium text-right">План (абон.)</th>
                        <th className="py-2 px-3 font-medium text-right">Оплачено</th>
                        <th className="py-2 pl-3 font-medium text-right">Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.list.map(p => {
                        const plan = Number(p.monthlyFee) || 0
                        const paid = Number(p.paidAmount) || 0
                        const rest = Math.max(0, plan - paid)
                        return (
                          <tr key={p.id} className="border-b border-surface-50 dark:border-surface-800/60">
                            <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200">{p.name}</td>
                            <td className="py-2 px-3 text-surface-500 dark:text-surface-400">{p.tariffNameSnapshot || '—'}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{money(plan)}</td>
                            <td className={clsx('py-2 px-3 text-right tabular-nums font-medium', paid > 0 ? 'text-green-600 dark:text-green-400' : 'text-surface-400')}>{money(paid)}</td>
                            <td className="py-2 pl-3 text-right tabular-nums text-surface-500 dark:text-surface-400">{money(rest)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
