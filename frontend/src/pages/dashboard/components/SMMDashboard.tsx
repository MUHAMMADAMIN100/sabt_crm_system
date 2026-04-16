import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tasksApi } from '@/services/api.service'
import { PageLoader, StatusBadge, PriorityBadge } from '@/components/ui'
import { AlertTriangle, RotateCcw, Clock, CheckSquare } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

export default function SMMDashboard() {
  const { data: myTasks, isLoading } = useQuery({
    queryKey: ['my-tasks'],
    queryFn: tasksApi.my,
  })

  if (isLoading) return <PageLoader />

  const now = new Date()

  const overdueTasks = (myTasks || []).filter((t: any) =>
    t.deadline && new Date(t.deadline) < now && !['done', 'cancelled'].includes(t.status)
  )

  const returnedTasks = (myTasks || []).filter((t: any) => t.status === 'returned')

  const todayTasks = (myTasks || []).filter((t: any) => {
    if (['done', 'cancelled'].includes(t.status)) return false
    if (!t.deadline) return true
    return new Date(t.deadline) >= now
  }).sort((a: any, b: any) => {
    if (!a.deadline) return 1
    if (!b.deadline) return -1
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
  })

  const reviewTasks = (myTasks || []).filter((t: any) => t.status === 'review')

  return (
    <div className="space-y-6">
      {/* Alerts: overdue + returned */}
      {(overdueTasks.length > 0 || returnedTasks.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {overdueTasks.length > 0 && (
            <div className="card border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-red-500" />
                <h3 className="font-bold text-red-700 dark:text-red-400 text-sm">
                  Просрочено: {overdueTasks.length}
                </h3>
              </div>
              <div className="space-y-2">
                {overdueTasks.map((t: any) => (
                  <Link
                    key={t.id}
                    to={`/tasks/${t.id}`}
                    className="block p-2 rounded-lg bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-red-800 dark:text-red-300 truncate">{t.title}</p>
                      {t.createdById && t.assigneeId && t.createdById !== t.assigneeId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          {t.createdBy?.name?.trim().split(' ')[0] || 'назначено'}
                        </span>
                      )}
                    </div>
                    {t.deadline && (
                      <p className="text-xs text-red-500">
                        Дедлайн: {format(new Date(t.deadline), 'dd MMMM', { locale: ru })}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {returnedTasks.length > 0 && (
            <div className="card border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10">
              <div className="flex items-center gap-2 mb-3">
                <RotateCcw size={16} className="text-orange-500" />
                <h3 className="font-bold text-orange-700 dark:text-orange-400 text-sm">
                  Возвращено: {returnedTasks.length}
                </h3>
              </div>
              <div className="space-y-2">
                {returnedTasks.map((t: any) => (
                  <Link
                    key={t.id}
                    to={`/tasks/${t.id}`}
                    className="block p-2 rounded-lg bg-orange-100 dark:bg-orange-900/20 hover:bg-orange-200 dark:hover:bg-orange-900/30 transition-colors"
                  >
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-orange-800 dark:text-orange-300 truncate">{t.title}</p>
                      {t.createdById && t.assigneeId && t.createdById !== t.assigneeId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          {t.createdBy?.name?.trim().split(' ')[0] || 'назначено'}
                        </span>
                      )}
                    </div>
                    {t.returnReason && (
                      <p className="text-xs text-orange-600 dark:text-orange-400 truncate">💬 {t.returnReason}</p>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* On review */}
      {reviewTasks.length > 0 && (
        <div className="card border-amber-200 dark:border-amber-800">
          <h2 className="section-title mb-3 flex items-center gap-2">
            <Clock size={16} className="text-amber-500" /> На проверке ({reviewTasks.length})
          </h2>
          <div className="space-y-2">
            {reviewTasks.map((t: any) => (
              <Link
                key={t.id}
                to={`/tasks/${t.id}`}
                className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/10"
              >
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{t.title}</p>
                  {t.createdById && t.assigneeId && t.createdById !== t.assigneeId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                      {t.createdBy?.name?.trim().split(' ')[0] || 'назначено'}
                    </span>
                  )}
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Today tasks */}
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <CheckSquare size={16} className="text-primary-600" /> Мои задачи
        </h2>
        {!todayTasks.length ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-8">Нет активных задач 🎉</p>
        ) : (
          <div className="space-y-2">
            {todayTasks.map((t: any) => {
              const isUrgent = t.deadline && new Date(t.deadline).getTime() - now.getTime() < 86400000 * 2
              return (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className="block p-3 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors group border border-transparent hover:border-surface-200 dark:hover:border-surface-600"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 leading-snug truncate">
                        {t.title}
                      </p>
                      {t.createdById && t.assigneeId && t.createdById !== t.assigneeId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                          {t.createdBy?.name?.trim().split(' ')[0] || 'назначено'}
                        </span>
                      )}
                    </div>
                    {t.deadline && (
                      <span className={`text-xs shrink-0 font-medium ${isUrgent ? 'text-orange-500' : 'text-surface-400 dark:text-surface-500'}`}>
                        {format(new Date(t.deadline), 'dd.MM', { locale: ru })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                    {t.project?.name && (
                      <span className="text-xs text-surface-400 dark:text-surface-500 truncate">{t.project.name}</span>
                    )}
                    {/* Progress X/Y */}
                    {t.totalCount > 0 && (
                      <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                        {t.doneCount}/{t.totalCount}
                      </span>
                    )}
                  </div>

                  {/* Quick action hint */}
                  {t.status === 'in_progress' && (
                    <div className="mt-2 flex gap-2">
                      <span className="text-[10px] text-primary-600 dark:text-primary-400 font-medium">
                        → Загрузить результат и отправить на проверку
                      </span>
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
