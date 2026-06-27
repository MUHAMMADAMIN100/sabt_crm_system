import { useMemo, lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi, workflowApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { PageLoader, Avatar, CollapsibleSection } from '@/components/ui'
import { TrendingDown, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { PmWidgets, HeadSmmWidgets } from './RiskWidgets'
import { STAGES } from '@/components/projects/workflowShared'

// Глобальный календарь историй — для руководителя SMM (отметки SMM-команды)
const GlobalStoriesCalendar = lazy(() => import('./GlobalStoriesCalendar'))

const SMM_POSITIONS = ['SMM специалист', 'Руководитель SMM', 'Сторисмейкер']
const SMM_ROLES = ['smm_specialist', 'storymaker']

export default function PMDashboard() {
  const user = useAuthStore(s => s.user)
  const isHeadSMM = user?.role === 'smm_director'

  // Просрочки теперь из Доски проектов (workflow), не из задач.
  const { data: overdueCards, isLoading: loadingOverdue } = useQuery({
    queryKey: ['workflow-overdue'],
    queryFn: workflowApi.overdue,
  })

  const { data: workloadRaw } = useQuery({
    queryKey: ['employee-workload'],
    queryFn: analyticsApi.employeeWorkload,
  })

  const workload = useMemo(() => {
    if (!isHeadSMM) return workloadRaw
    return (workloadRaw || []).filter((e: any) =>
      SMM_POSITIONS.includes(e.position || '') || SMM_ROLES.includes(e.role || ''),
    )
  }, [workloadRaw, isHeadSMM])

  const stageLabel = (k: string) => STAGES.find(s => s.key === k)?.label || k

  if (loadingOverdue) return <PageLoader />

  return (
    <div className="space-y-6">
      {/* Wave 20: TZ п.11 — для smm_director показываем виджеты Head of SMM,
          для video_director — виджеты PM. Старая Summary row остаётся ниже. */}
      {isHeadSMM ? <HeadSmmWidgets /> : <PmWidgets />}

      {/* Глобальный календарь сторис — smm_director видит отметки своей SMM-команды.
          Раньше показывался только на FounderDashboard, что лишало главного SMM
          обзора публикаций исполнителей. */}
      {isHeadSMM && (
        <Suspense fallback={null}>
          <GlobalStoriesCalendar />
        </Suspense>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-500">{overdueCards?.length ?? 0}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Просрочено (Доска)</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600 dark:text-primary-400">{workload?.length ?? 0}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">В команде</p>
        </div>
      </div>

      {/* Overdue workflow cards (Доска проектов) */}
      <CollapsibleSection
        id="pm-overdue"
        title={<h2 className="section-title flex items-center gap-2 text-red-600 dark:text-red-400"><TrendingDown size={16} /> Просроченные карточки</h2>}
      >
        {!overdueCards?.length ? (
          <p className="text-sm text-green-600 dark:text-green-400 py-4 text-center">Просрочек нет ✓</p>
        ) : (
          <div className="space-y-2">
            {overdueCards.slice(0, 12).map((c: any) => (
              <Link
                key={c.id}
                to="/workflow-board"
                className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{c.title}</p>
                  <p className="text-xs text-surface-400">{c.project?.name} · {stageLabel(c.stage)}{c.assignee ? ` · ${c.assignee.name}` : ''}</p>
                </div>
                {c.deadline && (
                  <span className="text-xs text-red-500 font-semibold shrink-0">
                    {format(new Date(c.deadline), 'dd.MM', { locale: ru })}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Team workload */}
      <CollapsibleSection
        id="pm-workload"
        title={<h2 className="section-title flex items-center gap-2"><AlertTriangle size={16} className="text-surface-500" /> Нагрузка команды</h2>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(workload || []).map((e: any) => (
            <Link
              key={e.id}
              to={`/employees/${e.id}`}
              className="flex items-center gap-3 p-3 rounded-xl border border-surface-100 dark:border-surface-700 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
            >
              <Avatar name={e.name} src={e.avatar} size={32} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{e.name}</p>
                <p className="text-[10px] text-surface-400 truncate">{e.position}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-sm font-bold ${e.activeTasks >= 8 ? 'text-red-500' : e.activeTasks >= 5 ? 'text-surface-500' : 'text-green-600 dark:text-green-400'}`}>
                  {e.activeTasks}
                </p>
                <p className="text-[10px] text-surface-400">задач</p>
              </div>
            </Link>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}
