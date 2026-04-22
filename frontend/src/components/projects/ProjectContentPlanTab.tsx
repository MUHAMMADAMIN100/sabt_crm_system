import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Plus, Edit, Trash2, ExternalLink, Filter, Loader2 } from 'lucide-react'
import { contentPlanApi, employeesApi } from '@/services/api.service'
import { Modal, EmptyState, ConfirmDialog, FormField } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'

interface ContentItem {
  id: string
  projectId: string
  contentType: string
  topic: string
  format: string | null
  preparationDeadline: string | null
  publishDate: string | null
  assigneeId: string | null
  assignee?: { id: string; name: string } | null
  pmId: string | null
  pm?: { id: string; name: string } | null
  status: string
  fileLink: string | null
  caption: string | null
  approvalStatus: string
  comments: string | null
}

const TYPE_OPTIONS = [
  { value: 'reel',     label: '🎬 Reels' },
  { value: 'story',    label: '📱 Story' },
  { value: 'post',     label: '📰 Post' },
  { value: 'design',   label: '🎨 Design' },
  { value: 'ad',       label: '💡 Ad' },
  { value: 'video',    label: '📹 Video' },
  { value: 'carousel', label: '🖼 Carousel' },
  { value: 'other',    label: '📦 Other' },
]

const STATUS_OPTIONS = [
  { value: 'planned',       label: 'Запланировано',  color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'preparing',     label: 'Готовится',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  { value: 'in_production', label: 'В производстве', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  { value: 'on_review',     label: 'На проверке',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'on_approval',   label: 'У клиента',      color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  { value: 'approved',      label: 'Утверждено ✓',   color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { value: 'published',     label: 'Опубликовано',   color: 'bg-emerald-200 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' },
  { value: 'cancelled',     label: 'Отменено',       color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
]

const APPROVAL_OPTIONS = [
  { value: 'pending',           label: 'Ожидает' },
  { value: 'approved',          label: 'Согласовано' },
  { value: 'changes_requested', label: 'Правки' },
  { value: 'rejected',          label: 'Отказ' },
]

const EDIT_ROLES = ['admin', 'founder', 'co_founder', 'project_manager', 'head_smm', 'smm_specialist']
const DELETE_ROLES = ['admin', 'founder', 'co_founder', 'project_manager', 'head_smm']

export default function ProjectContentPlanTab({ projectId }: { projectId: string }) {
  const role = useAuthStore(s => s.user?.role)
  const canEdit = !!role && EDIT_ROLES.includes(role)
  const canDelete = !!role && DELETE_ROLES.includes(role)

  const qc = useQueryClient()
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editItem, setEditItem] = useState<ContentItem | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const params = {
    projectId,
    contentType: filterType || undefined,
    status: filterStatus || undefined,
  }

  const { data: items, isLoading } = useQuery<ContentItem[]>({
    queryKey: ['content-plan', projectId, filterType, filterStatus],
    queryFn: () => contentPlanApi.list(params),
  })

  const { data: employees } = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
  })

  const queryKey = ['content-plan', projectId, filterType, filterStatus]

  const createMut = useMutation({
    mutationFn: (data: any) => contentPlanApi.create({ ...data, projectId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-plan', projectId] })
      qc.invalidateQueries({ queryKey: ['plan-fact', projectId] })
      qc.invalidateQueries({ queryKey: ['launch-checklist', projectId] })
      setShowCreate(false)
      toast.success('Позиция добавлена')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => contentPlanApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-plan', projectId] })
      qc.invalidateQueries({ queryKey: ['plan-fact', projectId] })
      qc.invalidateQueries({ queryKey: ['project-risk', projectId] })
      setEditItem(null)
      toast.success('Сохранено')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const quickStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => contentPlanApi.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey })
      const prev = qc.getQueryData<ContentItem[]>(queryKey)
      qc.setQueryData(queryKey, (old: ContentItem[] = []) => old.map(it => it.id === id ? { ...it, status } : it))
      return { prev }
    },
    onError: (_e, _v, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev)
      toast.error('Не удалось обновить статус')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plan-fact', projectId] })
      qc.invalidateQueries({ queryKey: ['project-risk', projectId] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: contentPlanApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-plan', projectId] })
      qc.invalidateQueries({ queryKey: ['plan-fact', projectId] })
      setDeleteId(null)
      toast.success('Удалено')
    },
    onError: () => toast.error('Ошибка'),
  })

  const grouped = useMemo(() => {
    const sorted = (items ?? []).slice().sort((a, b) => {
      const da = a.publishDate ? new Date(a.publishDate).getTime() : Number.MAX_SAFE_INTEGER
      const db = b.publishDate ? new Date(b.publishDate).getTime() : Number.MAX_SAFE_INTEGER
      return da - db
    })
    return sorted
  }, [items])

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin text-purple-500" /></div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-semibold text-base">Контент-план</h2>
        {canEdit && (
          <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm">
            <Plus size={16} /> Добавить позицию
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex items-center gap-1 text-xs text-gray-500"><Filter size={12} /> Фильтры:</div>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="">Все типы</option>
          {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm">
          <option value="">Все статусы</option>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(filterType || filterStatus) && (
          <button onClick={() => { setFilterType(''); setFilterStatus('') }} className="text-xs text-gray-500 hover:text-gray-700 underline">Сбросить</button>
        )}
      </div>

      {grouped.length === 0 ? (
        <EmptyState
          title="Контент-плана нет"
          description={canEdit ? 'Добавьте первую позицию или привяжите тариф — план сгенерируется автоматически.' : 'PM ещё не сформировал план.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Дата публикации</th>
                <th className="text-left px-3 py-2 font-medium">Тип</th>
                <th className="text-left px-3 py-2 font-medium">Тема</th>
                <th className="text-left px-3 py-2 font-medium">Статус</th>
                <th className="text-left px-3 py-2 font-medium">Согласование</th>
                <th className="text-left px-3 py-2 font-medium">Исполнитель</th>
                <th className="text-left px-3 py-2 font-medium">Файл</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(item => {
                const typeOpt = TYPE_OPTIONS.find(t => t.value === item.contentType)
                const statusOpt = STATUS_OPTIONS.find(s => s.value === item.status) ?? STATUS_OPTIONS[0]
                const apprOpt = APPROVAL_OPTIONS.find(a => a.value === item.approvalStatus)
                return (
                  <tr key={item.id} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {item.publishDate ? new Date(item.publishDate).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{typeOpt?.label ?? item.contentType}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={item.topic}>{item.topic}</td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <select
                          value={item.status}
                          onChange={e => quickStatusMut.mutate({ id: item.id, status: e.target.value })}
                          className={clsx('text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer', statusOpt.color)}
                        >
                          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <span className={clsx('text-xs px-2 py-1 rounded-full font-medium', statusOpt.color)}>{statusOpt.label}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{apprOpt?.label ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{item.assignee?.name ?? '—'}</td>
                    <td className="px-3 py-2">
                      {item.fileLink ? (
                        <a href={item.fileLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-purple-600 hover:underline">
                          <ExternalLink size={12} /> Открыть
                        </a>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {canEdit && (
                        <button onClick={() => setEditItem(item)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded" title="Редактировать">
                          <Edit size={14} />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => setDeleteId(item.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 rounded" title="Удалить">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="Новая позиция контент-плана" size="lg">
          <ItemForm
            employees={employees ?? []}
            loading={createMut.isPending}
            onCancel={() => setShowCreate(false)}
            onSubmit={data => createMut.mutate(data)}
          />
        </Modal>
      )}

      {editItem && (
        <Modal open onClose={() => setEditItem(null)} title={`Редактировать: ${editItem.topic}`} size="lg">
          <ItemForm
            initial={editItem}
            employees={employees ?? []}
            loading={updateMut.isPending}
            onCancel={() => setEditItem(null)}
            onSubmit={data => updateMut.mutate({ id: editItem.id, data })}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить позицию?"
        message="Позиция будет удалена из контент-плана. План-факт пересчитается автоматически."
        danger
      />
    </div>
  )
}

function ItemForm({ initial, employees, onSubmit, onCancel, loading }: {
  initial?: ContentItem
  employees: any[]
  onSubmit: (data: any) => void
  onCancel: () => void
  loading: boolean
}) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      topic: initial?.topic ?? '',
      contentType: initial?.contentType ?? 'post',
      format: initial?.format ?? '',
      publishDate: initial?.publishDate ? initial.publishDate.split('T')[0] : '',
      preparationDeadline: initial?.preparationDeadline ? initial.preparationDeadline.split('T')[0] : '',
      assigneeId: initial?.assigneeId ?? '',
      pmId: initial?.pmId ?? '',
      status: initial?.status ?? 'planned',
      approvalStatus: initial?.approvalStatus ?? 'pending',
      fileLink: initial?.fileLink ?? '',
      caption: initial?.caption ?? '',
      comments: initial?.comments ?? '',
    },
  })

  return (
    <form
      onSubmit={handleSubmit(data => onSubmit({
        ...data,
        format: data.format || null,
        publishDate: data.publishDate || null,
        preparationDeadline: data.preparationDeadline || null,
        assigneeId: data.assigneeId || null,
        pmId: data.pmId || null,
        fileLink: data.fileLink || null,
        caption: data.caption || null,
        comments: data.comments || null,
      }))}
      className="space-y-4 max-h-[75vh] overflow-y-auto pr-1"
    >
      <FormField label="Тема" required error={errors.topic?.message as string}>
        <input {...register('topic', { required: 'Введите тему' })} className="input" />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Тип контента">
          <select {...register('contentType')} className="input">
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormField>
        <FormField label="Формат">
          <input {...register('format')} className="input" placeholder="vertical, carousel-3, square…" />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Дата публикации">
          <input type="date" {...register('publishDate')} className="input" />
        </FormField>
        <FormField label="Готовность к ревью">
          <input type="date" {...register('preparationDeadline')} className="input" />
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Исполнитель">
          <select {...register('assigneeId')} className="input">
            <option value="">— Не назначен —</option>
            {employees.map((e: any) => (
              <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>
            ))}
          </select>
        </FormField>
        <FormField label="PM">
          <select {...register('pmId')} className="input">
            <option value="">— Не назначен —</option>
            {employees.map((e: any) => (
              <option key={e.userId || e.id} value={e.userId || e.id}>{e.fullName || e.name}</option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Статус">
          <select {...register('status')} className="input">
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormField>
        <FormField label="Согласование">
          <select {...register('approvalStatus')} className="input">
            {APPROVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </FormField>
      </div>

      <FormField label="Ссылка на файл">
        <input {...register('fileLink')} className="input" placeholder="Google Drive, Figma, R2 — https://..." />
      </FormField>

      <FormField label="Подпись к публикации">
        <textarea {...register('caption')} rows={3} className="input resize-none" />
      </FormField>

      <FormField label="Комментарии">
        <textarea {...register('comments')} rows={2} className="input resize-none" />
      </FormField>

      <div className="flex justify-end gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">Отмена</button>
        <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg text-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
          {loading ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}
