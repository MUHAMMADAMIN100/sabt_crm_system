import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { Modal, EmptyState, PageLoader, ConfirmDialog } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { CollapsibleField } from '@/components/ui/CollapsibleField'
import { Plus, Edit, Trash2, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'

/** Все возможные этапы онбординга. Какие именно показывать и в каком
 *  порядке — зависит от роли менеджера (см. STAGES_BY_ROLE ниже). */
const ALL_STAGES = {
  negotiation:    { label: 'Переговор',    accent: 'border-t-rose-500' },
  meeting:        { label: 'Встреча',      accent: 'border-t-sky-500' },
  kp_creation:    { label: 'КП',           accent: 'border-t-amber-500' },
  contract:       { label: 'Договор',      accent: 'border-t-emerald-500' },
  implementation: { label: 'Реализация',   accent: 'border-t-violet-500' },
  // Wave 15: финальная колонка справа — клиент снят с воронки.
  // Перенос сюда НЕ считается прогрессом и НЕ начисляет KPI.
  cancelled:      { label: 'Отмена',       accent: 'border-t-red-500' },
} as const

type StageKey = keyof typeof ALL_STAGES

// Унифицированный 6-этапный пайплайн онбординга — одинаковый для всех МП
// (и СММ, и разработка). Раньше у СММ было 4 этапа без «Переговор», но
// продажникам с двух направлений нужна одна логика воронки.
// Wave 15 — добавили «Отмена» как 6-й этап.
const STAGES_ALL: StageKey[] = ['negotiation', 'meeting', 'kp_creation', 'contract', 'implementation', 'cancelled']
const STAGES_SMM: StageKey[] = STAGES_ALL
const STAGES_DEV: StageKey[] = STAGES_ALL

const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(ALL_STAGES).map(([k, v]) => [k, v.label]),
)

/** Оптимистично прибавляет +delta к value метрики с заданным ключом
 *  в KPI-объекте {items: [{key, value, target, percent, done}, ...]}.
 *  Используется в onMutate, чтобы цифра мгновенно прыгнула в UI до
 *  ответа сервера. WebSocket потом перетрёт точным значением. */
function bumpKpiValue(kpi: any, key: string, delta: number) {
  if (!kpi || !Array.isArray(kpi.items)) return kpi
  let touched = false
  const items = kpi.items.map((it: any) => {
    if (it.key !== key) return it
    touched = true
    const value = Math.max(0, (Number(it.value) || 0) + delta)
    const target = Number(it.target) || 0
    const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
    return { ...it, value, percent, done: value >= target }
  })
  if (!touched) return kpi
  const overall = Math.round(items.reduce((acc: number, i: any) => acc + (i.value / (i.target || 1)) * 100, 0) / items.length)
  return { ...kpi, items, overallPercent: Math.min(100, Math.max(0, overall)) }
}

/** Если компонент вмонтирован внутрь другой страницы (Базы клиентов через
 *  view-toggle), скрываем заголовок «Онбординг» — у Базы свой. */
export default function OnboardingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient()
  const role = useAuthStore(s => s.user?.role)
  // У МП по разработке свой набор этапов (5 шагов с «Переговор»).
  const stageKeys: StageKey[] = role === 'sales_manager_dev' ? STAGES_DEV : STAGES_SMM
  const [showAdd, setShowAdd] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<StageKey | null>(null)

  // refetchOnMount: 'always' + staleTime 0 — гарантируем свежие данные при
  // каждом монтировании компонента. Иначе при переключении view-toggle
  // в Базе клиентов канбан мог показать пустые колонки из устаревшего кеша.
  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: () => clientsApi.list(),
    refetchOnMount: 'always',
    staleTime: 0,
  })

  // Локальная карта порядка этапов — для оптимистичной проверки «вперёд».
  // Совпадает с STAGE_ORDER на бэке (cancelled не считается прогрессом).
  const STAGE_ORDER_FE: Record<string, number> = {
    negotiation: 1, meeting: 2, kp_creation: 3, contract: 4, implementation: 5, cancelled: -1,
  }

  // Перетаскивание карточки — смена этапа онбординга.
  const moveMut = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: StageKey }) =>
      clientsApi.update(id, { onboardingStage: stage }),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ['clients'] })
      const prev = qc.getQueryData(['clients'])
      // Считаем — forward (+1) / backward (-1) / нейтрально (0, cancelled).
      const lead = Array.isArray(prev)
        ? (prev as any[]).find((c: any) => c.id === id)
        : null
      const fromOrder = STAGE_ORDER_FE[lead?.onboardingStage || ''] ?? 0
      const toOrder = STAGE_ORDER_FE[stage] ?? 0
      // Только реальные этапы (order > 0) участвуют в подсчёте. cancelled
      // имеет order=-1 и не двигает KPI ни в +, ни в −.
      const isForward  = toOrder > 0 && toOrder > fromOrder
      const isBackward = toOrder > 0 && fromOrder > 0 && toOrder < fromOrder
      qc.setQueryData(['clients'], (old: any) =>
        Array.isArray(old)
          ? old.map((c: any) => (c.id === id ? { ...c, onboardingStage: stage } : c))
          : old,
      )
      // Оптимистично двигаем «funnel_progress» — мгновенный отклик в UI,
      // WebSocket потом перетрёт точной цифрой с сервера.
      const delta = isForward ? +1 : isBackward ? -1 : 0
      if (delta !== 0) {
        qc.setQueriesData({ queryKey: ['sales-kpi'] }, (old: any) => bumpKpiValue(old, 'funnel_progress', delta))
        qc.setQueriesData({ queryKey: ['kpi-user'] },  (old: any) => bumpKpiValue(old, 'funnel_progress', delta))
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(['clients'], ctx?.prev)
      // Откатить оптимистичный +1 — проще всего рефетчем KPI.
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      toast.error('Не удалось переместить клиента')
    },
    // Финальная синхронизация: бэк уже broadcast'нул leads:changed через
    // WebSocket — useSocket инвалидирует/рефечит точную цифру с сервера,
    // оптимистичный bump перетрётся правильным значением.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      qc.invalidateQueries({ queryKey: ['kpi-all'] })
      qc.invalidateQueries({ queryKey: ['kpi-details'] })
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
    },
  })

  // Новый клиент — попадает на доску в первый этап роли (Встреча у СММ,
  // Переговор у разработки) и в Базу клиентов.
  const createMut = useMutation({
    mutationFn: (data: any) => clientsApi.create({ ...data, onboardingStage: stageKeys[0] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setShowAdd(false)
      toast.success('Клиент добавлен на онбординг')
    },
    onError: () => toast.error('Не удалось добавить клиента'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => clientsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      // Любое изменение лида может изменить status/onboardingStage →
      // обновляем KPI воронки, чтобы счётчик отражал прогресс сразу.
      qc.invalidateQueries({ queryKey: ['sales-kpi'] })
      qc.invalidateQueries({ queryKey: ['kpi-user'] })
      qc.invalidateQueries({ queryKey: ['kpi-all'] })
      qc.invalidateQueries({ queryKey: ['kpi-details'] })
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      setEditMode(false)
      toast.success('Изменения сохранены')
    },
    onError: () => toast.error('Не удалось сохранить'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['clients'] })
      // Оптимистично убираем из всех кешей клиентов (Онбординг + База).
      const snapshots = qc.getQueriesData({ queryKey: ['clients'] })
      qc.setQueriesData({ queryKey: ['clients'] }, (old: any) =>
        Array.isArray(old) ? old.filter((l: any) => l.id !== id) : old,
      )
      return { snapshots }
    },
    onError: (_e, _id, ctx) => {
      // Откат если бэк отказал.
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots as any[]) {
          qc.setQueryData(key, data)
        }
      }
      toast.error('Не удалось удалить')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      setDeleteId(null)
      setDetailId(null)
      toast.success('Клиент удалён')
    },
  })

  // «Убрать с доски» — оставляет клиента в Базе клиентов, но снимает
  // onboardingStage чтобы карточка пропала из канбана.
  const removeFromBoardMut = useMutation({
    mutationFn: (id: string) => clientsApi.update(id, { onboardingStage: null }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['clients'] })
      // Оптимистично обнуляем stage во всех кешах.
      const snapshots = qc.getQueriesData({ queryKey: ['clients'] })
      qc.setQueriesData({ queryKey: ['clients'] }, (old: any) =>
        Array.isArray(old)
          ? old.map((l: any) => l.id === id ? { ...l, onboardingStage: null } : l)
          : old,
      )
      return { snapshots }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.snapshots) {
        for (const [key, data] of ctx.snapshots as any[]) {
          qc.setQueryData(key, data)
        }
      }
      toast.error('Не удалось убрать с доски')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['clients-stats'] })
      setDetailId(null)
      toast.success('Убрано с онбординга. Клиент остался в Базе клиентов')
    },
  })

  if (isLoading) {
    // В embedded-режиме (внутри Базы клиентов) большой пульсирующий S
    // выглядит чужеродно — заменяем на компактный спиннер.
    if (embedded) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-surface-300 dark:border-surface-700 border-t-primary-500 rounded-full animate-spin" />
        </div>
      )
    }
    return <PageLoader />
  }

  const onboardingClients = (clients || []).filter((c: any) => c.onboardingStage)
  const detailClient = onboardingClients.find((c: any) => c.id === detailId) || null

  const handleDrop = (stage: StageKey) => {
    setDragOverStage(null)
    if (draggedId) {
      const c = onboardingClients.find((x: any) => x.id === draggedId)
      if (c && c.onboardingStage !== stage) moveMut.mutate({ id: draggedId, stage })
    }
    setDraggedId(null)
  }

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="page-title">Онбординг</h1>
            <p className="text-sm text-surface-500 dark:text-surface-400 mt-0.5">
              Клиенты на этапе онбординга. Перетащите карточку, чтобы сменить этап.
            </p>
          </div>
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={16} /> Добавить клиента
          </button>
        </div>
      )}
      {embedded && (
        <div className="flex justify-end">
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus size={16} /> Добавить клиента
          </button>
        </div>
      )}

      <div className={clsx(
        'flex gap-4 overflow-x-auto pb-3 lg:grid lg:overflow-x-visible stagger-kanban',
        // Сетка адаптивная под число колонок (Wave 15 — 6).
        stageKeys.length === 6 ? 'lg:grid-cols-6'
          : stageKeys.length === 5 ? 'lg:grid-cols-5'
          : 'lg:grid-cols-4',
      )}>
        {stageKeys.map(key => {
          const stage = ALL_STAGES[key]
          const items = onboardingClients.filter((c: any) => c.onboardingStage === key)
          return (
            <div
              key={key}
              onDragOver={e => { e.preventDefault(); setDragOverStage(key) }}
              onDragLeave={() => setDragOverStage(s => (s === key ? null : s))}
              onDrop={() => handleDrop(key)}
              className={clsx(
                'min-w-[260px] lg:min-w-0 rounded-2xl border-t-4 bg-surface-50 dark:bg-surface-800/50 p-3 transition-colors',
                stage.accent,
                dragOverStage === key && 'ring-2 ring-primary-400',
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm text-surface-800 dark:text-surface-200">{stage.label}</h3>
                <span className="text-xs text-surface-400 bg-surface-200 dark:bg-surface-700 rounded-full px-2 py-0.5">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2 min-h-[80px]">
                {items.map((c: any) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => setDraggedId(c.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onClick={() => { setDetailId(c.id); setEditMode(false) }}
                    className={clsx(
                      'bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 cursor-pointer transition-all duration-200 ease-out animate-fade-in',
                      'hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 hover:-translate-y-0.5',
                      'active:scale-[0.98]',
                      draggedId === c.id && 'opacity-50 scale-95 rotate-2',
                    )}
                  >
                    <p className="font-medium text-sm text-surface-900 dark:text-surface-100">{c.name}</p>
                    {c.sphere && <p className="text-[11px] text-surface-400 mt-0.5">{c.sphere}</p>}
                    {c.contactPerson && (
                      <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">👤 {c.contactPerson}</p>
                    )}
                    {c.dealPotential ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">
                        {Number(c.dealPotential).toLocaleString('ru-RU')} смн
                      </p>
                    ) : null}
                  </div>
                ))}
                {items.length === 0 && (
                  <p className="text-xs text-surface-300 dark:text-surface-600 text-center py-4">
                    Перетащите сюда
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {onboardingClients.length === 0 && (
        <EmptyState
          title="Нет клиентов на онбординге"
          description="Добавьте первого клиента кнопкой «Добавить клиента»."
        />
      )}

      {/* Добавление клиента */}
      {showAdd && (
        <Modal open onClose={() => setShowAdd(false)} title="Новый клиент на онбординге" size="md">
          <OnboardingClientForm
            loading={createMut.isPending}
            onClose={() => setShowAdd(false)}
            onSubmit={d => createMut.mutate(d)}
          />
        </Modal>
      )}

      {/* Карточка клиента — просмотр / редактирование */}
      {detailClient && (
        <Modal
          open
          onClose={() => { setDetailId(null); setEditMode(false) }}
          title={editMode ? 'Редактировать клиента' : detailClient.name}
          size="md"
        >
          {editMode ? (
            <OnboardingClientForm
              initial={detailClient}
              loading={updateMut.isPending}
              onClose={() => setEditMode(false)}
              onSubmit={d => updateMut.mutate({ id: detailClient.id, data: d })}
            />
          ) : (
            <ClientDetailView
              client={detailClient}
              onEdit={() => setEditMode(true)}
              onDelete={() => setDeleteId(detailClient.id)}
              onRemoveFromBoard={() => removeFromBoardMut.mutate(detailClient.id)}
              removeLoading={removeFromBoardMut.isPending}
            />
          )}
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        title="Удалить клиента?"
        message="Клиент будет удалён из онбординга и из базы клиентов безвозвратно."
        danger
      />
    </div>
  )
}

/** Просмотр всех данных клиента + кнопки редактирования / убрать с доски / удалить. */
function ClientDetailView({
  client, onEdit, onDelete, onRemoveFromBoard, removeLoading,
}: {
  client: any
  onEdit: () => void
  onDelete: () => void
  onRemoveFromBoard: () => void
  removeLoading?: boolean
}) {
  const rows: Array<[string, string]> = []
  if (client.onboardingStage) rows.push(['Этап онбординга', STAGE_LABEL[client.onboardingStage] || client.onboardingStage])
  if (client.sphere) rows.push(['Сфера', client.sphere])
  if (client.problem) rows.push(['Задача / услуга', client.problem])
  if (client.contactPerson) rows.push(['Контактное лицо', client.contactPerson])
  if (client.contactInfo) rows.push(['Контакты', client.contactInfo])
  if (client.address) rows.push(['Адрес', client.address])
  if (client.dealPotential) rows.push(['Потенциал сделки', `${Number(client.dealPotential).toLocaleString('ru-RU')} смн`])
  if (client.leadSource) rows.push(['Источник', client.leadSource])
  if (client.channel) rows.push(['Канал', client.channel])
  if (client.nextStep) rows.push(['Следующий шаг', client.nextStep])
  if (client.nextContactAt) {
    const d = new Date(client.nextContactAt)
    rows.push(['📅 Дата встречи', d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })])
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-surface-100 dark:divide-surface-700">
        {rows.length === 0 ? (
          <p className="text-sm text-surface-400 py-2">Дополнительных данных нет.</p>
        ) : rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 py-2">
            <span className="text-xs text-surface-400 dark:text-surface-500 w-36 shrink-0">{label}</span>
            <span className="text-sm text-surface-800 dark:text-surface-200 whitespace-pre-line break-words">{value}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-surface-100 dark:border-surface-700">
        <button
          type="button"
          onClick={onDelete}
          className="btn-secondary text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 mr-auto"
        >
          <Trash2 size={15} /> Удалить
        </button>
        <button
          type="button"
          onClick={onRemoveFromBoard}
          disabled={removeLoading}
          title="Убрать карточку с доски Онбординга. Клиент останется в Базе клиентов."
          className="btn-secondary text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
        >
          <EyeOff size={15} /> {removeLoading ? 'Убираю...' : 'Убрать'}
        </button>
        <button type="button" onClick={onEdit} className="btn-primary">
          <Edit size={15} /> Редактировать
        </button>
      </div>
    </div>
  )
}

function OnboardingClientForm({
  onSubmit, onClose, loading, initial,
}: {
  onSubmit: (d: any) => void
  onClose: () => void
  loading: boolean
  initial?: any
}) {
  const [name, setName] = useState(initial?.name || '')
  const [sphere, setSphere] = useState(initial?.sphere || '')
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson || '')
  const [contactInfo, setContactInfo] = useState(initial?.contactInfo || '')
  const [problem, setProblem] = useState(initial?.problem || '')
  const [dealPotential, setDealPotential] = useState(
    initial?.dealPotential != null ? String(initial.dealPotential) : '',
  )
  // Дата следующей встречи. Бэкенд при сохранении автоматически создаст
  // личную задачу для МП — она появится в его календаре и во вкладке Задачи.
  const [nextContactAt, setNextContactAt] = useState(
    initial?.nextContactAt ? String(initial.nextContactAt).slice(0, 10) : '',
  )

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { toast.error('Укажите название клиента'); return }
    onSubmit({
      name: name.trim(),
      sphere: sphere.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      contactInfo: contactInfo.trim() || undefined,
      problem: problem.trim() || undefined,
      dealPotential: dealPotential ? Number(dealPotential) : null,
      // Пустая строка → null, чтобы бэк удалил привязанную задачу-встречу.
      nextContactAt: nextContactAt || null,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Название клиента *</label>
        <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="ООО Ромашка, @blogger" autoFocus />
      </div>
      <CollapsibleField label="Сфера" defaultOpen={!!sphere} hint={sphere}>
        <input value={sphere} onChange={e => setSphere(e.target.value)} className="input" placeholder="Ресторан, Клиника, Блогер..." />
      </CollapsibleField>
      <CollapsibleField label="Задача / услуга" defaultOpen={!!problem} hint={problem ? 'заполнено' : ''}>
        <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={2} className="input resize-none" placeholder="Разработка сайта, SMM-продвижение..." />
      </CollapsibleField>
      <CollapsibleField label="Контактное лицо" defaultOpen={!!contactPerson} hint={contactPerson}>
        <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} className="input" placeholder="Иван Иванов — директор" />
      </CollapsibleField>
      <CollapsibleField label="Контакты" defaultOpen={!!contactInfo} hint={contactInfo ? 'заполнено' : ''}>
        <textarea value={contactInfo} onChange={e => setContactInfo(e.target.value)} rows={2} className="input resize-none" placeholder="+992 900 00 00 00, @instagram, email@domain.com" />
      </CollapsibleField>
      <CollapsibleField label="Потенциал сделки (смн)" defaultOpen={!!dealPotential} hint={dealPotential ? `${dealPotential} смн` : ''}>
        <input type="number" min={0} step="0.01" value={dealPotential} onChange={e => setDealPotential(e.target.value)} className="input" placeholder="10000" />
      </CollapsibleField>
      <div>
        <label className="label">📅 Дата встречи / следующего контакта</label>
        <DatePicker value={nextContactAt} onChange={setNextContactAt} />
        <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">
          {nextContactAt
            ? 'Появится у вас в Календаре (📌 личная задача) и в Задачах под фильтром «Мои».'
            : 'Пусто — встреча не будет создана. Если уже была — удалится.'}
        </p>
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <button type="button" onClick={onClose} disabled={loading} className="btn-secondary">Отмена</button>
        <button type="submit" disabled={loading} className="btn-primary min-w-[120px] justify-center">
          {loading ? 'Сохраняю...' : (initial ? 'Сохранить' : 'Добавить')}
        </button>
      </div>
    </form>
  )
}
