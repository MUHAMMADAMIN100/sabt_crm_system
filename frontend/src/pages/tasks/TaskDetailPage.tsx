import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, commentsApi, filesApi, taskResultsApi, taskChecklistApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, Avatar, ProgressBar, Modal, ConfirmDialog } from '@/components/ui'
import {
  ArrowLeft, Send, Edit2, Trash2, Paperclip, Upload,
  CheckCircle, RotateCcw, LinkIcon, MessageSquare, AlertTriangle,
  Plus, Square, CheckSquare2,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const PM_ROLES = ['admin', 'founder', 'project_manager']
const WORKER_ROLES = ['smm_specialist', 'designer', 'marketer', 'targetologist', 'sales_manager', 'employee']

const STATUS_FLOW: Record<string, string[]> = {
  new:         ['in_progress'],
  in_progress: ['review'],
  returned:    ['in_progress'],
  review:      [],
  done:        [],
  cancelled:   [],
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const { t } = useTranslation()

  const [comment, setComment] = useState('')
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [activeTab, setActiveTab] = useState<'comments' | 'files' | 'results' | 'checklist'>('results')
  const [returnReason, setReturnReason] = useState('')
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [resultType, setResultType] = useState<'link' | 'comment' | 'media'>('comment')
  const [resultContent, setResultContent] = useState('')
  const [newCheckItem, setNewCheckItem] = useState('')

  const role = user?.role || 'employee'
  const isPM = PM_ROLES.includes(role)
  const isWorker = WORKER_ROLES.includes(role)

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!),
  })

  const { data: files } = useQuery({
    queryKey: ['task-files', id],
    queryFn: () => filesApi.byTask(id!),
    enabled: activeTab === 'files',
  })

  const { data: results } = useQuery({
    queryKey: ['task-results', id],
    queryFn: () => taskResultsApi.list(id!),
  })

  const { data: checklist } = useQuery({
    queryKey: ['task-checklist', id],
    queryFn: () => taskChecklistApi.list(id!),
  })

  const addCheckItem = useMutation({
    mutationFn: () => taskChecklistApi.create(id!, newCheckItem),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task-checklist', id] }); setNewCheckItem('') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const toggleCheckItem = useMutation({
    mutationFn: (itemId: string) => taskChecklistApi.toggle(id!, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-checklist', id] }),
  })

  const removeCheckItem = useMutation({
    mutationFn: (itemId: string) => taskChecklistApi.remove(id!, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-checklist', id] }),
  })

  const updateTask = useMutation({
    mutationFn: (data: any) => tasksApi.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Статус обновлён')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const addResult = useMutation({
    mutationFn: () => taskResultsApi.create(id!, { type: resultType, content: resultContent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-results', id] })
      setResultContent('')
      setShowResultModal(false)
      toast.success('Результат загружен')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const submitForReview = useMutation({
    mutationFn: () => tasksApi.update(id!, { status: 'review' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Задача отправлена на проверку')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Сначала загрузите результат работы'),
  })

  const approveTask = useMutation({
    mutationFn: () => tasksApi.approve(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Задача подтверждена ✓')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const returnTask = useMutation({
    mutationFn: () => tasksApi.returnTask(id!, returnReason || 'Требует доработки'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      setShowReturnModal(false)
      setReturnReason('')
      toast.success('Задача возвращена в работу')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const addComment = useMutation({
    mutationFn: () => commentsApi.create(id!, comment),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task', id] }); setComment('') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось добавить комментарий'),
  })

  const deleteComment = useMutation({
    mutationFn: (cid: string) => commentsApi.remove(id!, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  })

  const updateComment = useMutation({
    mutationFn: ({ cid, msg }: any) => commentsApi.update(id!, cid, msg),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['task', id] }); setEditingComment(null) },
  })

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await filesApi.upload(file, undefined, id)
    qc.invalidateQueries({ queryKey: ['task-files', id] })
    toast.success(t('files.uploaded'))
  }

  if (isLoading) return <PageLoader />
  if (!task) return <div className="text-surface-600 dark:text-surface-400">{t('common.noData')}</div>

  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && !['done', 'cancelled'].includes(task.status)
  const isReturned = task.status === 'returned'
  const isOnReview = task.status === 'review'
  const isDone = task.status === 'done'

  // Status options worker can move to
  const allowedNextStatuses = STATUS_FLOW[task.status] || []
  const canChangeStatus = isWorker && allowedNextStatuses.length > 0
  const resultCount = results?.length || 0
  const hasResult = resultCount > 0
  const canSubmitReview = isWorker && task.status === 'in_progress' && hasResult
  const canSubmitReviewNoResult = isWorker && task.status === 'in_progress' && !hasResult

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{task.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.project && (
              <Link to={`/projects/${task.project.id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                {task.project.name}
              </Link>
            )}
            {isOverdue && (
              <span className="text-xs font-semibold text-red-500 flex items-center gap-1">
                <AlertTriangle size={12} /> Просрочено
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {isReturned && task.returnReason && (
        <div className="card border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10">
          <div className="flex items-start gap-2">
            <RotateCcw size={16} className="text-orange-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">Задача возвращена в работу</p>
              <p className="text-sm text-orange-600 dark:text-orange-300 mt-0.5">{task.returnReason}</p>
            </div>
          </div>
        </div>
      )}

      {/* PM actions: approve / return */}
      {isPM && isOnReview && (
        <div className="card border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-3">
            Задача ожидает проверки
          </p>
          {resultCount > 0 && (
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
              Загружено результатов: {resultCount} — посмотрите во вкладке «Результаты»
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => approveTask.mutate()}
              disabled={approveTask.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={16} /> Подтвердить
            </button>
            <button
              onClick={() => setShowReturnModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition-colors"
            >
              <RotateCcw size={16} /> Вернуть в работу
            </button>
          </div>
        </div>
      )}

      {/* Worker actions: upload result + submit review */}
      {isWorker && ['in_progress', 'returned'].includes(task.status) && (
        <div className="card bg-primary-50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800">
          <p className="text-sm font-semibold text-primary-700 dark:text-primary-400 mb-3">
            {hasResult ? `Результатов загружено: ${resultCount}` : 'Загрузите результат работы'}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowResultModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              <Upload size={15} /> Загрузить результат
            </button>
            {task.status === 'in_progress' && (
              <button
                onClick={() => submitForReview.mutate()}
                disabled={submitForReview.isPending || !hasResult}
                title={!hasResult ? 'Сначала загрузите результат' : ''}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                  hasResult
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-surface-200 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
                )}
              >
                <Send size={15} /> Отправить на проверку
              </button>
            )}
            {task.status === 'returned' && hasResult && (
              <button
                onClick={() => updateTask.mutate({ status: 'in_progress' })}
                disabled={updateTask.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors"
              >
                Взять в работу
              </button>
            )}
          </div>
          {canSubmitReviewNoResult && (
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-2">
              Кнопка «Отправить на проверку» станет активной после загрузки результата
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-4">
          {task.description && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">{t('tasks.description')}</h3>
              <p className="text-surface-700 dark:text-surface-300 text-sm whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* X/Y Progress */}
          {task.totalCount > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">Прогресс</h3>
                <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                  {task.doneCount} / {task.totalCount}
                </span>
              </div>
              <ProgressBar value={Math.round((task.doneCount / task.totalCount) * 100)} />
              {isPM && !isDone && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => updateTask.mutate({ doneCount: Math.max(0, (task.doneCount || 0) - 1) })}
                    disabled={task.doneCount <= 0}
                    className="px-3 py-1 text-sm bg-surface-100 dark:bg-surface-700 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-40"
                  >
                    −
                  </button>
                  <button
                    onClick={() => updateTask.mutate({ doneCount: Math.min(task.totalCount, (task.doneCount || 0) + 1) })}
                    disabled={task.doneCount >= task.totalCount}
                    className="px-3 py-1 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40"
                  >
                    +1
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-surface-100 dark:border-surface-700 flex-wrap">
            {(['results', 'checklist', 'comments', 'files'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab
                    ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                    : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                )}
              >
                {tab === 'results' && `Результаты (${results?.length || 0})`}
                {tab === 'checklist' && `Чек-лист (${checklist?.filter((i: any) => i.isDone).length || 0}/${checklist?.length || 0})`}
                {tab === 'comments' && `Комментарии (${task.comments?.length || 0})`}
                {tab === 'files' && t('files.title')}
              </button>
            ))}
          </div>

          {/* Results tab */}
          {activeTab === 'results' && (
            <div className="space-y-3">
              {!results?.length ? (
                <div className="text-center py-8 text-surface-400 dark:text-surface-500">
                  <MessageSquare size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Результатов пока нет</p>
                  {isWorker && ['in_progress', 'returned'].includes(task.status) && (
                    <button onClick={() => setShowResultModal(true)} className="mt-3 btn-primary text-sm">
                      Загрузить результат
                    </button>
                  )}
                </div>
              ) : (
                results.map((r: any) => (
                  <div key={r.id} className="flex gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-700/50">
                    <Avatar name={r.submittedBy?.name} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-surface-900 dark:text-surface-100">{r.submittedBy?.name}</span>
                        <span className="text-xs text-surface-400">{format(new Date(r.createdAt), 'dd.MM HH:mm', { locale: ru })}</span>
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', {
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400': r.type === 'link',
                          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400': r.type === 'media',
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300': r.type === 'comment',
                        })}>
                          {r.type === 'link' ? 'Ссылка' : r.type === 'media' ? 'Медиа' : 'Комментарий'}
                        </span>
                      </div>
                      {r.type === 'link' ? (
                        <a href={r.content} target="_blank" rel="noreferrer"
                          className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 break-all">
                          <LinkIcon size={12} className="shrink-0" /> {r.content}
                        </a>
                      ) : (
                        <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{r.content}</p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Checklist tab */}
          {activeTab === 'checklist' && (
            <div className="space-y-2">
              {checklist?.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700/30 group">
                  <button
                    onClick={() => toggleCheckItem.mutate(item.id)}
                    className={clsx('shrink-0 transition-colors', item.isDone ? 'text-green-500' : 'text-surface-300 dark:text-surface-600 hover:text-primary-500')}
                  >
                    {item.isDone ? <CheckSquare2 size={18} /> : <Square size={18} />}
                  </button>
                  <span className={clsx('flex-1 text-sm', item.isDone ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-800 dark:text-surface-200')}>
                    {item.text}
                  </span>
                  {isPM && (
                    <button
                      onClick={() => removeCheckItem.mutate(item.id)}
                      className="hidden group-hover:block text-surface-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
              {!checklist?.length && (
                <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">Чек-лист пуст</p>
              )}
              {isPM && !isDone && (
                <div className="flex gap-2 pt-2">
                  <input
                    value={newCheckItem}
                    onChange={e => setNewCheckItem(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && newCheckItem.trim() && addCheckItem.mutate()}
                    placeholder="Добавить пункт..."
                    className="input flex-1 text-sm"
                  />
                  <button
                    onClick={() => newCheckItem.trim() && addCheckItem.mutate()}
                    disabled={!newCheckItem.trim() || addCheckItem.isPending}
                    className="btn-primary flex items-center gap-1"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Comments tab */}
          {activeTab === 'comments' && (
            <div className="space-y-3">
              {task.comments?.map((c: any) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar name={c.author?.name} size={32} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{c.author?.name}</span>
                      <span className="text-xs text-surface-400 dark:text-surface-500">{format(new Date(c.createdAt), 'dd.MM HH:mm')}</span>
                    </div>
                    {editingComment === c.id ? (
                      <div className="flex gap-2">
                        <input value={editText} onChange={e => setEditText(e.target.value)} className="input flex-1 text-sm" />
                        <button onClick={() => updateComment.mutate({ cid: c.id, msg: editText })} className="btn-primary text-xs">{t('common.save')}</button>
                        <button onClick={() => setEditingComment(null)} className="btn-secondary text-xs">{t('common.cancel')}</button>
                      </div>
                    ) : (
                      <div className="bg-surface-50 dark:bg-surface-700/50 rounded-xl p-3 group relative">
                        <p className="text-sm text-surface-700 dark:text-surface-300">{c.message}</p>
                        {(c.authorId === user?.id || user?.role === 'admin') && (
                          <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                            <button onClick={() => { setEditingComment(c.id); setEditText(c.message) }} className="p-1 hover:bg-surface-200 dark:hover:bg-surface-600 rounded-lg text-surface-500">
                              <Edit2 size={12} />
                            </button>
                            <button onClick={() => deleteComment.mutate(c.id)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-red-500">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex gap-3">
                <Avatar name={user?.name} size={32} />
                <div className="flex-1 flex gap-2">
                  <input
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && comment.trim() && addComment.mutate()}
                    placeholder="Комментарий..."
                    className="input flex-1 text-sm"
                  />
                  <button onClick={() => comment.trim() && addComment.mutate()} disabled={!comment.trim()} className="btn-primary">
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Files tab */}
          {activeTab === 'files' && (
            <div className="space-y-3">
              <label className="btn-secondary cursor-pointer">
                <Upload size={15} /> {t('files.upload')}
                <input type="file" className="hidden" onChange={uploadFile} />
              </label>
              <div className="space-y-2">
                {files?.map((f: any) => (
                  <a key={f.id} href={f.path} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-700"
                  >
                    <Paperclip size={15} className="text-primary-600 dark:text-primary-400 shrink-0" />
                    <span className="text-sm text-surface-700 dark:text-surface-300 flex-1 truncate">{f.originalName}</span>
                    <span className="text-xs text-surface-400 dark:text-surface-500">{(f.size / 1024).toFixed(1)} KB</span>
                  </a>
                ))}
                {!files?.length && <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">{t('files.noFiles')}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar info */}
        <div className="space-y-4">
          {/* Status control (PM only when not in done/cancelled) */}
          {isPM && !['done', 'cancelled'].includes(task.status) && (
            <div className="card">
              <h3 className="font-semibold text-sm text-surface-700 dark:text-surface-300 mb-2">Статус задачи</h3>
              <select
                value={task.status}
                onChange={e => updateTask.mutate({ status: e.target.value })}
                className="input w-full"
              >
                {['new','in_progress','review','returned','done','cancelled'].map(s => (
                  <option key={s} value={s}>
                    {({ new: 'Новая', in_progress: 'В работе', review: 'На проверке', returned: 'Возвращено', done: 'Готово', cancelled: 'Отменена' } as any)[s]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="card space-y-3">
            <h3 className="font-semibold text-sm text-surface-700 dark:text-surface-300">Детали</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-surface-500 dark:text-surface-400">{t('tasks.assignee')}</span>
                {task.assignee ? (
                  <div className="flex items-center gap-1.5">
                    <Avatar name={task.assignee.name} size={20} />
                    <span className="font-medium text-surface-900 dark:text-surface-100">{task.assignee.name}</span>
                  </div>
                ) : <span className="text-surface-400 dark:text-surface-500">—</span>}
              </div>
              <div className="flex justify-between">
                <span className="text-surface-500 dark:text-surface-400">{t('tasks.deadline')}</span>
                <span className={clsx('font-medium', isOverdue ? 'text-red-500' : 'text-surface-900 dark:text-surface-100')}>
                  {task.deadline ? format(new Date(task.deadline), 'dd.MM.yyyy') : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-500 dark:text-surface-400">{t('tasks.estimatedHours')}</span>
                <span className="font-medium text-surface-900 dark:text-surface-100">{task.estimatedHours || 0}ч</span>
              </div>
              <div className="flex justify-between">
                <span className="text-surface-500 dark:text-surface-400">{t('dashboard.hours')}</span>
                <span className="font-medium text-primary-600 dark:text-primary-400">{task.loggedHours || 0}ч</span>
              </div>
              {isDone && task.reviewedAt && (
                <div className="flex justify-between">
                  <span className="text-surface-500 dark:text-surface-400">Подтверждено</span>
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {format(new Date(task.reviewedAt), 'dd.MM.yyyy')}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-surface-500 dark:text-surface-400">Создана</span>
                <span className="text-surface-700 dark:text-surface-300">{format(new Date(task.createdAt), 'dd.MM.yyyy')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal: Load result */}
      <Modal open={showResultModal} onClose={() => setShowResultModal(false)} title="Загрузить результат" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Тип результата</label>
            <div className="flex gap-2">
              {(['comment', 'link', 'media'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setResultType(type)}
                  className={clsx('flex-1 py-2 rounded-xl text-sm font-medium border transition-colors', {
                    'border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400': resultType === type,
                    'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:border-surface-300': resultType !== type,
                  })}
                >
                  {type === 'comment' ? 'Описание' : type === 'link' ? 'Ссылка' : 'Медиа'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-1">
              {resultType === 'link' ? 'URL ссылка' : resultType === 'media' ? 'Ссылка на медиа' : 'Описание результата'}
            </label>
            {resultType === 'comment' ? (
              <textarea
                value={resultContent}
                onChange={e => setResultContent(e.target.value)}
                rows={4}
                placeholder="Опишите что сделано..."
                className="input w-full resize-none"
              />
            ) : (
              <input
                value={resultContent}
                onChange={e => setResultContent(e.target.value)}
                placeholder={resultType === 'link' ? 'https://...' : 'https://drive.google.com/...'}
                className="input w-full"
              />
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowResultModal(false)} className="btn-secondary">Отмена</button>
            <button
              onClick={() => addResult.mutate()}
              disabled={!resultContent.trim() || addResult.isPending}
              className="btn-primary"
            >
              Сохранить
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Return reason */}
      <Modal open={showReturnModal} onClose={() => setShowReturnModal(false)} title="Вернуть задачу в работу" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Причина возврата</label>
            <textarea
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              rows={3}
              placeholder="Укажите что нужно доработать..."
              className="input w-full resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowReturnModal(false)} className="btn-secondary">Отмена</button>
            <button
              onClick={() => returnTask.mutate()}
              disabled={returnTask.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              <RotateCcw size={15} /> Вернуть
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
