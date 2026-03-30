import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, commentsApi, filesApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, Avatar } from '@/components/ui'
import { ArrowLeft, Send, Edit2, Trash2, Paperclip, Upload } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const { t } = useTranslation()
  const [comment, setComment] = useState('')
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [activeTab, setActiveTab] = useState<'comments' | 'files'>('comments')

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!),
  })

  const { data: files } = useQuery({
    queryKey: ['task-files', id],
    queryFn: () => filesApi.byTask(id!),
    enabled: activeTab === 'files',
  })

  const updateTask = useMutation({
    mutationFn: (data: any) => tasksApi.update(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
    },
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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <h1 className="page-title">{task.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.project && (
              <Link to={`/projects/${task.project.id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                {task.project.name}
              </Link>
            )}
          </div>
        </div>
        <select
          value={task.status}
          onChange={e => updateTask.mutate({ status: e.target.value })}
          className="input w-40"
        >
          {['new','in_progress','review','done','cancelled'].map(s => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-4">
          {task.description && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">{t('tasks.description')}</h3>
              <p className="text-surface-700 dark:text-surface-300 text-sm whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-surface-100 dark:border-surface-700">
            {(['comments', 'files'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400' : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                )}
              >
                {tab === 'comments' ? `${t('reports.comments')} (${task.comments?.length || 0})` : t('files.title')}
              </button>
            ))}
          </div>

          {/* Comments */}
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
                            <button onClick={() => { setEditingComment(c.id); setEditText(c.message) }} className="p-1 hover:bg-surface-200 dark:hover:bg-surface-600 rounded-lg text-surface-500 dark:text-surface-400">
                              <Edit2 size={12} />
                            </button>
                            <button onClick={() => deleteComment.mutate(c.id)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-red-500 dark:text-red-400">
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
                    placeholder={t('reports.comments') + '...'}
                    className="input flex-1 text-sm"
                  />
                  <button onClick={() => comment.trim() && addComment.mutate()} disabled={!comment.trim()} className="btn-primary">
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Files */}
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
          <div className="card space-y-3">
            <h3 className="font-semibold text-sm text-surface-700 dark:text-surface-300">{t('common.noData') === 'Нет данных' ? 'Детали' : 'Details'}</h3>
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
                <span className={`font-medium ${task.deadline && new Date(task.deadline) < new Date() ? 'text-red-500' : 'text-surface-900 dark:text-surface-100'}`}>
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
              <div className="flex justify-between">
                <span className="text-surface-500 dark:text-surface-400">{t('reports.date')}</span>
                <span className="text-surface-700 dark:text-surface-300">{format(new Date(task.createdAt), 'dd.MM.yyyy')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
