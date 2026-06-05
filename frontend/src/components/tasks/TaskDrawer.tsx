import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { tasksApi, commentsApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { StatusBadge, PriorityBadge, Avatar } from '@/components/ui'
import { X, ExternalLink, MessageSquare, Send, Edit2, Trash2, Calendar, User as UserIcon, FolderKanban, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { isTaskOverdue, STATUS_LABELS, TASK_STATUSES } from '@/lib/taskStatus'
import { stripLeadingEmoji } from '@/lib/stripEmoji'

/**
 * Универсальный right-side drawer для задач. Открывается по taskId,
 * грузит задачу + комментарии, поддерживает Esc/overlay для закрытия.
 * Используется на Задачах, Календаре и в любом месте, где раньше
 * был navigate('/tasks/:id'). Полная страница доступна по «Открыть полностью».
 */
export default function TaskDrawer({
  taskId,
  onClose,
  onEdit,
  onDelete,
}: {
  taskId: string | null
  onClose: () => void
  onEdit?: (task: any) => void
  onDelete?: (taskId: string) => void
}) {
  const isOpen = !!taskId
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const previousActive = useRef<HTMLElement | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!isOpen) return
    previousActive.current = document.activeElement as HTMLElement
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // Блокируем скролл фона пока drawer открыт.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previousActive.current?.focus()
    }
  }, [isOpen, onClose])

  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => tasksApi.get(taskId!),
    enabled: !!taskId,
  })

  const { data: comments } = useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => commentsApi.list(taskId!),
    enabled: !!taskId,
  })

  const addCommentMut = useMutation({
    mutationFn: (message: string) => commentsApi.create(taskId!, message),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['task-comments', taskId] })
    },
    onError: () => toast.error('Не удалось отправить комментарий'),
  })

  const statusMut = useMutation({
    mutationFn: (status: string) => tasksApi.update(taskId!, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', taskId] })
      invalidateAfterTaskChange(qc)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось обновить статус'),
  })

  // Wave 11: 4-статусная модель — берём подписи из центрального модуля.
  const ALL_STATUSES = TASK_STATUSES
  const labels = STATUS_LABELS

  const isOwn = task?.assigneeId === user?.id
  const isCreator = task?.createdById === user?.id
  const isManagerPlus = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm']
    .includes(user?.role || '')
  const canEdit = isManagerPlus || isOwn || isCreator
  const canChangeStatus = isManagerPlus || isOwn

  // Не рендерим drawer вообще, пока он закрыт. Иначе содержимое (включая
  // placeholder «Загрузка…») остаётся в DOM и в некоторых браузерах
  // протекает за пределами viewport (translate-x-full срабатывает не везде
  // одинаково), создавая «фантомную» панель справа.
  if (!isOpen) return null

  return (
    <>
      {/* Overlay: лёгкая тонировка + сильный backdrop-blur. Фон не
          «чёрный», а «размыто-светлый» — модалка в фокусе, контекст
          виден, но не отвлекает. */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[100] bg-black/20 backdrop-blur-md transition-opacity duration-200 animate-fade-in"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={clsx(
          'fixed top-0 right-0 z-[110] h-full bg-white dark:bg-surface-900',
          'shadow-[-12px_0_40px_-8px_rgba(0,0,0,0.25)]',
          'border-l border-surface-200 dark:border-surface-700',
          'w-full sm:w-[460px] lg:w-[560px] xl:w-[640px] flex flex-col',
          'animate-slide-in-right',
        )}
      >
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-surface-100 dark:border-surface-700">
          <div className="flex items-center gap-2 min-w-0">
            {task?.priority && <PriorityBadge priority={task.priority} />}
            {task?.status && <StatusBadge status={task.status} />}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {task && canEdit && onEdit && (
              <button
                onClick={() => onEdit(task)}
                className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"
                title="Редактировать"
              >
                <Edit2 size={16} />
              </button>
            )}
            {task && canEdit && onDelete && (
              <button
                onClick={() => onDelete(task.id)}
                className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                title="Удалить"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700"
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
          {!task ? (
            <div className="flex items-center justify-center h-32 text-sm text-surface-400">Загрузка…</div>
          ) : (
            <>
              <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100 leading-snug">
                {stripLeadingEmoji(task.title)}
              </h2>

              {task.description && (
                <p className="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap leading-relaxed">
                  {task.description}
                </p>
              )}

              <div className="grid grid-cols-1 gap-2">
                {canChangeStatus && (
                  <DetailRow icon={<Edit2 size={14} />} label="Статус">
                    <select
                      value={task.status}
                      onChange={(e) => statusMut.mutate(e.target.value)}
                      className="text-xs border border-surface-200 dark:border-surface-600 rounded-lg px-2 py-1 bg-white dark:bg-surface-800"
                    >
                      {ALL_STATUSES.map(s => (
                        <option key={s} value={s}>{labels[s]}</option>
                      ))}
                    </select>
                  </DetailRow>
                )}
                {task.deadline && (
                  <DetailRow icon={<Calendar size={14} />} label="Дедлайн">
                    <span className={clsx(
                      'text-sm',
                      isTaskOverdue(task)
                        ? 'text-red-500 font-medium'
                        : 'text-surface-700 dark:text-surface-300',
                    )}>
                      {format(new Date(task.deadline), 'd MMMM yyyy, HH:mm', { locale: ru })}
                    </span>
                  </DetailRow>
                )}
                {task.createdAt && (
                  <DetailRow icon={<Clock size={14} />} label="Создана">
                    <span className="text-sm text-surface-700 dark:text-surface-300">
                      {format(new Date(task.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
                    </span>
                  </DetailRow>
                )}
                {task.assignee && (
                  <DetailRow icon={<UserIcon size={14} />} label="Исполнитель">
                    <div className="flex items-center gap-2">
                      <Avatar name={task.assignee.name} src={task.assignee.avatar} size={22} />
                      <span className="text-sm text-surface-700 dark:text-surface-300">
                        {task.assigneeId === user?.id ? 'Вы' : task.assignee.name}
                      </span>
                    </div>
                  </DetailRow>
                )}
                {task.project && (
                  <DetailRow icon={<FolderKanban size={14} />} label="Проект">
                    <Link
                      to={`/projects/${task.project.id}`}
                      onClick={onClose}
                      className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      {task.project.name}
                    </Link>
                  </DetailRow>
                )}
              </div>

              <div className="pt-2 border-t border-surface-100 dark:border-surface-700">
                <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-200 mb-2 flex items-center gap-2">
                  <MessageSquare size={14} /> Комментарии ({comments?.length ?? 0})
                </h3>
                <div className="space-y-2 mb-3">
                  {comments?.length ? comments.map((c: any) => (
                    <div key={c.id} className="rounded-lg bg-surface-50 dark:bg-surface-800/50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Avatar name={c.user?.name} src={c.user?.avatar} size={20} />
                        <span className="text-xs font-medium text-surface-700 dark:text-surface-300">
                          {c.user?.name || '—'}
                        </span>
                        <span className="text-[10px] text-surface-400">
                          {c.createdAt ? format(new Date(c.createdAt), 'dd.MM HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap">
                        {c.message}
                      </p>
                    </div>
                  )) : (
                    <p className="text-xs text-surface-400 italic">Комментариев пока нет</p>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const msg = draft.trim()
                    if (msg) addCommentMut.mutate(msg)
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Написать комментарий…"
                    className="input flex-1 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || addCommentMut.isPending}
                    className="btn-primary px-3"
                  >
                    <Send size={14} />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-surface-100 dark:border-surface-700 flex gap-2">
          {task && (
            <Link
              to={`/tasks/${task.id}`}
              onClick={onClose}
              className="btn-secondary flex-1 justify-center text-sm inline-flex items-center gap-1"
            >
              <ExternalLink size={14} /> Открыть полностью
            </Link>
          )}
        </div>
      </aside>
    </>
  )
}

function DetailRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
      <span className="text-surface-400 dark:text-surface-500 shrink-0">{icon}</span>
      <span className="text-xs text-surface-500 dark:text-surface-400 min-w-[90px]">{label}</span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  )
}
