import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectAdsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal, EmptyState, ConfirmDialog } from '@/components/ui'
import { Plus, Edit, Trash2, Megaphone } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format, parseISO, isWithinInterval } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const CHANNEL_OPTIONS = [
  { value: 'instagram', label: 'Instagram',       icon: '📸' },
  { value: 'tiktok',    label: 'TikTok',          icon: '🎵' },
  { value: 'facebook',  label: 'Facebook',        icon: '👤' },
  { value: 'youtube',   label: 'YouTube',         icon: '📺' },
  { value: 'telegram',  label: 'Telegram',        icon: '✈️' },
  { value: 'google',    label: 'Google Ads',      icon: '🔎' },
  { value: 'other',     label: 'Другое',          icon: '🌐' },
]

const MANAGE_ROLES = ['admin', 'founder', 'co_founder', 'project_manager', 'head_smm', 'smm_specialist']

interface Props { projectId: string }

export default function ProjectAdsTab({ projectId }: Props) {
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canManage = MANAGE_ROLES.includes(user?.role || '')
  const [editingAd, setEditingAd] = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: ads, isLoading } = useQuery({
    queryKey: ['project-ads', projectId],
    queryFn: () => projectAdsApi.list(projectId),
  })

  const queryKey = ['project-ads', projectId]

  const createMut = useMutation({
    mutationFn: (data: any) => projectAdsApi.create(projectId, data),
    onMutate: async (newAd: any) => {
      setShowCreate(false)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      const temp = { id: `temp-${Date.now()}`, ...newAd, createdAt: new Date().toISOString() }
      qc.setQueryData(queryKey, (old: any[] = []) => [temp, ...old])
      return { previous, temp }
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: (server: any, _v, ctx) => {
      qc.setQueryData(queryKey, (old: any[] = []) => old.map(a => a.id === ctx?.temp.id ? server : a))
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Реклама добавлена')
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => projectAdsApi.update(projectId, id, data),
    onMutate: async ({ id, data }: any) => {
      setEditingAd(null)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, (old: any[] = []) => old.map(a => a.id === id ? { ...a, ...data } : a))
      return { previous }
    },
    onError: (e: any, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Сохранено')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectAdsApi.remove(projectId, id),
    onMutate: async (id: string) => {
      setDeleteId(null)
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, (old: any[] = []) => old.filter(a => a.id !== id))
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Удалено')
    },
  })

  if (isLoading) return <p className="text-sm text-surface-400 text-center py-8">Загрузка...</p>

  const today = new Date()
  const active = (ads || []).filter((a: any) => {
    try {
      return isWithinInterval(today, { start: parseISO(a.startDate), end: parseISO(a.endDate) })
    } catch { return false }
  })
  const ended = (ads || []).filter((a: any) => new Date(a.endDate) < today)
  const upcoming = (ads || []).filter((a: any) => new Date(a.startDate) > today)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Megaphone size={18} className="text-primary-500" />
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100">Рекламные кампании</h2>
          {active.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {active.length} активн.
            </span>
          )}
        </div>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus size={16} /> Добавить рекламу
          </button>
        )}
      </div>

      {!ads?.length ? (
        <EmptyState
          title="Нет рекламных кампаний"
          description="Добавьте первую кампанию, чтобы отслеживать её период и канал"
          action={canManage && <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> Добавить</button>}
        />
      ) : (
        <div className="space-y-5">
          {active.length > 0 && <AdSection title="🟢 Идёт сейчас" ads={active} canManage={canManage} onEdit={setEditingAd} onDelete={setDeleteId} accent="active" />}
          {upcoming.length > 0 && <AdSection title="📅 Запланировано" ads={upcoming} canManage={canManage} onEdit={setEditingAd} onDelete={setDeleteId} accent="upcoming" />}
          {ended.length > 0 && <AdSection title="⚪ Завершены" ads={ended} canManage={canManage} onEdit={setEditingAd} onDelete={setDeleteId} accent="ended" />}
        </div>
      )}

      {(showCreate || editingAd) && (
        <AdForm
          initial={editingAd}
          onClose={() => { setShowCreate(false); setEditingAd(null) }}
          onSubmit={(data: any) => {
            if (editingAd) updateMut.mutate({ id: editingAd.id, data })
            else createMut.mutate(data)
          }}
          loading={createMut.isPending || updateMut.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить рекламу?"
        message="Запись будет удалена безвозвратно."
        danger
      />
    </div>
  )
}

function AdSection({ title, ads, canManage, onEdit, onDelete, accent }: any) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-2">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ads.map((a: any) => {
          const ch = CHANNEL_OPTIONS.find(c => c.value === a.channel)
          return (
            <div key={a.id} className={clsx(
              'card p-4 relative overflow-hidden',
              accent === 'active' && 'border-emerald-300 dark:border-emerald-700',
              accent === 'upcoming' && 'border-amber-200 dark:border-amber-700',
              accent === 'ended' && 'opacity-70',
            )}>
              {accent === 'active' && (
                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
              )}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-surface-900 dark:text-surface-100 truncate">{a.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-surface-500 dark:text-surface-400">
                    <span>{ch?.icon} {ch?.label || a.channel}</span>
                    {a.budget && <span>· 💰 {Number(a.budget).toLocaleString('ru-RU')} сомони</span>}
                    {a.budgetSource === 'company' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 font-medium">из компании</span>}
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => onEdit(a)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Edit size={14} /></button>
                    <button onClick={() => onDelete(a.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-surface-600 dark:text-surface-300">
                <span className="font-medium">
                  {format(parseISO(a.startDate.slice(0, 10)), 'dd MMM', { locale: ru })}
                </span>
                <span className="text-surface-300">→</span>
                <span className="font-medium">
                  {format(parseISO(a.endDate.slice(0, 10)), 'dd MMM yyyy', { locale: ru })}
                </span>
              </div>
              {a.createdBy?.name && (
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-surface-400 dark:text-surface-500">
                  <span>Создал: <span className="font-medium text-surface-600 dark:text-surface-300">{a.createdBy.name}</span></span>
                </div>
              )}
              {a.note && <p className="text-xs text-surface-500 dark:text-surface-400 mt-2 line-clamp-2">{a.note}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AdForm({ initial, onClose, onSubmit, loading }: any) {
  const { register, handleSubmit } = useForm({
    defaultValues: {
      title: initial?.title || '',
      channel: initial?.channel || 'instagram',
      budget: initial?.budget || '',
      budgetSource: initial?.budgetSource || 'client',
      startDate: initial?.startDate ? String(initial.startDate).slice(0, 10) : '',
      endDate: initial?.endDate ? String(initial.endDate).slice(0, 10) : '',
      note: initial?.note || '',
    },
  })

  const submit = (data: any) => {
    if (data.endDate < data.startDate) { toast.error('Дата окончания раньше начала'); return }
    onSubmit({
      ...data,
      budget: data.budget ? Number(data.budget) : null,
    })
  }

  return (
    <Modal open onClose={onClose} title={initial ? 'Редактировать рекламу' : 'Новая реклама'} size="md">
      <form onSubmit={handleSubmit(submit)} className="space-y-3">
        <div>
          <label className="label">Название *</label>
          <input {...register('title', { required: true })} className="input" placeholder="Промо новой коллекции" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Канал *</label>
            <select {...register('channel', { required: true })} className="input">
              {CHANNEL_OPTIONS.map(c => (
                <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Бюджет (сомони)</label>
            <input type="number" min={0} step="0.01" {...register('budget')} className="input" placeholder="500" />
          </div>
        </div>
        <div>
          <label className="label">Кто платит *</label>
          <select {...register('budgetSource', { required: true })} className="input">
            <option value="client">От клиента — клиент оплачивает</option>
            <option value="company">Из компании — мы платим (добавится в бюджет проекта)</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Начало *</label>
            <input type="date" {...register('startDate', { required: true })} className="input" />
          </div>
          <div>
            <label className="label">Конец *</label>
            <input type="date" {...register('endDate', { required: true })} className="input" />
          </div>
        </div>
        <div>
          <label className="label">Заметка</label>
          <textarea {...register('note')} rows={2} className="input resize-none" placeholder="Ссылка на креатив, ЦА, условия..." />
        </div>
        <div className="flex gap-2 justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Сохранение...' : (initial ? 'Сохранить' : 'Добавить')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
