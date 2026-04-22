import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  Loader2, Briefcase, CheckSquare, Users, DollarSign, AlertTriangle,
  Hourglass, ListChecks, TrendingUp, Calendar as CalIcon, ExternalLink,
} from 'lucide-react'
import { contentPlanApi, riskApi, activityLogApi, tasksApi } from '@/services/api.service'

// ═══════════════════════════════════════════════════════════════════
// 1. OVERVIEW TAB — сводный дашборд по проекту (TZ п.13)
// ═══════════════════════════════════════════════════════════════════
export function ProjectOverviewTab({ project }: { project: any }) {
  const { data: risk } = useQuery({
    queryKey: ['project-risk', project.id],
    queryFn: () => riskApi.projectRiskDetail(project.id),
  })

  const tasks = project.tasks || []
  const done = tasks.filter((t: any) => ['done', 'approved', 'published'].includes(t.status)).length
  const inProgress = tasks.filter((t: any) =>
    ['in_progress', 'accepted', 'on_pm_review', 'on_rework', 'on_client_approval', 'review'].includes(t.status),
  ).length
  const overdue = tasks.filter((t: any) =>
    t.deadline && new Date(t.deadline) < new Date() && !['done', 'approved', 'published', 'cancelled'].includes(t.status),
  ).length

  const fmt = (v: any) => v == null ? '—' : new Intl.NumberFormat('ru-RU').format(Number(v)) + ' сомони'

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base">Обзор проекта</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={CheckSquare} label="Задач всего" value={tasks.length} />
        <Stat icon={ListChecks}  label="Завершено"  value={done} accent="text-emerald-600" />
        <Stat icon={Hourglass}   label="В работе"   value={inProgress} accent="text-blue-600" />
        <Stat icon={AlertTriangle} label="Просрочено" value={overdue} accent={overdue > 0 ? 'text-red-600' : 'text-gray-500'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2"><DollarSign size={14} className="text-emerald-500" /> Финансы</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <Row label="Контракт" value={fmt(project.totalContractValue)} />
            <Row label="Оплачено" value={fmt(project.paidAmount)} />
            <Row label="К оплате" value={fmt(project.outstandingAmount)} />
            <Row label="Маржа"    value={fmt(project.marginEstimate)} />
            <Row label="Статус оплаты" value={project.paymentStatus || '—'} />
            <Row label="Тариф" value={project.tariffNameSnapshot || '—'} />
          </dl>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2"><AlertTriangle size={14} className="text-amber-500" /> Риск</h3>
          {risk ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={clsx(
                  'text-xs px-2 py-1 rounded-full font-medium',
                  risk.level === 'red'    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                  risk.level === 'yellow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                )}>
                  {risk.level.toUpperCase()} · скор {risk.score}
                </span>
                <span className="text-xs text-gray-500">
                  {(risk.factors || []).filter((f: any) => f.triggered).length} триггеров
                </span>
              </div>
              <ul className="text-xs space-y-1">
                {(risk.factors || []).filter((f: any) => f.triggered).slice(0, 5).map((f: any) => (
                  <li key={f.key} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {f.label}
                  </li>
                ))}
                {(risk.factors || []).filter((f: any) => f.triggered).length === 0 && (
                  <li className="text-emerald-600 dark:text-emerald-400">Все факторы в норме ✓</li>
                )}
              </ul>
            </div>
          ) : <Loading />}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 2. DELIVERABLES TAB — полный план-факт по контенту
// ═══════════════════════════════════════════════════════════════════
export function ProjectDeliverablesTab({ projectId, projectType }: { projectId: string; projectType?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['plan-fact', projectId],
    queryFn: () => riskApi.planFact(projectId),
    enabled: projectType === 'SMM',
  })

  if (projectType !== 'SMM') {
    return <Empty title="Только для SMM-проектов" description="Deliverables считаются по позициям контент-плана." />
  }
  if (isLoading) return <Loading />
  if (!data || data.length === 0) {
    return <Empty title="Контент-плана нет" description="Привяжите тариф — план сгенерируется автоматически." />
  }

  const totalPlanned = data.reduce((s: number, r: any) => s + r.planned, 0)
  const totalActual = data.reduce((s: number, r: any) => s + r.actual, 0)
  const totalOveruse = data.reduce((s: number, r: any) => s + r.overuse, 0)
  const totalPercent = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base">Deliverables</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="План"        value={totalPlanned} />
        <Stat label="Факт"        value={totalActual} accent="text-emerald-600" />
        <Stat label="Перерасход"  value={totalOveruse} accent={totalOveruse > 0 ? 'text-red-600' : 'text-gray-500'} />
        <Stat label="Выполнение"  value={`${totalPercent}%`} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Тип</th>
              <th className="text-right px-3 py-2 font-medium">План</th>
              <th className="text-right px-3 py-2 font-medium">Факт</th>
              <th className="text-right px-3 py-2 font-medium">Лимит тарифа</th>
              <th className="text-right px-3 py-2 font-medium">Осталось</th>
              <th className="text-right px-3 py-2 font-medium">Перерасход</th>
              <th className="text-right px-3 py-2 font-medium">Недотяг</th>
              <th className="text-right px-3 py-2 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r: any) => (
              <tr key={r.contentType} className="border-t border-gray-200 dark:border-gray-700">
                <td className="px-3 py-2 font-medium">{r.contentType}</td>
                <td className="px-3 py-2 text-right">{r.planned}</td>
                <td className="px-3 py-2 text-right text-emerald-600">{r.actual}</td>
                <td className="px-3 py-2 text-right">{r.tariffLimit ?? '—'}</td>
                <td className="px-3 py-2 text-right">{r.remaining}</td>
                <td className={clsx('px-3 py-2 text-right', r.overuse > 0 && 'text-red-600 font-medium')}>{r.overuse}</td>
                <td className={clsx('px-3 py-2 text-right', r.underuse > 0 && 'text-amber-600 font-medium')}>{r.underuse}</td>
                <td className="px-3 py-2 text-right">{r.percent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 3. TEAM WORKLOAD TAB — нагрузка участников проекта
// ═══════════════════════════════════════════════════════════════════
export function ProjectTeamWorkloadTab({ project }: { project: any }) {
  const memberIds: string[] = (project.members || []).map((m: any) => m.id)
  const { data: workloads, isLoading } = useQuery({
    queryKey: ['workload-team-all'],
    queryFn: () => riskApi.workloadEmployees(),
  })

  if (isLoading) return <Loading />
  const teamLoads = (workloads ?? []).filter((w: any) => memberIds.includes(w.userId))

  if (teamLoads.length === 0) {
    return <Empty title="В проекте нет участников" description="Добавьте сотрудников во вкладке «Участники»." />
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-base flex items-center gap-2"><Users size={16} className="text-purple-500" /> Нагрузка команды</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {teamLoads.map((w: any) => (
          <div key={w.userId} className={clsx(
            'rounded-xl border p-4 bg-white dark:bg-gray-900',
            w.overload === 'red' ? 'border-red-200 dark:border-red-900/50' :
            w.overload === 'yellow' ? 'border-amber-200 dark:border-amber-900/50' :
            'border-gray-200 dark:border-gray-700',
          )}>
            <div className="flex items-center justify-between mb-2">
              <Link to={`/employees/${w.userId}`} className="font-medium text-sm hover:text-purple-600 inline-flex items-center gap-1">
                {w.userName} <ExternalLink size={11} className="opacity-50" />
              </Link>
              <span className={clsx(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                w.overload === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                w.overload === 'yellow' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
              )}>{w.overload}</span>
            </div>
            <div className="text-xs text-gray-500 mb-2">{w.role}</div>
            <dl className="grid grid-cols-2 gap-1 text-xs">
              <Row label="Проектов" value={w.projectCount} />
              <Row label="В работе" value={w.tasksInProgress} />
              <Row label="В очереди" value={w.tasksInQueue} />
              <Row label="Часов 30д" value={`${w.loggedHoursLast30d}ч`} />
            </dl>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 4. QUALITY & REVISIONS TAB — качество задач проекта
// ═══════════════════════════════════════════════════════════════════
export function ProjectQualityTab({ projectId }: { projectId: string }) {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['project-tasks-quality', projectId],
    queryFn: () => tasksApi.list({ projectId }),
  })

  if (isLoading) return <Loading />
  if (!tasks || tasks.length === 0) {
    return <Empty title="Задач нет" description="Добавьте задачи в проект — здесь появится статистика качества." />
  }

  const reworked = tasks.filter((t: any) => (t.reworkCount ?? 0) > 0)
  const finished = tasks.filter((t: any) => ['done', 'approved', 'published'].includes(t.status))
  const acceptedFirstTry = finished.filter((t: any) => t.acceptedOnFirstTry).length
  const withQuality = tasks.filter((t: any) => t.qualityScore != null)
  const avgQuality = withQuality.length > 0
    ? withQuality.reduce((s: number, t: any) => s + Number(t.qualityScore), 0) / withQuality.length
    : null
  const reworkRate = tasks.length > 0 ? Math.round((reworked.length / tasks.length) * 100) : 0
  const firstTryRate = finished.length > 0 ? Math.round((acceptedFirstTry / finished.length) * 100) : 0

  return (
    <div className="space-y-5">
      <h2 className="font-semibold text-base flex items-center gap-2"><TrendingUp size={16} className="text-emerald-500" /> Качество и правки</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Всего задач"  value={tasks.length} />
        <Stat label="С первого раза" value={`${firstTryRate}%`}
          accent={firstTryRate >= 80 ? 'text-emerald-600' : firstTryRate >= 50 ? 'text-amber-600' : 'text-red-600'} />
        <Stat label="С возвратами" value={`${reworkRate}%`}
          accent={reworkRate <= 10 ? 'text-emerald-600' : reworkRate <= 30 ? 'text-amber-600' : 'text-red-600'} />
        <Stat label="Средняя оценка"
          value={avgQuality != null ? `${avgQuality.toFixed(1)} / 10` : '—'}
          accent={avgQuality == null ? '' : avgQuality >= 8 ? 'text-emerald-600' : avgQuality >= 6 ? 'text-amber-600' : 'text-red-600'} />
      </div>

      {reworked.length > 0 && (
        <section>
          <h3 className="text-sm font-medium mb-2">Задачи с возвратами ({reworked.length})</h3>
          <ul className="space-y-1.5">
            {reworked.slice(0, 20).map((t: any) => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                <Link to={`/tasks/${t.id}`} className="hover:text-purple-600 truncate flex-1">{t.title}</Link>
                <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
                  {t.assignee?.name && <span>{t.assignee.name}</span>}
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                    Возвратов: {t.reworkCount}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// 5. ACTIVITY TAB — лента активности по проекту
// ═══════════════════════════════════════════════════════════════════
export function ProjectActivityTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['project-activity', projectId],
    queryFn: () => activityLogApi.list({ entity: 'project', entityId: projectId, limit: 100 }),
  })

  if (isLoading) return <Loading />
  const items = data?.data ?? data ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return <Empty title="Нет активности" description="История изменений по проекту пока пуста." />
  }

  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-base flex items-center gap-2"><CalIcon size={16} className="text-purple-500" /> Лента активности</h2>
      <ul className="space-y-1">
        {items.map((a: any) => (
          <li key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 text-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
            <span className="text-xs text-gray-500 shrink-0 w-32">
              {a.createdAt ? new Date(a.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
            </span>
            <span className="font-medium">{a.userName || '—'}</span>
            <span className="text-gray-500">→ {a.action}</span>
            {a.entityName && <span className="text-gray-400 truncate">{a.entityName}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SHARED helpers
// ═══════════════════════════════════════════════════════════════════
function Stat({ icon: Icon, label, value, accent }: { icon?: any; label: string; value: any; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 text-center">
      {Icon && <Icon size={16} className="mx-auto mb-1 text-purple-500" />}
      <div className={clsx('text-xl font-bold', accent || 'text-gray-900 dark:text-gray-100')}>{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <>
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value ?? '—'}</dd>
    </>
  )
}

function Loading() {
  return <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-purple-500" /></div>
}

function Empty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-8 text-gray-500">
      <Briefcase size={32} className="mx-auto mb-2 opacity-30" />
      <div className="font-medium">{title}</div>
      {description && <div className="text-xs mt-1">{description}</div>}
    </div>
  )
}
