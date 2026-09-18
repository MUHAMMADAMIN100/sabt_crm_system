import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/services/api.service'
import TaskDrawer from '@/components/tasks/TaskDrawer'
import { isTaskOverdue, STATUS_LABELS, normalizeTaskStatus } from '@/lib/taskStatus'
import { CalendarDays, ClipboardList, Check, MoreHorizontal } from 'lucide-react'
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
  const qc = useQueryClient()
  const { data: tasks } = useQuery({ queryKey: ['my-tasks'], queryFn: tasksApi.my })
  // Отметка «готово» прямо в списке — как на карточках производства.
  // Оптимистично: галочка появляется сразу, сервер догоняет.
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => tasksApi.update(v.id, { status: v.done ? 'done' : 'in_progress' }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['my-tasks'] })
      const prev = qc.getQueryData<any>(['my-tasks'])
      qc.setQueryData<any>(['my-tasks'], (old: any) => Array.isArray(old)
        ? old.map((t: any) => t.id === v.id ? { ...t, status: v.done ? 'done' : 'in_progress' } : t) : old)
      return { prev }
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(['my-tasks'], ctx.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['my-tasks'] }),
  })

  // Закрытая в этой сессии задача не исчезает, а остаётся зачёркнутой —
  // видно, что сделал, и можно снять отметку. После перезагрузки уходит.
  const [keep, setKeep] = useState<Set<string>>(() => new Set())
  const rows = useMemo(() => {
    return ((tasks as any[]) || [])
      .filter(t => !(Number(t.devStage) >= 1) && (t.status !== 'done' || keep.has(t.id)) && t.status !== 'cancelled')
      .sort((a, b) => {
        const da = a.deadline || '9999', db = b.deadline || '9999'
        return da < db ? -1 : da > db ? 1 : 0
      })
  }, [tasks, keep])

  if (rows.length === 0) return null

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <ClipboardList size={17} className="text-surface-500 dark:text-surface-400" />
        <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Мои задачи</h2>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-400">
          {rows.filter(t => normalizeTaskStatus(t.status) !== 'done').length}
        </span>
      </div>

      <div>
        {rows.map(t => {
          const overdue = isTaskOverdue(t)
          const done = normalizeTaskStatus(t.status) === 'done'
          return (
            <div
              key={t.id}
              onClick={() => setOpenId(t.id)}
              className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2.5 my-2 cursor-pointer transition hover:border-surface-300 dark:hover:border-surface-600',
                done ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
                  : overdue ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200/70 dark:border-red-900/40'
                  : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}
            >
              {/* Галочка «готово» — как на карточках производства. */}
              <button
                type="button"
                onClick={ev => {
                  ev.stopPropagation()
                  if (!done) setKeep(prev => new Set(prev).add(t.id))
                  toggle.mutate({ id: t.id, done: !done })
                }}
                title={done ? 'Снять отметку' : 'Отметить готовой'}
                className={clsx('w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition',
                  done ? 'bg-green-500 border-green-500' : 'border-surface-300 dark:border-surface-600 hover:border-green-500')}
              >
                <Check size={13} className={clsx('text-white transition-opacity', done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
              </button>

              <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center bg-surface-200/70 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400">
                <ClipboardList size={16} />
              </div>

              <div className="min-w-0 flex-1 overflow-hidden">
                <p className={clsx('text-[13.5px] font-semibold truncate',
                  done ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>{t.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-nowrap sm:flex-wrap overflow-hidden">
                  <span className="text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-block bg-surface-200/70 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400">
                    Задача
                  </span>
                  {t.project?.name && (
                    <span className="text-[11px] text-surface-400 dark:text-surface-500 min-w-0 truncate">{t.project.name}</span>
                  )}
                  <span className="text-[11px] text-surface-400 dark:text-surface-500 shrink-0">
                    {STATUS_LABELS[normalizeTaskStatus(t.status)]}
                  </span>
                  {t.deadline && (
                    <span className={clsx('text-[11px] shrink-0 inline-flex items-center gap-1',
                      overdue ? 'text-red-500 dark:text-red-400 font-bold' : 'text-surface-400 dark:text-surface-500')}>
                      <CalendarDays size={11} />
                      {format(new Date(t.deadline), 'd MMM', { locale: ru })}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={ev => { ev.stopPropagation(); setOpenId(t.id) }}
                title="Подробнее"
                className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-primary-600 hover:border-primary-400 flex items-center justify-center shrink-0 transition"
              >
                <MoreHorizontal size={16} />
              </button>
            </div>
          )
        })}
      </div>

      {openId && <TaskDrawer taskId={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
