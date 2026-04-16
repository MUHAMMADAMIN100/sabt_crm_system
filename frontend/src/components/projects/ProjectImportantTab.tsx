import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectAnnouncementsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal, EmptyState, ConfirmDialog, Avatar } from '@/components/ui'
import { Plus, Trash2, AlertTriangle, Megaphone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const MANAGE_ROLES = ['admin', 'founder', 'co_founder', 'project_manager', 'head_smm']

interface Props { projectId: string }

export default function ProjectImportantTab({ projectId }: Props) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canManage = MANAGE_ROLES.includes(user?.role || '')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: announcements, isLoading } = useQuery({
    queryKey: ['project-announcements', projectId],
    queryFn: () => projectAnnouncementsApi.list(projectId),
  })

  const createMut = useMutation({
    mutationFn: (data: any) => projectAnnouncementsApi.create(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-announcements', projectId] })
      setShowCreate(false)
      toast.success('Объявление отправлено всем участникам')
    },
    onError: () => toast.error('Ошибка'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectAnnouncementsApi.remove(projectId, id),
    onMutate: async (id: string) => {
      setDeleteId(null)
      await qc.cancelQueries({ queryKey: ['project-announcements', projectId] })
      const previous = qc.getQueryData(['project-announcements', projectId])
      qc.setQueryData(['project-announcements', projectId], (old: any[] = []) => old.filter(a => a.id !== id))
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(['project-announcements', projectId], ctx.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => toast.success('Удалено'),
  })

  if (isLoading) return <p className="text-sm text-surface-400 text-center py-8">Загрузка...</p>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-500" />
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Важные объявления</h2>
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> Добавить объявление
          </button>
        )}
      </div>

      {!announcements?.length ? (
        <EmptyState
          title="Нет объявлений"
          description="Добавьте срочное объявление — все участники проекта получат уведомление на почту и в Telegram"
          action={canManage && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> Добавить</button>}
        />
      ) : (
        <div className="space-y-3">
          {announcements.map((a: any) => (
            <div key={a.id} className={clsx(
              'card p-4 border-l-4',
              a.priority === 'urgent' ? 'border-l-red-500' : 'border-l-amber-400',
            )}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {a.priority === 'urgent' && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-bold uppercase">Срочно</span>
                    )}
                    <h3 className="font-semibold text-surface-900 dark:text-surface-100">{a.title}</h3>
                  </div>
                  {a.description && (
                    <p className="text-sm text-surface-600 dark:text-surface-400 mt-1 whitespace-pre-line">{a.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-3 text-xs text-surface-400 dark:text-surface-500">
                    {a.createdBy && (
                      <div className="flex items-center gap-1.5">
                        <Avatar name={a.createdBy.name} size={18} />
                        <span>{a.createdBy.name}</span>
                      </div>
                    )}
                    <span>{format(new Date(a.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}</span>
                  </div>
                </div>
                {canManage && (
                  <button onClick={() => setDeleteId(a.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400 shrink-0">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <AnnouncementForm
          onClose={() => setShowCreate(false)}
          onSubmit={(data: any) => createMut.mutate(data)}
          loading={createMut.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить объявление?"
        message="Объявление будет удалено."
        danger
      />
    </div>
  )
}

function AnnouncementForm({ onClose, onSubmit, loading }: any) {
  const { register, handleSubmit } = useForm({
    defaultValues: { title: '', description: '', priority: 'urgent' },
  })

  return (
    <Modal open onClose={onClose} title="Новое объявление" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <div>
          <label className="label">Заголовок *</label>
          <input {...register('title', { required: true })} className="input" placeholder="Срочное совещание в 15:00" />
        </div>
        <div>
          <label className="label">Описание</label>
          <textarea {...register('description')} rows={3} className="input resize-none" placeholder="Подробности..." />
        </div>
        <div>
          <label className="label">Приоритет</label>
          <select {...register('priority')} className="input">
            <option value="urgent">Срочное</option>
            <option value="normal">Обычное</option>
          </select>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-400">
          Все участники проекта получат уведомление на почту, в Telegram и внутри системы.
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
          <button type="submit" disabled={loading} className="btn-primary bg-red-600 hover:bg-red-700">
            {loading ? 'Отправка...' : 'Отправить всем'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
