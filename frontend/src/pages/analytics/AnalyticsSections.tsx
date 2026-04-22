import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Loader2, AlertTriangle, AlertCircle, CheckCircle2, ExternalLink, Tag, DollarSign, Users, Briefcase } from 'lucide-react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  riskApi, smmTariffsApi, projectsApi, analyticsApi, employeesApi,
} from '@/services/api.service'

type Level = 'green' | 'yellow' | 'red'

const LEVEL_CHIP: Record<Level, string> = {
  green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const COLORS = ['#6B4FCF', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4']

const fmtMoney = (v: any) => v == null ? '—' : new Intl.NumberFormat('ru-RU').format(Number(v)) + ' сомони'

// ═══════════════════════════════════════════════════════════════════
// 1. FOUNDER ANALYTICS — KPI верхнего уровня (выручка / маржа / total)
// ═══════════════════════════════════════════════════════════════════
export function FounderAnalyticsSection() {
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: dashboard } = useQuery({ queryKey: ['analytics-dashboard'], queryFn: analyticsApi.dashboard })

  if (isLoading) return <Loading />

  const list = (projects || []).filter((p: any) => !p.isArchived)
  const totalContract = list.reduce((s: number, p: any) => s + Number(p.totalContractValue || 0), 0)
  const totalPaid = list.reduce((s: number, p: any) => s + Number(p.paidAmount || 0), 0)
  const totalOutstanding = list.reduce((s: number, p: any) => s + Number(p.outstandingAmount || 0), 0)
  const totalMargin = list.reduce((s: number, p: any) => s + Number(p.marginEstimate || 0), 0)
  const overdue = list.filter((p: any) => p.paymentStatus === 'overdue').length

  const overview = dashboard?.overview

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base flex items-center gap-2"><Briefcase size={16} className="text-purple-500" /> Founder analytics</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Активных проектов" value={overview?.activeProjects ?? list.length} accent="text-purple-600" />
        <Tile label="Контрактов всего"  value={fmtMoney(totalContract)} accent="text-blue-600" />
        <Tile label="Получено"          value={fmtMoney(totalPaid)} accent="text-emerald-600" />
        <Tile label="К оплате"          value={fmtMoney(totalOutstanding)} accent={totalOutstanding > 0 ? 'text-amber-600' : 'text-gray-500'} />
        <Tile label="Маржа (план)"      value={fmtMoney(totalMargin)} accent="text-emerald-600" />
        <Tile label="Просрочки оплат"   value={overdue} accent={overdue > 0 ? 'text-red-600' : 'text-gray-500'} />
        <Tile label="Завершено задач"   value={`${overview?.completionRate ?? 0}%`} />
        <Tile label="Просрочка задач"   value={overview?.overdueTasks ?? 0} accent="text-red-600" />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 2. TEAM ANALYTICS — нагрузка команды
// ═══════════════════════════════════════════════════════════════════
export function TeamAnalyticsSection() {
  const { data: workloads, isLoading } = useQuery({
    queryKey: ['workload-employees-all'],
    queryFn: () => riskApi.workloadEmployees(),
  })
  const { data: pmWorkloads } = useQuery({
    queryKey: ['workload-pm-all'],
    queryFn: () => riskApi.workloadPm(),
  })

  if (isLoading) return <Loading />

  const team = (workloads || []).slice().sort((a: any, b: any) => b.tasksInProgress - a.tasksInProgress)
  const overloaded = team.filter((w: any) => w.overload === 'red').length
  const yellow = team.filter((w: any) => w.overload === 'yellow').length

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base flex items-center gap-2"><Users size={16} className="text-purple-500" /> Team analytics</h2>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Перегружены (red)" value={overloaded} accent="text-red-600" />
        <Tile label="Высокая нагрузка"  value={yellow} accent="text-amber-600" />
        <Tile label="Норма"             value={team.length - overloaded - yellow} accent="text-emerald-600" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Сотрудник</th>
              <th className="text-left px-3 py-2">Роль</th>
              <th className="text-right px-3 py-2">Проекты</th>
              <th className="text-right px-3 py-2">В работе</th>
              <th className="text-right px-3 py-2">В очереди</th>
              <th className="text-right px-3 py-2">Часов 30д</th>
              <th className="text-center px-3 py-2">Overload</th>
            </tr>
          </thead>
          <tbody>
            {team.map((w: any) => (
              <tr key={w.userId} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2"><Link to={`/employees/${w.userId}`} className="hover:text-purple-600">{w.userName}</Link></td>
                <td className="px-3 py-2 text-xs text-gray-500">{w.role}</td>
                <td className="px-3 py-2 text-right">{w.projectCount}</td>
                <td className="px-3 py-2 text-right">{w.tasksInProgress}</td>
                <td className="px-3 py-2 text-right">{w.tasksInQueue}</td>
                <td className="px-3 py-2 text-right">{w.loggedHoursLast30d}</td>
                <td className="px-3 py-2 text-center">
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_CHIP[w.overload as Level])}>{w.overload}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pmWorkloads && pmWorkloads.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Нагрузка PM-ов</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pmWorkloads.map((p: any) => (
              <div key={p.pmId} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
                <div className="font-medium text-sm mb-1">{p.pmName}</div>
                <div className="text-xs text-gray-500 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <span>Проектов: {p.projectCount}</span>
                  <span>SMM: {p.smmSpecialistCount}</span>
                  <span>На проверке: {p.tasksOnReview}</span>
                  <span>На доработке: {p.tasksOnRework}</span>
                  <span className="col-span-2 text-red-600">В риске: {p.projectsAtRisk}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 3. SMM ANALYTICS — только по SMM-проектам
// ═══════════════════════════════════════════════════════════════════
export function SmmAnalyticsSection() {
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })

  if (isLoading) return <Loading />

  const smmProjects = (projects || []).filter((p: any) => p.projectType === 'SMM' && !p.isArchived)
  const withTariff = smmProjects.filter((p: any) => p.tariffId)
  const withoutTariff = smmProjects.filter((p: any) => !p.tariffId)

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base flex items-center gap-2">📱 SMM analytics</h2>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="SMM-проектов" value={smmProjects.length} accent="text-purple-600" />
        <Tile label="С тарифом"    value={withTariff.length} accent="text-emerald-600" />
        <Tile label="Без тарифа"   value={withoutTariff.length} accent={withoutTariff.length > 0 ? 'text-amber-600' : 'text-gray-500'} />
      </div>

      {smmProjects.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Проект</th>
                <th className="text-left px-3 py-2">Тариф</th>
                <th className="text-right px-3 py-2">Месячная плата</th>
                <th className="text-left px-3 py-2">Статус оплаты</th>
              </tr>
            </thead>
            <tbody>
              {smmProjects.map((p: any) => (
                <tr key={p.id} className="border-t border-gray-200 dark:border-gray-700">
                  <td className="px-3 py-2"><Link to={`/projects/${p.id}`} className="hover:text-purple-600">{p.name}</Link></td>
                  <td className="px-3 py-2 text-xs">{p.tariffNameSnapshot || <span className="text-amber-600">— без тарифа —</span>}</td>
                  <td className="px-3 py-2 text-right text-xs">{fmtMoney(p.monthlyFee)}</td>
                  <td className="px-3 py-2 text-xs">{p.paymentStatus || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 4. FINANCE ANALYTICS — выручка, маржа по проектам
// ═══════════════════════════════════════════════════════════════════
export function FinanceAnalyticsSection() {
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })

  if (isLoading) return <Loading />

  const list = (projects || []).filter((p: any) => !p.isArchived && Number(p.totalContractValue || 0) > 0)
  const sorted = list.slice().sort((a: any, b: any) => Number(b.marginEstimate || 0) - Number(a.marginEstimate || 0))

  const chartData = sorted.slice(0, 10).map((p: any) => ({
    name: p.name.length > 20 ? p.name.slice(0, 20) + '…' : p.name,
    Контракт: Number(p.totalContractValue || 0),
    Себестоимость: Number(p.internalCostEstimate || 0),
    Маржа: Number(p.marginEstimate || 0),
  }))

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base flex items-center gap-2"><DollarSign size={16} className="text-emerald-500" /> Finance analytics</h2>

      {chartData.length > 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3">Топ-10 проектов по марже</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 30 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} angle={-15} textAnchor="end" />
              <YAxis fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Контракт" fill={COLORS[0]} />
              <Bar dataKey="Себестоимость" fill={COLORS[3]} />
              <Bar dataKey="Маржа" fill={COLORS[1]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty title="Нет финансовых данных" description="Заполните totalContractValue в проектах — графики появятся." />
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2">Проект</th>
              <th className="text-right px-3 py-2">Контракт</th>
              <th className="text-right px-3 py-2">Оплачено</th>
              <th className="text-right px-3 py-2">К оплате</th>
              <th className="text-right px-3 py-2">Себестоимость</th>
              <th className="text-right px-3 py-2">Маржа</th>
              <th className="text-left px-3 py-2">Статус</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p: any) => (
              <tr key={p.id} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2"><Link to={`/projects/${p.id}`} className="hover:text-purple-600">{p.name}</Link></td>
                <td className="px-3 py-2 text-right text-xs">{fmtMoney(p.totalContractValue)}</td>
                <td className="px-3 py-2 text-right text-xs">{fmtMoney(p.paidAmount)}</td>
                <td className="px-3 py-2 text-right text-xs">{fmtMoney(p.outstandingAmount)}</td>
                <td className="px-3 py-2 text-right text-xs">{fmtMoney(p.internalCostEstimate)}</td>
                <td className="px-3 py-2 text-right text-xs font-medium">{fmtMoney(p.marginEstimate)}</td>
                <td className="px-3 py-2 text-xs">{p.paymentStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 5. RISK ANALYTICS — встроенный block рисков
// ═══════════════════════════════════════════════════════════════════
export function RiskAnalyticsSection() {
  const { data: projectRisks, isLoading } = useQuery({ queryKey: ['risks-projects'], queryFn: riskApi.projectRisks })
  const { data: employeeRisks } = useQuery({ queryKey: ['risks-employees'], queryFn: riskApi.employeeRisks })

  if (isLoading) return <Loading />

  const projStats = countLevels(projectRisks ?? [])
  const empStats = countLevels(employeeRisks ?? [])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base flex items-center gap-2"><AlertTriangle size={16} className="text-red-500" /> Risk analytics</h2>
        <Link to="/risks" className="text-xs text-purple-600 hover:underline inline-flex items-center gap-1">Открыть полную страницу <ExternalLink size={12} /></Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile label="Проектов red"     value={projStats.red}    accent="text-red-600" />
        <Tile label="Проектов yellow"  value={projStats.yellow} accent="text-amber-600" />
        <Tile label="Проектов green"   value={projStats.green}  accent="text-emerald-600" />
        <Tile label="Сотрудники red"   value={empStats.red}     accent="text-red-600" />
        <Tile label="Сотрудники yellow" value={empStats.yellow}  accent="text-amber-600" />
        <Tile label="Сотрудники green"  value={empStats.green}   accent="text-emerald-600" />
      </div>

      <section>
        <h3 className="text-sm font-medium mb-2">Топ-10 рисковых проектов</h3>
        <ul className="space-y-1.5">
          {(projectRisks ?? []).filter((r: any) => r.level !== 'green').slice(0, 10).map((r: any) => (
            <li key={r.projectId} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <Link to={`/projects/${r.projectId}`} className="hover:text-purple-600 truncate flex-1">{r.projectName}</Link>
              <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_CHIP[r.level as Level])}>{r.level} · {r.score}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 6. TARIFF ANALYTICS — распределение проектов по тарифам
// ═══════════════════════════════════════════════════════════════════
export function TariffAnalyticsSection() {
  const { data: tariffs, isLoading } = useQuery({ queryKey: ['smm-tariffs'], queryFn: () => smmTariffsApi.list() })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })

  if (isLoading) return <Loading />

  const list = (projects || []).filter((p: any) => p.projectType === 'SMM' && !p.isArchived)
  const counts: Record<string, { tariffId: string; name: string; price: number; projects: number; revenue: number }> = {}

  for (const t of (tariffs || [])) {
    counts[t.id] = { tariffId: t.id, name: t.name, price: Number(t.monthlyPrice), projects: 0, revenue: 0 }
  }
  for (const p of list) {
    if (p.tariffId && counts[p.tariffId]) {
      counts[p.tariffId].projects++
      counts[p.tariffId].revenue += Number(p.monthlyFee || 0)
    }
  }

  const rows = Object.values(counts).filter(r => r.projects > 0).sort((a, b) => b.projects - a.projects)
  const pieData = rows.map(r => ({ name: r.name, value: r.projects }))

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base flex items-center gap-2"><Tag size={16} className="text-purple-500" /> Tariff analytics</h2>

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Тарифов всего"   value={tariffs?.length ?? 0} />
        <Tile label="Активных тарифов" value={(tariffs ?? []).filter((t: any) => t.isActive).length} accent="text-emerald-600" />
        <Tile label="Используемых"     value={rows.length} accent="text-purple-600" />
      </div>

      {rows.length === 0 ? (
        <Empty title="Нет проектов с тарифами" description="Привяжите тарифы к SMM-проектам — здесь появится распределение." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
            <h3 className="text-sm font-medium mb-3">Проекты по тарифам</h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={80} label>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">Тариф</th>
                  <th className="text-right px-3 py-2">Цена</th>
                  <th className="text-right px-3 py-2">Проектов</th>
                  <th className="text-right px-3 py-2">Выручка/мес</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.tariffId} className="border-t border-gray-200 dark:border-gray-700">
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right text-xs">{fmtMoney(r.price)}</td>
                    <td className="px-3 py-2 text-right">{r.projects}</td>
                    <td className="px-3 py-2 text-right text-xs font-medium">{fmtMoney(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SHARED helpers
// ═══════════════════════════════════════════════════════════════════
function countLevels(rows: { level: string }[]) {
  return rows.reduce(
    (acc, r) => { acc[r.level as Level] = (acc[r.level as Level] || 0) + 1; return acc },
    { green: 0, yellow: 0, red: 0 } as Record<Level, number>,
  )
}

function Tile({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 text-center">
      <div className={clsx('text-xl font-bold', accent || 'text-gray-900 dark:text-gray-100')}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function Loading() {
  return <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-purple-500" /></div>
}

function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-8 text-gray-500">
      <div className="font-medium">{title}</div>
      {description && <div className="text-xs mt-1">{description}</div>}
    </div>
  )
}
