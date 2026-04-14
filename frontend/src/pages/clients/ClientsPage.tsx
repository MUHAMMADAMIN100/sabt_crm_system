import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { Modal, EmptyState, PageLoader, ConfirmDialog } from '@/components/ui'
import { Plus, Search, Edit, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'new',         label: 'Новый',              color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { value: 'waiting',     label: 'Ожидание ответа',    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  { value: 'negotiating', label: 'В переговорах',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  { value: 'proposal',    label: 'Предложение',        color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  { value: 'won',         label: 'Клиент ✓',           color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  { value: 'lost',        label: 'Отказ',              color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
  { value: 'on_hold',     label: 'На паузе',           color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
]

const INTEREST_OPTIONS: { value: string; label: string; icon: string; color: string }[] = [
  { value: '',     label: 'Все',      icon: '⚪', color: '' },
  { value: 'cold', label: 'Холодный', icon: '🧊', color: 'text-sky-500' },
  { value: 'warm', label: 'Тёплый',   icon: '☀️', color: 'text-amber-500' },
  { value: 'hot',  label: 'Горячий',  icon: '🔥', color: 'text-red-500' },
]

const CHANNEL_OPTIONS = ['WhatsApp', 'Telegram', 'Instagram', 'Звонок', 'Email', 'Личная встреча']
const SOURCE_OPTIONS = ['Instagram', 'Рекомендация', 'Холодный обзвон', 'Сайт', 'Реклама', 'Другое']
const SPHERE_SUGGESTIONS = ['Ресторан', 'Кафе', 'Клиника', 'Школа', 'Салон красоты', 'Отель', 'Магазин', 'Блогер', 'Модель', 'SMM', 'Разработка', 'Другое']

export default function ClientsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [interest, setInterest] = useState('')
  const [sphere, setSphere] = useState('')
  const [editLead, setEditLead] = useState<any>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: leads, isLoading } = useQuery({
    queryKey: ['clients', search, status, interest, sphere],
    queryFn: () => clientsApi.list({ search: search || undefined, status: status || undefined, interest: interest || undefined, sphere: sphere || undefined }),
  })

  const { data: stats } = useQuery({
    queryKey: ['clients-stats'],
    queryFn: clientsApi.stats,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['clients'] })
    qc.invalidateQueries({ queryKey: ['clients-stats'] })
  }

  const createMut = useMutation({
    mutationFn: clientsApi.create,
    onSuccess: () => { invalidate(); setShowCreate(false); toast.success('Клиент добавлен') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => clientsApi.update(id, data),
    onSuccess: () => { invalidate(); setEditLead(null); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Ошибка'),
  })
  const deleteMut = useMutation({
    mutationFn: clientsApi.remove,
    onSuccess: () => { invalidate(); setDeleteId(null); toast.success('Удалено') },
    onError: () => toast.error('Ошибка'),
  })

  const spheres = useMemo(() => {
    const set = new Set<string>()
    leads?.forEach((l: any) => l.sphere && set.add(l.sphere))
    return Array.from(set).sort()
  }, [leads])

  if (isLoading) return <PageLoader />

  const totalPotentialFmt = Number(stats?.openPotential || 0).toLocaleString('ru-RU')

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">База клиентов</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
            {stats?.total || 0} лидов · потенциал {totalPotentialFmt} сомони
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus size={16} /> Добавить клиента
        </button>
      </div>

      {/* Status counter chips */}
      {stats?.byStatus && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatus('')}
            className={clsx(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              !status ? 'bg-primary-600 text-white border-primary-600' : 'bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 border-surface-200 dark:border-surface-700',
            )}
          >
            Все · {stats.total}
          </button>
          {STATUS_OPTIONS.map(s => {
            const n = stats.byStatus[s.value] || 0
            if (n === 0 && status !== s.value) return null
            return (
              <button
                key={s.value}
                onClick={() => setStatus(status === s.value ? '' : s.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                  status === s.value ? 'ring-2 ring-primary-500 ' + s.color : s.color,
                )}
              >
                {s.label} · {n}
              </button>
            )
          })}
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию / сфере / контакту / адресу"
            className="input pl-9"
          />
        </div>
        <select value={interest} onChange={e => setInterest(e.target.value)} className="input sm:w-40">
          {INTEREST_OPTIONS.map(i => (
            <option key={i.value} value={i.value}>{i.icon} {i.label}</option>
          ))}
        </select>
        <select value={sphere} onChange={e => setSphere(e.target.value)} className="input sm:w-40">
          <option value="">Все сферы</option>
          {spheres.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      {!leads?.length ? (
        <EmptyState
          title="Нет клиентов"
          description="Добавьте первого лида, чтобы начать ведение базы"
          action={<button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> Добавить клиента</button>}
        />
      ) : (
        <div className="card p-0 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-surface-100 dark:border-surface-700 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Название / Сфера</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 hidden md:table-cell">ЛПР / Контакт</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400">Статус</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 hidden lg:table-cell">Интерес</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 text-right hidden lg:table-cell">Потенциал</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 hidden md:table-cell">Следующий контакт</th>
                <th className="px-4 py-3 text-xs font-semibold text-surface-500 dark:text-surface-400 text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l: any) => {
                const statusOpt = STATUS_OPTIONS.find(s => s.value === l.status)
                const interestOpt = INTEREST_OPTIONS.find(i => i.value === l.interest)
                const nextIsSoon = l.nextContactAt && new Date(l.nextContactAt) <= new Date(Date.now() + 2 * 86400000)
                const nextIsOverdue = l.nextContactAt && new Date(l.nextContactAt) < new Date()
                return (
                  <tr
                    key={l.id}
                    onClick={() => setEditLead(l)}
                    className="border-b border-surface-50 dark:border-surface-700/50 hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-surface-900 dark:text-surface-100">{l.name}</div>
                      {l.sphere && <div className="text-[11px] text-surface-400 dark:text-surface-500 mt-0.5">{l.sphere}</div>}
                      {l.problem && <div className="text-[10px] text-surface-400 dark:text-surface-500 mt-0.5 italic truncate max-w-[200px]">{l.problem}</div>}
                      {/* mobile: contact inline */}
                      <div className="md:hidden mt-1 text-[11px] text-surface-500 dark:text-surface-400">
                        {l.contactPerson && <span>👤 {l.contactPerson}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell align-top">
                      {l.contactPerson && <div className="text-sm text-surface-800 dark:text-surface-200">{l.contactPerson}</div>}
                      {l.contactInfo && <div className="text-[11px] text-surface-500 dark:text-surface-400 whitespace-pre-line">{l.contactInfo}</div>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={clsx('inline-flex text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap', statusOpt?.color)}>
                        {statusOpt?.label || l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell align-top text-sm">
                      {interestOpt ? <span className={interestOpt.color}>{interestOpt.icon} {interestOpt.label}</span> : <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell align-top text-right tabular-nums">
                      {l.dealPotential ? `${Number(l.dealPotential).toLocaleString('ru-RU')}` : <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell align-top">
                      {l.nextContactAt ? (
                        <span className={clsx(
                          'text-xs inline-flex items-center gap-1',
                          nextIsOverdue ? 'text-red-500 font-semibold' : nextIsSoon ? 'text-amber-600 dark:text-amber-400' : 'text-surface-500 dark:text-surface-400',
                        )}>
                          {nextIsOverdue && '🔴 '}{nextIsSoon && !nextIsOverdue && '🟠 '}
                          {format(parseISO(l.nextContactAt.slice(0, 10)), 'dd.MM.yy')}
                        </span>
                      ) : <span className="text-surface-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditLead(l)} className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 text-surface-500"><Edit size={14} /></button>
                        <button onClick={() => setDeleteId(l.id)} className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editLead) && (
        <ClientForm
          initial={editLead}
          onClose={() => { setShowCreate(false); setEditLead(null) }}
          onSubmit={(data: any) => {
            if (editLead) updateMut.mutate({ id: editLead.id, data })
            else createMut.mutate(data)
          }}
          loading={createMut.isPending || updateMut.isPending}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить клиента?"
        message="Все данные лида будут удалены безвозвратно."
        danger
      />
    </div>
  )
}

function ClientForm({ initial, onClose, onSubmit, loading }: any) {
  const { register, handleSubmit, watch } = useForm({ defaultValues: {
    name: initial?.name || '',
    sphere: initial?.sphere || '',
    problem: initial?.problem || '',
    address: initial?.address || '',
    contactPerson: initial?.contactPerson || '',
    contactInfo: initial?.contactInfo || '',
    status: initial?.status || 'new',
    interest: initial?.interest || '',
    dealPotential: initial?.dealPotential || '',
    leadSource: initial?.leadSource || '',
    channel: initial?.channel || '',
    nextStep: initial?.nextStep || '',
    lastContactAt: initial?.lastContactAt ? String(initial.lastContactAt).slice(0, 10) : '',
    nextContactAt: initial?.nextContactAt ? String(initial.nextContactAt).slice(0, 10) : '',
    rejectionReason: initial?.rejectionReason || '',
  } })

  const currentStatus = watch('status')

  const submit = (data: any) => {
    onSubmit({
      ...data,
      dealPotential: data.dealPotential ? Number(data.dealPotential) : null,
      interest: data.interest || null,
      lastContactAt: data.lastContactAt || null,
      nextContactAt: data.nextContactAt || null,
    })
  }

  return (
    <Modal open onClose={onClose} title={initial ? 'Редактировать клиента' : 'Новый клиент'} size="xl">
      <form onSubmit={handleSubmit(submit)} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">Название компании / клиента *</label>
            <input {...register('name', { required: true })} className="input" placeholder="ООО Ромашка, @blogger_name" />
          </div>
          <div>
            <label className="label">Сфера</label>
            <input list="sphere-list" {...register('sphere')} className="input" placeholder="Ресторан, Клиника, Блогер..." />
            <datalist id="sphere-list">
              {SPHERE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Адрес</label>
            <input {...register('address')} className="input" placeholder="г. Душанбе, ул. ..." />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Проблема / что нужно</label>
            <textarea {...register('problem')} rows={2} className="input resize-none" placeholder="Разработка сайта, SMM-продвижение..." />
          </div>
          <div>
            <label className="label">ЛПР (кто принимает решение)</label>
            <input {...register('contactPerson')} className="input" placeholder="Иван Иванов — директор" />
          </div>
          <div>
            <label className="label">Контакты ЛПР</label>
            <textarea {...register('contactInfo')} rows={2} className="input resize-none" placeholder="+992 900 00 00 00&#10;@instagram_handle&#10;email@domain.com" />
          </div>
          <div>
            <label className="label">Статус *</label>
            <select {...register('status')} className="input">
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Степень интереса</label>
            <select {...register('interest')} className="input">
              <option value="">Не указано</option>
              <option value="cold">🧊 Холодный</option>
              <option value="warm">☀️ Тёплый</option>
              <option value="hot">🔥 Горячий</option>
            </select>
          </div>
          <div>
            <label className="label">Потенциал сделки (сомони)</label>
            <input type="number" min={0} step="0.01" {...register('dealPotential')} className="input" placeholder="10000" />
          </div>
          <div>
            <label className="label">Источник лида</label>
            <input list="source-list" {...register('leadSource')} className="input" placeholder="Instagram, Рекомендация..." />
            <datalist id="source-list">
              {SOURCE_OPTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Канал общения</label>
            <input list="channel-list" {...register('channel')} className="input" placeholder="WhatsApp, Telegram..." />
            <datalist id="channel-list">
              {CHANNEL_OPTIONS.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="label">Дата последнего контакта</label>
            <input type="date" {...register('lastContactAt')} className="input" />
          </div>
          <div>
            <label className="label">Дата следующего контакта</label>
            <input type="date" {...register('nextContactAt')} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Следующий шаг</label>
            <textarea {...register('nextStep')} rows={2} className="input resize-none" placeholder="Отправить коммерческое предложение..." />
          </div>
          {currentStatus === 'lost' && (
            <div className="sm:col-span-2">
              <label className="label">Причина отказа</label>
              <textarea {...register('rejectionReason')} rows={2} className="input resize-none" placeholder="Дорого, уже есть подрядчик..." />
            </div>
          )}
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
