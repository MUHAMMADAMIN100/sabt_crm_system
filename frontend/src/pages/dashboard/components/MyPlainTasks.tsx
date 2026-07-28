import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/services/api.service'
import TaskDrawer from '@/components/tasks/TaskDrawer'
import { isTaskOverdue, STATUS_LABELS, normalizeTaskStatus } from '@/lib/taskStatus'
import { CalendarDays, ClipboardList } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

/**
 * «Мои задачи» — обычные поручения в кабинете, ОТДЕЛЬНО от производственных
 * карточек доски (те живут в MyDevCards). Разделение намеренное: карточка
 * этапа и поручение руководителя — разные по смыслу вещи, в одном списке
 * производственная работа терялась бы среди прочего.
 */
export default function MyPlainTasks() {
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: tasks } = useQuery({ queryKey: ['my-tasks'], queryFn: tasksApi.my })

  const rows = useMemo(() => {
    return ((tasks as any[]) || [])
      .filter(t => !(Number(t.devStage) >= 1) && t.status !== 'done' && t.status !== 'cancelled')
      .sort((a, b) => {
        const da = a.deadline || '9999', db = b.deadline || '9999'
        return da < db ? -1 : da > db ? 1 : 0
      })
  }, [tasks])

  if (rows.length === 0) return null

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={17} className="text-surface-500 dark:text-surface-400" />
        <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Мои задачи</h2>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
          {rows.length}
        </span>
      </div>

      <div className="divide-y divide-surface-100 dark:divide-surface-700">
        {rows.map(t => {
          const overdue = isTaskOverdue(t)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="w-full text-left py-2.5 flex items-start gap-3 hover:bg-surface-50 dark:hover:bg-surface-800/60 transition-colors px-1 rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{t.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {t.project?.name && (
                    <span className="text-xs text-surface-500 dark:text-surface-400 truncate">{t.project.name}</span>
                  )}
                  <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
                    {STATUS_LABELS[normalizeTaskStatus(t.status)]}
                  </span>
                </div>
              </div>
              {t.deadline && (
                <span className={clsx(
                  'text-[11px] shrink-0 inline-flex items-center gap-1 mt-0.5',
                  overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-surface-500 dark:text-surface-400',
                )}>
                  <CalendarDays size={12} />
                  {format(new Date(t.deadline), 'd MMM', { locale: ru })}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
