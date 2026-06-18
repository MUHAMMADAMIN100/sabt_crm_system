import { useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { workflowApi, projectAdsApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { getRoleLabel } from '@/lib/permissions'
import { Trash2, Megaphone, History } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

/** Колонки доски — порядок = порядок на экране (ТЗ маршрут). */
export const STAGES: { key: string; label: string }[] = [
  { key: 'content_plan',     label: 'Контент-план' },
  { key: 'organization',     label: 'Организация' },
  { key: 'shooting',         label: 'Съёмка' },
  { key: 'editing',          label: 'Монтаж' },
  { key: 'design',           label: 'Дизайн' },
  { key: 'internal_review',  label: 'Внутренняя проверка' },
  { key: 'client_approval',  label: 'Согласование с клиентом' },
  { key: 'ready_to_publish', label: 'Готово к публикации' },
  { key: 'published',        label: 'Опубликовано' },
  { key: 'ads',              label: 'Реклама' },
]

export const CONTENT_TYPES: { value: string; label: string }[] = [
  { value: 'reel',     label: 'Reels' },
  { value: 'post',     label: 'Пост' },
  { value: 'carousel', label: 'Карусель' },
  { value: 'story',    label: 'История' },
  { value: 'design',   label: 'Дизайн' },
  { value: 'video',    label: 'Видео' },
  { value: 'other',    label: 'Другое' },
]
export const typeLabel = (v?: string | null) =>
  CONTENT_TYPES.find(t => t.value === v)?.label || null

/** Короткий лейбл роли для подписи исполнителя — «Анора (СММ)». */
export const shortRole = (role?: string | null): string => {
  const map: Record<string, string> = {
    smm_specialist: 'СММ',
    smm_director: 'Рук. SMM',
    video_director: 'Рук. видео',
    designer: 'Дизайнер',
    videographer: 'Видеограф',
    video_editor: 'Монтажёр',
    organizer: 'Организатор',
    storymaker: 'Сторисмейкер',
    scriptwriter: 'Сценарист',
    qa: 'QA',
    publisher: 'Публикатор',
    targetologist: 'Таргетолог',
    developer: 'Разработчик',
  }
  return map[role || ''] || getRoleLabel(role)
}

/** Роли-владельцы этапа — фильтр поля «Исполнитель» + скрытие кнопок (ТЗ §12). */
export const STAGE_ROLE_FILTER: Record<string, string[]> = {
  content_plan: ['scriptwriter'],
  organization: ['organizer'],
  shooting: ['videographer', 'video_director'],
  editing: ['video_editor'],
  design: ['designer'],
  internal_review: ['qa'],
  client_approval: ['smm_director'],
  ready_to_publish: ['publisher'],
  ads: ['targetologist'],
}

/** Действие выхода этапа → допустимые роли (ТЗ §12). */
export const ACTION_ROLES: Record<string, string[]> = {
  confirm_plan: ['scriptwriter'],
  confirm_shoot: ['organizer'],
  assign_videographer: ['video_director'],
  shoot_done: ['videographer', 'video_director'],
  editing_done: ['video_editor'],
  cover_done: ['designer'],
  layout_done: ['designer'],
  qa_accept: ['qa'],
  qa_rework: ['qa'],
  mark_sent_to_client: ['smm_director'],
  client_approve: ['smm_director'],
  client_revisions: ['smm_director'],
  publish: ['publisher'],
}
const ALL_ACCESS = ['admin', 'founder', 'co_founder']

/** Может ли текущий пользователь выполнить действие (для скрытия кнопок). */
export function canDoAction(action: string, role?: string | null, secondaryRole?: string | null): boolean {
  if (role && ALL_ACCESS.includes(role)) return true
  const allowed = ACTION_ROLES[action] || []
  return allowed.includes(role || '') || (!!secondaryRole && allowed.includes(secondaryRole))
}

/** Бейджи карточки: тип, ожидание, доработка, дедлайн/публикация. */
export function WorkflowCardBadges({ card }: { card: any }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const deadline = card.deadline ? parseISO(card.deadline) : null
  const isOverdue = !!deadline && deadline < today && card.stage !== 'published' && card.stage !== 'ads'
  const tl = typeLabel(card.contentType)
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {card.type && (
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded',
          card.type === 'reels' ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
            : card.type === 'cover' ? 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200'
            : 'bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200')}>
          {card.type === 'reels' ? 'Рилс' : card.type === 'cover' ? 'Обложка' : 'Макет'}
        </span>
      )}
      {card.status === 'waiting_cover' && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">⏳ ждёт обложку</span>
      )}
      {card.status === 'rework' && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">↩ доработка</span>
      )}
      {!card.type && tl && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200">{tl}</span>
      )}
      {card.publishedAt ? (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Опубл.: {format(parseISO(card.publishedAt), 'dd.MM.yyyy')}
        </span>
      ) : deadline && (isOverdue ? (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
          Просрочено: {format(deadline, 'dd.MM.yyyy')}
        </span>
      ) : (
        <span className="text-[10px] text-surface-500 dark:text-surface-400">до {format(deadline, 'dd.MM.yyyy')}</span>
      ))}
      {card.publishDate && !card.publishedAt && (
        <span className="text-[10px] text-surface-400 dark:text-surface-500">пуб. {format(parseISO(card.publishDate), 'dd.MM')}</span>
      )}
    </div>
  )
}

/** Текущий актёр для скрытия кнопок по роли. */
interface Actor { role?: string | null; secondaryRole?: string | null }

// ─── Форма карточки (общая для глобальной доски и вкладки проекта) ────
export function CardFormModal({
  open, card, stage, projects, project, loading, transitioning, actor,
  onClose, onSubmit, onDelete, onTransition,
}: {
  open: boolean
  card: any | null
  stage: string
  /** Глобальная доска: список проектов (с селектом). */
  projects?: any[]
  /** Вкладка проекта: один фиксированный проект (без селекта). */
  project?: any
  loading?: boolean
  transitioning?: boolean
  actor?: Actor
  onClose: () => void
  onSubmit: (projectId: string, data: any) => void
  onDelete?: () => void
  onTransition?: (action: string, payload: any) => void
}) {
  const singleProject = !!project
  const effectiveStage = card?.stage || stage
  const isContentPlan = !card && effectiveStage === 'content_plan'
  const { register, handleSubmit, control, watch, formState: { errors } } = useForm({
    defaultValues: {
      projectId: card?.projectId || project?.id || '',
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
  const projList = singleProject ? [project] : (projects || [])
  const activeProjectId = singleProject ? project.id : selectedProjectId

  // Исполнители — участники проекта + менеджер, отфильтрованные по роли этапа.
  const assignees = useMemo(() => {
    const proj = projList.find((p: any) => p.id === activeProjectId)
    if (!proj) return []
    const seen = new Set<string>()
    const list: any[] = []
    for (const m of proj.members || []) if (m?.id && !seen.has(m.id)) { seen.add(m.id); list.push(m) }
    if (proj.manager?.id && !seen.has(proj.manager.id)) { seen.add(proj.manager.id); list.push(proj.manager) }
    const stageRoles = STAGE_ROLE_FILTER[effectiveStage] || []
    if (stageRoles.length === 0) return list
    const ok = (m: any) =>
      ['admin', 'founder', 'co_founder'].includes(m.role)
      || stageRoles.includes(m.role)
      || (m.secondaryRole && stageRoles.includes(m.secondaryRole))
      || m.id === card?.assigneeId
    return list.filter(ok)
  }, [projList, activeProjectId, effectiveStage, card?.assigneeId])

  const stageLabel = STAGES.find(s => s.key === effectiveStage)?.label

  return (
    <Modal open={open} onClose={onClose} title={card ? `Карточка — ${stageLabel}` : `Новая карточка — ${stageLabel}`}>
      <form
        onSubmit={handleSubmit((data: any) => onSubmit(activeProjectId, {
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
        {!singleProject && (
          <div>
            <label className="label">Проект *</label>
            <select {...register('projectId', { required: true })} className="input" disabled={!!card}>
              <option value="">— Выберите проект —</option>
              {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {errors.projectId && <p className="text-xs text-red-500 mt-1">Выберите проект</p>}
          </div>
        )}
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
            <select {...register('assigneeId')} className="input" disabled={!activeProjectId}>
              <option value="">{activeProjectId ? '— Не назначен —' : '— Сначала выберите проект —'}</option>
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

      {card && (card.finalCutUrl || card.finalAssetUrl || card.coverUrl || card.introUrl || card.rawFootageUrl || card.publishedUrl) && (
        <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700 space-y-1">
          <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide">Материалы</p>
          {[
            ['Исходники', card.rawFootageUrl],
            ['Монтаж', card.finalCutUrl],
            ['Макет', card.finalAssetUrl],
            ['Обложка', card.coverUrl],
            ['Заставка', card.introUrl],
            ['Публикация', card.publishedUrl],
          ].filter(([, v]) => v).map(([label, v]: any) => (
            <a key={label} href={v} target="_blank" rel="noreferrer" className="block text-xs text-primary-600 dark:text-primary-400 hover:underline truncate">
              {label}: {v}
            </a>
          ))}
        </div>
      )}

      {card && onTransition && (
        <StageActions card={card} disabled={!!transitioning} assignees={assignees} actor={actor} onTransition={onTransition} />
      )}

      {card && <CardHistory cardId={card.id} />}
    </Modal>
  )
}

// ─── Панель действий текущего этапа (ТЗ §9/§10) ───────────────────────
export function StageActions({ card, disabled, assignees, actor, onTransition }: {
  card: any
  disabled: boolean
  assignees: any[]
  actor?: Actor
  onTransition: (action: string, payload: any) => void
}) {
  const [f, setF] = useState<Record<string, string>>({})
  const set = (k: string, v: string) => setF(prev => ({ ...prev, [k]: v }))
  const field = (k: string, label: string, placeholder = '') => (
    <div key={k}>
      <label className="label text-xs">{label}</label>
      <input className="input" value={f[k] || ''} onChange={e => set(k, e.target.value)} placeholder={placeholder} />
    </div>
  )
  // Кнопка скрывается, если у пользователя нет роли этапа (ТЗ §12 / M4).
  const btn = (action: string, payload: any, children: React.ReactNode, danger = false) => {
    if (!canDoAction(action, actor?.role, actor?.secondaryRole)) return null
    return (
      <button type="button" disabled={disabled}
        onClick={() => onTransition(action, payload)}
        className={clsx('px-3 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50',
          danger ? 'bg-amber-500 hover:bg-amber-600' : 'bg-primary-600 hover:bg-primary-700')}>
        {children}
      </button>
    )
  }

  const stage = card.stage
  const type = card.type || 'static'

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

// ─── История карточки (журнал событий) ────────────────────────────────
export function CardHistory({ cardId }: { cardId: string }) {
  const { data: events } = useQuery({
    queryKey: ['workflow-events', cardId],
    queryFn: () => workflowApi.events(cardId),
  })
  if (!events || events.length === 0) return null
  return (
    <div className="mt-4 pt-4 border-t border-surface-200 dark:border-surface-700">
      <p className="text-xs font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
        <History size={13} /> История
      </p>
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {events.map((e: any) => (
          <div key={e.id} className="text-[11px] text-surface-600 dark:text-surface-300 flex items-start gap-2">
            <span className="text-surface-400 dark:text-surface-500 tabular-nums shrink-0">{format(parseISO(e.createdAt), 'dd.MM HH:mm')}</span>
            <span>
              {e.message || e.action}
              {e.comment && <span className="text-amber-600 dark:text-amber-400"> — {e.comment}</span>}
              {e.actorName && <span className="text-surface-400"> · {e.actorName}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── M7: форма рекламной кампании ─────────────────────────────────────
export function AdCampaignModal({ card, project, onClose, onSaved }: {
  card: any
  project: any
  onClose: () => void
  onSaved: () => void
}) {
  const targetologists = useMemo(() => {
    if (!project) return []
    const seen = new Set<string>()
    const list: any[] = []
    for (const m of [...(project.members || []), project.manager].filter(Boolean)) {
      if (m?.id && !seen.has(m.id)) {
        seen.add(m.id)
        if (m.role === 'targetologist' || m.secondaryRole === 'targetologist' || ['admin', 'founder', 'co_founder'].includes(m.role)) list.push(m)
      }
    }
    return list
  }, [project])

  const { register, handleSubmit, control, formState: { errors } } = useForm({
    defaultValues: {
      title: card.title || '', channel: 'instagram',
      totalBudget: '', dailyBudget: '',
      startDate: '', endDate: '', targetologistId: '',
    },
  })

  const saveMut = useMutation({
    mutationFn: async (data: any) => {
      await projectAdsApi.create(card.projectId, {
        title: data.title,
        channel: data.channel,
        budget: data.totalBudget ? Number(data.totalBudget) : null,
        dailyBudget: data.dailyBudget ? Number(data.dailyBudget) : null,
        budgetSource: 'client',
        status: 'planned',
        targetologistId: data.targetologistId || null,
        cardId: card.id,
        startDate: data.startDate, endDate: data.endDate,
      })
      await workflowApi.move(card.id, { stage: 'ads' }).catch(() => {})
    },
    onSuccess: () => { toast.success('Кампания создана (PLANNED)'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось создать кампанию'),
  })

  return (
    <Modal open onClose={onClose} title={`Запустить рекламу — ${card.title}`}>
      <form onSubmit={handleSubmit((d: any) => saveMut.mutate(d))} className="space-y-4">
        <div>
          <label className="label">Название кампании *</label>
          <input {...register('title', { required: true })} className="input" />
          {errors.title && <p className="text-xs text-red-500 mt-1">Обязательное поле</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Площадка</label>
            <select {...register('channel')} className="input">
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="facebook">Facebook</option>
              <option value="youtube">YouTube</option>
              <option value="telegram">Telegram</option>
              <option value="google">Google Ads</option>
              <option value="other">Другое</option>
            </select>
          </div>
          <div>
            <label className="label">Таргетолог</label>
            <select {...register('targetologistId')} className="input">
              <option value="">— Не назначен —</option>
              {targetologists.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Дневной бюджет (сомони)</label>
            <input type="number" min={0} {...register('dailyBudget')} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Общий бюджет (сомони)</label>
            <input type="number" min={0} {...register('totalBudget')} className="input" placeholder="0" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Начало *</label>
            <Controller name="startDate" control={control} rules={{ required: true }}
              render={({ field }) => <DatePicker value={(field.value as string) || ''} onChange={field.onChange} />} />
            {errors.startDate && <p className="text-xs text-red-500 mt-1">Укажите дату</p>}
          </div>
          <div>
            <label className="label">Конец *</label>
            <Controller name="endDate" control={control} rules={{ required: true }}
              render={({ field }) => <DatePicker value={(field.value as string) || ''} onChange={field.onChange} />} />
            {errors.endDate && <p className="text-xs text-red-500 mt-1">Укажите дату</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button type="submit" disabled={saveMut.isPending} className="btn-primary text-sm">
            <Megaphone size={14} /> {saveMut.isPending ? 'Создаю…' : 'Создать кампанию'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
