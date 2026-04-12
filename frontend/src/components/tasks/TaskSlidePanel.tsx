import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tasksApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { StatusBadge, PriorityBadge, Avatar, ProgressBar } from '@/components/ui'
import {
  X, ExternalLink, Calendar, Clock, User,
  FolderKanban, CheckSquare, AlertTriangle,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const ALL_STATUSES = [
  { value: 'new', label: 'Новая' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'returned', label: 'Возвращено' },
  { value: 'done', label: 'Готово' },
  { value: 'cancelled', label: 'Отменена' },
]

const PM_ROLES = ['admin', 'founder', 'project_manager']

interface Props {
  taskId: string | null
  onClose: () => void
}

export default function TaskSlidePanel({ taskId, onClose }: Props) {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const isPM = PM_ROLES.includes(user?.role || '')
  const isSMM = user?.role === 'smm_specialist'

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId!),
    enabled: !!taskId,
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: any) => tasksApi.update(id, { status }),
    onSuccess: () => {
      invalidateAfterTaskChange(qc)
      qc.invalidateQueries({ queryKey: ['calendar'] })
      toast.success('Статус обновлён')
    },
    onError: () => toast.error('Ошибка обновления'),
  })

  const isOpen = !!taskId

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          'fixed inset-0 bg-black/40 z-40 transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={onClose}
      />

      {/* Slide panel */}
      <div
        className={clsx(
          'fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-surface-900 shadow-2xl z-50',
          'flex flex-col transition-transform duration-300 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-surface-700 shrink-0">
          <h2 className="font-semibold text-surface-900 dark:text-surface-100 text-base">Детали задачи</h2>
          <div className="flex items-center gap-2">
            {task && (
              <Link
                to={`/tasks/${task.id}`}
                className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
                title="Открыть полную страницу"
              >
                <ExternalLink size={16} />
              </Link>
            )}
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg text-surface-500 dark:text-surface-400"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !task ? (
            <p className="text-surface-500 dark:text-surface-400 text-sm text-center py-8">Задача не найдена</p>
          ) : (
            <>
              {/* Title + badges */}
              <div>
                <h3 className="text-lg font-bold text-surface-900 dark:text-surface-100 leading-snug mb-2">
                  {task.title}
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                </div>
              </div>

              {/* Description */}
              {task.description && (
                <div className="bg-surface-50 dark:bg-surface-800 rounded-xl p-3">
                  <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">{task.description}</p>
                </div>
              )}

              {/* Meta info */}
              <div className="space-y-2.5">
                {task.project && (
                  <InfoRow icon={<FolderKanban size={14} />} label="Проект">
                    <Link to={`/projects/${task.project.id}`} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                      {task.project.name}
                    </Link>
                  </InfoRow>
                )}
                {task.assignee && (
                  <InfoRow icon={<User size={14} />} label="Исполнитель">
                    <div className="flex items-center gap-2">
                      <Avatar name={task.assignee.name} src={task.assignee.avatar} size={20} />
                      <span className="text-sm text-surface-800 dark:text-surface-200">{task.assignee.name}</span>
                    </div>
                  </InfoRow>
                )}
                {task.startDate && (
                  <InfoRow icon={<Calendar size={14} />} label="Начало">
                    <span className="text-sm text-surface-700 dark:text-surface-300">
                      {format(new Date(task.startDate), 'dd MMM yyyy', { locale: ru })}
                    </span>
                  </InfoRow>
                )}
                {task.deadline && (
                  <InfoRow icon={<Clock size={14} />} label="Дедлайн">
                    <span className={clsx(
                      'text-sm font-medium',
                      new Date(task.deadline) < new Date() && task.status !== 'done'
                        ? 'text-red-500'
                        : 'text-surface-700 dark:text-surface-300',
                    )}>
                      {format(new Date(task.deadline), 'dd MMM yyyy', { locale: ru })}
                      {new Date(task.deadline) < new Date() && task.status !== 'done' && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-red-500">
                          <AlertTriangle size={11} /> просрочено
                        </span>
                      )}
                    </span>
                  </InfoRow>
                )}
              </div>

              {/* Checklist progress */}
              {task.totalCount > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-surface-500 dark:text-surface-400 flex items-center gap-1">
                      <CheckSquare size={12} /> Чеклист
                    </span>
                    <span className="text-xs text-surface-500 dark:text-surface-400">
                      {task.doneCount}/{task.totalCount}
                    </span>
                  </div>
                  <ProgressBar value={Math.round((task.doneCount / task.totalCount) * 100)} />
                </div>
              )}

              {/* Logged hours */}
              {task.loggedHours > 0 && (
                <div className="flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                  <Clock size={14} />
                  <span>Залогировано: <b className="text-surface-800 dark:text-surface-200">{task.loggedHours}ч</b></span>
                </div>
              )}

              {/* Return reason */}
              {task.returnReason && (
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 border border-red-200 dark:border-red-900/50">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">Причина возврата:</p>
                  <p className="text-xs text-red-600 dark:text-red-300">{task.returnReason}</p>
                </div>
              )}

              {/* Status change */}
              {(isPM || isSMM || task.assigneeId === user?.id) && !['done', 'cancelled'].includes(task.status) && (
                <div>
                  <p className="text-xs font-medium text-surface-500 dark:text-surface-400 mb-2">Изменить статус</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_STATUSES
                      .filter(s => s.value !== task.status)
                      .filter(s => {
                        if (isPM) return true
                        // SMM и обычные сотрудники — все статусы кроме done (PM утверждает)
                        return !['done'].includes(s.value)
                      })
                      .map(s => (
                        <button
                          key={s.value}
                          onClick={() => statusMut.mutate({ id: task.id, status: s.value })}
                          disabled={statusMut.isPending}
                          className="px-3 py-1.5 text-xs rounded-lg border border-surface-200 dark:border-surface-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:border-primary-300 hover:text-primary-700 dark:hover:text-primary-400 transition-colors text-surface-600 dark:text-surface-300"
                        >
                          → {s.label}
                        </button>
                      ))
                    }
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {task && (
          <div className="px-5 py-4 border-t border-surface-100 dark:border-surface-700 shrink-0">
            <Link
              to={`/tasks/${task.id}`}
              className="btn-primary w-full justify-center"
              onClick={onClose}
            >
              <ExternalLink size={15} /> Открыть полную страницу
            </Link>
          </div>
        )}
      </div>
    </>
  )
}

function InfoRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="text-surface-400 dark:text-surface-500 mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-surface-400 dark:text-surface-500 mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  )
}
