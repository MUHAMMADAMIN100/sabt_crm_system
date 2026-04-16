import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tasksApi, analyticsApi } from '@/services/api.service'
import { PageLoader, StatusBadge, PriorityBadge, Avatar } from '@/components/ui'
import { TrendingDown, Clock, Eye, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'

export default function PMDashboard() {
  const qc = useQueryClient()

  const { data: overdueTasks, isLoading: loadingOverdue } = useQuery({
    queryKey: ['tasks-overdue'],
    queryFn: tasksApi.overdue,
  })

  const { data: reviewTasks, isLoading: loadingReview } = useQuery({
    queryKey: ['tasks-review'],
    queryFn: () => tasksApi.list({ status: 'review' }),
  })

  const { data: workload } = useQuery({
    queryKey: ['employee-workload'],
    queryFn: analyticsApi.employeeWorkload,
  })

  const approve = useMutation({
    mutationFn: (id: string) => tasksApi.approve(id),
    onMutate: async (taskId: string) => {
      await qc.cancelQueries({ queryKey: ['tasks-review'] })
      const previous = qc.getQueryData(['tasks-review'])
      qc.setQueryData(['tasks-review'], (old: any[]) => old?.filter((t: any) => t.id !== taskId) ?? [])
      return { previous }
    },
    onError: (_e: any, _v: any, context: any) => {
      qc.setQueryData(['tasks-review'], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks-review'] })
      qc.invalidateQueries({ queryKey: ['tasks-overdue'] })
      toast.success('Задача подтверждена')
    },
  })

  if (loadingOverdue || loadingReview) return <PageLoader />

  // Tasks due in next 24h
  const urgentSoon = (overdueTasks || []).filter((t: any) => {
    if (!t.deadline) return false
    const diff = new Date(t.deadline).getTime() - Date.now()
    return diff > 0 && diff < 86400000
  })

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-3xl font-bold text-amber-500">{reviewTasks?.length ?? 0}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">На проверке</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-red-500">{overdueTasks?.length ?? 0}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Просрочено</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-orange-500">{urgentSoon.length}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Сгорят сегодня</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-bold text-primary-600 dark:text-primary-400">{workload?.length ?? 0}</p>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">В команде</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks on review */}
        <div className="card">
          <h2 className="section-title mb-4 flex items-center gap-2">
            <Eye size={16} className="text-amber-500" /> Ожидают проверки
          </h2>
          {!reviewTasks?.length ? (
            <p className="text-sm text-surface-400 py-4 text-center">Нет задач на проверке</p>
          ) : (
            <div className="space-y-3">
              {reviewTasks.slice(0, 8).map((t: any) => (
                <div key={t.id} className="flex items-start gap-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Link to={`/tasks/${t.id}`} className="text-sm font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 truncate">
                        {t.title}
                      </Link>
                      {t.createdById && t.assigneeId && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${t.createdById === t.assigneeId ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                          {t.createdById === t.assigneeId ? 'сам' : (t.createdBy?.name?.trim().split(' ')[0] || 'назначено')}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <PriorityBadge priority={t.priority} />
                      {t.assignee && (
                        <span className="text-xs text-surface-400">{t.assignee.name}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => approve.mutate(t.id)}
                    disabled={approve.isPending}
                    className="shrink-0 text-xs px-2 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                  >
                    Принять
                  </button>
                  <Link
                    to={`/tasks/${t.id}`}
                    className="shrink-0 text-xs px-2 py-1 bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-300 rounded-lg hover:opacity-80"
                  >
                    Открыть
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Overdue tasks */}
        <div className="card">
          <h2 className="section-title mb-4 flex items-center gap-2 text-red-600 dark:text-red-400">
            <TrendingDown size={16} /> Просроченные
          </h2>
          {!overdueTasks?.length ? (
            <p className="text-sm text-green-600 dark:text-green-400 py-4 text-center">Просрочек нет ✓</p>
          ) : (
            <div className="space-y-2">
              {overdueTasks.slice(0, 8).map((t: any) => (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{t.title}</p>
                      {t.createdById && t.assigneeId && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${t.createdById === t.assigneeId ? 'bg-surface-100 dark:bg-surface-700 text-surface-400' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'}`}>
                          {t.createdById === t.assigneeId ? 'сам' : (t.createdBy?.name?.trim().split(' ')[0] || 'назначено')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-surface-400">{t.assignee?.name}</p>
                  </div>
                  {t.deadline && (
                    <span className="text-xs text-red-500 font-semibold shrink-0">
                      {format(new Date(t.deadline), 'dd.MM', { locale: ru })}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Team workload */}
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <AlertTriangle size={16} className="text-orange-500" /> Нагрузка команды
        </h2>
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
                <p className={`text-sm font-bold ${e.activeTasks >= 8 ? 'text-red-500' : e.activeTasks >= 5 ? 'text-orange-500' : 'text-green-600 dark:text-green-400'}`}>
                  {e.activeTasks}
                </p>
                <p className="text-[10px] text-surface-400">задач</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
