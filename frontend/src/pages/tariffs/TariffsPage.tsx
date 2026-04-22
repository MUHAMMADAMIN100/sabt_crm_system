import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Plus, Edit, Trash2, Copy, Power, Search } from 'lucide-react'
import { smmTariffsApi } from '@/services/api.service'
import { Modal, EmptyState, PageLoader, ConfirmDialog, FormField } from '@/components/ui'
import { hasPermission } from '@/lib/permissions'
import { useAuthStore } from '@/store/auth.store'

interface Tariff {
  id: string
  name: string
  description: string | null
  monthlyPrice: number | string
  storiesPerMonth: number
  reelsPerMonth: number
  postsPerMonth: number
  designsPerMonth: number
  adsIncluded: boolean
  shootingDaysPerMonth: number
  reportsPerMonth: number
  revisionLimit: number
  durationDays: number
  isActive: boolean
  createdAt: string
}

const fmtMoney = (v: number | string | null | undefined) =>
  v == null ? '—' : new Intl.NumberFormat('ru-RU').format(Number(v)) + ' ₽'

export default function TariffsPage() {
  const role = useAuthStore(s => s.user?.role)
  const canEdit = hasPermission(role as any, 'tariffs.manage')

  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editTariff, setEditTariff] = useState<Tariff | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const params = {
    search: search || undefined,
    isActive: showInactive ? undefined : true,
  }

  const { data: tariffs, isLoading } = useQuery<Tariff[]>({
    queryKey: ['smm-tariffs', params],
    queryFn: () => smmTariffsApi.list(params),
  })

  const filtered = tariffs ?? []

  const createMut = useMutation({
    mutationFn: smmTariffsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smm-tariffs'] })
      setShowCreate(false)
      toast.success('Тариф создан')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => smmTariffsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smm-tariffs'] })
      setEditTariff(null)
      toast.success('Сохранено')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })

  const toggleMut = useMutation({
    mutationFn: smmTariffsApi.toggleActive,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smm-tariffs'] })
      toast.success('Статус изменён')
    },
    onError: () => toast.error('Ошибка'),
  })

  const cloneMut = useMutation({
    mutationFn: smmTariffsApi.clone,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smm-tariffs'] })
      toast.success('Тариф продублирован')
    },
    onError: () => toast.error('Ошибка'),
  })

  const deleteMut = useMutation({
    mutationFn: smmTariffsApi.remove,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smm-tariffs'] })
      setDeleteId(null)
      toast.success('Удалено')
    },
    onError: (e: any) => {
      // Скорее всего FK от projects — даём подсказку.
      const msg = e?.response?.status === 500
        ? 'На тариф ссылаются проекты. Используйте «выключить» вместо удаления.'
        : e?.response?.data?.message || 'Ошибка'
      toast.error(msg)
    },
  })

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">SMM-тарифы</h1>
          <p className="text-sm text-gray-500">Шаблоны для SMM-проектов: лимиты по контенту и ежемесячная стоимость.</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium"
          >
            <Plus size={16} /> Новый тариф
          </button>
        )}
      </header>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
        </div>
        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Показать выключенные
        </label>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Тарифов пока нет"
          description={canEdit ? 'Создайте первый тариф — он появится в списке выбора при создании SMM-проектов.' : 'Тарифы появятся здесь после настройки администратором.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(t => (
            <TariffCard
              key={t.id}
              tariff={t}
              canEdit={canEdit}
              onEdit={() => setEditTariff(t)}
              onClone={() => cloneMut.mutate(t.id)}
              onToggle={() => toggleMut.mutate(t.id)}
              onDelete={() => setDeleteId(t.id)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="Новый тариф" size="lg">
          <TariffForm
            loading={createMut.isPending}
            onCancel={() => setShowCreate(false)}
            onSubmit={data => createMut.mutate(data)}
          />
        </Modal>
      )}

      {editTariff && (
        <Modal open onClose={() => setEditTariff(null)} title={`Редактировать: ${editTariff.name}`} size="lg">
          <TariffForm
            initial={editTariff}
            loading={updateMut.isPending}
            onCancel={() => setEditTariff(null)}
            onSubmit={data => updateMut.mutate({ id: editTariff.id, data })}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить тариф?"
        message="Если на тариф ссылаются проекты, удаление не пройдёт. Лучше выключите тариф (toggle), он останется в истории."
        danger
      />
    </div>
  )
}

function TariffCard({ tariff, canEdit, onEdit, onClone, onToggle, onDelete }: {
  tariff: Tariff
  canEdit: boolean
  onEdit: () => void
  onClone: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className={clsx(
      'rounded-xl border p-5 bg-white dark:bg-gray-900 shadow-sm',
      tariff.isActive
        ? 'border-gray-200 dark:border-gray-700'
        : 'border-gray-200 dark:border-gray-800 opacity-60',
    )}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-base truncate">{tariff.name}</h3>
          {tariff.description && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{tariff.description}</p>
          )}
        </div>
        <span className={clsx(
          'shrink-0 text-xs px-2 py-1 rounded-full font-medium',
          tariff.isActive
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
        )}>
          {tariff.isActive ? 'активный' : 'выкл'}
        </span>
      </div>

      <div className="text-2xl font-bold text-purple-600 mb-4">
        {fmtMoney(tariff.monthlyPrice)} <span className="text-xs font-normal text-gray-500">/ мес</span>
      </div>

      <ul className="space-y-1 text-sm mb-4">
        {tariff.storiesPerMonth > 0 && <li>📱 Stories: <b>{tariff.storiesPerMonth}</b></li>}
        {tariff.reelsPerMonth > 0    && <li>🎬 Reels: <b>{tariff.reelsPerMonth}</b></li>}
        {tariff.postsPerMonth > 0    && <li>📰 Posts: <b>{tariff.postsPerMonth}</b></li>}
        {tariff.designsPerMonth > 0  && <li>🎨 Дизайны: <b>{tariff.designsPerMonth}</b></li>}
        {tariff.shootingDaysPerMonth > 0 && <li>📸 Съёмочных дней: <b>{tariff.shootingDaysPerMonth}</b></li>}
        {tariff.reportsPerMonth > 0  && <li>📊 Отчётов: <b>{tariff.reportsPerMonth}</b></li>}
        {tariff.adsIncluded          && <li>💡 Реклама включена</li>}
        {tariff.revisionLimit > 0    && <li>↻ Лимит правок: <b>{tariff.revisionLimit}</b></li>}
        <li className="text-xs text-gray-500 pt-1">Длительность: {tariff.durationDays} дн.</li>
      </ul>

      {canEdit && (
        <div className="flex items-center gap-1 pt-3 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onEdit} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title="Редактировать">
            <Edit size={14} />
          </button>
          <button onClick={onClone} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title="Дублировать">
            <Copy size={14} />
          </button>
          <button onClick={onToggle} className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800" title={tariff.isActive ? 'Выключить' : 'Включить'}>
            <Power size={14} />
          </button>
          <button onClick={onDelete} className="p-2 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 ml-auto" title="Удалить">
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

function TariffForm({ initial, onSubmit, onCancel, loading }: {
  initial?: Partial<Tariff>
  onSubmit: (data: any) => void
  onCancel: () => void
  loading: boolean
}) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      monthlyPrice: Number(initial?.monthlyPrice ?? 0),
      storiesPerMonth: initial?.storiesPerMonth ?? 0,
      reelsPerMonth: initial?.reelsPerMonth ?? 0,
      postsPerMonth: initial?.postsPerMonth ?? 0,
      designsPerMonth: initial?.designsPerMonth ?? 0,
      shootingDaysPerMonth: initial?.shootingDaysPerMonth ?? 0,
      reportsPerMonth: initial?.reportsPerMonth ?? 0,
      revisionLimit: initial?.revisionLimit ?? 0,
      durationDays: initial?.durationDays ?? 30,
      adsIncluded: initial?.adsIncluded ?? false,
      isActive: initial?.isActive ?? true,
    },
  })

  return (
    <form
      onSubmit={handleSubmit(data => onSubmit({
        ...data,
        monthlyPrice: Number(data.monthlyPrice) || 0,
        storiesPerMonth: Number(data.storiesPerMonth) || 0,
        reelsPerMonth: Number(data.reelsPerMonth) || 0,
        postsPerMonth: Number(data.postsPerMonth) || 0,
        designsPerMonth: Number(data.designsPerMonth) || 0,
        shootingDaysPerMonth: Number(data.shootingDaysPerMonth) || 0,
        reportsPerMonth: Number(data.reportsPerMonth) || 0,
        revisionLimit: Number(data.revisionLimit) || 0,
        durationDays: Number(data.durationDays) || 30,
      }))}
      className="space-y-4 max-h-[75vh] overflow-y-auto pr-1"
    >
      <FormField label="Название" required error={errors.name?.message as string}>
        <input
          {...register('name', { required: 'Введите название' })}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
      </FormField>

      <FormField label="Описание">
        <textarea
          {...register('description')}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
      </FormField>

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Цена / мес (₽)" required>
          <input type="number" step="0.01" {...register('monthlyPrice')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
        </FormField>
        <FormField label="Длительность (дней)">
          <input type="number" {...register('durationDays')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" />
        </FormField>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <FormField label="Stories"><input type="number" {...register('storiesPerMonth')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
        <FormField label="Reels"><input type="number" {...register('reelsPerMonth')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
        <FormField label="Posts"><input type="number" {...register('postsPerMonth')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
        <FormField label="Дизайны"><input type="number" {...register('designsPerMonth')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <FormField label="Съёмок / мес"><input type="number" {...register('shootingDaysPerMonth')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
        <FormField label="Отчётов / мес"><input type="number" {...register('reportsPerMonth')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
        <FormField label="Лимит правок"><input type="number" {...register('revisionLimit')} className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900" /></FormField>
      </div>

      <div className="flex items-center gap-6 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" {...register('adsIncluded')} /> Реклама включена
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" {...register('isActive')} /> Активный
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-gray-200 dark:border-gray-700">Отмена</button>
        <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg text-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50">
          {loading ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}
