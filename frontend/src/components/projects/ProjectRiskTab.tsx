import { useQuery } from '@tanstack/react-query'
import { Loader2, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { riskApi } from '@/services/api.service'

type Level = 'green' | 'yellow' | 'red'

interface RiskFactor {
  key: string
  label: string
  triggered: boolean
  weight: number
  detail?: string
}

interface ProjectRiskDetail {
  projectId: string
  projectName: string
  managerId: string | null
  managerName: string | null
  level: Level
  score: number
  factors: RiskFactor[]
}

interface PlanFactRow {
  contentType: string
  planned: number
  actual: number
  cancelled: number
  remaining: number
  tariffLimit: number | null
  percent: number
  overuse: number
  underuse: number
}

const TYPE_LABELS: Record<string, string> = {
  reel: 'Reels', story: 'Stories', post: 'Posts', design: 'Дизайны',
  ad: 'Реклама', video: 'Видео', carousel: 'Карусели', other: 'Прочее',
}

const TYPE_ICONS: Record<string, string> = {
  reel: '🎬', story: '📱', post: '📰', design: '🎨',
  ad: '💡', video: '📹', carousel: '🖼', other: '📦',
}

const LEVEL_STYLE: Record<Level, { bg: string; text: string; border: string; label: string; icon: any }> = {
  green:  { bg: 'bg-emerald-50 dark:bg-emerald-900/10', text: 'text-emerald-700 dark:text-emerald-400',
            border: 'border-emerald-200 dark:border-emerald-900/50', label: 'Низкий риск', icon: CheckCircle2 },
  yellow: { bg: 'bg-amber-50 dark:bg-amber-900/10',     text: 'text-amber-700 dark:text-amber-400',
            border: 'border-amber-200 dark:border-amber-900/50',     label: 'Средний риск', icon: AlertCircle },
  red:    { bg: 'bg-red-50 dark:bg-red-900/10',         text: 'text-red-700 dark:text-red-400',
            border: 'border-red-200 dark:border-red-900/50',         label: 'Высокий риск', icon: AlertTriangle },
}

export default function ProjectRiskTab({ projectId, projectType }: { projectId: string; projectType?: string }) {
  const { data: risk, isLoading: riskLoading } = useQuery<ProjectRiskDetail>({
    queryKey: ['project-risk', projectId],
    queryFn: () => riskApi.projectRiskDetail(projectId),
  })

  const { data: planFact, isLoading: pfLoading } = useQuery<PlanFactRow[]>({
    queryKey: ['plan-fact', projectId],
    queryFn: () => riskApi.planFact(projectId),
    enabled: projectType === 'SMM',
  })

  if (riskLoading) {
    return <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-purple-500" /></div>
  }

  if (!risk) return null

  const style = LEVEL_STYLE[risk.level]
  const Icon = style.icon
  const triggered = risk.factors.filter(f => f.triggered)
  const passed = risk.factors.filter(f => !f.triggered)

  return (
    <div className="space-y-6">
      {/* ─── Risk overview card ──────────────────────────── */}
      <div className={clsx('rounded-xl border p-5', style.bg, style.border)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Icon className={style.text} size={32} />
            <div>
              <div className={clsx('text-sm font-medium', style.text)}>{style.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Сработало <b>{triggered.length}</b> из {risk.factors.length} факторов
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className={clsx('text-3xl font-bold', style.text)}>{risk.score}</div>
            <div className="text-[10px] uppercase text-gray-500 tracking-wide">риск-скор</div>
          </div>
        </div>
      </div>

      {/* ─── Triggered factors ────────────────────────────── */}
      {triggered.length > 0 && (
        <section>
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <AlertTriangle className="text-amber-500" size={16} />
            Активные триггеры ({triggered.length})
          </h3>
          <ul className="space-y-2">
            {triggered.map(f => (
              <li key={f.key} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{f.label}</div>
                  {f.detail && <div className="text-xs text-gray-500 mt-0.5">{f.detail}</div>}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-800 font-medium text-amber-700 dark:text-amber-400">
                  +{f.weight}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Passed factors (compact) ─────────────────────── */}
      {passed.length > 0 && (
        <section>
          <h3 className="font-semibold text-sm mb-3 text-gray-500">Без триггера ({passed.length})</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {passed.map(f => (
              <li key={f.key} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                {f.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Plan-Fact (SMM only) ─────────────────────────── */}
      {projectType === 'SMM' && (
        <section>
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            📊 План-факт по контенту
          </h3>
          {pfLoading ? (
            <div className="flex items-center justify-center py-6"><Loader2 className="animate-spin text-purple-500" /></div>
          ) : !planFact || planFact.length === 0 ? (
            <div className="text-sm text-gray-500 italic px-4 py-6 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
              Контент-плана пока нет. Привяжите тариф — план будет сгенерирован автоматически.
            </div>
          ) : (
            <div className="space-y-3">
              {planFact.map(row => <PlanFactBar key={row.contentType} row={row} />)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function PlanFactBar({ row }: { row: PlanFactRow }) {
  const label = TYPE_LABELS[row.contentType] ?? row.contentType
  const icon = TYPE_ICONS[row.contentType] ?? '•'
  const denom = row.tariffLimit && row.tariffLimit > 0 ? row.tariffLimit : Math.max(row.planned, 1)
  const fillPct = Math.min(100, Math.round((row.actual / denom) * 100))
  const overPct = row.overuse > 0 && row.tariffLimit
    ? Math.min(50, Math.round((row.overuse / row.tariffLimit) * 100))
    : 0
  const barColor = row.overuse > 0
    ? 'bg-red-500'
    : fillPct >= 100 ? 'bg-emerald-500'
    : fillPct >= 70 ? 'bg-amber-500'
    : 'bg-purple-500'

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="text-base">{icon}</span>
          {label}
        </div>
        <div className="text-xs text-gray-500">
          {row.actual} из {row.tariffLimit ?? row.planned}
          {row.tariffLimit != null && (
            <> · план {row.planned}</>
          )}
        </div>
      </div>
      <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
        <div className={clsx('h-full transition-all', barColor)} style={{ width: `${fillPct}%` }} />
        {overPct > 0 && (
          <div className="h-full bg-red-700/80" style={{ width: `${overPct}%` }} title="Перерасход" />
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1.5">
        <span>{row.percent}% выполнено</span>
        <div className="flex items-center gap-3">
          {row.overuse > 0 && (
            <span className="text-red-600 dark:text-red-400 font-medium">Перерасход +{row.overuse}</span>
          )}
          {row.underuse > 0 && (
            <span className="text-amber-600 dark:text-amber-400">Недотяг −{row.underuse}</span>
          )}
          {row.remaining > 0 && (
            <span>Осталось {row.remaining}</span>
          )}
        </div>
      </div>
    </div>
  )
}
