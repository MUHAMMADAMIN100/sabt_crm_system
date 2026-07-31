import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { workflowApi, projectAdsApi, smmTariffsApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { getRoleLabel } from '@/lib/permissions'
import { Trash2, Megaphone, History, Clapperboard, Users } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { tariffLimitsOf } from '@/lib/tariffLimits'

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
    pm_dev: 'ПМ (Разработка)',
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

/** Маршрут групповой карточки по этапам (для подписей кнопок «→ …»). */
export const GROUP_NEXT_FE: Record<string, Record<string, string>> = {
  reels: {
    organization: 'shooting', shooting: 'editing', editing: 'internal_review',
    internal_review: 'client_approval', client_approval: 'ready_to_publish',
    ready_to_publish: 'published',
  },
  macros: {
    organization: 'design', design: 'internal_review',
    internal_review: 'client_approval', client_approval: 'ready_to_publish',
    ready_to_publish: 'published',
  },
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

/** Может ли текущий пользователь выполнить действие (для скрытия кнопок).
 *  Руководители производства (MANAGE_ROLES: admin/founder/co_founder/
 *  smm_director/organizer) могут выполнять действие ЛЮБОГО этапа. */
export function canDoAction(action: string, role?: string | null, secondaryRole?: string | null): boolean {
  if (canManageBoard({ role, secondaryRole })) return true
  const allowed = ACTION_ROLES[action] || []
  return allowed.includes(role || '') || (!!secondaryRole && allowed.includes(secondaryRole))
}

/** Роли, которым разрешено РЕДАКТИРОВАТЬ данные доски (создавать/менять/
 *  удалять/назначать). Остальные — только смена статуса своих карточек. */
export const MANAGE_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'organizer']
export function canManageBoard(actor?: { role?: string | null; secondaryRole?: string | null; extraPermissions?: string[] | null } | null): boolean {
  if (!actor) return false
  if (MANAGE_ROLES.includes(actor.role || '') || MANAGE_ROLES.includes(actor.secondaryRole || '')) return true
  // Персональный грант «Контент-план» — даёт право вести доску.
  return Array.isArray(actor.extraPermissions) && actor.extraPermissions.includes('content-plan.manage')
}

/** Является ли пользователь исполнителем карточки — зеркалит backend isAssignee:
 *  основной assigneeId, список assigneeIds, заранее назначенные монтажёры
 *  (editorIds) и назначения внутри элементов группы. Используется фильтром
 *  «только мои» на доске, чтобы он совпадал с виджетом «Мои карточки». */
export function isMineCard(card: any, uid?: string | null): boolean {
  if (!uid || !card) return false
  if (card.assigneeId === uid) return true
  if (Array.isArray(card.assigneeIds) && card.assigneeIds.includes(uid)) return true
  if (Array.isArray(card.editorIds) && card.editorIds.includes(uid)) return true
  if (Array.isArray(card.items)) {
    return card.items.some((it: any) =>
      it?.assigneeId === uid ||
      (Array.isArray(it?.assigneeIds) && it.assigneeIds.includes(uid)) ||
      (Array.isArray(it?.editorIds) && it.editorIds.includes(uid)))
  }
  return false
}

/**
 * Предсказание результата перехода для ОПТИМИСТИЧНОГО обновления доски —
 * зеркалит движок workflow.service. patch применяется к карточке в кэше
 * сразу, до ответа сервера; keepOpen=true — модалку не закрываем (действие
 * без смены этапа, напр. «Отправлено клиенту»). nowIso передаём, чтобы не
 * звать Date в общем коде лишний раз.
 */
export function predictTransition(
  card: any, action: string, payload: any,
): { patch: Record<string, any> | null; keepOpen: boolean } {
  const isReels = card?.type === 'reels' || (card?.type == null && card?.contentType === 'reel')
  const nowIso = new Date().toISOString()
  switch (action) {
    case 'confirm_plan':
      return { patch: { stage: (card?.type === 'reels' || card?.contentType === 'reel') ? 'organization' : 'design' }, keepOpen: false }
    case 'confirm_shoot':
      return { patch: { stage: 'shooting', shootDate: payload?.shootDate || card?.shootDate || null }, keepOpen: false }
    case 'shoot_done':
      return { patch: { stage: 'editing' }, keepOpen: false }
    case 'editing_done':
      // join-гейт: если ветка дизайна ещё не готова — остаёмся в Монтаже («ждёт обложку»).
      return card?.designDone === false
        ? { patch: { status: 'waiting_cover', editingDone: true }, keepOpen: true }
        : { patch: { stage: 'internal_review', editingDone: true, status: 'active' }, keepOpen: false }
    case 'cover_done':
      return { patch: { status: 'done' }, keepOpen: false }
    case 'layout_done':
      return { patch: { stage: 'internal_review' }, keepOpen: false }
    case 'qa_accept':
      return { patch: { stage: 'client_approval', status: 'active' }, keepOpen: false }
    case 'qa_rework':
      return { patch: { stage: isReels ? 'editing' : 'design', status: 'rework' }, keepOpen: false }
    case 'mark_sent_to_client':
      return { patch: { sentToClientAt: nowIso }, keepOpen: true }
    case 'client_approve':
      return { patch: { stage: 'ready_to_publish', status: 'active' }, keepOpen: false }
    case 'client_revisions':
      return { patch: { stage: isReels ? 'editing' : 'design', status: 'rework' }, keepOpen: false }
    case 'publish':
      return { patch: { stage: 'published', status: 'published', publishedAt: nowIso, publishedUrl: payload?.publishedUrl || card?.publishedUrl || null }, keepOpen: false }
    default:
      return { patch: null, keepOpen: false }
  }
}

/** Бейджи карточки: тип, ожидание, доработка, дедлайн/публикация. */
// Цвета типов: Reels — синий, Макет — оранжевый (ТЗ — точь в точь образцы).
const REELS_CHIP = 'bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800'
const MACRO_CHIP = 'bg-orange-100 text-orange-700 border border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800'

/** % заполнения карточки КП/группы (для красной метки незаполненного). */
function fillPercent(card: any): number {
  const items: any[] = card.items || []
  if (items.length === 0) return 100
  const fields = card.kind === 'reels'
    ? ['title', 'publishDate', 'description', 'assigneeId', 'shootDate']
    : card.kind === 'macros'
      ? ['title', 'publishDate', 'description', 'assigneeId']
      : ['title', 'publishDate', 'description'] // kp
  let total = 0, filled = 0
  for (const it of items) for (const f of fields) { total++; if (String(it?.[f] ?? '').trim()) filled++ }
  return total ? Math.round((filled / total) * 100) : 100
}

export function WorkflowCardBadges({ card }: { card: any }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const deadline = card.deadline ? parseISO(card.deadline) : null
  const isOverdue = !!deadline && deadline < today && card.stage !== 'published' && card.stage !== 'ads'
  const tl = typeLabel(card.contentType)
  const isGroup = card.kind === 'kp' || card.kind === 'reels' || card.kind === 'macros'
  const isWorkGroup = card.kind === 'reels' || card.kind === 'macros'
  // Производственный прогресс по этапам (100% — «Опубликовано»). Считает бэк
  // (progressPct): одиночные/группы — по своему этапу, КП — среднее по всем
  // единицам проекта. Показываем на всех карточках, кроме обложек.
  const progressPct: number | null =
    typeof card.progressPct === 'number' && card.type !== 'cover' ? card.progressPct : null
  const progressColor = (p: number) => p >= 100
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : p >= 60
      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
      : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300'
  // Заполненность формы (данные) — оставляем маленькой красной меткой только
  // когда бриф заполнен не полностью: это контроль качества данных, не прогресс.
  const fill = isGroup ? fillPercent(card) : 100
  // Исполнители групповой карточки: уникальные имена (с учётом нескольких на
  // элемент) + счётчик элементов с назначением.
  const groupItems: any[] = isWorkGroup ? (card.items || []) : []
  const namesOf = (it: any): string[] =>
    (Array.isArray(it.assigneeNames) && it.assigneeNames.length) ? it.assigneeNames : (it.assigneeName ? [it.assigneeName] : [])
  const hasAssignee = (it: any): boolean =>
    (Array.isArray(it.assigneeIds) && it.assigneeIds.length > 0) || !!it.assigneeId
  const execNames = Array.from(new Set(groupItems.flatMap(namesOf).filter(Boolean))) as string[]
  const assignedCount = groupItems.filter(hasAssignee).length
  const totalItems = groupItems.length
  return (
    <>
    <div className="flex items-center gap-1.5 flex-wrap">
      {card.kind === 'kp' && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-200">
          {card.confirmed && <span className="w-2 h-2 rounded-full bg-green-500 inline-block" title="Сохранён" />}
          Контент-план
        </span>
      )}
      {(card.kind === 'reels' || card.kind === 'macros') && (
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', card.kind === 'reels' ? REELS_CHIP : MACRO_CHIP)}>
          {card.kind === 'reels' ? 'Reels' : 'Макеты'} · {(card.items || []).length}
        </span>
      )}
      {card.type && (
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded',
          card.type === 'reels' ? REELS_CHIP
            : card.type === 'cover' ? 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200'
            : MACRO_CHIP)}>
          {card.type === 'reels' ? 'Reels' : card.type === 'cover' ? 'Обложка' : 'Макет'}
        </span>
      )}
      {progressPct !== null && (
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', progressColor(progressPct))}
          title="Производственный прогресс: 100% — на этапе «Опубликовано»">
          {progressPct}%
        </span>
      )}
      {isGroup && fill < 100 && (
        <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" title={`Бриф заполнен на ${fill}% — заполните данные`}>
          ⚠ {fill}%
        </span>
      )}
      {card.kind === 'kp' && card.createdBy?.name && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400" title="Создал / заполнил · дата создания">
          ✎ {card.createdBy.name}{card.createdAt ? ` · ${format(new Date(card.createdAt), 'dd.MM.yyyy')}` : ''}
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
          Просрочено: {format(deadline, 'dd.MM.yyyy')}{card.deadlineTime ? ` ${card.deadlineTime}` : ''}
        </span>
      ) : (
        <span className="text-[10px] text-surface-500 dark:text-surface-400">до {format(deadline, 'dd.MM.yyyy')}{card.deadlineTime ? ` ${card.deadlineTime}` : ''}</span>
      ))}
      {card.publishDate && !card.publishedAt && (
        <span className="text-[10px] text-surface-400 dark:text-surface-500">пуб. {format(parseISO(card.publishDate), 'dd.MM')}{card.publishTime ? ` ${card.publishTime}` : ''}</span>
      )}
    </div>
    {isWorkGroup && totalItems > 0 && (
      <div className="flex items-center gap-1 flex-wrap text-[11px] text-surface-500 dark:text-surface-400 pt-0.5">
        <Users size={12} className="shrink-0" />
        {execNames.length > 0 ? (
          <>
            {execNames.map(n => (
              <span key={n} className="px-1.5 py-0.5 rounded bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300">{n}</span>
            ))}
            <span className="ml-auto tabular-nums">{assignedCount}/{totalItems}</span>
          </>
        ) : assignedCount > 0 ? (
          <span>Назначено: {assignedCount}/{totalItems}</span>
        ) : (
          <span>Исполнители не назначены</span>
        )}
      </div>
    )}
    </>
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
  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm({
    defaultValues: {
      projectId: card?.projectId || project?.id || '',
      title: card?.title || '',
      description: card?.description || '',
      contentType: card?.contentType || '',
      deadline: card?.deadline || '',
      deadlineTime: card?.deadlineTime || '',
      assigneeId: card?.assigneeId || '',
      type: card?.type || 'reels',
      publishDate: card?.publishDate || '',
      publishTime: card?.publishTime || '',
      needsIntro: card?.needsIntro ?? true,
    },
  })

  const selectedProjectId = watch('projectId')
  const watchedType = watch('type')
  const projList = singleProject ? [project] : (projects || [])
  const activeProjectId = singleProject ? project.id : selectedProjectId

  // «Одноразовая съёмка/дизайн» — карточка без клиентского проекта: выбор
  // проекта необязателен, бэк складывает её в служебный проект (sentinel
  // projectId='one-off'). Доступно на входных этапах «Съёмка» и «Дизайн».
  const [oneOff, setOneOff] = useState(false)
  const showOneOff = !card && !singleProject
    && (effectiveStage === 'shooting' || effectiveStage === 'design')
  const oneOffLabel = effectiveStage === 'design' ? 'Одноразовый дизайн' : 'Одноразовая съёмка'
  const projectPicked = oneOff ? true : !!activeProjectId

  // Исполнители — ВСЕ пользователи с ролью, валидной для этапа (не только
  // участники проекта), как в групповой форме. + текущий назначенный.
  const stageRoles = STAGE_ROLE_FILTER[effectiveStage] || []
  const { data: roleUsers = [] } = useQuery({
    queryKey: ['workflow-assignees', stageRoles.join(',')],
    queryFn: () => workflowApi.assignees(stageRoles),
    enabled: stageRoles.length > 0,
  })
  const assignees = useMemo(() => {
    const list: any[] = [...(roleUsers as any[])]
    if (card?.assigneeId && card?.assignee && !list.some((m: any) => m.id === card.assigneeId)) {
      list.push(card.assignee)
    }
    return list
  }, [roleUsers, card?.assigneeId, card?.assignee])

  const stageLabel = STAGES.find(s => s.key === effectiveStage)?.label
  const canManage = canManageBoard(actor)

  // Несколько исполнителей (как в групповой карточке): держим список id.
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([])
  useEffect(() => {
    const fromArr = Array.isArray(card?.assigneeIds) && card.assigneeIds.length
      ? card.assigneeIds
      : (card?.assigneeId ? [card.assigneeId] : [])
    setSelectedAssignees(fromArr)
  }, [card?.id])
  const toggleAssignee = (uid: string) =>
    setSelectedAssignees(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid])
  const nameOf = (id: string) =>
    (assignees.find((m: any) => m.id === id)?.name) || (card?.assignee?.id === id ? card.assignee.name : '')

  // ─── Монтаж: на этапе «Съёмка» заранее выбираем монтажёров (video_editor).
  // При переходе Съёмка → Монтаж они станут исполнителями карточки монтажа.
  const showEditors = effectiveStage === 'shooting'
  const { data: editorUsers = [] } = useQuery({
    queryKey: ['workflow-assignees', 'video_editor'],
    queryFn: () => workflowApi.assignees(['video_editor']),
    enabled: showEditors,
  })
  const [selectedEditors, setSelectedEditors] = useState<string[]>([])
  useEffect(() => {
    setSelectedEditors(Array.isArray(card?.editorIds) ? card.editorIds : [])
  }, [card?.id])
  const toggleEditor = (uid: string) =>
    setSelectedEditors(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid])
  const editorNameOf = (id: string) => (editorUsers as any[]).find((m: any) => m.id === id)?.name || ''

  return (
    <Modal open={open} onClose={onClose} title={card ? `Карточка — ${stageLabel}` : `Новая карточка — ${stageLabel}`}>
      {!canManage && (
        <p className="mb-3 text-[11px] text-surface-500 dark:text-surface-400 bg-surface-100 dark:bg-surface-700/50 rounded-lg px-3 py-2">
          Просмотр карточки. Менять данные может только руководитель — вы можете лишь выполнить действие этапа ниже.
        </p>
      )}
      <form
        onSubmit={handleSubmit((data: any) => onSubmit(oneOff ? 'one-off' : activeProjectId, {
          title: data.title,
          description: data.description || null,
          deadline: data.deadline || null,
          deadlineTime: data.deadlineTime || null,
          assigneeId: selectedAssignees[0] || null,
          assigneeIds: selectedAssignees,
          publishDate: data.publishDate || null,
          publishTime: data.publishTime || null,
          ...(showEditors ? { editorIds: selectedEditors } : {}),
          ...(isContentPlan ? { type: data.type, needsCover: true, needsIntro: data.type === 'reels' ? !!data.needsIntro : false } : {}),
        }))}
        className="space-y-4"
      >
        <fieldset disabled={!canManage} className="space-y-4 border-0 p-0 m-0 min-w-0 disabled:opacity-100">
        {!singleProject && (
          <div>
            <label className="label">Проект {oneOff ? '' : '*'}</label>
            <select {...register('projectId', { required: !oneOff })} className="input" disabled={!!card || oneOff}>
              <option value="">— Выберите проект —</option>
              {(projects || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              {/* Проект открытой карточки может отсутствовать в списке
                  (служебный «Одноразовые съёмки» скрыт из списков проектов) —
                  добавляем option, чтобы селект показывал реальное имя. */}
              {card?.projectId && !(projects || []).some((p: any) => p.id === card.projectId) && (
                <option value={card.projectId}>{card.project?.name || 'Одноразовые съёмки'}</option>
              )}
            </select>
            {errors.projectId && !oneOff && <p className="text-xs text-red-500 mt-1">Выберите проект</p>}
            {showOneOff && (
              <div className="mt-2">
                <label className="inline-flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4" checked={oneOff}
                    onChange={e => {
                      setOneOff(e.target.checked)
                      // Сбрасываем уже выбранный проект: карточка поедет в
                      // «Одноразовые съёмки», серый селект не должен врать.
                      if (e.target.checked) setValue('projectId', '')
                    }} />
                  {oneOffLabel} <span className="text-surface-400 font-normal">— без клиентского проекта</span>
                </label>
                {oneOff && (
                  <p className="text-[11px] text-surface-400 mt-1">
                    Карточка попадёт в служебный проект «Одноразовые» — выбирать проект не нужно.
                  </p>
                )}
              </div>
            )}
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
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <div>
            <label className="label">Дата публикации</label>
            <Controller name="publishDate" control={control}
              render={({ field }) => <DatePicker value={(field.value as string) || ''} onChange={field.onChange} />} />
          </div>
          <div>
            <label className="label">Время</label>
            <input type="time" {...register('publishTime')} className="input w-28" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Дедлайн этапа</label>
            {/* flex-wrap: в узкой ячейке время переносится под дату, не
                наезжая на соседнюю колонку «Исполнители». */}
            <div className="flex flex-wrap gap-2">
              <Controller name="deadline" control={control}
                render={({ field }) => <DatePicker className="flex-1 min-w-[150px]" value={(field.value as string) || ''} onChange={field.onChange} />} />
              <input type="time" {...register('deadlineTime')} title="Время дедлайна" className="input w-24" />
            </div>
          </div>
          <div>
            <label className="label">Исполнители <span className="text-surface-400 font-normal">(можно несколько)</span></label>
            {!projectPicked ? (
              <p className="input flex items-center text-surface-400 min-h-[38px]">— Сначала выберите проект —</p>
            ) : canManage ? (
              <div className="max-h-32 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700">
                {assignees.length === 0 && <p className="text-xs text-surface-400 px-2 py-1.5">Нет доступных</p>}
                {assignees.map((m: any) => (
                  <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/40">
                    <input type="checkbox" className="w-4 h-4 shrink-0" checked={selectedAssignees.includes(m.id)} onChange={() => toggleAssignee(m.id)} />
                    <span className="truncate">{m.name}{m.role ? ` (${shortRole(m.role)})` : ''}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-surface-600 dark:text-surface-300 input flex items-center min-h-[38px]">
                {selectedAssignees.length ? selectedAssignees.map(id => nameOf(id)).filter(Boolean).join(', ') : '— Не назначен —'}
              </p>
            )}
          </div>
        </div>
        {showEditors && (
          <div>
            <label className="label">Монтаж <span className="text-surface-400 font-normal">— монтажёры (можно несколько)</span></label>
            {!projectPicked ? (
              <p className="input flex items-center text-surface-400 min-h-[38px]">— Сначала выберите проект —</p>
            ) : canManage ? (
              <>
                <div className="max-h-32 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700">
                  {(editorUsers as any[]).length === 0 && <p className="text-xs text-surface-400 px-2 py-1.5">Нет доступных монтажёров</p>}
                  {(editorUsers as any[]).map((m: any) => (
                    <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/40">
                      <input type="checkbox" className="w-4 h-4 shrink-0" checked={selectedEditors.includes(m.id)} onChange={() => toggleEditor(m.id)} />
                      <span className="truncate">{m.name}{m.role ? ` (${shortRole(m.role)})` : ''}</span>
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-surface-400 mt-1">Когда съёмка завершится, карточка перейдёт в «Монтаж» на выбранных монтажёров — они получат уведомление.</p>
              </>
            ) : (
              <p className="text-sm text-surface-600 dark:text-surface-300 input flex items-center min-h-[38px]">
                {selectedEditors.length ? selectedEditors.map(id => editorNameOf(id)).filter(Boolean).join(', ') : '— Не назначен —'}
              </p>
            )}
          </div>
        )}
        <div>
          <label className="label">Описание / сценарий</label>
          <textarea {...register('description')} className="input min-h-[70px]" rows={3} />
        </div>
        </fieldset>
        <div className="flex items-center justify-between gap-2 pt-1">
          {canManage && onDelete
            ? <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"><Trash2 size={13} /> Удалить</button>
            : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">{canManage ? 'Отмена' : 'Закрыть'}</button>
            {canManage && <button type="submit" disabled={loading} className="btn-primary text-sm">{loading ? 'Сохранение…' : 'Сохранить'}</button>}
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
  // Глобальная занятость дат — подсветка календаря «Дата съёмки» на этапе
  // «Организация» (грузим только когда поле реально показывается).
  const { data: globalLoad } = useQuery({
    queryKey: ['workflow', 'publication-load'],
    queryFn: () => workflowApi.publicationLoad(),
    enabled: card?.stage === 'organization',
    staleTime: 60_000,
  })
  const KIND_RU: Record<string, string> = { reel: 'Рилс', macro: 'Макет', shoot: 'Съёмка' }
  const shootDateMarks = ((globalLoad as any[]) || []).map((m: any) => ({
    date: m.date, kind: m.kind,
    label: `${m.project} · ${KIND_RU[m.kind] || m.kind}${m.title && m.kind !== 'shoot' ? `: ${m.title}` : ''}`,
  }))
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
            <div>
              <label className="label text-xs">Дата съёмки</label>
              <DatePicker value={f.shootDate || ''} onChange={(v: string) => set('shootDate', v)} marks={shootDateMarks} />
            </div>
            {field('shootTime', 'Время', '14:00')}
            {field('shootLocation', 'Место', 'Студия')}
          </div>
          {btn('confirm_shoot', { shootDate: f.shootDate, shootTime: f.shootTime, shootLocation: f.shootLocation }, '✓ Подтвердить съёмку')}
        </Wrap>
      )
    case 'shooting':
      return (
        <Wrap>
          {field('rawFootageUrl', 'Ссылка на исходники (необязательно)', 'https://…')}
          {btn('shoot_done', { rawFootageUrl: f.rawFootageUrl }, '✓ Съёмка завершена → Монтаж')}
        </Wrap>
      )
    case 'editing':
      return (
        <Wrap>
          {card.status === 'waiting_cover' && <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">⏳ Монтаж готов, ждём обложку/заставку.</p>}
          {field('finalCutUrl', 'Ссылка на монтаж (необязательно)', 'https://…')}
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
          <div className="flex gap-2 flex-wrap items-center">
            {card.sentToClientAt
              ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                  ✓ Отправлено клиенту{card.sentToClientAt ? ` · ${format(parseISO(card.sentToClientAt), 'dd.MM HH:mm')}` : ''}
                </span>
              : btn('mark_sent_to_client', {}, 'Отправлено клиенту')}
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

// ─── §9.1/§9.2: группировка съёмки + пакетное «Подтвердить съёмку» ─────
export function ShootSessionModal({ projectId, cards, onClose, onSaved }: {
  projectId: string
  cards: any[]
  onClose: () => void
  onSaved: () => void
}) {
  // Кандидаты: рилсы на этапе «Организация» этого проекта.
  const candidates = useMemo(
    () => (cards || []).filter((c: any) => c.projectId === projectId && c.stage === 'organization' && (c.type || '') === 'reels'),
    [cards, projectId],
  )
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [f, setF] = useState<Record<string, string>>({})
  const toggle = (id: string) => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Глобальная занятость дат (все проекты) — не назначить две съёмки на день.
  const { data: globalLoad } = useQuery({
    queryKey: ['workflow', 'publication-load'],
    queryFn: () => workflowApi.publicationLoad(),
    staleTime: 60_000,
  })
  const KIND_RU: Record<string, string> = { reel: 'Рилс', macro: 'Макет', shoot: 'Съёмка' }
  const dateMarks = ((globalLoad as any[]) || []).map(m => ({
    date: m.date, kind: m.kind,
    label: `${m.project} · ${KIND_RU[m.kind] || m.kind}${m.title && m.kind !== 'shoot' ? `: ${m.title}` : ''}`,
  }))

  const saveMut = useMutation({
    mutationFn: () => workflowApi.createShootSession(projectId, {
      date: f.date, time: f.time, location: f.location, title: f.title,
      cardIds: [...picked],
    }),
    onSuccess: (r: any) => { toast.success(`Съёмка назначена · карточек: ${r?.moved ?? 0}`); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось создать съёмку'),
  })

  return (
    <Modal open onClose={onClose} title="Съёмочная группа">
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label text-xs">Дата съёмки *</label><DatePicker value={f.date || ''} onChange={(v: string) => setF(p => ({ ...p, date: v }))} marks={dateMarks} /></div>
          <div><label className="label text-xs">Время</label><input className="input" value={f.time || ''} onChange={e => setF(p => ({ ...p, time: e.target.value }))} placeholder="14:00" /></div>
          <div><label className="label text-xs">Место</label><input className="input" value={f.location || ''} onChange={e => setF(p => ({ ...p, location: e.target.value }))} placeholder="Студия" /></div>
        </div>
        <div>
          <p className="label text-xs mb-1">Рилсы на этапе «Организация» ({candidates.length})</p>
          {candidates.length === 0
            ? <p className="text-xs text-surface-400">Нет рилсов на этапе «Организация» в этом проекте.</p>
            : (
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {candidates.map((c: any) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer">
                    <input type="checkbox" className="w-4 h-4" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
                    {c.title}
                  </label>
                ))}
              </div>
            )}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button type="button" disabled={saveMut.isPending || picked.size === 0 || !f.date}
            onClick={() => saveMut.mutate()} className="btn-primary text-sm">
            <Clapperboard size={14} /> {saveMut.isPending ? 'Назначаю…' : `Подтвердить съёмку (${picked.size})`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── §11: настройка отступов дедлайнов (дни до публикации) ─────────────
const DEADLINE_STAGE_LABELS: { key: string; label: string }[] = [
  { key: 'organization', label: 'Организация' },
  { key: 'shooting', label: 'Съёмка' },
  { key: 'editing', label: 'Монтаж' },
  { key: 'design', label: 'Дизайн' },
  { key: 'internal_review', label: 'Внутр. проверка' },
  { key: 'client_approval', label: 'Согласование' },
  { key: 'ready_to_publish', label: 'Готово к публ.' },
]
export function DeadlineSettingsModal({ onClose }: { onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['workflow-deadlines'], queryFn: () => workflowApi.getDeadlineSettings() })
  const [reels, setReels] = useState<Record<string, string>>({})
  const [stat, setStat] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!data) return
    const r: Record<string, string> = {}; const s: Record<string, string> = {}
    for (const k of Object.keys(data.reels || {})) r[k] = String(data.reels[k])
    for (const k of Object.keys(data.static || {})) s[k] = String(data.static[k])
    setReels(r); setStat(s)
  }, [data])
  const saveMut = useMutation({
    mutationFn: () => workflowApi.updateDeadlineSettings({
      reels: Object.fromEntries(Object.entries(reels).map(([k, v]) => [k, Number(v) || 0])),
      static: Object.fromEntries(Object.entries(stat).map(([k, v]) => [k, Number(v) || 0])),
    }),
    onSuccess: () => { toast.success('Дедлайны сохранены'); onClose() },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'),
  })
  return (
    <Modal open onClose={onClose} title="Отступы дедлайнов (дни до публикации)">
      <div className="space-y-3">
        <p className="text-xs text-surface-500 dark:text-surface-400">За сколько дней до публикации должен завершиться каждый этап. Применяется при подтверждении плана.</p>
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center text-sm">
          <span className="text-xs font-semibold text-surface-400">Этап</span>
          <span className="text-xs font-semibold text-surface-400 w-16 text-center">Рилс</span>
          <span className="text-xs font-semibold text-surface-400 w-16 text-center">Макет</span>
          {DEADLINE_STAGE_LABELS.map(s => (
            <Frag key={s.key}>
              <span className="text-surface-700 dark:text-surface-300">{s.label}</span>
              <input type="number" min={0} className="input w-16 text-center py-1"
                value={reels[s.key] ?? ''} onChange={e => setReels(p => ({ ...p, [s.key]: e.target.value }))}
                disabled={!(s.key in (data?.reels || {}))} />
              <input type="number" min={0} className="input w-16 text-center py-1"
                value={stat[s.key] ?? ''} onChange={e => setStat(p => ({ ...p, [s.key]: e.target.value }))}
                disabled={!(s.key in (data?.static || {}))} />
            </Frag>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Отмена</button>
          <button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className="btn-primary text-sm">
            {saveMut.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
function Frag({ children }: { children: React.ReactNode }) { return <>{children}</> }

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
      // Переносим карточку в «Реклама»; если не вышло — не глотаем, сообщим.
      const moveFailed = await workflowApi.move(card.id, { stage: 'ads' }).then(() => false).catch(() => true)
      return { moveFailed }
    },
    onSuccess: (r: any) => {
      if (r?.moveFailed) toast('Кампания создана (PLANNED), но карточка осталась на месте — перенос в «Реклама» недоступен с этого этапа', { icon: '⚠️' })
      else toast.success('Кампания создана (PLANNED)')
      onSaved()
    },
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

// ─── Контент-план: форма КП (блоки рилсов/макетов по тарифу) ──────────
export function ContentPlanModal({ projects, card, fixedProjectId, onClose, onSaved }: {
  projects: any[]
  card: any | null
  fixedProjectId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const editing = !!card
  const { data: tariffs } = useQuery({ queryKey: ['smm-tariffs', { isActive: true }], queryFn: () => smmTariffsApi.list({ isActive: true }) })
  const [projectId, setProjectId] = useState(card?.projectId || fixedProjectId || '')
  const [reels, setReels] = useState<any[]>([])
  const [macros, setMacros] = useState<any[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!card?.items) return
    setReels(card.items.filter((i: any) => i.itemKind === 'reel'))
    setMacros(card.items.filter((i: any) => i.itemKind === 'macro'))
  }, [card])

  const project = projects.find((p: any) => p.id === projectId)
  const tariff = (tariffs || []).find((t: any) => t.id === project?.tariffId)
  // У ИНДИВИДУАЛЬНОГО тарифа цифры лежат в самом проекте: в справочнике он
  // один на всех и хранит нули — иначе доска строила бы 0 рилсов и 0 макетов.
  const limits = tariffLimitsOf(tariff, project?.customTariff)
  // Макет = Post → количество макетов берём из postsPerMonth.
  const tariffLabel = tariff ? `${limits.reelsPerMonth} рилс · ${limits.postsPerMonth} макет` : (projectId ? 'без тарифа' : '')

  // Префилл по тарифу при создании (не при редактировании существующего КП).
  useEffect(() => {
    if (editing) return
    if (!tariff) { setReels([]); setMacros([]); return }
    setReels(Array.from({ length: limits.reelsPerMonth }, () => ({ title: '', publishDate: '', description: '' })))
    setMacros(Array.from({ length: limits.postsPerMonth }, () => ({ title: '', publishDate: '', description: '' })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tariff?.id, limits.reelsPerMonth, limits.postsPerMonth, editing])

  const setItem = (list: any[], setList: any, idx: number, patch: any) =>
    setList(list.map((it: any, i: number) => i === idx ? { ...it, ...patch } : it))

  const todayIso = format(new Date(), 'yyyy-MM-dd')
  // Глобальная занятость по ВСЕМ проектам (публикации рилсов/макетов и
  // съёмки) — чтобы не ставить несколько единиц на один день. Даты текущего
  // проекта дают локальные reels/macros формы (свежее, чем сохранённые в БД),
  // поэтому его записи из глобальных меток исключаем.
  const { data: globalLoad } = useQuery({
    queryKey: ['workflow', 'publication-load'],
    queryFn: () => workflowApi.publicationLoad(),
    staleTime: 60_000,
  })
  const KIND_RU: Record<string, string> = { reel: 'Рилс', macro: 'Макет', shoot: 'Съёмка' }
  const globalMarks = ((globalLoad as any[]) || [])
    .filter(m => m.projectId !== projectId)
    .map(m => ({ date: m.date, kind: m.kind, label: `${m.project} · ${KIND_RU[m.kind] || m.kind}${m.title && m.kind !== 'shoot' ? `: ${m.title}` : ''}` }))

  // Занятые дни для подсветки в календаре: локальные (этот план) + глобальные.
  // Исключаем дату самого редактируемого элемента.
  const occupiedMarks = (excludeKind: 'reel' | 'macro', excludeIdx: number) => [
    ...reels.map((r: any, i: number) => ({ date: r.publishDate, kind: 'reel' as const, label: `Этот план · Рилс ${i + 1}${r.title ? `: ${r.title}` : ''}`, skip: excludeKind === 'reel' && i === excludeIdx })),
    ...macros.map((m: any, i: number) => ({ date: m.publishDate, kind: 'macro' as const, label: `Этот план · Макет ${i + 1}${m.title ? `: ${m.title}` : ''}`, skip: excludeKind === 'macro' && i === excludeIdx })),
  ].filter(m => m.date && !m.skip).map(({ date, kind, label }) => ({ date, kind, label })).concat(globalMarks)

  const qc = useQueryClient()
  // Мгновенно закрываем + сохраняем в фоне; доска обновится по invalidate.
  const onSave = () => {
    toast.success('Контент-план сохранён')
    onClose()
    workflowApi.saveContentPlan(projectId, { reels, macros })
      .catch((e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'))
      .finally(() => qc.invalidateQueries({ queryKey: ['workflow'] }))
  }

  const renderBlocks = (kind: 'reel' | 'macro', list: any[], setList: any) => list.map((it: any, idx: number) => {
    const key = `${kind}-${idx}`
    const isOpen = open[key] ?? false
    return (
      <div key={key} className="border border-surface-200 dark:border-surface-700 rounded-lg">
        <button type="button" onClick={() => setOpen(p => ({ ...p, [key]: !isOpen }))}
          className="w-full flex items-center justify-between px-3 py-2 text-left rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700/40 transition-colors">
          <span className="text-sm font-medium text-surface-800 dark:text-surface-200">
            {kind === 'reel' ? 'Reels' : 'Макет'} {idx + 1}{it.title ? ` — ${it.title}` : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-surface-400">{isOpen ? 'свернуть' : 'редактировать'}</span>
            <span className={clsx('text-surface-400 transition-transform', isOpen && 'rotate-180')}>▾</span>
          </span>
        </button>
        {isOpen && (
          <div className="px-3 pb-3 space-y-2">
            <div><label className="label text-xs">Тема</label><input className="input" value={it.title || ''} onChange={e => setItem(list, setList, idx, { title: e.target.value })} /></div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div><label className="label text-xs">Дата публикации</label><DatePicker value={it.publishDate || ''} minDate={todayIso} onChange={(v: string) => setItem(list, setList, idx, { publishDate: v })} marks={occupiedMarks(kind, idx)} /></div>
              <div><label className="label text-xs">Время</label><input type="time" className="input w-24" value={it.publishTime || ''} onChange={e => setItem(list, setList, idx, { publishTime: e.target.value })} /></div>
            </div>
            <div><label className="label text-xs">Описание</label><textarea className="input min-h-[60px]" value={it.description || ''} onChange={e => setItem(list, setList, idx, { description: e.target.value })} /></div>
          </div>
        )}
      </div>
    )
  })

  return (
    <Modal open onClose={onClose} title={editing ? 'Контент-план' : 'Новый контент-план'} size="xl">
      <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
        <div>
          <label className="label">Проект *</label>
          <select className="input" value={projectId} disabled={editing || !!fixedProjectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">— Выберите проект —</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {projectId && <p className="text-[11px] text-surface-500 dark:text-surface-400 mt-1">Тариф: {tariffLabel}</p>}
        </div>
        {projectId && (
          <>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">Рилсы ({reels.length})</p>
              {reels.length ? renderBlocks('reel', reels, setReels) : <p className="text-xs text-surface-400">Нет рилсов в тарифе</p>}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400">Макеты ({macros.length})</p>
              {macros.length ? renderBlocks('macro', macros, setMacros) : <p className="text-xs text-surface-400">Нет макетов в тарифе</p>}
            </div>
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 pt-3 border-t border-surface-100 dark:border-surface-700 mt-3">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Отмена</button>
        <button type="button" disabled={!projectId || (reels.length + macros.length === 0)}
          onClick={onSave} className="btn-primary text-sm">
          Сохранить
        </button>
      </div>
    </Modal>
  )
}

// ─── Групповая карточка «Рилсы»/«Макеты»: элементы по этапам ──────────
export function GroupCardModal({ card, project, actor, onClose, onSaved }: {
  card: any
  project: any
  actor?: { role?: string | null; secondaryRole?: string | null }
  onClose: () => void
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const [items, setItems] = useState<any[]>(card.items || [])
  const stage = card.stage
  const isReels = card.kind === 'reels'
  const canManage = canManageBoard(actor)

  // Роль-исполнитель зависит от текущего этапа: видеограф (съёмка/организация),
  // монтажёр (монтаж), дизайнер (дизайн/организация макетов).
  const assignRoles = !isReels ? ['designer'] : (stage === 'editing' ? ['video_editor'] : ['videographer', 'video_director'])
  const assignLabel = !isReels ? 'Дизайнер' : (stage === 'editing' ? 'Монтажёр' : 'Видеограф')
  const { data: opts = [] } = useQuery({
    queryKey: ['workflow-assignees', assignRoles.join(',')],
    queryFn: () => workflowApi.assignees(assignRoles),
  })
  // На «Съёмке» рилсов можно заранее выбрать монтажёров — при переходе в
  // «Монтаж» они станут исполнителями и получат уведомление по 3 каналам.
  const showEditorPick = isReels && stage === 'shooting'
  const { data: editorOpts = [] } = useQuery({
    queryKey: ['workflow-assignees', 'video_editor'],
    queryFn: () => workflowApi.assignees(['video_editor']),
    enabled: showEditorPick,
  })
  // Следующий этап маршрута группы (для подписей кнопок).
  const nextKey = GROUP_NEXT_FE[isReels ? 'reels' : 'macros'][stage]
  const nextLabel = STAGES.find(s => s.key === nextKey)?.label || ''
  const showAssignee = ['organization', 'shooting', 'editing', 'design'].includes(stage)
  const showShoot = isReels && ['organization', 'shooting'].includes(stage)

  // Глобальная занятость дат по всем проектам — подсветка календаря «Дата
  // съёмки», чтобы не назначить две съёмки/публикации на один день.
  const { data: globalLoad } = useQuery({
    queryKey: ['workflow', 'publication-load'],
    queryFn: () => workflowApi.publicationLoad(),
    enabled: showShoot && canManage,
    staleTime: 60_000,
  })
  const SHOOT_KIND_RU: Record<string, string> = { reel: 'Рилс', macro: 'Макет', shoot: 'Съёмка' }
  const shootMarks = ((globalLoad as any[]) || []).map(m => ({
    date: m.date, kind: m.kind,
    label: `${m.project} · ${SHOOT_KIND_RU[m.kind] || m.kind}${m.title && m.kind !== 'shoot' ? `: ${m.title}` : ''}`,
  }))
  const setItem = (idx: number, patch: any) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it))

  // Несколько исполнителей на элемент. Храним assigneeIds/assigneeNames;
  // assigneeId/assigneeName = первый из списка (совместимость, аватар).
  const itemIds = (it: any): string[] =>
    Array.isArray(it.assigneeIds) && it.assigneeIds.length ? it.assigneeIds : (it.assigneeId ? [it.assigneeId] : [])
  const itemNames = (it: any): string[] =>
    Array.isArray(it.assigneeNames) && it.assigneeNames.length ? it.assigneeNames : (it.assigneeName ? [it.assigneeName] : [])
  const toggleAssignee = (idx: number, m: any) => {
    const cur = itemIds(items[idx])
    const ids = cur.includes(m.id) ? cur.filter(x => x !== m.id) : [...cur, m.id]
    const names = ids.map(id => (opts as any[]).find((o: any) => o.id === id)?.name).filter(Boolean)
    setItem(idx, { assigneeIds: ids, assigneeNames: names, assigneeId: ids[0] || '', assigneeName: names[0] || '' })
  }
  // Монтажёры элемента (заранее на «Съёмке»).
  const itemEditorIds = (it: any): string[] => Array.isArray(it.editorIds) ? it.editorIds.filter(Boolean) : []
  const itemEditorNames = (it: any): string[] => Array.isArray(it.editorNames) ? it.editorNames.filter(Boolean) : []
  const toggleEditor = (idx: number, m: any) => {
    const cur = itemEditorIds(items[idx])
    const ids = cur.includes(m.id) ? cur.filter(x => x !== m.id) : [...cur, m.id]
    const names = ids.map(id => (editorOpts as any[]).find((o: any) => o.id === id)?.name).filter(Boolean)
    setItem(idx, { editorIds: ids, editorNames: names })
  }

  // Оптимистичное обновление обеих досок (префикс ['workflow']).
  const optimistic = (patch: (c: any) => any) =>
    qc.setQueriesData({ queryKey: ['workflow'] }, (old: any) =>
      Array.isArray(old) ? old.map((c: any) => c.id === card.id ? patch(c) : c) : old)

  // Сохранить: мгновенно закрываем + обновляем доску, запрос идёт в фоне.
  const onSave = () => {
    optimistic(c => ({ ...c, items }))
    toast.success('Сохранено')
    onClose()
    workflowApi.updateItems(card.id, items)
      .catch((e: any) => toast.error(e?.response?.data?.message || 'Не удалось сохранить'))
      .finally(() => qc.invalidateQueries({ queryKey: ['workflow'] }))
  }
  const onDone = () => {
    if (!nextKey) return
    // Исполнитель обязателен на этапах с выбором (видеограф/монтажёр/дизайнер).
    if (showAssignee && items.some(it => itemIds(it).length === 0)) {
      toast.error(`Назначьте: ${assignLabel} — у всех элементов`)
      return
    }
    optimistic(c => ({ ...c, items, stage: nextKey, position: 9999 }))
    toast.success('Готово')
    onClose()
    ;(async () => {
      try {
        // updateItems — менеджерский эндпоинт (403 для исполнителей). У
        // исполнителя все поля заблокированы, сохранять ему нечего — сразу
        // выполняем переход (он разрешён роли-владельцу текущего этапа).
        if (canManage) await workflowApi.updateItems(card.id, items)
        await workflowApi.transition(card.id, 'org_confirm', {})
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Не удалось выполнить')
      } finally {
        qc.invalidateQueries({ queryKey: ['workflow'] })
      }
    })()
  }

  // Вынести ОДИН элемент на следующий этап независимо от других.
  const advanceOne = (it: any) => {
    if (showAssignee && itemIds(it).length === 0) {
      toast.error(`Назначьте: ${assignLabel}`)
      return
    }
    const rest = items.filter(x => x.id !== it.id)
    setItems(rest)
    optimistic(c => ({ ...c, items: (c.items || []).filter((x: any) => x.id !== it.id) }))
    toast.success('Готово')
    if (rest.length === 0) onClose()
    ;(async () => {
      try {
        // Как в onDone: updateItems только менеджерам, иначе 403 ломал
        // «Готово» у исполнителя (дизайнер/видеограф) до самого перехода.
        if (canManage) await workflowApi.updateItems(card.id, items)
        await workflowApi.advanceItem(card.id, it.id)
      } catch (e: any) {
        toast.error(e?.response?.data?.message || 'Не удалось')
      } finally {
        qc.invalidateQueries({ queryKey: ['workflow'] })
      }
    })()
  }
  const assigneeName = (id?: string) => (opts as any[]).find((m: any) => m.id === id)?.name
  const fmtDate = (d?: string) => { try { return d ? format(parseISO(d), 'dd/MM/yyyy') : '' } catch { return d || '' } }
  const typeWord = isReels ? 'Reels' : 'Макет'
  const todayIso = format(new Date(), 'yyyy-MM-dd')

  const stageLabel = STAGES.find(s => s.key === stage)?.label || stage
  return (
    <Modal open onClose={onClose} title={`${card.title} — ${stageLabel}`} size="xl">
      <div className="space-y-3 max-h-[68vh] overflow-y-auto pr-1">
        {items.length === 0 && <p className="text-sm text-surface-400">Нет элементов.</p>}
        {items.map((it, idx) => (
          <div key={it.id || idx} className="border border-surface-200 dark:border-surface-700 rounded-lg p-3 space-y-2">
            {/* Заголовок + дата публикации в правом верхнем углу (дд/мм/гггг) */}
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-surface-800 dark:text-surface-200">
                {typeWord} {idx + 1}{it.title ? ` ${it.title}` : ''}
              </p>
              {it.publishDate && (
                <span className="text-[11px] text-surface-400 shrink-0 text-right">
                  Дата публикации<br />{fmtDate(it.publishDate)}{it.publishTime ? ` ${it.publishTime}` : ''}
                </span>
              )}
            </div>
            {it.description && <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">{it.description}</p>}
            {(showAssignee || showShoot) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {showAssignee && (
                  <div>
                    <label className="label text-xs">{assignLabel} * <span className="text-surface-400 font-normal">(можно несколько)</span></label>
                    {canManage ? (
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700">
                        {opts.length === 0 && <p className="text-xs text-surface-400 px-2 py-1.5">Нет доступных</p>}
                        {opts.map((m: any) => {
                          const checked = itemIds(it).includes(m.id)
                          return (
                            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/40">
                              <input type="checkbox" className="w-4 h-4 shrink-0" checked={checked} onChange={() => toggleAssignee(idx, m)} />
                              <span className="truncate">{m.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-surface-600 dark:text-surface-300 input flex items-center min-h-[38px]">
                        {itemNames(it).length ? itemNames(it).join(', ') : '— Не назначен —'}
                      </p>
                    )}
                  </div>
                )}
                {showEditorPick && (
                  <div>
                    <label className="label text-xs">Монтаж <span className="text-surface-400 font-normal">— монтажёры (можно несколько)</span></label>
                    {canManage ? (
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 divide-y divide-surface-100 dark:divide-surface-700">
                        {(editorOpts as any[]).length === 0 && <p className="text-xs text-surface-400 px-2 py-1.5">Нет доступных монтажёров</p>}
                        {(editorOpts as any[]).map((m: any) => {
                          const checked = itemEditorIds(it).includes(m.id)
                          return (
                            <label key={m.id} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-700/40">
                              <input type="checkbox" className="w-4 h-4 shrink-0" checked={checked} onChange={() => toggleEditor(idx, m)} />
                              <span className="truncate">{m.name}</span>
                            </label>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-surface-600 dark:text-surface-300 input flex items-center min-h-[38px]">
                        {itemEditorNames(it).length ? itemEditorNames(it).join(', ') : '— Не назначен —'}
                      </p>
                    )}
                  </div>
                )}
                {showShoot && (
                  <>
                    <div><label className="label text-xs">Дата съёмки</label><DatePicker value={it.shootDate || ''} disabled={!canManage} minDate={todayIso} maxDate={it.publishDate || undefined} onChange={(v: string) => setItem(idx, { shootDate: v })} marks={shootMarks} /></div>
                    <div><label className="label text-xs">Время</label><input type="time" className="input" disabled={!canManage} value={it.shootTime || ''} onChange={e => setItem(idx, { shootTime: e.target.value })} /></div>
                    <div><label className="label text-xs">Место</label><input className="input" disabled={!canManage} value={it.shootLocation || ''} onChange={e => setItem(idx, { shootLocation: e.target.value })} placeholder="Студия" /></div>
                  </>
                )}
              </div>
            )}
            {/* Имя исполнителя + кнопка «Готово» для этого элемента (независимо) */}
            {nextKey && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-surface-500 dark:text-surface-400">
                  {itemNames(it).length ? `${itemNames(it).length > 1 ? 'Исполнители' : 'Исполнитель'}: ${itemNames(it).join(', ')}` : 'Исполнитель не назначен'}
                </span>
                <button type="button" onClick={() => advanceOne(it)}
                  className="px-3 py-1 rounded-lg text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors">
                  Готово → {nextLabel}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-2 pt-3 border-t border-surface-100 dark:border-surface-700 mt-3">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Закрыть</button>
        <div className="flex gap-2">
          {canManage && <button type="button" onClick={onSave} className="btn-secondary text-sm">Сохранить</button>}
          {nextKey && items.length > 0 && (
            <button type="button" onClick={onDone} className="btn-primary text-sm">
              Все готово → {nextLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── «История»: архив карточек, прошедших все этапы (опубл. > 6 дней) ──────
export function ArchiveModal({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['workflow-archive', projectId || 'all'],
    queryFn: () => (projectId ? workflowApi.projectArchive(projectId) : workflowApi.archive()),
  })
  const list = (cards as any[]) || []
  return (
    <Modal open onClose={onClose} title={`История${list.length ? ` (${list.length})` : ''}`} size="xl">
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
        Карточки, опубликованные более 6 дней назад — попадают сюда автоматически и убираются с доски. Только просмотр.
      </p>
      {isLoading ? (
        <p className="text-sm text-surface-400 animate-pulse py-6 text-center">Загрузка…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-surface-400 py-6 text-center">В истории пока пусто.</p>
      ) : (
        <div className="space-y-2 max-h-[68vh] overflow-y-auto pr-1">
          {list.map((c: any) => (
            <div key={c.id} className="border border-surface-200 dark:border-surface-700 rounded-lg p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-surface-900 dark:text-surface-100 leading-snug">{c.title}</p>
                {c.project?.name && (
                  <span className="text-[11px] text-primary-600 dark:text-primary-400 font-medium shrink-0">{c.project.name}</span>
                )}
              </div>
              <WorkflowCardBadges card={c} />
              {c.assignee?.name && (
                <p className="text-[11px] text-surface-500 dark:text-surface-400">
                  Исполнитель: {c.assignee.name}{c.assignee.role ? ` (${shortRole(c.assignee.role)})` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end pt-3 border-t border-surface-100 dark:border-surface-700 mt-3">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">Закрыть</button>
      </div>
    </Modal>
  )
}
