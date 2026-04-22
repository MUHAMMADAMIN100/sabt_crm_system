import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Loader2, AlertTriangle, AlertCircle, CheckCircle2,
  Briefcase, ListChecks, Hourglass, TrendingUp, Activity as ActivityIcon,
} from 'lucide-react'
import { riskApi, tasksApi, activityLogApi } from '@/services/api.service'

type Level = 'green' | 'yellow' | 'red'

const LEVEL_CHIP: Record<Level, string> = {
  green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  yellow: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  red:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}
const LEVEL_ICON: Record<Level, any> = {
  green:  CheckCircle2,
  yellow: AlertCircle,
  red:    AlertTriangle,
}

// ═══════════════════════════════════════════════════════════════════
// WORKLOAD TAB
// ═══════════════════════════════════════════════════════════════════
export function EmployeeWorkloadTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee-workload', userId],
    queryFn: () => riskApi.workloadEmployees(userId),
  })

  if (isLoading) return <Loading />
  const w = (data ?? [])[0]
  if (!w) return <Empty title="Нагрузки нет" description="Сотруднику пока не назначены активные задачи." />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><ActivityIcon size={16} className="text-purple-500" /> Нагрузка</h3>
        <span className={clsx('text-xs px-2 py-1 rounded-full font-medium', LEVEL_CHIP[w.overload as Level])}>
          {w.overload === 'red' ? '🔥 Перегружен' : w.overload === 'yellow' ? '⚠️ Высокая' : '✓ Норма'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat icon={Briefcase}  label="Проектов"          value={w.projectCount} />
        <Stat icon={ListChecks} label="Задач в работе"    value={w.tasksInProgress} />
        <Stat icon={Hourglass}  label="Задач в очереди"   value={w.tasksInQueue} />
        <Stat icon={TrendingUp} label="Planned часов"     value={`${w.plannedHours}ч`} />
        <Stat icon={ActivityIcon} label="Logged 30 дней"  value={`${w.loggedHoursLast30d}ч`} />
        <Stat icon={ActivityIcon} label="Загрузка / 160ч" value={`${Math.round((w.loggedHoursLast30d / 160) * 100)}%`} />
      </div>

      <p className="text-xs text-gray-500 italic">
        Эвристика overload: &gt;8 активных задач = +2; &gt;5 = +1; &gt;160ч за 30 дней = +2; 121-160ч = +1.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// QUALITY TAB
// ═══════════════════════════════════════════════════════════════════
export function EmployeeQualityTab({ userId }: { userId: string }) {
  const { data: tasks, isLoading } = useQuery<any[]>({
    queryKey: ['employee-tasks-all', userId],
    queryFn: () => tasksApi.list({ assigneeId: userId }),
  })

  if (isLoading) return <Loading />
  if (!tasks || tasks.length === 0) return <Empty title="Нет задач" description="Не на чем считать качество." />

  const finished = tasks.filter(t => ['done', 'approved', 'published'].includes(t.status))
  const reworked = tasks.filter(t => (t.reworkCount ?? 0) > 0)
  const acceptedFirstTry = finished.filter(t => t.acceptedOnFirstTry)
  const withQuality = tasks.filter(t => t.qualityScore != null)
  const avgQuality = withQuality.length > 0
    ? withQuality.reduce((s, t) => s + Number(t.qualityScore), 0) / withQuality.length
    : null
  const reworkRate = tasks.length > 0 ? Math.round((reworked.length / tasks.length) * 100) : 0
  const firstTryRate = finished.length > 0 ? Math.round((acceptedFirstTry.length / finished.length) * 100) : 0

  // Performance trend: actual / estimated for finished tasks with both values
  const withBoth = finished.filter(t =>
    Number(t.actualCompletionHours) > 0 && Number(t.estimatedHours) > 0,
  )
  const speedRatio = withBoth.length > 0
    ? withBoth.reduce((s, t) => s + Number(t.actualCompletionHours) / Number(t.estimatedHours), 0) / withBoth.length
    : null

  return (
    <div className="space-y-5">
      <h3 className="font-semibold">Качество и производительность</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Всего задач"        value={tasks.length} />
        <Stat label="Завершено"          value={finished.length} />
        <Stat label="С первого раза"     value={`${firstTryRate}%`} accent={firstTryRate >= 80 ? 'text-emerald-600' : firstTryRate >= 50 ? 'text-amber-600' : 'text-red-600'} />
        <Stat label="Возвращений на доработку" value={`${reworkRate}%`} accent={reworkRate <= 10 ? 'text-emerald-600' : reworkRate <= 30 ? 'text-amber-600' : 'text-red-600'} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Stat
          label="Средняя оценка качества"
          value={avgQuality != null ? `${avgQuality.toFixed(1)} / 10` : '—'}
          accent={avgQuality == null ? '' : avgQuality >= 8 ? 'text-emerald-600' : avgQuality >= 6 ? 'text-amber-600' : 'text-red-600'}
          sub={`по ${withQuality.length} задачам с оценкой`}
        />
        <Stat
          label="Скорость (actual / estimated)"
          value={speedRatio != null ? speedRatio.toFixed(2) : '—'}
          accent={speedRatio == null ? '' : speedRatio <= 1.0 ? 'text-emerald-600' : speedRatio <= 1.3 ? 'text-amber-600' : 'text-red-600'}
          sub={speedRatio != null ? (speedRatio < 1 ? 'быстрее плана' : speedRatio === 1 ? 'точно по плану' : 'медленнее плана') : `по ${withBoth.length} замеренным задачам`}
        />
      </div>

      <p className="text-xs text-gray-500 italic">
        Метрики собираются из новых полей задач (reworkCount, qualityScore, acceptedOnFirstTry, actualCompletionHours).
        Чем больше задач с заполненными полями — тем точнее картина.
      </p>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// RISK TAB
// ═══════════════════════════════════════════════════════════════════
export function EmployeeRiskTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee-risk', userId],
    queryFn: () => riskApi.employeeRiskDetail(userId),
  })

  if (isLoading) return <Loading />
  if (!data) return <Empty title="Нет данных" description="Риск-скор не рассчитан." />

  const Icon = LEVEL_ICON[data.level as Level]
  const triggered = (data.factors || []).filter((f: any) => f.triggered)
  const passed = (data.factors || []).filter((f: any) => !f.triggered)

  return (
    <div className="space-y-5">
      <h3 className="font-semibold">Риск-скор сотрудника</h3>

      <div className={clsx(
        'rounded-xl border p-5 flex items-start justify-between',
        data.level === 'red'    && 'border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10',
        data.level === 'yellow' && 'border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10',
        data.level === 'green'  && 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-900/10',
      )}>
        <div className="flex items-center gap-3">
          <Icon size={28} className={
            data.level === 'red' ? 'text-red-500' :
            data.level === 'yellow' ? 'text-amber-500' : 'text-emerald-500'
          } />
          <div>
            <div className="text-sm font-medium">
              {data.level === 'red' ? 'Высокий риск' : data.level === 'yellow' ? 'Средний риск' : 'Низкий риск'}
            </div>
            <div className="text-xs text-gray-500">{triggered.length} из {data.factors.length} факторов сработало</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold">{data.score}</div>
          <div className="text-[10px] uppercase text-gray-500">риск-скор</div>
        </div>
      </div>

      {triggered.length > 0 && (
        <section>
          <h4 className="text-sm font-medium mb-2">Активные триггеры</h4>
          <ul className="space-y-1.5">
            {triggered.map((f: any) => (
              <li key={f.key} className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/50">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="flex-1">{f.label}{f.detail ? ` — ${f.detail}` : ''}</span>
                <span className="text-xs text-amber-700 dark:text-amber-400">+{f.weight}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {passed.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-500 mb-2">Без триггера</h4>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
            {passed.map((f: any) => (
              <li key={f.key} className="flex items-center gap-2 text-gray-500">
                <CheckCircle2 size={14} className="text-emerald-500" /> {f.label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY TAB
// ═══════════════════════════════════════════════════════════════════
export function EmployeeActivityTab({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee-activity', userId],
    queryFn: () => activityLogApi.list({ userId, limit: 100 }),
  })

  if (isLoading) return <Loading />
  const items = data?.data ?? data ?? []
  if (!Array.isArray(items) || items.length === 0) {
    return <Empty title="Нет активности" description="История действий сотрудника пока пуста." />
  }

  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Лента активности</h3>
      <ul className="space-y-1">
        {items.map((a: any) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
              <span className="text-xs text-gray-500 shrink-0 w-32">
                {a.createdAt ? new Date(a.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
              </span>
              <span className="font-medium">{a.action}</span>
              {a.entityName && (
                <span className="text-gray-500 truncate">— {a.entityName}</span>
              )}
            </div>
            {a.entity && (
              <span className="text-[11px] text-gray-400 uppercase">{a.entity}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════════
function Stat({ icon: Icon, label, value, sub, accent }: { icon?: any; label: string; value: any; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className={clsx('text-xl font-bold', accent || 'text-gray-900 dark:text-gray-100')}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-1">{sub}</div>}
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
