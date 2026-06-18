import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { workflowApi, projectsApi } from '@/services/api.service'
import { Modal, ConfirmDialog, Avatar, PageLoader } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { STAGES, CONTENT_TYPES, typeLabel, shortRole } from '@/components/projects/ProjectWorkflowTab'
import { Plus, Trash2, LayoutGrid } from 'lucide-react'
import { format, parseISO, startOfDay } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

/**
 * Глобальная «Доска проектов» — производственный канбан со всех SMM-
 * проектов сразу. Те же этапы и возможности, что во вкладке «Процесс
 * работы» внутри проекта (drag-and-drop, CRUD), но карточки со всех
 * проектов, и при добавлении нужно выбрать проект.
 */
export default function ProjectsBoardPage() {
  const qc = useQueryClient()
  const queryKey = ['workflow', 'all']

  const { data: cards, isLoading } = useQuery({
    queryKey,
    queryFn: () => workflowApi.listAll(),
  })

  // SMM-проекты — для селекта в форме добавления и фильтра сверху.
  const { data: projects } = useQuery({
    queryKey: ['projects', 'smm-for-board'],
    queryFn: () => projectsApi.list(),
  })
  const smmProjects = useMemo(
    () => (projects || []).filter((p: any) => p.projectType === 'SMM' && !p.isArchived),
    [projects],
  )

  const [projectFilter, setProjectFilter] = useState<string>('')

  const visibleCards = useMemo(
    () => (cards || []).filter((c: any) => !projectFilter || c.projectId === projectFilter),
    [cards, projectFilter],
  )

  const byStage = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const s of STAGES) map[s.key] = []
    for (const c of visibleCards) (map[c.stage] || (map[c.stage] = [])).push(c)
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.position - b.position)
    return map
  }, [visibleCards])

  // ── Модалки ─────────────────────────────────────────────────────────
  const [editCard, setEditCard] = useState<any>(null)
  const [createStage, setCreateStage] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const showModal = !!editCard || !!createStage
  const closeModal = () => { setEditCard(null); setCreateStage(null) }

  const createMut = useMutation({
    mutationFn: ({ projectId, data }: any) => workflowApi.create(projectId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); closeModal(); toast.success('Карточка добавлена') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось добавить'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }: any) => workflowApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); closeModal(); toast.success('Сохранено') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => workflowApi.remove(id),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, (old: any[] = []) => old.filter(c => c.id !== id))
      setDeleteId(null); closeModal()
      return { previous }
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous); toast.error('Не удалось удалить') },
    onSuccess: () => { qc.invalidateQueries({ queryKey }); toast.success('Карточка удалена') },
  })

  // Движок переходов (ТЗ §10): действие выхода этапа.
  const transitionMut = useMutation({
    mutationFn: ({ id, action, payload }: any) => workflowApi.transition(id, action, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey }); closeModal(); toast.success('Готово') },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось выполнить действие'),
  })

  // ── Drag-and-drop ───────────────────────────────────────────────────
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  const moveMut = useMutation({
    mutationFn: ({ id, stage, position }: any) => workflowApi.move(id, { stage, position }),
    onMutate: async ({ id, stage, position }: any) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData(queryKey)
      qc.setQueryData(queryKey, (old: any[] = []) => {
        const card = old.find(c => c.id === id)
        if (!card) return old
        return [...old.filter(c => c.id !== id), { ...card, stage, position: position ?? 9999 }]
      })
      return { previous }
    },
    onError: (_e, _v, ctx) => { if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous); toast.error('Не удалось перенести') },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })

  const handleDrop = (stage: string) => {
    setDragOverStage(null)
    if (!dragId) return
    const card = (cards || []).find((c: any) => c.id === dragId)
    setDragId(null)
    if (!card || card.stage === stage) return
    moveMut.mutate({ id: dragId, stage, position: (byStage[stage]?.length ?? 0) })
  }

  const today = startOfDay(new Date())
  const renderCard = (c: any) => {
    const deadline = c.deadline ? parseISO(c.deadline) : null
    const isOverdue = !!deadline && deadline < today && c.stage !== 'published' && c.stage !== 'ads'
    const tl = typeLabel(c.contentType)
    return (
      <div
        key={c.id}
        draggable
        onDragStart={() => setDragId(c.id)}
        onDragEnd={() => { setDragId(null); setDragOverStage(null) }}
        onClick={() => setEditCard(c)}
        className={clsx(
          'bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl p-3 space-y-2',
          'cursor-grab active:cursor-grabbing hover:border-surface-400 dark:hover:border-surface-500 transition-colors',
          dragId === c.id && 'opacity-50',
        )}
      >
        <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 leading-snug">{c.title}</p>
        <p className="text-[11px] text-primary-600 dark:text-primary-400 font-medium truncate">
          {c.project?.name || '—'}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {c.type && (
            <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded',
              c.type === 'reels' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                : c.type === 'cover' ? 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200'
                : 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200')}>
              {c.type === 'reels' ? 'Рилс' : c.type === 'cover' ? 'Обложка' : 'Макет'}
            </span>
          )}
          {c.status === 'waiting_cover' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">⏳ ждёт обложку</span>
          )}
          {c.status === 'rework' && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">↩ доработка</span>
          )}
          {!c.type && tl && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200">{tl}</span>
          )}
          {deadline && (isOverdue ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
              Просрочено: {format(deadline, 'dd.MM.yyyy')}
            </span>
          ) : (
            <span className="text-[10px] text-surface-500 dark:text-surface-400">до {format(deadline, 'dd.MM.yyyy')}</span>
          ))}
        </div>
        {c.assignee && (
          <div className="flex items-center gap-1.5 pt-0.5">
            <Avatar name={c.assignee.name} src={c.assignee.avatar} size={20} />
            <span className="text-[11px] text-surface-600 dark:text-surface-300 truncate">
              {c.assignee.name} ({shortRole(c.assignee.role)})
            </span>
          </div>
        )}
      </div>
    )
  }

  if (isLoading) return <PageLoader />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <LayoutGrid size={20} className="text-primary-600" />
          <h1 className="page-title">Доска проектов</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="input py-1.5 text-sm max-w-[220px]"
          >
            <option value="">Все проекты</option>
            {smmProjects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button type="button" onClick={() => setCreateStage('content_plan')} className="btn-primary text-sm whitespace-nowrap">
            <Plus size={14} /> Добавить карточку
          </button>
        </div>
      </div>
      <p className="text-xs text-surface-500 dark:text-surface-400">
        Общий производственный канбан всех SMM-проектов · перетаскивайте карточки между этапами · клик — редактирование
      </p>

      <div className="flex gap-3 overflow-x-auto pb-3 hide-scrollbar items-start">
        {STAGES.map(stage => {
          const items = byStage[stage.key] || []
          return (
            <div
              key={stage.key}
              onDragOver={e => { e.preventDefault(); setDragOverStage(stage.key) }}
              onDragLeave={() => setDragOverStage(prev => (prev === stage.key ? null : prev))}
              onDrop={() => handleDrop(stage.key)}
              className={clsx(
                'w-[230px] shrink-0 rounded-xl p-2 transition-colors',
                dragOverStage === stage.key
                  ? 'bg-surface-100 dark:bg-surface-700/50 ring-2 ring-surface-400 dark:ring-surface-500'
                  : 'bg-surface-50 dark:bg-surface-800/50',
              )}
            >
              <div className="flex items-center justify-between px-1 pb-2">
                <span className="text-xs font-semibold text-surface-700 dark:text-surface-200 truncate">{stage.label}</span>
                <span className="flex items-center gap-1">
                  <span className="text-[10px] font-semibold w-5 h-5 rounded-full bg-surface-200 dark:bg-surface-700 text-surface-600 dark:text-surface-300 inline-flex items-center justify-center">{items.length}</span>
                  <button type="button" title="Добавить в эту колонку" onClick={() => setCreateStage(stage.key)}
                    className="w-5 h-5 inline-flex items-center justify-center rounded text-surface-400 hover:text-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition-colors">
                    <Plus size={12} />
                  </button>
                </span>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {items.length === 0
                  ? <p className="text-[11px] text-surface-300 dark:text-surface-600 text-center py-4 select-none">Пусто</p>
                  : items.map(renderCard)}
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <CardFormModal
          open={showModal}
          card={editCard}
          stage={createStage || editCard?.stage || 'content_plan'}
          projects={smmProjects}
          loading={createMut.isPending || updateMut.isPending}
          transitioning={transitionMut.isPending}
          onClose={closeModal}
          onDelete={editCard ? () => setDeleteId(editCard.id) : undefined}
          onTransition={(action: string, payload: any) => editCard && transitionMut.mutate({ id: editCard.id, action, payload })}
          onSubmit={(projectId: string, data: any) => {
            if (editCard) updateMut.mutate({ id: editCard.id, data })
            else createMut.mutate({ projectId, data: { ...data, stage: createStage } })
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Удалить карточку?"
        message="Это действие нельзя отменить."
        danger
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        onClose={() => setDeleteId(null)}
      />
    </div>
  )
}

// ─── Форма карточки (с выбором проекта) ───────────────────────────────
function CardFormModal({ open, card, stage, projects, loading, transitioning, onClose, onSubmit, onDelete, onTransition }: {
  open: boolean
  card: any | null
  stage: string
  projects: any[]
  loading?: boolean
  transitioning?: boolean
  onClose: () => void
  onSubmit: (projectId: string, data: any) => void
  onDelete?: () => void
  onTransition?: (action: string, payload: any) => void
}) {
  const effectiveStage = card?.stage || stage
  const isContentPlan = !card && effectiveStage === 'content_plan'
  const { register, handleSubmit, control, watch, formState: { errors } } = useForm({
    defaultValues: {
      projectId: card?.projectId || '',
      title: card?.title || '',
      description: card?.description || '',
      contentType: card?.contentType || '',
      deadline: card?.deadline || '',
      assigneeId: card?.assigneeId || '',
      type: card?.type || 'reels',
      publishDate: card?.publishDate || '',
      needsIntro: card?.needsIntro ?? true,
    },
  })

  const selectedProjectId = watch('projectId')
  const watchedType = watch('type')
  // Исполнители — участники выбранного проекта + его менеджер.
  const assignees = useMemo(() => {
    const proj = projects.find((p: any) => p.id === selectedProjectId)
    if (!proj) return []
    const seen = new Set<string>()
    const list: any[] = []
    for (const m of proj.members || []) if (m?.id && !seen.has(m.id)) { seen.add(m.id); list.push(m) }
    if (proj.manager?.id && !seen.has(proj.manager.id)) list.push(proj.manager)
    return list
  }, [projects, selectedProjectId])

  const stageLabel = STAGES.find(s => s.key === effectiveStage)?.label

  return (
    <Modal open={open} onClose={onClose} title={card ? `Карточка — ${stageLabel}` : `Новая карточка — ${stageLabel}`}>
      <form
        onSubmit={handleSubmit((data: any) => onSubmit(data.projectId, {
          title: data.title,
          description: data.description || null,
          contentType: data.contentType || null,
          deadline: data.deadline || null,
          assigneeId: data.assigneeId || null,
          publishDate: data.publishDate || null,
          ...(isContentPlan ? { type: data.type, needsCover: true, needsIntro: data.type === 'reels' ? !!data.needsIntro : false } : {}),
        }))}
        className="space-y-4"
      >
        {/* Проект — обязателен; при редактировании менять нельзя. */}
        <div>
          <label className="label">Проект *</label>
          <select {...register('projectId', { required: true })} className="input" disabled={!!card}>
            <option value="">— Выберите проект —</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.projectId && <p className="text-xs text-red-500 mt-1">Выберите проект</p>}
        </div>
        {/* Тип единицы (маршрут) — только при создании в Контент-плане. */}
        {isContentPlan && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Тип единицы (маршрут) *</label>
              <select {...register('type')} className="input">
                <option value="reels">Рилс (съёмка → монтаж → обложка)</option>
                <option value="static">Макет (сразу в дизайн)</option>
              </select>
            </div>
            {watchedType === 'reels' && (
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                  <input type="checkbox" {...register('needsIntro')} className="w-4 h-4" />
                  Нужна заставка (intro)
                </label>
              </div>
            )}
          </div>
        )}
        <div>
          <label className="label">Заголовок *</label>
          <input {...register('title', { required: true })} className="input" placeholder="Например: Reels — рецепт фирменного плова" />
          {errors.title && <p className="text-xs text-red-500 mt-1">Обязательное поле</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Тип контента</label>
            <select {...register('contentType')} className="input">
              <option value="">— Не указан —</option>
              {CONTENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Дата публикации</label>
            <Controller name="publishDate" control={control}
              render={({ field }) => <DatePicker value={(field.value as string) || ''} onChange={field.onChange} />} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Дедлайн этапа</label>
            <Controller name="deadline" control={control}
              render={({ field }) => <DatePicker value={(field.value as string) || ''} onChange={field.onChange} />} />
          </div>
          <div>
            <label className="label">Исполнитель</label>
            <select {...register('assigneeId')} className="input" disabled={!selectedProjectId}>
              <option value="">{selectedProjectId ? '— Не назначен —' : '— Сначала выберите проект —'}</option>
              {assignees.map((m: any) => (
                <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${shortRole(m.role)})` : ''}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Описание / сценарий</label>
          <textarea {...register('description')} className="input min-h-[70px]" rows={3} />
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          {onDelete
            ? <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"><Trash2 size={13} /> Удалить</button>
            : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Отмена</button>
            <button type="submit" disabled={loading} className="btn-primary text-sm">{loading ? 'Сохранение…' : 'Сохранить'}</button>
          </div>
        </div>
      </form>

      {/* Действия этапа (движок переходов) — только для существующей карточки. */}
      {card && onTransition && (
        <StageActions card={card} disabled={!!transitioning} assignees={assignees} onTransition={onTransition} />
      )}
    </Modal>
  )
}

// ─── Панель действий текущего этапа (ТЗ §9/§10) ───────────────────────
function StageActions({ card, disabled, assignees, onTransition }: {
  card: any
  disabled: boolean
  assignees: any[]
  onTransition: (action: string, payload: any) => void
}) {
  const [f, setF] = useState<Record<string, string>>({})
  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  // ВАЖНО: хелперы — обычные функции (не компоненты), иначе инпут
  // ремаунтится на каждый символ и теряет фокус.
  const field = (k: string, label: string, placeholder = '') => (
    <div key={k}>
      <label className="label text-xs">{label}</label>
      <input className="input" value={f[k] || ''} onChange={e => set(k, e.target.value)} placeholder={placeholder} />
    </div>
  )
  const btn = (action: string, payload: any, children: React.ReactNode, danger = false) => (
    <button type="button" disabled={disabled}
      onClick={() => onTransition(action, payload)}
      className={clsx('px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50',
        danger ? 'bg-amber-500 hover:bg-amber-600' : 'bg-primary-600 hover:bg-primary-700')}>
      {children}
    </button>
  )

  const stage = card.stage
  const type = card.type || 'static'

  // Карточка обложки/заставки (живёт в Дизайне, привязана к рилсу).
  if (type === 'cover') {
    return (
      <Wrap>
        {field('coverUrl', 'Ссылка на обложку', 'https://…')}
        {card.needsIntro && field('introUrl', 'Ссылка на заставку (intro)', 'https://…')}
        {btn('cover_done', { coverUrl: f.coverUrl, introUrl: f.introUrl }, '✓ Обложка/заставка готова')}
      </Wrap>
    )
  }

  switch (stage) {
    case 'content_plan':
      return (
        <Wrap>
          <p className="text-[11px] text-surface-500 dark:text-surface-400">Подтвердите план: рилс → Организация (+обложка в Дизайн), макет → Дизайн. Дедлайны рассчитаются от даты публикации.</p>
          {btn('confirm_plan', {}, '✓ Подтвердить план')}
        </Wrap>
      )
    case 'organization':
      return (
        <Wrap>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {field('shootDate', 'Дата съёмки', '2026-06-20')}
            {field('shootTime', 'Время', '14:00')}
            {field('shootLocation', 'Место', 'Студия')}
          </div>
          {btn('confirm_shoot', { shootDate: f.shootDate, shootTime: f.shootTime, shootLocation: f.shootLocation }, '✓ Подтвердить съёмку')}
        </Wrap>
      )
    case 'shooting':
      return (
        <Wrap>
          <div>
            <label className="label text-xs">Назначить видеографа</label>
            <select className="input" value={f.assigneeId || ''} onChange={e => set('assigneeId', e.target.value)}>
              <option value="">— Выберите —</option>
              {assignees.map((m: any) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${shortRole(m.role)})` : ''}</option>)}
            </select>
            <div className="mt-2">{btn('assign_videographer', { assigneeId: f.assigneeId }, 'Назначить видеографа')}</div>
          </div>
          <hr className="border-surface-100 dark:border-surface-700" />
          {field('rawFootageUrl', 'Ссылка на исходники', 'https://…')}
          {btn('shoot_done', { rawFootageUrl: f.rawFootageUrl }, '✓ Съёмка завершена → Монтаж')}
        </Wrap>
      )
    case 'editing':
      return (
        <Wrap>
          {card.status === 'waiting_cover' && <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">⏳ Монтаж готов, ждём обложку/заставку.</p>}
          {field('finalCutUrl', 'Ссылка на монтаж', 'https://…')}
          {btn('editing_done', { finalCutUrl: f.finalCutUrl }, '✓ Монтаж готов')}
        </Wrap>
      )
    case 'design':
      return (
        <Wrap>
          {field('finalAssetUrl', 'Ссылка на макет', 'https://…')}
          {btn('layout_done', { finalAssetUrl: f.finalAssetUrl }, '✓ Макет готов → Проверка')}
        </Wrap>
      )
    case 'internal_review':
      return (
        <Wrap>
          {btn('qa_accept', {}, '✓ Принято → Согласование')}
          <hr className="border-surface-100 dark:border-surface-700" />
          {field('comment', 'Комментарий к доработке', 'Что исправить…')}
          {btn('qa_rework', { comment: f.comment }, '↩ На доработку', true)}
        </Wrap>
      )
    case 'client_approval':
      return (
        <Wrap>
          <div className="flex gap-2 flex-wrap">
            {btn('mark_sent_to_client', {}, 'Отправлено клиенту')}
            {btn('client_approve', {}, '✓ Клиент согласовал')}
          </div>
          <hr className="border-surface-100 dark:border-surface-700" />
          {field('comment', 'Правки клиента', 'Комментарий клиента…')}
          {btn('client_revisions', { comment: f.comment }, '↩ Правки клиента', true)}
        </Wrap>
      )
    case 'ready_to_publish':
      return (
        <Wrap>
          {field('publishedUrl', 'Ссылка на публикацию', 'https://instagram.com/…')}
          {btn('publish', { publishedUrl: f.publishedUrl }, '✓ Опубликовано')}
        </Wrap>
      )
    default:
      return null
  }
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700 space-y-2">
      <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">Действия этапа</p>
      {children}
    </div>
  )
}
