import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi, employeesApi } from '@/services/api.service'
import { tasksApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { StatCard, PageLoader, StatusBadge, Avatar } from '@/components/ui'
import {
  FolderKanban, CheckSquare, Users, AlertTriangle,
  TrendingDown, UserX, Activity, Clock, DollarSign,
  Briefcase, Edit2, Check, X,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'

export default function FounderDashboard() {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canSeeFinance = user?.role === 'founder'
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null)
  const [salaryValue, setSalaryValue] = useState('')

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
    queryKey: ['payroll'],
    queryFn: analyticsApi.payroll,
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

  const totalPayroll = payroll?.totalPayroll || 0
  const totalBudget = payroll?.totalBudget || 0

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

      {/* Finance KPI row — founder only */}
      {canSeeFinance && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
            <DollarSign size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-surface-500 dark:text-surface-400">Зарплатный фонд</p>
            <p className="text-xl font-bold text-surface-900 dark:text-surface-100">
              {totalPayroll.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
            </p>
            <p className="text-xs text-surface-400 dark:text-surface-500">{payroll?.employeeCount || 0} сотрудников</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <Briefcase size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-surface-500 dark:text-surface-400">Бюджет проектов</p>
            <p className="text-xl font-bold text-surface-900 dark:text-surface-100">
              {totalBudget.toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
            </p>
            <p className="text-xs text-surface-400 dark:text-surface-500">{payroll?.projects?.length || 0} активных проектов</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
            <Activity size={20} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-xs text-surface-500 dark:text-surface-400">Прибыль (бюджет − ФОТ)</p>
            <p className={`text-xl font-bold ${totalBudget - totalPayroll >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
              {(totalBudget - totalPayroll).toLocaleString('ru-RU')} <span className="text-sm font-normal">сомони</span>
            </p>
            <p className="text-xs text-surface-400 dark:text-surface-500">расчётная маржа</p>
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
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{t.title}</p>
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
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <CheckSquare size={16} /> Эффективность сотрудников
        </h2>
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
      </div>

      {/* Payroll table — founder only */}
      {canSeeFinance && (
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <DollarSign size={16} /> Зарплатный фонд — сотрудники
        </h2>
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
                <td colSpan={3} className="pt-3 font-semibold text-surface-700 dark:text-surface-300">Итого ФОТ</td>
                <td className="pt-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                  {totalPayroll.toLocaleString('ru-RU')} сомони
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      )}

      {/* Projects revenue — founder only */}
      {canSeeFinance && (
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <Briefcase size={16} /> Доход по проектам
        </h2>
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
      </div>
      )}
    </div>
  )
}
