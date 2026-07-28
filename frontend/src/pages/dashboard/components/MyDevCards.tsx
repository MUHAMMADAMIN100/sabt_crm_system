import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tasksApi } from '@/services/api.service'
import { DEV_STAGES } from '@/pages/workflow/DevProjectsBoard'
import TaskDrawer from '@/components/tasks/TaskDrawer'
import { isTaskOverdue } from '@/lib/taskStatus'
import { CalendarDays, Hammer } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

/**
 * «Мои карточки на доске разработки» — блок в кабинете разработчика и
 * проект-менеджера. Показывает карточки этапов (задачи с devStage), которые
 * назначены лично мне и ещё не закрыты: что делать, по какому проекту, на
 * каком этапе и к какому сроку. Клик открывает карточку.
 *
 * Обычные поручения сюда НЕ мешаем — они идут отдельным блоком (MyTasksBlock),
 * чтобы производственные карточки не терялись среди прочих задач.
 */
export default function MyDevCards() {
  const [openId, setOpenId] = useState<string | null>(null)
  const { data: tasks } = useQuery({ queryKey: ['my-tasks'], queryFn: tasksApi.my })

  const cards = useMemo(() => {
    return ((tasks as any[]) || [])
      .filter(t => Number(t.devStage) >= 1 && t.status !== 'done' && t.status !== 'cancelled')
      .sort((a, b) => {
        // Сначала то, у чего срок ближе; задачи без срока — в конец.
        const da = a.deadline || '9999', db = b.deadline || '9999'
        return da < db ? -1 : da > db ? 1 : 0
      })
  }, [tasks])

  if (cards.length === 0) return null

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Hammer size={17} className="text-primary-600 dark:text-primary-400" />
        <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">
          Мои карточки на доске разработки
        </h2>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
          {cards.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {cards.map(t => {
          const stage = DEV_STAGES.find(s => s.num === Number(t.devStage))
          const overdue = isTaskOverdue(t)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(t.id)}
              className="text-left rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 hover:border-primary-400 dark:hover:border-primary-500 transition-colors p-3"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 shrink-0">
                  {stage ? `${stage.pct}%` : '—'}
                </span>
                <span className="text-[11px] text-surface-500 dark:text-surface-400 truncate">
                  {stage?.label || 'Этап не указан'}
                </span>
              </div>
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100 line-clamp-2">{t.title}</p>
              {t.project?.name && (
                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 truncate">{t.project.name}</p>
              )}
              {t.deadline && (
                <p className={clsx(
                  'text-[11px] mt-1.5 inline-flex items-center gap-1',
                  // Красный — только для просрочки, как принято в системе.
                  overdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-surface-500 dark:text-surface-400',
                )}>
                  <CalendarDays size={12} />
                  {format(new Date(t.deadline), 'd MMM', { locale: ru })}
                  {overdue && ' · просрочено'}
                </p>
              )}
            </button>
          )
        })}
      </div>

      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
