import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi } from '@/services/api.service'
import { PageLoader, EmptyState, Avatar } from '@/components/ui'
import { STATUS_LABELS, STATUS_COLOR_CLASSES, normalizeTaskStatus } from '@/lib/taskStatus'
import { ClipboardList, Crown, Play, Check, CalendarDays, AlertTriangle } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий', medium: 'Средний', high: 'Высокий', critical: 'Критический', urgent: 'Срочный',
}

/**
 * «Задачи от руководителя» — личный кабинет поручений.
 *  · вкладка «Мне»: задачи, выданные сотруднику основателем/руководителями;
 *    статус меняется одним кликом (В работе → Выполнено), без файла-результата;
 *  · вкладка «Я выдал»: для тех, кто ставит задачи — видно, на каком статусе
 *    каждая задача и у кого.
 */
export default function ManagementTasksPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'mine' | 'assigned'>('mine')

  const { data: mine = [], isLoading } = useQuery({
    queryKey: ['tasks-from-management'],
    queryFn: () => tasksApi.fromManagement(),
    refetchInterval: 60000,
  })
  // Вкладку «Я выдал» показываем по ФАКТУ наличия выданных задач, а не по
  // списку ролей: задачи ставят и менеджеры продаж, и назначенные менеджеры
  // проектов — жёсткий список ролей на фронте пришлось бы дублировать и
  // поддерживать синхронно с бэком.
  const { data: assigned = [] } = useQuery({
    queryKey: ['tasks-assigned-by-me'],
    queryFn: () => tasksApi.assignedByMe(),
    refetchInterval: 60000,
  })
  const canAssign = assigned.length > 0

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => tasksApi.update(id, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks-from-management'] })
      qc.invalidateQueries({ queryKey: ['tasks-assigned-by-me'] })
      qc.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('Статус обновлён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось обновить статус'),
  })

  if (isLoading) return <PageLoader />

  const list: any[] = tab === 'mine' ? mine : assigned
  const isOverdue = (t: any) =>
    !!t.deadline && normalizeTaskStatus(t.status) !== 'done'
    && new Date(t.deadline) < new Date(new Date().setHours(0, 0, 0, 0))

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList size={20} className="text-primary-600" />
        <h1 className="page-title">Задачи от руководителя</h1>
      </div>

      {canAssign && (
        <div className="flex gap-1.5">
          {([['mine', `Мне · ${mine.length}`], ['assigned', `Я выдал · ${assigned.length}`]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setTab(v)}
              className={clsx('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                tab === v
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600')}
            >{label}</button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          title={tab === 'mine' ? 'Задач от руководителя нет' : 'Вы пока не выдавали задач'}
          description={tab === 'mine'
            ? 'Здесь появятся поручения от основателя и руководителей направлений.'
            : 'Поставьте задачу сотруднику — она появится здесь со статусом.'}
        />
      ) : (
        <div className="space-y-2.5">
          {list.map((t: any) => {
            const status = normalizeTaskStatus(t.status)
            const overdue = isOverdue(t)
            return (
              <div key={t.id} className="card space-y-2.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-surface-900 dark:text-surface-100 leading-snug">{t.title}</p>
                    {t.description && (
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-1 whitespace-pre-wrap">{t.description}</p>
                    )}
                  </div>
                  <span className={clsx('text-[11px] font-semibold px-2 py-0.5 rounded shrink-0', STATUS_COLOR_CLASSES[status])}>
                    {STATUS_LABELS[status]}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap text-[11px] text-surface-500 dark:text-surface-400">
                  {tab === 'mine' ? (
                    t.createdBy?.name && (
                      <span className="inline-flex items-center gap-1">
                        <Crown size={12} className="text-primary-500" /> от {t.createdBy.name}
                      </span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar name={t.assignee?.name || 'Сотрудник'} src={t.assignee?.avatar} size={18} />
                      {t.assignee?.name || 'Исполнитель не назначен'}
                      {Array.isArray(t.assignees) && t.assignees.length > 1 && ` +${t.assignees.length - 1}`}
                    </span>
                  )}
                  {t.project?.name && <span>· {t.project.name}</span>}
                  {t.priority && <span>· {PRIORITY_LABELS[t.priority] || t.priority}</span>}
                  {t.deadline && (
                    <span className={clsx('inline-flex items-center gap-1', overdue && 'text-red-500 font-semibold')}>
                      {overdue ? <AlertTriangle size={12} /> : <CalendarDays size={12} />}
                      {format(parseISO(t.deadline), 'dd.MM.yyyy')}
                      {overdue && ' · просрочено'}
                    </span>
                  )}
                </div>

                {/* Смена статуса — только на своей вкладке. Закрытую и
                    ОТМЕНЁННУЮ руководством задачу «оживить» нельзя. */}
                {tab === 'mine' && status !== 'done' && status !== 'cancelled' && (
                  <div className="flex gap-2 pt-0.5">
                    {status !== 'in_progress' && (
                      <button
                        type="button"
                        disabled={statusMut.isPending}
                        onClick={() => statusMut.mutate({ id: t.id, status: 'in_progress' })}
                        className="btn-secondary text-xs py-1"
                      ><Play size={12} /> Взять в работу</button>
                    )}
                    <button
                      type="button"
                      disabled={statusMut.isPending}
                      onClick={() => statusMut.mutate({ id: t.id, status: 'done' })}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-60"
                    ><Check size={12} /> Выполнено</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
