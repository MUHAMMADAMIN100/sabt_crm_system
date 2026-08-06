import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  // Вторая роль тоже даёт управленческий уровень — зеркально RolesGuard бэка.
  const MANAGER_PLUS_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'video_director', 'dev_director']
  const isManagerPlus = MANAGER_PLUS_ROLES.includes(user?.role || '')
    || MANAGER_PLUS_ROLES.includes(user?.secondaryRole || '')
  const canEdit = isManagerPlus || isOwn || isCreator
  const canChangeStatus = isManagerPlus || isOwn

  // Не рендерим drawer вообще, пока он закрыт. Иначе содержимое (включая
  // placeholder «Загрузка…») остаётся в DOM и в некоторых браузерах
  // протекает за пределами viewport (translate-x-full срабатывает не везде
  // одинаково), создавая «фантомную» панель справа.
  if (!isOpen) return null

  // Рендерим через portal в document.body — иначе stacking context
  // родителя (Layout) не даёт overlay'ю накрыть Sidebar/Header.
  return createPortal(
    <>
      {/* Overlay: матовая плёнка + сильный backdrop-blur по всему viewport. */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[9998] bg-surface-900/30 backdrop-blur-2xl transition-opacity duration-200 animate-fade-in"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={clsx(
          // Прижато к правому краю: top 0, bottom 0, right 0, без gap'ов.
          'fixed top-0 right-0 bottom-0 z-[9999]',
          'bg-surface-50 dark:bg-surface-900',
          // Округление только слева (справа упирается в край экрана).
          'rounded-l-3xl overflow-hidden',
          'shadow-[-24px_0_60px_-12px_rgba(15,23,42,0.35)]',
          'w-full sm:w-[480px] lg:w-[580px] xl:w-[660px] flex flex-col',
          'animate-slide-in-right',
        )}
      >
        {/* Top bar: бейджи слева, кнопки действий справа */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            {task?.priority && <PriorityBadge priority={task.priority} />}
            {task?.status && <StatusBadge status={task.status} />}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {task && canEdit && onEdit && (
              <button
                onClick={() => onEdit(task)}
                className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
                title="Редактировать"
              >
                <Edit2 size={16} />
              </button>
            )}
            {task && canEdit && onDelete && (
              <button
                onClick={() => onDelete(task.id)}
                className="p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors"
                title="Удалить"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
              aria-label="Закрыть"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-5 min-h-0">
          {!task ? (
            <div className="flex items-center justify-center h-40 text-sm text-surface-400">Загрузка…</div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-surface-900 dark:text-surface-50 leading-tight tracking-tight">
                {stripLeadingEmoji(task.title)}
              </h2>

              {task.description && (
                <p className="text-sm text-surface-600 dark:text-surface-400 whitespace-pre-wrap leading-relaxed">
                  {task.description}
                </p>
              )}

              {/* Сводная карточка метаданных */}
              <div className="rounded-2xl bg-surface-50 dark:bg-surface-800/50 border border-surface-100 dark:border-surface-700/50 divide-y divide-surface-100 dark:divide-surface-700/50 overflow-hidden">
                {canChangeStatus && (
                  <DetailRow icon={<Edit2 size={15} />} label="Статус" tone="indigo">
                    <select
                      value={task.status}
                      onChange={(e) => statusMut.mutate(e.target.value)}
                      className="text-sm border border-surface-200 dark:border-surface-600 rounded-lg px-2.5 py-1 bg-surface-100 dark:bg-surface-700/60 focus:outline-none focus:ring-2 focus:ring-primary-200"
                    >
                      {ALL_STATUSES.map(s => (
                        <option key={s} value={s}>{labels[s]}</option>
                      ))}
                    </select>
                  </DetailRow>
                )}
                {task.deadline && (
                  <DetailRow icon={<Calendar size={15} />} label="Дедлайн" tone="rose">
                    <span className={clsx(
                      'text-sm font-medium',
                      isTaskOverdue(task)
                        ? 'text-red-500'
                        : 'text-surface-800 dark:text-surface-100',
                    )}>
                      {format(new Date(task.deadline), 'd MMMM yyyy, HH:mm', { locale: ru })}
                    </span>
                  </DetailRow>
                )}
                {task.createdAt && (
                  <DetailRow icon={<Clock size={15} />} label="Создана" tone="slate">
                    <span className="text-sm text-surface-700 dark:text-surface-200">
                      {format(new Date(task.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
                    </span>
                  </DetailRow>
                )}
                {task.assignee && (
                  <DetailRow icon={<UserIcon size={15} />} label="Исполнитель" tone="violet">
                    <div className="flex items-center gap-2">
                      <Avatar name={task.assignee.name} src={task.assignee.avatar} size={24} />
                      <span className="text-sm font-medium text-surface-800 dark:text-surface-100">
                        {task.assigneeId === user?.id ? 'Вы' : task.assignee.name}
                      </span>
                    </div>
                  </DetailRow>
                )}
                {task.project && (
                  <DetailRow icon={<FolderKanban size={15} />} label="Проект" tone="emerald">
                    <Link
                      to={`/projects/${task.project.id}`}
                      onClick={onClose}
                      className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      {task.project.name}
                    </Link>
                  </DetailRow>
                )}
              </div>

              {/* Комментарии */}
              <div className="pt-3 border-t border-surface-100 dark:border-surface-700/60">
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-100 mb-3 flex items-center gap-2">
                  <MessageSquare size={15} className="text-primary-500" />
                  Комментарии
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-xs text-surface-500">
                    {comments?.length ?? 0}
                  </span>
                </h3>
                <div className="space-y-2 mb-3">
                  {comments?.length ? comments.map((c: any) => (
                    <div key={c.id} className="rounded-xl bg-surface-50 dark:bg-surface-800/50 border border-surface-100 dark:border-surface-700/50 p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Avatar name={c.user?.name || c.author?.name} src={c.user?.avatar || c.author?.avatar} size={22} />
                        <span className="text-xs font-semibold text-surface-700 dark:text-surface-200">
                          {c.user?.name || c.author?.name || '—'}
                        </span>
                        <span className="text-[10px] text-surface-400 ml-auto">
                          {c.createdAt ? format(new Date(c.createdAt), 'dd.MM HH:mm') : ''}
                        </span>
                      </div>
                      <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap leading-relaxed">
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
                    className="flex-1 text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-900 px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || addCommentMut.isPending}
                    className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-primary-600 hover:bg-primary-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    aria-label="Отправить"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </>
          )}
        </div>

      </aside>
    </>,
    document.body,
  )
}

const TONE_BG: Record<string, string> = {
  indigo:  'bg-surface-50  dark:bg-surface-500/15  text-surface-600  dark:text-surface-300',
  rose:    'bg-surface-50    dark:bg-surface-500/15    text-surface-600    dark:text-surface-300',
  slate:   'bg-surface-100  dark:bg-surface-700/40   text-surface-600   dark:text-surface-300',
  violet:  'bg-surface-50  dark:bg-surface-500/15  text-surface-600  dark:text-surface-300',
  emerald: 'bg-green-50 dark:bg-green-500/15 text-green-600 dark:text-green-300',
}

function DetailRow({
  icon, label, children, tone = 'slate',
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  tone?: keyof typeof TONE_BG
}) {
  const toneClass = TONE_BG[tone] || TONE_BG.slate
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={clsx('shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl', toneClass)}>
        {icon}
      </span>
      <span className="text-xs uppercase tracking-wide text-surface-400 dark:text-surface-500 min-w-[96px] font-medium">
        {label}
      </span>
      <span className="flex-1 min-w-0 text-right">{children}</span>
    </div>
  )
}
