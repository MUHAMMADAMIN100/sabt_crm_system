import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  AlertTriangle, AlertCircle, CheckCircle2, ExternalLink, DollarSign, TrendingUp,
  Users, ListChecks, Briefcase, Hourglass, Zap,
} from 'lucide-react'
import { riskApi, projectsApi, tasksApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

type Level = 'green' | 'yellow' | 'red'

const LEVEL_CHIP: Record<Level, string> = {
  green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const fmtMoney = (v: any) => v == null ? '—' : new Intl.NumberFormat('ru-RU').format(Number(v)) + ' ₽'

// ═══════════════════════════════════════════════════════════════════
// FounderWidgets — TZ п.11: проекты в риске, просрочки оплат, перегруженные
// PM, слабая активность команды, перерасход тарифов, выручка, маржа.
// ═══════════════════════════════════════════════════════════════════
export function FounderWidgets() {
  const { data: projectRisks } = useQuery({ queryKey: ['risks-projects'], queryFn: riskApi.projectRisks })
  const { data: employeeRisks } = useQuery({ queryKey: ['risks-employees'], queryFn: riskApi.employeeRisks })
  const { data: workloads } = useQuery({ queryKey: ['workload-employees-all'], queryFn: () => riskApi.workloadEmployees() })
  const { data: pmWorkloads } = useQuery({ queryKey: ['workload-pm-all'], queryFn: () => riskApi.workloadPm() })
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })

  const list = (projects ?? []).filter((p: any) => !p.isArchived)
  const overdueProjects = list.filter((p: any) =>
    p.paymentStatus === 'overdue' ||
    (p.nextPaymentDate && new Date(p.nextPaymentDate) < new Date() && p.paymentStatus !== 'paid'),
  )
  const overusedProjects = list.filter((p: any) => Number(p.tariffLimitOveruseCost ?? 0) > 0)
  const totalRevenue = list.reduce((s: number, p: any) => s + Number(p.paidAmount ?? 0), 0)
  const totalMargin = list.reduce((s: number, p: any) => s + Number(p.marginEstimate ?? 0), 0)
  const overloadedPmIds = new Set(
    (workloads ?? []).filter((w: any) => w.overload === 'red').map((w: any) => w.userId),
  )
  const overloadedPmCount = (pmWorkloads ?? []).filter((p: any) => overloadedPmIds.has(p.pmId)).length
  const lowActivityEmployees = (employeeRisks ?? []).filter((e: any) =>
    e.factors?.some((f: any) => f.key === 'low_activity' && f.triggered),
  )
  const projectsAtRiskRed = (projectRisks ?? []).filter((r: any) => r.level === 'red')
  const projectsAtRiskYellow = (projectRisks ?? []).filter((r: any) => r.level === 'yellow')

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-base flex items-center gap-2"><Zap size={16} className="text-purple-500" /> Сводка для основателя</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Проекты RED" value={projectsAtRiskRed.length} accent="text-red-600" link="/risks?level=red" icon={AlertTriangle} />
        <Tile label="Проекты YELLOW" value={projectsAtRiskYellow.length} accent="text-amber-600" link="/risks" icon={AlertCircle} />
        <Tile label="Просрочки оплат" value={overdueProjects.length} accent={overdueProjects.length > 0 ? 'text-red-600' : 'text-gray-500'} icon={DollarSign} />
        <Tile label="Перерасход тарифа" value={overusedProjects.length} accent={overusedProjects.length > 0 ? 'text-amber-600' : 'text-gray-500'} icon={TrendingUp} />
        <Tile label="Перегруженные PM" value={overloadedPmCount} accent={overloadedPmCount > 0 ? 'text-amber-600' : 'text-gray-500'} icon={Users} />
        <Tile label="Слабая активность" value={lowActivityEmployees.length} accent={lowActivityEmployees.length > 0 ? 'text-amber-600' : 'text-gray-500'} icon={Hourglass} />
        <Tile label="Выручка (получено)" value={fmtMoney(totalRevenue)} accent="text-emerald-600" />
        <Tile label="Маржа (план)" value={fmtMoney(totalMargin)} accent="text-emerald-600" />
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// HeadSmmWidgets — TZ п.11: рейтинг PM, рейтинг SMM, возвраты,
// качество, перегруз команд, сложные проекты.
// ═══════════════════════════════════════════════════════════════════
export function HeadSmmWidgets() {
  const { data: projectRisks } = useQuery({ queryKey: ['risks-projects'], queryFn: riskApi.projectRisks })
  const { data: employeeRisks } = useQuery({ queryKey: ['risks-employees'], queryFn: riskApi.employeeRisks })
  const { data: workloads } = useQuery({ queryKey: ['workload-employees-all'], queryFn: () => riskApi.workloadEmployees() })
  const { data: pmWorkloads } = useQuery({ queryKey: ['workload-pm-all'], queryFn: () => riskApi.workloadPm() })
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })

  // Рейтинг PM по нагрузке (меньше — лучше)
  const pmRated = (pmWorkloads ?? []).slice().sort(
    (a: any, b: any) => (a.tasksOnReview + a.tasksOnRework) - (b.tasksOnReview + b.tasksOnRework),
  )

  // Рейтинг SMM-специалистов по качеству (меньше rework rate — лучше)
  const smmEmployees = (workloads ?? []).filter((w: any) =>
    ['smm_specialist', 'head_smm', 'designer'].includes(w.role),
  )
  const smmRanked = smmEmployees.slice().sort((a: any, b: any) => a.tasksInProgress - b.tasksInProgress)

  // Возвраты
  const tasksWithRework = (tasks ?? []).filter((t: any) => (t.reworkCount ?? 0) > 0).length
  const totalTasks = (tasks ?? []).length
  const reworkRate = totalTasks > 0 ? Math.round((tasksWithRework / totalTasks) * 100) : 0

  // Среднее качество
  const withScore = (tasks ?? []).filter((t: any) => t.qualityScore != null)
  const avgQuality = withScore.length > 0
    ? (withScore.reduce((s: number, t: any) => s + Number(t.qualityScore), 0) / withScore.length).toFixed(1)
    : '—'

  const overloadedTeam = (workloads ?? []).filter((w: any) => w.overload === 'red').length
  const complexProjects = (projectRisks ?? []).filter((r: any) => r.level === 'red').length

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-base flex items-center gap-2"><Zap size={16} className="text-purple-500" /> Сводка Head of SMM</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Возвратов задач" value={`${tasksWithRework} (${reworkRate}%)`} accent={reworkRate > 30 ? 'text-red-600' : reworkRate > 10 ? 'text-amber-600' : 'text-emerald-600'} />
        <Tile label="Среднее качество" value={`${avgQuality} / 10`} accent="text-emerald-600" />
        <Tile label="Перегруз команды" value={overloadedTeam} accent={overloadedTeam > 0 ? 'text-red-600' : 'text-gray-500'} />
        <Tile label="Сложные проекты" value={complexProjects} accent={complexProjects > 0 ? 'text-red-600' : 'text-gray-500'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-2">Рейтинг PM (свободные сверху)</h3>
          {pmRated.length === 0 ? <p className="text-xs text-gray-500">Нет данных</p> : (
            <ul className="space-y-1 text-sm">
              {pmRated.slice(0, 5).map((p: any) => (
                <li key={p.pmId} className="flex items-center justify-between">
                  <Link to={`/employees/${p.pmId}`} className="hover:text-purple-600 truncate">{p.pmName}</Link>
                  <span className="text-xs text-gray-500 shrink-0">проверка {p.tasksOnReview} · доработка {p.tasksOnRework}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-2">Рейтинг SMM (по загрузке)</h3>
          {smmRanked.length === 0 ? <p className="text-xs text-gray-500">Нет данных</p> : (
            <ul className="space-y-1 text-sm">
              {smmRanked.slice(0, 5).map((w: any) => (
                <li key={w.userId} className="flex items-center justify-between">
                  <Link to={`/employees/${w.userId}`} className="hover:text-purple-600 truncate">{w.userName}</Link>
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_CHIP[w.overload as Level])}>
                    {w.overload}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(employeeRisks ?? []).filter((e: any) => e.level !== 'green').length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 p-3">
          <h3 className="text-sm font-medium mb-1 text-amber-700 dark:text-amber-400">Сотрудники в зоне риска</h3>
          <ul className="text-xs space-y-0.5 mt-2">
            {(employeeRisks ?? []).filter((e: any) => e.level !== 'green').slice(0, 5).map((e: any) => (
              <li key={e.userId} className="flex items-center justify-between">
                <Link to={`/employees/${e.userId}`} className="hover:text-purple-600">{e.userName}</Link>
                <span>{e.level} · {e.score}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// PmWidgets — TZ п.11: мои проекты, мои SMM, на проверке, на доработке,
// недельный план, риски по моим проектам.
// ═══════════════════════════════════════════════════════════════════
export function PmWidgets() {
  const userId = useAuthStore(s => s.user?.id)
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: tasks } = useQuery({ queryKey: ['tasks'], queryFn: () => tasksApi.list() })
  const { data: projectRisks } = useQuery({ queryKey: ['risks-projects'], queryFn: riskApi.projectRisks })

  if (!userId) return null

  const myProjects = (projects ?? []).filter((p: any) => p.managerId === userId && !p.isArchived)
  const myProjectIds = new Set(myProjects.map((p: any) => p.id))
  const mySMMSpecialists = new Set<string>()
  for (const p of myProjects) {
    for (const m of (p.members || [])) {
      if (['smm_specialist', 'head_smm', 'designer'].includes(m.role)) {
        mySMMSpecialists.add(m.id)
      }
    }
  }

  const myTasks = (tasks ?? []).filter((t: any) => myProjectIds.has(t.projectId))
  const onReview = myTasks.filter((t: any) => ['review', 'on_pm_review'].includes(t.status)).length
  const onRework = myTasks.filter((t: any) => ['returned', 'on_rework'].includes(t.status)).length

  // Недельный план — задачи с deadline в ближайшие 7 дней
  const now = new Date()
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const weekTasks = myTasks.filter((t: any) =>
    t.deadline && new Date(t.deadline) >= now && new Date(t.deadline) <= in7days
    && !['done', 'approved', 'published', 'cancelled'].includes(t.status),
  )

  const myRisks = (projectRisks ?? []).filter((r: any) => myProjectIds.has(r.projectId) && r.level !== 'green')

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-base flex items-center gap-2"><Briefcase size={16} className="text-purple-500" /> Сводка PM</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Мои проекты"  value={myProjects.length} icon={Briefcase} link="/projects" />
        <Tile label="Мои SMM"      value={mySMMSpecialists.size} icon={Users} />
        <Tile label="На проверке"  value={onReview} accent={onReview > 10 ? 'text-red-600' : onReview > 5 ? 'text-amber-600' : 'text-gray-700'} icon={ListChecks} />
        <Tile label="На доработке" value={onRework} accent={onRework > 5 ? 'text-amber-600' : 'text-gray-700'} icon={AlertCircle} />
        <Tile label="План на 7 дней" value={weekTasks.length} accent="text-blue-600" />
        <Tile label="Проектов в риске" value={myRisks.length} accent={myRisks.length > 0 ? 'text-red-600' : 'text-emerald-600'} link="/risks" />
      </div>

      {myRisks.length > 0 && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 p-3">
          <h3 className="text-sm font-medium mb-2 text-amber-700 dark:text-amber-400">Мои проекты в риске</h3>
          <ul className="text-sm space-y-1">
            {myRisks.map((r: any) => (
              <li key={r.projectId} className="flex items-center justify-between">
                <Link to={`/projects/${r.projectId}`} className="hover:text-purple-600">{r.projectName}</Link>
                <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', LEVEL_CHIP[r.level as Level])}>
                  {r.level} · {r.score}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════════
function Tile({ label, value, accent, icon: Icon, link }: {
  label: string; value: any; accent?: string; icon?: any; link?: string
}) {
  const inner = (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 transition-colors hover:border-purple-300">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-gray-500">{label}</div>
        {Icon && <Icon size={14} className="text-purple-500" />}
        {link && !Icon && <ExternalLink size={11} className="text-gray-400" />}
      </div>
      <div className={clsx('text-xl font-bold', accent || 'text-gray-900 dark:text-gray-100')}>{value}</div>
    </div>
  )
  return link ? <Link to={link}>{inner}</Link> : inner
}
