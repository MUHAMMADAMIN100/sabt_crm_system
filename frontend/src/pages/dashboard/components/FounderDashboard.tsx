import { useState, useMemo, lazy, Suspense } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi, employeesApi, projectsApi } from '@/services/api.service'
import { tasksApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { StatCard, PageLoader, StatusBadge, Avatar, CollapsibleSection } from '@/components/ui'
import {
  FolderKanban, CheckSquare, Users, AlertTriangle,
  TrendingDown, UserX, Activity, Clock, DollarSign,
  Briefcase, Edit2, Check, X, Calendar, Camera, TrendingUp,
} from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'

const StoryCalendar = lazy(() => import('@/components/stories/StoryCalendar'))
const GlobalStoriesCalendar = lazy(() => import('./GlobalStoriesCalendar'))
import { format, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, eachDayOfInterval, getDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'

type FinancePeriod = 'this_month' | 'last_3_months' | 'this_year' | 'all_time'

const PERIOD_LABELS: Record<FinancePeriod, string> = {
  this_month: 'Этот месяц',
  last_3_months: 'Последние 3 месяца',
  this_year: 'Этот год',
  all_time: 'Всё время',
}

function periodToRange(period: FinancePeriod): { from?: string; to?: string } {
  const now = new Date()
  if (period === 'all_time') return {}
  if (period === 'this_month') {
    return {
      from: format(startOfMonth(now), 'yyyy-MM-dd'),
      to: format(endOfMonth(now), 'yyyy-MM-dd'),
    }
  }
  if (period === 'last_3_months') {
    return {
      from: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'),
      to: format(endOfMonth(now), 'yyyy-MM-dd'),
    }
  }
  // this_year
  return {
    from: format(startOfYear(now), 'yyyy-MM-dd'),
    to: format(endOfYear(now), 'yyyy-MM-dd'),
  }
}

export default function FounderDashboard() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canSeeFinance = user?.role === 'founder' || user?.role === 'co_founder'
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null)
  const [salaryValue, setSalaryValue] = useState('')
  const [period, setPeriod] = useState<FinancePeriod>('this_month')
  const range = useMemo(() => periodToRange(period), [period])

  const { data: overview, isLoading } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: analyticsApi.overview,
  })

  const { data: overdueTasks } = useQuery({
    queryKey: ['tasks-overdue'],
    queryFn: tasksApi.overdue,
  })

  const { data: workload } = useQuery({
    queryKey: ['employee-workload'],
    queryFn: analyticsApi.employeeWorkload,
  })

  const { data: efficiency } = useQuery({
    queryKey: ['employee-efficiency'],
    queryFn: analyticsApi.employeeEfficiency,
  })

  const { data: avgCompletion } = useQuery({
    queryKey: ['avg-completion'],
    queryFn: analyticsApi.avgCompletion,
  })

  const { data: payroll } = useQuery({
    queryKey: ['payroll', range.from, range.to],
    queryFn: () => analyticsApi.payroll(range),
    enabled: canSeeFinance,
  })

  const salaryMut = useMutation({
    mutationFn: ({ id, salary }: { id: string; salary: number }) =>
      employeesApi.update(id, { salary }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll'] })
      qc.invalidateQueries({ queryKey: ['employees'] })
      qc.invalidateQueries({ queryKey: ['employee'] })
      qc.invalidateQueries({ queryKey: ['analytics-overview'] })
      setEditingSalaryId(null)
      toast.success('Зарплата обновлена')
    },
    onError: () => toast.error('Ошибка обновления'),
  })

  if (isLoading) return <PageLoader />

  const atRiskProjects = overview?.overdueTasks > 0 ? Math.ceil(overview.overdueTasks / 3) : 0
  const inactiveEmployees = (workload || []).filter((e: any) => e.activeTasks === 0)
  const overloadedPMs = (workload || []).filter((e: any) => e.activeTasks >= 10)

  const monthlyPayroll = Number(payroll?.monthlyPayroll || 0)
  const totalBudget = Number(payroll?.totalBudget || 0)
  const lifetimePaid = Number(payroll?.lifetimePaid || 0)
  const revenueForPeriod = Number(payroll?.revenueForPeriod || 0)
  const payrollForPeriod = Number(payroll?.payrollForPeriod || 0)
  const profitForPeriod = Number(payroll?.profitForPeriod || 0)
  const isAllTime = period === 'all_time'

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          title="Активных проектов"
          value={overview?.activeProjects ?? 0}
          icon={FolderKanban}
          color="bg-primary-600"
          sub={`из ${overview?.totalProjects ?? 0} всего`}
        />
        <StatCard
          title="Просроченных задач"
          value={overview?.overdueTasks ?? 0}
          icon={TrendingDown}
          color="bg-red-500"
          sub="требуют внимания"
        />
        <StatCard
          title="Сотрудников"
          value={overview?.totalEmployees ?? 0}
          icon={Users}
          color="bg-amber-500"
          sub={`${inactiveEmployees.length} неактивных`}
        />
        <StatCard
          title="Проектов в риске"
          value={atRiskProjects}
          icon={AlertTriangle}
          color="bg-orange-500"
          sub="по просрочкам"
        />
        <StatCard
          title="Среднее время закрытия"
          value={avgCompletion ? `${avgCompletion.avgDays}д` : '—'}
          icon={Clock}
          color="bg-violet-500"
          sub={avgCompletion ? `${avgCompletion.totalDone} задач закрыто` : 'нет данных'}
        />
      </div>

      {/* Finance section — founder only */}
      {canSeeFinance && (
      <div className="space-y-4">
        {/* Period selector */}
        <div className="flex flex-wrap items-center gap-2">
          <Calendar size={14} className="text-surface-400 dark:text-surface-500" />
          <span className="text-xs font-medium text-surface-500 dark:text-surface-400 mr-1">Период:</span>
          {(Object.keys(PERIOD_LABELS) as FinancePeriod[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                period === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
              )}
            >{PERIOD_LABELS[p]}</button>
          ))}
        </div>

        {/* Period-specific finance KPIs */}
        {!isAllTime && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                <DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-surface-500 dark:text-surface-400">Получено за период</p>
                <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">
                  {revenueForPeriod.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
                </p>
                <p className="text-xs text-surface-400 dark:text-surface-500">{payroll?.payments?.length || 0} платежей</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                <Users size={20} className="text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-xs text-surface-500 dark:text-surface-400">Расход на ЗП за период</p>
                <p className="text-xl font-bold text-orange-700 dark:text-orange-400">
                  {payrollForPeriod.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
                </p>
                <p className="text-xs text-surface-400 dark:text-surface-500">по истории зарплат</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className={clsx(
                'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                profitForPeriod >= 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30',
              )}>
                <Activity size={20} className={profitForPeriod >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'} />
              </div>
              <div>
                <p className="text-xs text-surface-500 dark:text-surface-400">Прибыль за период</p>
                <p className={`text-xl font-bold ${profitForPeriod >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                  {profitForPeriod.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
                </p>
                <p className="text-xs text-surface-400 dark:text-surface-500">получено − ЗП</p>
              </div>
            </div>
          </div>
        )}

        {/* Lifetime / overall KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="card flex items-center gap-4 opacity-90">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-xs text-surface-500 dark:text-surface-400">Месячный ФОТ (текущий)</p>
              <p className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {monthlyPayroll.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
              </p>
              <p className="text-xs text-surface-400 dark:text-surface-500">{payroll?.employeeCount || 0} сотрудников</p>
            </div>
          </div>
          <div className="card flex items-center gap-4 opacity-90">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <Briefcase size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-surface-500 dark:text-surface-400">Бюджет всех проектов</p>
              <p className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {totalBudget.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
              </p>
              <p className="text-xs text-surface-400 dark:text-surface-500">контрактная сумма</p>
            </div>
          </div>
          <div className="card flex items-center gap-4 opacity-90">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
              <Activity size={20} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <p className="text-xs text-surface-500 dark:text-surface-400">Всего получено (всё время)</p>
              <p className="text-xl font-bold text-surface-900 dark:text-surface-100">
                {lifetimePaid.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
              </p>
              <p className="text-xs text-surface-400 dark:text-surface-500">из {totalBudget.toLocaleString('ru-RU')} в контрактах</p>
            </div>
          </div>
        </div>
      </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overdue tasks */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title text-red-600 dark:text-red-400 flex items-center gap-2">
              <TrendingDown size={16} /> Просроченные задачи
            </h2>
            <Link to="/tasks?overdue=true" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
              Все
            </Link>
          </div>
          {!overdueTasks?.length ? (
            <p className="text-sm text-green-600 dark:text-green-400 py-4 text-center">Просрочек нет ✓</p>
          ) : (
            <div className="space-y-2">
              {overdueTasks.slice(0, 8).map((t: any) => (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{t.title}</p>
                      {t.createdById && t.assigneeId && (t.createdById === t.assigneeId || t.createdBy?.name?.trim()) && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${t.createdById === t.assigneeId ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                          {t.createdById === t.assigneeId ? 'сам' : (t.createdBy?.name?.trim().split(' ')[0] || '')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-surface-400 dark:text-surface-500">{t.project?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.assignee && <Avatar name={t.assignee.name} src={t.assignee.avatar} size={20} />}
                    {t.deadline && (
                      <span className="text-xs text-red-500 font-medium">
                        {format(new Date(t.deadline), 'dd.MM', { locale: ru })}
                      </span>
                    )}
                    <StatusBadge status={t.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Inactive employees */}
          <div className="card">
            <h3 className="font-semibold text-sm text-surface-900 dark:text-surface-100 mb-3 flex items-center gap-2">
              <UserX size={14} className="text-orange-500" /> Неактивные сегодня
            </h3>
            {inactiveEmployees.length === 0 ? (
              <p className="text-xs text-green-600 dark:text-green-400">Все активны ✓</p>
            ) : (
              <div className="space-y-2">
                {inactiveEmployees.slice(0, 6).map((e: any) => (
                  <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-2 hover:opacity-80">
                    <Avatar name={e.name} src={e.avatar} size={24} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-surface-800 dark:text-surface-200 truncate">{e.name}</p>
                      <p className="text-[10px] text-surface-400 dark:text-surface-500 truncate">{e.position}</p>
                    </div>
                    <span className="text-[10px] text-orange-500 font-semibold">{e.activeTasks} задач</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Overloaded */}
          {overloadedPMs.length > 0 && (
            <div className="card border-orange-100 dark:border-orange-900/30">
              <h3 className="font-semibold text-sm text-orange-700 dark:text-orange-400 mb-3 flex items-center gap-2">
                <Activity size={14} /> Перегруженные
              </h3>
              <div className="space-y-2">
                {overloadedPMs.slice(0, 4).map((e: any) => (
                  <Link key={e.id} to={`/employees/${e.id}`} className="flex items-center gap-2 hover:opacity-80">
                    <Avatar name={e.name} src={e.avatar} size={24} />
                    <span className="text-xs text-surface-800 dark:text-surface-200 flex-1 truncate">{e.name}</span>
                    <span className="text-xs font-bold text-orange-600">{e.activeTasks}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Employee efficiency table */}
      <CollapsibleSection
        id="efficiency"
        title={<h2 className="section-title flex items-center gap-2"><CheckSquare size={16} /> Эффективность сотрудников</h2>}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                <th className="pb-2 font-medium">Сотрудник</th>
                <th className="pb-2 font-medium text-right">Выполнено</th>
                <th className="pb-2 font-medium text-right">Всего</th>
                <th className="pb-2 font-medium text-right">Часов</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-surface-800">
              {(efficiency?.data || []).slice(0, 10).map((e: any) => {
                const empLink = e.employeeEntityId ? `/employees/${e.employeeEntityId}` : `/employees/${e.id}`
                return (
                  <tr key={e.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors cursor-pointer">
                    <td className="py-2">
                      <Link to={empLink} className="flex items-center gap-2">
                        <Avatar name={e.name} size={24} />
                        <div>
                          <p className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400">{e.name}</p>
                          <p className="text-[10px] text-surface-400">{e.position}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="py-2 text-right font-semibold text-green-600 dark:text-green-400">{e.doneTasks}</td>
                    <td className="py-2 text-right text-surface-500">{e.totalTasks}</td>
                    <td className="py-2 text-right text-surface-500">{e.totalHours?.toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* Story calendar — admin view (all employees) */}
      <CollapsibleSection
        id="stories-admin"
        title={<h2 className="section-title flex items-center gap-2"><Camera size={16} /> Истории сотрудников</h2>}
        defaultOpen={false}
      >
        <Suspense fallback={<div className="text-center text-sm text-surface-400 py-4">Загрузка...</div>}>
          <StoryCalendar adminAll compact />
        </Suspense>
      </CollapsibleSection>

      {/* Global stories calendar (aggregated across all projects) */}
      {canSeeFinance && (
        <Suspense fallback={<div className="card text-center text-sm text-surface-400 py-4">Загрузка...</div>}>
          <GlobalStoriesCalendar />
        </Suspense>
      )}

      {/* Income vs Expense — global */}
      {canSeeFinance && (
        <IncomeExpenseChart sectionId="ie-global" title="🌍 Доходы и расходы компании (все проекты)" />
      )}

      {/* Income vs Expense — per project */}
      {canSeeFinance && (
        <IncomeExpenseChart sectionId="ie-project" title="📁 Доходы и расходы по проекту" perProject />
      )}

      {/* Payroll table — founder only */}
      {canSeeFinance && (
      <CollapsibleSection
        id="payroll"
        title={<h2 className="section-title flex items-center gap-2"><DollarSign size={16} /> Зарплатный фонд — сотрудники</h2>}
        defaultOpen={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                <th className="pb-2 font-medium">Сотрудник</th>
                <th className="pb-2 font-medium">Должность</th>
                <th className="pb-2 font-medium">Отдел</th>
                <th className="pb-2 font-medium text-right">Зарплата (сомони)</th>
                <th className="pb-2 font-medium text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-surface-800">
              {(payroll?.employeeList || []).map((e: any) => (
                <tr key={e.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors">
                  <td className="py-2">
                    <Link to={`/employees/${e.id}`} className="flex items-center gap-2 hover:text-primary-600 dark:hover:text-primary-400">
                      <Avatar name={e.fullName} src={e.avatar} size={24} />
                      <span className="font-medium text-surface-900 dark:text-surface-100">{e.fullName}</span>
                    </Link>
                  </td>
                  <td className="py-2 text-surface-500 dark:text-surface-400 text-xs">{e.position}</td>
                  <td className="py-2 text-surface-500 dark:text-surface-400 text-xs">{e.department}</td>
                  <td className="py-2 text-right">
                    {editingSalaryId === e.id ? (
                      <input
                        type="number"
                        className="input py-1 text-sm w-36 text-right"
                        value={salaryValue}
                        onChange={ev => setSalaryValue(ev.target.value)}
                        min={0}
                        autoFocus
                      />
                    ) : (
                      <span className="font-semibold text-surface-900 dark:text-surface-100">
                        {(e.salary || 0).toLocaleString('ru-RU')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {editingSalaryId === e.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => salaryMut.mutate({ id: e.id, salary: Number(salaryValue) })}
                          className="p-1.5 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg text-green-600"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setEditingSalaryId(null)}
                          className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-500"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingSalaryId(e.id); setSalaryValue(String(e.salary || 0)) }}
                        className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-400 hover:text-primary-600"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-surface-200 dark:border-surface-600">
                <td colSpan={3} className="pt-3 font-semibold text-surface-700 dark:text-surface-300">Итого ФОТ (в месяц)</td>
                <td className="pt-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                  {monthlyPayroll.toLocaleString('ru-RU')} сомони
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </CollapsibleSection>
      )}

      {/* Projects revenue — founder only */}
      {canSeeFinance && (
      <CollapsibleSection
        id="projects-revenue"
        title={<h2 className="section-title flex items-center gap-2"><Briefcase size={16} /> Доход по проектам</h2>}
        defaultOpen={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                <th className="pb-2 font-medium">Проект</th>
                <th className="pb-2 font-medium text-right">Бюджет</th>
                <th className="pb-2 font-medium text-right">Оплачено</th>
                <th className="pb-2 font-medium text-right">Остаток</th>
                <th className="pb-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-surface-800">
              {(payroll?.projects || []).map((p: any) => {
                const remaining = (p.budget || 0) - (p.paidAmount || 0)
                return (
                  <tr key={p.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors">
                    <td className="py-2">
                      <Link to={`/projects/${p.id}`} className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400">
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-2 text-right text-surface-500">{(p.budget || 0).toLocaleString('ru-RU')}</td>
                    <td className="py-2 text-right font-semibold text-green-600 dark:text-green-400">{(p.paidAmount || 0).toLocaleString('ru-RU')}</td>
                    <td className={`py-2 text-right font-semibold ${remaining > 0 ? 'text-orange-500' : 'text-green-600 dark:text-green-400'}`}>
                      {remaining.toLocaleString('ru-RU')}
                    </td>
                    <td className="py-2">
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>
      )}
    </div>
  )
}

// ─── Income vs Expense chart ─────────────────────────────────────
const CHART_PERIODS: { value: FinancePeriod; label: string }[] = [
  { value: 'this_month', label: 'Этот месяц' },
  { value: 'last_3_months', label: '3 месяца' },
  { value: 'this_year', label: 'Этот год' },
  { value: 'all_time', label: 'Всё время' },
]

function IncomeExpenseChart({ title, perProject, sectionId }: { title: string; perProject?: boolean; sectionId: string }) {
  const [period, setPeriod] = useState<FinancePeriod>('this_year')
  const [projectId, setProjectId] = useState<string>('')
  const [projectType, setProjectType] = useState<string>('')
  const range = useMemo(() => periodToRange(period), [period])

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    enabled: perProject,
  })

  const filteredProjects = useMemo(() => {
    if (!perProject) return []
    return (projects || []).filter((p: any) => !projectType || p.projectType === projectType)
  }, [projects, projectType, perProject])

  const { data, isLoading } = useQuery({
    queryKey: ['income-expense', range.from, range.to, perProject ? projectId : null],
    queryFn: () => analyticsApi.incomeExpense({
      from: range.from,
      to: range.to,
      projectId: perProject && projectId ? projectId : undefined,
    }),
  })

  const fmt = (n: number) => n.toLocaleString('ru-RU')
  const series = (data?.series || []).map((s: any) => ({
    ...s,
    monthLabel: format(new Date(s.month + '-01'), 'LLL yy', { locale: ru }),
  }))
  const totals = data?.totals || { income: 0, payroll: 0, ads: 0, expense: 0, profit: 0 }

  return (
    <CollapsibleSection
      id={sectionId}
      title={
        <div className="flex items-center justify-between flex-wrap gap-3 w-full">
          <h2 className="section-title flex items-center gap-2"><TrendingUp size={16} /> {title}</h2>
          <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
            {perProject && (
              <>
                <select value={projectType} onChange={e => { setProjectType(e.target.value); setProjectId('') }} className="input text-xs py-1.5 w-32">
                  <option value="">Все типы</option>
                  <option value="Web сайт">Web сайт</option>
                  <option value="Дизайн">Дизайн</option>
                  <option value="SMM">SMM</option>
                </select>
                <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-xs py-1.5 w-48">
                  <option value="">Все проекты</option>
                  {filteredProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </>
            )}
            {CHART_PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={clsx(
                  'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  period === p.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200',
                )}
              >{p.label}</button>
            ))}
          </div>
        </div>
      }
    >

      {isLoading ? (
        <p className="text-sm text-surface-400 text-center py-12">Загрузка...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">Доход</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{fmt(totals.income)}</p>
            </div>
            <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-900/20">
              <p className="text-xs text-orange-700 dark:text-orange-400">Зарплаты</p>
              <p className="text-lg font-bold text-orange-700 dark:text-orange-400">{fmt(totals.payroll)}</p>
            </div>
            <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-900/20">
              <p className="text-xs text-purple-700 dark:text-purple-400">Реклама</p>
              <p className="text-lg font-bold text-purple-700 dark:text-purple-400">{fmt(totals.ads)}</p>
            </div>
            <div className={clsx(
              'p-3 rounded-xl',
              totals.profit >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20',
            )}>
              <p className={clsx('text-xs', totals.profit >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>Прибыль</p>
              <p className={clsx('text-lg font-bold', totals.profit >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>{fmt(totals.profit)}</p>
            </div>
          </div>

          {series.length === 0 ? (
            <p className="text-sm text-surface-400 text-center py-8">Нет данных за период</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis
                  dataKey="monthLabel"
                  tick={{ fontSize: 11 }}
                  label={{ value: 'Месяц', position: 'insideBottom', offset: -2, style: { fontSize: 10, fill: '#94a3b8' } }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}к` : v}
                  label={{ value: 'Сомони', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }}
                />
                <Tooltip formatter={(v: any) => `${fmt(Number(v))} сомони`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="income" name="Доход" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="payroll" name="Зарплаты" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="ads" name="Реклама" stroke="#a855f7" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </CollapsibleSection>
  )
}
