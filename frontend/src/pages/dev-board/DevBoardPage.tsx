import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import {
  Plus, Search, CalendarDays,
  Columns, Table2, User as UserIcon, AlertTriangle, CheckSquare,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Trash2, Folder, RefreshCw,
  MoreHorizontal, SlidersHorizontal, Check, GanttChartSquare,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { devTrackerApi, usersApi, projectsApi } from '@/services/api.service'
import { Modal, FormField, Avatar, PageLoader, EmptyState } from '@/components/ui'
// Локальные виджеты модуля: нативные select/date рисуются браузером
// (без анимации, системный хайлайт). В dev-board — плавные поповеры.
import { BoardSelect as Select } from './BoardSelect'
import './animations.css'
import { BoardDatePicker } from './BoardDatePicker'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import {
  DEV_TASK_STATUSES, DEV_STATUS_LABELS, DEV_STATUS_COLORS,
  DEV_PRIORITY_LABELS, DEV_PRIORITY_CLASSES,
  DEV_TASK_TYPE_LABELS, DEV_STORY_POINTS, DEV_PRIORITY_RANK,
  TYPE_ICONS, PRIORITY_DOTS, DEV_WEBHOOK_EVENTS,
  isDevTaskOverdue, fmtDeadline, hasSubtasks, isSlaBreached,
  ASSIGNEE_ROLES, selectDevProjects,
  type DevTask, type DevTaskStatus, type DevTaskPriority, type DevTaskType,
  type DevSprint, type DevWebhook, type DevWebhookDelivery, type BoardUser,
} from './devBoardTypes'
import { taskUrl, projectUrl } from '@/pages/dev/devLinks'

/**
 * «Доска разработки» — канбан задач команды разработки (Jira/Notion-стиль).
 * Drag-and-drop — нативный HTML5 DnD (без новых зависимостей), перемещение
 * уходит PATCH /dev-tracker/:id/move с оптимистичным обновлением кэша.
 */

const LIST_KEY = ['dev-tracker', 'list'] as const

// BoardUser / DEV_PRIORITY_RANK — общие из ./devBoardTypes (единый источник).

type GroupBy = 'status' | 'priority' | 'assignee'
type SortKey = 'title' | 'deadline' | 'priority' | null
type BoardView = 'board' | 'table' | 'calendar' | 'timeline'

/** WIP-лимиты колонок (только UI, localStorage 'dev-board-wip'). */
const WIP_KEY = 'dev-board-wip'
const DEFAULT_WIP: Partial<Record<DevTaskStatus, number>> = {
  in_progress: 3,
  in_review: 2,
  testing: 2,
}
/** Валидация лимитов из localStorage: только известные статусы и целые ≥0 —
 *  мусор/ручная правка вне формата отбрасываем вместо бейджа «NaN/−1». */
function sanitizeWip(parsed: unknown): Partial<Record<DevTaskStatus, number>> {
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_WIP }
  const out: Partial<Record<DevTaskStatus, number>> = {}
  for (const s of DEV_TASK_STATUSES) {
    const n = (parsed as Record<string, unknown>)[s]
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[s] = Math.floor(n)
  }
  return out
}
function loadWip(): Partial<Record<DevTaskStatus, number>> {
  try {
    const raw = localStorage.getItem(WIP_KEY)
    // Есть пользовательская конфигурация — используем только её (иначе
    // дефолтный лимит нельзя снять); без raw — дефолты модуля.
    if (raw) return sanitizeWip(JSON.parse(raw))
  } catch { /* приватный режим */ }
  return { ...DEFAULT_WIP }
}

/**
 * Колонка доски — строится динамически в зависимости от группировки.
 *  - status: заполнены `status` + `dotClass`;
 *  - priority: заполнены `priority` + `dotClass`;
 *  - assignee: заполнен `assigneeId` (null — колонка «Без исполнителя»).
 */
interface BoardColumn {
  key: string
  label: string
  dotClass?: string
  status?: DevTaskStatus
  priority?: DevTaskPriority
  assigneeId?: string | null
  tasks: DevTask[]
}


// ── Шаблоны модалки создания ────────────────────────────────────────────
// Вынесены в константы: один и тот же текст используют и segmented control
// «Пустая | Фича | Баг», и ручной выбор типа «Баг» в селекте (не дублировать).
const BUG_REPORT_TEMPLATE =
  'Что произошло:\nЧто ожидалось:\nШаги воспроизведения:\n1. \n2. \nОкружение (браузер/устройство):\n'
const FEATURE_TEMPLATE =
  'Контекст:\nЧто нужно сделать:\nКритерии приёмки:\n- [ ] \n- [ ] \n'

// ── Модалка создания задачи ───────────────────────────────────────────
function CreateTaskModal({ open, status, users, projects, initialProjectId, initialDeadline, canCreate, onClose }: {
  open: boolean
  status: DevTaskStatus
  users: BoardUser[]
  /** Проекты раздела «Разработка» для привязки задачи (/dev/projects). */
  projects: { value: string; label: string }[]
  /** Предвыбранный проект (открытие с карточки проекта или фильтра доски). */
  initialProjectId?: string
  /** При создании из календаря сюда приходит день клика (YYYY-MM-DD). */
  initialDeadline?: string
  /** Право dev-tracker.manage — без него форма не отправляется. */
  canCreate?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [taskType, setTaskType] = useState<DevTaskType>('feature')
  const [priority, setPriority] = useState<DevTaskPriority>('medium')
  const [assigneeId, setAssigneeId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [storyPoints, setStoryPoints] = useState('')
  const [deadline, setDeadline] = useState('')
  const [tags, setTags] = useState('')

  // ── Шаблон создания: «Пустая | Фича | Баг» ────────────────────────────
  // Применяем пресет только к пустым полям — уже введённое пользователем
  // не затираем. Выбор нигде не запоминаем (состояние живёт до закрытия).
  type CreateTemplate = 'empty' | 'feature' | 'bug'
  const [template, setTemplate] = useState<CreateTemplate>('empty')

  const applyTemplate = (t: CreateTemplate) => {
    setTemplate(t)
    if (t === 'empty') {
      // Сброс к дефолтам; заголовок/исполнителя/проект/дедлайн не трогаем.
      setTaskType('feature')
      setPriority('medium')
      setStoryPoints('')
      setTags('')
      setDescription('')
      return
    }
    if (t === 'feature') {
      setTaskType('feature')
      setPriority('medium')
      // Название/исполнитель/проект/дедлайн не трогаем; описание —
      // только если поле пустое (уже введённое не затираем).
      if (!description.trim()) setDescription(FEATURE_TEMPLATE)
      return
    }
    setTaskType('bug')
    setPriority('high')
    if (!description.trim()) setDescription(BUG_REPORT_TEMPLATE)
  }

  // Предвыбранный проект из фильтра/страницы проекта — подставляем при открытии.
  useEffect(() => {
    if (open && initialProjectId && !projectId) setProjectId(initialProjectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProjectId])

  // Календарь передаёт день клика как стартовый дедлайн (но не затираем
  // уже введённую дату, если модалку переоткрыли).
  useEffect(() => {
    if (open && initialDeadline && !deadline) setDeadline(initialDeadline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDeadline])

  const reset = () => {
    setTitle(''); setDescription(''); setTaskType('feature'); setPriority('medium')
    setAssigneeId(''); setProjectId(''); setStoryPoints(''); setDeadline(''); setTags('')
    setTemplate('empty')
  }

  const createMut = useMutation({
    mutationFn: (data: any) => devTrackerApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      toast.success('Задача создана')
      reset()
      onClose()
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось создать задачу'))
    },
  })

  const submit = () => {
    if (canCreate === false) { toast.error('Создавать задачи могут CEO и PM разработки'); return }
    if (!title.trim()) { toast.error('Введите название задачи'); return }
    // Клиентские лимиты до отправки: бэк режет длинные строки 400/413 —
    // лучше понятный тост, чем ошибка сервера. Лимиты щедрые (название 255,
    // описание 5000, тег 50, ссылка/файл 2000), обычные задачи не задевают.
    if (title.trim().length > 255) { toast.error('Название слишком длинное (максимум 255 символов)'); return }
    if (description.trim().length > 5000) { toast.error('Описание слишком длинное (максимум 5000 символов)'); return }
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean)
    if (tagList.length > 20) { toast.error('Слишком много тегов (максимум 20)'); return }
    if (tagList.some(t => t.length > 50)) { toast.error('Тег слишком длинный (максимум 50 символов)'); return }
    if (createMut.isPending) return
    createMut.mutate({
      title: title.trim(),
      description: description.trim() || undefined,
      status,
      priority,
      taskType,
      assigneeId: assigneeId || undefined,
      projectId: projectId || undefined,
      storyPoints: storyPoints ? Number(storyPoints) : undefined,
      deadline: deadline || undefined,
      tags: tagList,
    })
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title={`Новая задача — «${DEV_STATUS_LABELS[status]}»`}
      size="lg"
    >
      <div className="space-y-4 dev-pop-enter">
        {canCreate === false && (
          <p className="text-xs rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 px-3 py-2">
            У вас просмотр без создания — задачи ставят CEO и PM разработки. Вы можете двигать свои карточки и писать комментарии.
          </p>
        )}
        <div
          className="flex gap-1 p-1 rounded-xl bg-surface-100 dark:bg-surface-800"
          role="group"
          aria-label="Шаблон задачи"
        >
          {(
            [
              { value: 'empty', label: 'Пустая' },
              { value: 'feature', label: 'Фича' },
              { value: 'bug', label: 'Баг' },
            ] as const
          ).map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => applyTemplate(opt.value)}
              className={clsx(
                'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                template === opt.value
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <FormField label="Название" required>
          <input
            className="input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Коротко: что нужно сделать"
            autoFocus
            maxLength={255}
            aria-label="Название задачи"
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
          />
        </FormField>
        <FormField label="Описание">
          <textarea
            className="input min-h-[90px] resize-y"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Подробности, критерии приёмки, ссылки…"
            maxLength={5000}
            aria-label="Описание задачи"
          />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Тип задачи">
            <Select
              value={taskType}
              onChange={v => {
                const t = v as DevTaskType
                setTaskType(t)
                // Шаблон баг-репорта, как в Linear/Jira: выбрал «Баг» —
                // получил готовую структуру, осталось заполнить. Не затираем
                // уже набранное описание (текст — BUG_REPORT_TEMPLATE выше).
                if (t === 'bug' && !description.trim()) {
                  setDescription(BUG_REPORT_TEMPLATE)
                }
              }}
              options={(Object.keys(DEV_TASK_TYPE_LABELS) as DevTaskType[]).map(t => ({
                value: t, label: DEV_TASK_TYPE_LABELS[t],
              }))}
            />
          </FormField>
          <FormField label="Приоритет">
            <Select
              value={priority}
              onChange={v => setPriority(v as DevTaskPriority)}
              options={(Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[]).map(p => ({
                value: p, label: DEV_PRIORITY_LABELS[p],
              }))}
            />
          </FormField>
          <FormField label="Исполнитель">
            <Select
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder="Не назначен"
              options={users.map(u => ({ value: u.id, label: u.name }))}
            />
          </FormField>
          {!!projects.length && (
            <FormField label="Проект (Разработка)">
              <Select
                value={projectId}
                onChange={setProjectId}
                placeholder="Без проекта"
                options={projects}
              />
            </FormField>
          )}
          <FormField label="Story points">
            <Select
              value={storyPoints}
              onChange={setStoryPoints}
              placeholder="Не оценено"
              options={DEV_STORY_POINTS.map(sp => ({ value: String(sp), label: String(sp) }))}
            />
          </FormField>
          <FormField label="Дедлайн">
            <BoardDatePicker value={deadline} onChange={setDeadline} placeholder="Без дедлайна" />
          </FormField>
          <FormField label="Теги (через запятую)">
            <input
              className="input"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="frontend, срочно"
            />
          </FormField>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-secondary" onClick={() => { reset(); onClose() }}>Отмена</button>
          <button className="btn-primary" disabled={createMut.isPending || canCreate === false} onClick={submit} title={canCreate === false ? 'Создавать задачи могут CEO и PM разработки' : undefined}>
            {createMut.isPending ? 'Создание…' : 'Создать задачу'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Карточка задачи ───────────────────────────────────────────────────
function TaskCard({ task, dragging, onDragStart, onDragEnd, onTagClick, sprintName, onStatus }: {
  task: DevTask
  dragging: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  /** Клик по тегу toggles tagFilter доски. */
  onTagClick?: (tag: string) => void
  /** Название спринта для бейджа (маппится страницей из списка спринтов). */
  sprintName?: string | null
  /** Перемещение через PATCH /dev-tracker/:id/move (доступно и без manage). */
  onStatus?: (id: string, status: DevTaskStatus) => void
}) {
  const navigate = useNavigate()
  const typeMeta = TYPE_ICONS[task.taskType] || TYPE_ICONS.feature
  const TypeIcon = typeMeta.icon
  const overdue = isDevTaskOverdue(task)
  const sla = isSlaBreached(task)
  const blocked = !!task.isBlocked
  const blockedReason = (task.blockedReason || '').trim()
  const subtaskTotal = task.subtasksCount ?? 0
  const subtaskDone = task.subtasksDone ?? 0
  // Счётчики от бэка могут прийти строкой/NaN — ширина NaN% ломала layout.
  const safeSubTotal = typeof subtaskTotal === 'number' && Number.isFinite(subtaskTotal) && subtaskTotal >= 0 ? Math.floor(subtaskTotal) : 0
  const safeSubDone = typeof subtaskDone === 'number' && Number.isFinite(subtaskDone) && subtaskDone >= 0 ? Math.floor(subtaskDone) : 0
  const subtaskPct = safeSubTotal > 0 ? Math.min(100, Math.max(0, Math.round((safeSubDone / safeSubTotal) * 100))) : 0

  // ── «···»-меню: HTML5-DnD на таче мёртв, поэтому перемещение между
  // статусами дублируем поповером. На coarse-pointer кнопка видна всегда,
  // на desktop — только по hover/focus карточки (классы md: ниже).
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  // Позиция меню в портале: под кнопкой, вверх если внизу мало места.
  // Закрываем при скролле/ресайзе (иначе меню «отрывается» от карточки),
  // клике мимо (кнопка тоже вне меню) и Esc с возвратом фокуса.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    if (!menuOpen) { setMenuPos(null); return }
    const place = () => {
      const r = menuBtnRef.current?.getBoundingClientRect()
      if (!r) return
      const W = 208 // w-52
      const H = 400 // ~заголовок + 6 пунктов + разделитель + «Открыть»
      const up = window.innerHeight - r.bottom < H + 12 && r.top > H + 12
      setMenuPos({
        top: up ? Math.max(8, r.top - H - 4) : r.bottom + 4,
        left: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)),
      })
    }
    place()
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !menuBtnRef.current?.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onScrollResize = () => setMenuOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        // Фокус-возврат на кнопку «···» (a11y).
        menuBtnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
    }
  }, [menuOpen])
  const pickStatus = (s: DevTaskStatus) => {
    if (s !== task.status) onStatus?.(task.id, s)
    setMenuOpen(false)
    menuBtnRef.current?.focus()
  }
  const openTask = () => {
    setMenuOpen(false)
    navigate(taskUrl(task.id))
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => navigate(taskUrl(task.id))}
      className={clsx(
        'card-interactive group relative cursor-pointer p-3 space-y-2 select-none dev-lift',
        dragging && 'opacity-40',
      )}
      title="Открыть задачу"
    >
      <div className="flex items-start gap-1.5">
        <TypeIcon size={15} className={clsx('mt-2.5 shrink-0', typeMeta.className)} />
        <p className="flex-1 min-w-0 pt-2 text-sm font-medium text-surface-900 dark:text-surface-100 leading-snug break-words">
          {task.title}
        </p>
        <div className="relative shrink-0">
          <button
            ref={menuBtnRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Действия с задачей"
            title="Действия с задачей"
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            className="w-10 h-10 -mr-1 flex items-center justify-center rounded-md text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 focus:opacity-100 focus-visible:opacity-100"
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && menuPos && createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="Переместить задачу"
              style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
              className="z-[70] w-52 max-h-[min(70vh,430px)] overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-1 dev-pop-enter"
            >
              <p className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-surface-400 dark:text-surface-500">
                Переместить:
              </p>
              {onStatus && DEV_TASK_STATUSES.map(s => (
                <button
                  key={s}
                  type="button"
                  role="menuitem"
                  onClick={e => { e.stopPropagation(); pickStatus(s) }}
                  aria-current={s === task.status ? 'true' : undefined}
                  className={clsx(
                    'w-full min-h-[40px] flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                    'text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800',
                    s === task.status && 'font-semibold',
                  )}
                >
                  <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', DEV_STATUS_COLORS[s])} />
                  <span className="flex-1 truncate">{DEV_STATUS_LABELS[s]}</span>
                  {s === task.status && <Check size={14} className="shrink-0 text-primary-500" />}
                </button>
              ))}
              <div className="my-1 border-t border-surface-100 dark:border-surface-800" />
              <button
                type="button"
                role="menuitem"
                onClick={e => { e.stopPropagation(); openTask() }}
                className="w-full min-h-[40px] flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              >
                Открыть
              </button>
            </div>,
            document.body,
          )}
        </div>
      </div>

      {/* Проект задачи — связка с /dev/projects: клик открывает проект. */}
      {task.project && (
        <span
          onClick={e => { e.stopPropagation(); navigate(projectUrl(task.project!.id)) }}
          className="inline-flex items-center gap-1 max-w-full text-[10px] px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-900/25 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors cursor-pointer"
          title={`Проект: ${task.project.name}`}
        >
          <Folder size={10} className="shrink-0" />
          <span className="truncate">{task.project.name}</span>
        </span>
      )}

      {/* Блокер / SLA / спринт — красные бейджи поверх карточки. */}
      {(blocked || sla || sprintName) && (
        <div className="flex flex-wrap items-center gap-1">
          {blocked && (
            <span
              className="inline-flex items-center gap-1 max-w-full text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
              title={blockedReason ? `Заблокирована: ${blockedReason}` : 'Задача заблокирована'}
            >
              <span className="shrink-0">⛔</span>
              <span className="truncate">{blockedReason || 'Блокер'}</span>
            </span>
          )}
          {sla && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300"
              title="Просрочен SLA: откройте задачу и ускорьте решение"
            >
              🔥 SLA
            </span>
          )}
          {sprintName && (
            <span
              className="inline-flex items-center gap-1 max-w-full text-[10px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300"
              title={`Спринт: ${sprintName}`}
            >
              <span className="truncate">{sprintName}</span>
            </span>
          )}
        </div>
      )}

      {!!(Array.isArray(task.tags) && task.tags.length) && (
        <div className="flex flex-wrap gap-1">
          {task.tags.map(tag => (
            <button
              key={String(tag)}
              type="button"
              onClick={e => { e.stopPropagation(); onTagClick?.(tag) }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900/40 dark:hover:text-primary-300 transition-colors cursor-pointer"
              title={`Фильтр по тегу: ${tag}`}
            >
              {String(tag)}
            </button>
          ))}
        </div>
      )}

      {hasSubtasks(task) && (
        <div className="flex items-center gap-2" title="Прогресс подзадач">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckSquare size={11} />
            {safeSubDone}/{safeSubTotal}
          </span>
          <div className="h-1 flex-1 max-w-[120px] rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${subtaskPct}%` }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', DEV_PRIORITY_CLASSES[task.priority] || DEV_PRIORITY_CLASSES.medium)}>
          {DEV_PRIORITY_LABELS[task.priority] || task.priority}
        </span>
        {task.storyPoints != null && (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400"
            title="Story points"
          >
            {task.storyPoints} SP
          </span>
        )}
        {task.deadline && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-[10px] font-medium',
              overdue ? 'text-red-600 dark:text-red-400' : 'text-surface-500 dark:text-surface-400',
            )}
            title={overdue ? 'Дедлайн просрочен' : 'Дедлайн'}
          >
            <CalendarDays size={11} />
            {fmtDeadline(task.deadline)}
          </span>
        )}
        {task.assignee && (
          <span className="ml-auto inline-flex items-center gap-1.5 min-w-0">
            <Avatar name={String(task.assignee.name ?? '?')} src={task.assignee.avatarUrl || task.assignee.avatar || undefined} size={20} zoomable={false} />
            <span className="text-[11px] text-surface-500 dark:text-surface-400 truncate max-w-[90px]">
              {String(task.assignee.name ?? '—').split(' ')[0]}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

// ── Быстрое добавление задачи (inline, Notion-стиль) ──────────────────
/** Поле «Новая задача…»: Enter создаёт задачу, поле очищается и сохраняет
 *  фокус — так можно быстро добавить несколько задач подряд. */
function QuickAdd({ placeholder, onSubmit, disabled }: {
  placeholder: string
  onSubmit: (title: string) => void
  /** Пока летит create — ввод блокируем: двойной Enter до ре-рендера
   *  иначе дублировал задачу (submit читал stale value). */
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const submit = () => {
    if (disabled) return
    const v = value.trim()
    if (!v) return
    // Клиентский лимит до отправки (как в модалке создания).
    if (v.length > 255) return
    onSubmit(v)
    setValue('')
    // Фокус возвращаем после перерисовки — пользователь вводит дальше.
    requestAnimationFrame(() => ref.current?.focus())
  }
  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
      className="input !py-1.5 !min-h-[40px] text-sm"
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={255}
      disabled={disabled}
    />
  )
}

// ── Заголовок таблицы с сортировкой ───────────────────────────────────
function SortHeader({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 font-medium text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
    >
      {label}
      {active && (dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
    </button>
  )
}
// ── Таблица задач (Notion database table) ─────────────────────────────
/** Строки-задачи: статус меняется через /move (доступен всем), остальные
 *  поля — обычным PATCH (только dev-tracker.manage). Подзадачи — с отступом
 *  и стрелкой вниз сразу под родителем. */
function TasksTable({ rows, users, canManage, sortKey, sortDir, onToggleSort, onStatus, onUpdate, onOpen, onQuickAdd, quickAddPending, selected, onToggle, onToggleAll, allTopIds, onTagClick }: {
  rows: { task: DevTask; isSub: boolean }[]
  users: BoardUser[]
  canManage: boolean
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onToggleSort: (k: Exclude<SortKey, null>) => void
  onStatus: (id: string, status: DevTaskStatus) => void
  onUpdate: (id: string, data: any) => void
  onOpen: (id: string) => void
  onQuickAdd: (title: string) => void
  /** Летит quick-add — блокируем повторный Enter (дубли задач). */
  quickAddPending?: boolean
  /** Bulk-выделение (Notion-стиль): чекбоксы у задач верхнего уровня. */
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  allTopIds: string[]
  /** Клик по тегу toggles tagFilter доски. */
  onTagClick?: (tag: string) => void
}) {
  const statusOptions = DEV_TASK_STATUSES.map(s => ({ value: s, label: DEV_STATUS_LABELS[s] }))
  const priorityOptions = (Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[])
    .map(p => ({ value: p, label: DEV_PRIORITY_LABELS[p] }))
  const assigneeOptions = users.map(u => ({ value: u.id, label: u.name }))
  const th = 'px-3 py-2.5 text-xs whitespace-nowrap'
  const allSelected = allTopIds.length > 0 && allTopIds.every(id => selected.has(id))

  return (
    <>
      {/* Desktop: широкая таблица. На mobile вместо неё карточки ниже —
          920px в 360px не влезают и колонки обрезаются. */}
      <div className="hidden md:block card !p-0 overflow-x-auto min-h-0 flex-1">
      <table className="w-full text-sm border-collapse min-w-[920px]">
        <thead className="sticky top-0 z-20 bg-surface-50 dark:bg-surface-800">
          <tr className="border-b border-surface-200 dark:border-surface-800 text-left">
            {canManage && (
              <th className="px-2 w-9 sticky left-0 z-10 bg-surface-50 dark:bg-surface-800">
                <input
                  type="checkbox"
                  className="w-5 h-5 cursor-pointer accent-primary-600"
                  checked={allSelected}
                  onChange={onToggleAll}
                  title={allSelected ? 'Снять выделение' : 'Выделить все'}
                  aria-label={allSelected ? 'Снять выделение' : 'Выделить все'}
                />
              </th>
            )}
            <th className={clsx(th, 'sticky z-10 bg-surface-50 dark:bg-surface-800', canManage ? 'left-9' : 'left-0')}>
              <SortHeader label="Название" active={sortKey === 'title'} dir={sortDir} onClick={() => onToggleSort('title')} />
            </th>
            <th className={clsx(th, 'font-medium text-surface-500 dark:text-surface-400')}>Статус</th>
            <th className={th}>
              <SortHeader label="Приоритет" active={sortKey === 'priority'} dir={sortDir} onClick={() => onToggleSort('priority')} />
            </th>
            <th className={clsx(th, 'font-medium text-surface-500 dark:text-surface-400')}>Исполнитель</th>
            <th className={th}>
              <SortHeader label="Дедлайн" active={sortKey === 'deadline'} dir={sortDir} onClick={() => onToggleSort('deadline')} />
            </th>
            <th className={clsx(th, 'font-medium text-surface-500 dark:text-surface-400 text-center')}>SP</th>
            <th className={clsx(th, 'font-medium text-surface-500 dark:text-surface-400')}>Теги</th>
          </tr>
        </thead>
        <tbody>
          {canManage && (
            <tr className="border-b border-surface-100 dark:border-surface-800/60">
              <td className="px-3 py-2" colSpan={canManage ? 8 : 7}>
                <QuickAdd placeholder="+ Новая задача" onSubmit={onQuickAdd} disabled={quickAddPending} />
              </td>
            </tr>
          )}
          {rows.map(({ task, isSub }) => {
            const overdue = isDevTaskOverdue(task)
            const sla = isSlaBreached(task)
            const blocked = !!(task as DevTask).isBlocked
            const blockedReason = String((task as DevTask).blockedReason || '').trim()
            const deadlineHot = overdue || sla
            return (
              <tr
                key={task.id}
                className={clsx(
                  'border-b border-surface-100 dark:border-surface-800/60 hover:bg-surface-50 dark:hover:bg-surface-800/40 transition-colors',
                  !isSub && selected.has(task.id) && 'bg-primary-50/60 dark:bg-primary-900/20',
                )}
              >
                {canManage && (
                  <td className={clsx('px-2 w-9 sticky left-0 z-10', !isSub && selected.has(task.id) ? 'bg-primary-50 dark:bg-primary-900/30' : 'bg-surface-50 dark:bg-surface-800')}>
                    {!isSub && (
                      <input
                        type="checkbox"
                        className="w-5 h-5 cursor-pointer accent-primary-600"
                        checked={selected.has(task.id)}
                        onChange={() => onToggle(task.id)}
                        aria-label="Выбрать задачу"
                        title={task.title}
                      />
                    )}
                  </td>
                )}
                <td className={clsx('px-3 py-1.5 max-w-[340px] sticky z-10', canManage ? 'left-9' : 'left-0', !isSub && selected.has(task.id) ? 'bg-primary-50 dark:bg-primary-900/30' : 'bg-surface-50 dark:bg-surface-800')}>
                  <div className={clsx('flex items-center gap-1.5 min-w-0', isSub && 'pl-5')}>
                    {isSub && <span className="text-surface-400 shrink-0">↳</span>}
                    <button
                      onClick={() => onOpen(task.id)}
                      className="text-left font-medium text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400 truncate"
                      title={task.title}
                    >
                      {task.title}
                    </button>
                    {hasSubtasks(task) && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">
                        ☑ {task.subtasksDone ?? 0}/{task.subtasksCount ?? 0}
                      </span>
                    )}
                    {blocked && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 shrink-0 max-w-[180px] truncate"
                        title={blockedReason ? `Заблокирована: ${blockedReason}` : 'Задача заблокирована'}
                      >
                        ⛔ {blockedReason || 'Блокер'}
                      </span>
                    )}
                    {sla && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 shrink-0"
                        title="Просрочен SLA"
                      >
                        🔥 SLA
                      </span>
                    )}
                  </div>
                  {/* Проект «Разработка» — под названием, ссылкой на проект. */}
                  {task.project && (
                    <Link
                      to={projectUrl(task.project.id)}
                      className="inline-flex items-center gap-1 mt-0.5 text-[10px] text-sky-600 dark:text-sky-400 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      <Folder size={10} /> {task.project.name}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-1.5 w-40">
                  <Select value={task.status} onChange={v => onStatus(task.id, v as DevTaskStatus)}
                    options={statusOptions} className="!py-1 text-xs" />
                </td>
                <td className="px-3 py-1.5 w-36">
                  {canManage ? (
                    <Select value={task.priority} onChange={v => onUpdate(task.id, { priority: v })}
                      options={priorityOptions} className="!py-1 text-xs" />
                  ) : (
                    <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', DEV_PRIORITY_CLASSES[task.priority] || DEV_PRIORITY_CLASSES.medium)}>
                      {DEV_PRIORITY_LABELS[task.priority] || task.priority}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 w-44">
                  {canManage ? (
                    <Select value={task.assigneeId || ''} onChange={v => onUpdate(task.id, { assigneeId: v || null })}
                      placeholder="Не назначен" options={assigneeOptions} className="!py-1 text-xs" />
                  ) : task.assignee ? (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Avatar name={task.assignee.name} src={task.assignee.avatarUrl || task.assignee.avatar || undefined} size={20} zoomable={false} />
                      <span className="text-xs text-surface-600 dark:text-surface-300 truncate">{task.assignee.name}</span>
                    </span>
                  ) : (
                    <span className="text-xs text-surface-400">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 w-40">
                  {canManage ? (
                    <div title={sla && !overdue ? 'Просрочен SLA' : undefined}>
                      <BoardDatePicker small
                        value={task.deadline ? task.deadline.slice(0, 10) : ''}
                        onChange={v => onUpdate(task.id, { deadline: v || null })}
                        placeholder="—"
                        className={clsx(deadlineHot && '[&>button]:!text-red-600 dark:[&>button]:!text-red-400 [&>button]:!border-red-300 dark:[&>button]:!border-red-800')}
                      />
                    </div>
                  ) : task.deadline ? (
                    <span className={clsx('inline-flex items-center gap-1 text-xs', deadlineHot ? 'text-red-600 dark:text-red-400 font-medium' : 'text-surface-500 dark:text-surface-400')}>
                      <CalendarDays size={11} /> {fmtDeadline(task.deadline)}
                    </span>
                  ) : (
                    sla ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400" title="Просрочен SLA (возраст задачи больше порога)">
                        🔥 SLA
                      </span>
                    ) : (
                      <span className="text-xs text-surface-400">—</span>
                    )
                  )}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {task.storyPoints != null
                    ? <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">{task.storyPoints}</span>
                    : <span className="text-xs text-surface-400">—</span>}
                </td>
                <td className="px-3 py-1.5">
                  {Array.isArray(task.tags) && task.tags.length ? (
                    <div className="flex flex-wrap gap-1">
                      {task.tags.map(tag => (
                        <button
                          key={String(tag)}
                          type="button"
                          onClick={() => onTagClick?.(tag)}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400 hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-900/40 dark:hover:text-primary-300 transition-colors cursor-pointer"
                          title={`Фильтр по тегу: ${tag}`}
                        >
                          {String(tag)}
                        </button>
                      ))}
                    </div>
                  ) : <span className="text-xs text-surface-400">—</span>}
                </td>
              </tr>
            )
          })}
          {!rows.length && (
            <tr>
              <td colSpan={canManage ? 8 : 7} className="px-3 py-10 text-center text-sm text-surface-400 dark:text-surface-500">Задач нет</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      {/* Mobile: компактные карточки вместо широкой таблицы — всё видно
          без горизонтального скролла: название, статус, приоритет,
          исполнитель, дедлайн, SP, теги. Статус меняется тем же /move. */}
      <div className="md:hidden card !p-2 min-h-0 flex-1 space-y-2">
        {canManage && (
          <QuickAdd placeholder="+ Новая задача" onSubmit={onQuickAdd} disabled={quickAddPending} />
        )}
        {rows.map(({ task, isSub }) => {
          const overdue = isDevTaskOverdue(task)
          const sla = isSlaBreached(task)
          return (
            <div
              key={task.id}
              className={clsx(
                'rounded-lg border border-surface-200 dark:border-surface-700/60 px-3 py-2.5',
                !isSub && selected.has(task.id) && 'border-primary-500 dark:border-primary-400 bg-primary-50/60 dark:bg-primary-900/20',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                {canManage && !isSub && (
                  // Чекбокс 20px сам по себе мимо нормы тапов 40px — оборачиваем
                  // в 40px хит-зону без сдвига layout (отрицательный отступ).
                  <span className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] -ml-2 shrink-0">
                  <input
                    type="checkbox"
                    className="w-5 h-5 cursor-pointer accent-primary-600"
                    checked={selected.has(task.id)}
                    onChange={() => onToggle(task.id)}
                    aria-label={`Выбрать задачу «${task.title}»`}
                  />
                  </span>
                )}
                {isSub && <span className="text-surface-400 shrink-0">↳</span>}
                <button
                  onClick={() => onOpen(task.id)}
                  className="flex-1 min-w-0 text-left font-medium text-sm text-surface-800 dark:text-surface-200 truncate"
                  title={task.title}
                >
                  {task.title}
                </button>
                {hasSubtasks(task) && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">
                    ☑ {task.subtasksDone ?? 0}/{task.subtasksCount ?? 0}
                  </span>
                )}
              </div>
              {task.project && (
                <Link
                  to={projectUrl(task.project.id)}
                  className="inline-flex items-center gap-1 mt-1 max-w-full text-[10px] text-sky-600 dark:text-sky-400"
                  onClick={e => e.stopPropagation()}
                >
                  <Folder size={10} className="shrink-0" />
                  <span className="truncate">{task.project.name}</span>
                </Link>
              )}
              <div className="mt-2 flex gap-2">
                <div className="flex-1 min-w-0">
                  <Select
                    value={task.status}
                    onChange={v => onStatus(task.id, v as DevTaskStatus)}
                    options={statusOptions}
                    className="!py-1.5 text-xs"
                  />
                </div>
                <div className="w-28 shrink-0">
                  {canManage ? (
                    <Select
                      value={task.priority}
                      onChange={v => onUpdate(task.id, { priority: v })}
                      options={priorityOptions}
                      className="!py-1.5 text-xs"
                    />
                  ) : (
                    <span className={clsx('inline-flex items-center text-[10px] font-semibold px-1.5 py-1 rounded', DEV_PRIORITY_CLASSES[task.priority] || DEV_PRIORITY_CLASSES.medium)}>
                      {DEV_PRIORITY_LABELS[task.priority] || task.priority}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-surface-500 dark:text-surface-400">
                {task.isBlocked && (
                  <span
                    className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400"
                    title={task.blockedReason || 'Блокер'}
                  >
                    ⛔ <span className="max-w-[140px] truncate">{task.blockedReason || 'Блокер'}</span>
                  </span>
                )}
                {sla && (
                  <span title="Просрочен SLA: откройте задачу и ускорьте решение">
                    🔥
                  </span>
                )}
                {task.assignee ? (
                  <span className="inline-flex items-center gap-1.5 min-w-0">
                    <Avatar name={String(task.assignee.name ?? '?')} src={task.assignee.avatarUrl || task.assignee.avatar || undefined} size={18} zoomable={false} />
                    <span className="truncate max-w-[120px]">{String(task.assignee.name ?? '—')}</span>
                  </span>
                ) : (
                  <span className="text-surface-400">Без исполнителя</span>
                )}
                {task.deadline ? (
                  <span className={clsx('inline-flex items-center gap-1 tabular-nums', (overdue || sla) && 'text-red-600 dark:text-red-400 font-medium')}>
                    <CalendarDays size={11} /> {fmtDeadline(task.deadline)}
                  </span>
                ) : null}
                {task.storyPoints != null && (
                  <span className="font-semibold text-primary-600 dark:text-primary-400 tabular-nums">
                    SP {task.storyPoints}
                  </span>
                )}
              </div>
              {!!(Array.isArray(task.tags) && task.tags.length) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {task.tags.map(tag => (
                    <button
                      key={String(tag)}
                      type="button"
                      onClick={() => onTagClick?.(tag)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400"
                      title={`Фильтр по тегу: ${tag}`}
                    >
                      {String(tag)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {!rows.length && (
          <p className="px-3 py-10 text-center text-sm text-surface-400 dark:text-surface-500">Задач нет</p>
        )}
      </div>
    </>
  )
}
// ── Повестка недели (mobile agenda для календаря) ─────────────────────
/** Мобильная замена месячной сетки: 7 колонок на 360px нечитаемы, поэтому
 *  показываем список 7 дней текущей недели (день + до 3 пилюль + «+N»).
 *  Группировку берёт из пропса byDay (считает MonthCalendar — без дубля
 *  логики), создание — через тот же onCreateAt с canManage-guard. */
function WeekAgenda({ byDay, onOpen, onCreateAt, canCreate, className = 'md:hidden' }: {
  byDay: Map<string, DevTask[]>
  onOpen: (id: string) => void
  onCreateAt: (dateISO: string) => void
  canCreate?: boolean
  /** Видимость: по умолчанию только mobile (мат-календарь показывает
   *  повестку и на десктопе в режиме «Неделя» — тогда передаём 'hidden md:block'). */
  className?: string
}) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [expandedDay, setExpandedDay] = useState<string | null>(null)

  const days = useMemo(() => {
    const today = new Date()
    const dow = (today.getDay() + 6) % 7 // Пн = 0
    const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - dow + weekOffset * 7)
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return { date: d, key }
    })
  }, [weekOffset])

  const todayKey = useMemo(() => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }, [])

  const first = days[0]?.date
  const last = days[6]?.date
  const weekLabel = first && last
    ? first.getMonth() === last.getMonth()
      ? `${first.getDate()}–${last.getDate()} ${last.toLocaleDateString('ru-RU', { month: 'long' })}`
      : `${first.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`
    : ''

  const navBtn = 'min-w-[40px] min-h-[40px] flex items-center justify-center rounded-md text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors'

  return (
    <div className={clsx('card min-h-0 flex-1', className)}>
      <div className="flex items-center gap-1 mb-2">
        <button className={navBtn} onClick={() => setWeekOffset(o => o - 1)} title="Предыдущая неделя" aria-label="Предыдущая неделя">
          <ChevronLeft size={18} />
        </button>
        <span className="flex-1 text-center text-sm font-semibold text-surface-800 dark:text-surface-200 capitalize">
          {weekLabel}
        </span>
        <button
          className="min-h-[40px] px-2 rounded-md text-xs text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          onClick={() => { setWeekOffset(0); setExpandedDay(null) }}
        >
          Сегодня
        </button>
        <button className={navBtn} onClick={() => setWeekOffset(o => o + 1)} title="Следующая неделя" aria-label="Следующая неделя">
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="space-y-2">
        {days.map(({ date, key }) => {
          const dayTasks = byDay.get(key) || []
          const isToday = key === todayKey
          const isExpanded = expandedDay === key
          const visibleTasks = isExpanded || dayTasks.length <= 3 ? dayTasks : dayTasks.slice(0, 3)
          const hiddenCount = dayTasks.length - visibleTasks.length
          return (
            <div
              key={key}
              className={clsx(
                'rounded-lg border border-surface-200 dark:border-surface-700/60 px-2.5 py-2',
                isToday && 'border-primary-500 dark:border-primary-400',
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedDay(isExpanded ? null : key)}
                  aria-expanded={isExpanded}
                  className="flex-1 min-h-[40px] flex items-center gap-2 text-left"
                  title={dayTasks.length > 3 ? (isExpanded ? 'Свернуть день' : 'Показать все задачи дня') : undefined}
                >
                  <span
                    className={clsx(
                      'text-xs font-semibold tabular-nums capitalize',
                      isToday ? 'text-primary-600 dark:text-primary-400' : 'text-surface-700 dark:text-surface-300',
                    )}
                  >
                    {date.toLocaleDateString('ru-RU', { weekday: 'short' })}, {date.getDate()}.{String(date.getMonth() + 1).padStart(2, '0')}
                  </span>
                  {isToday && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-600 text-white">
                      Сегодня
                    </span>
                  )}
                  <span className="text-[11px] text-surface-400 dark:text-surface-500 tabular-nums">
                    {dayTasks.length ? `· ${dayTasks.length}` : '· пусто'}
                  </span>
                </button>
                {canCreate !== false && (
                  <button
                    type="button"
                    onClick={() => onCreateAt(key)}
                    title="Задача на этот день"
                    aria-label={`Создать задачу на ${key}`}
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-md text-surface-400 hover:text-primary-500 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors shrink-0"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {!!visibleTasks.length && (
                <div className="mt-1.5 space-y-1">
                  {visibleTasks.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className={clsx(
                        'w-full min-h-[40px] flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded transition-colors',
                        t.status === 'done'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 line-through'
                          : isDevTaskOverdue(t)
                            ? 'bg-red-50 dark:bg-red-900/25 text-red-700 dark:text-red-400 font-medium'
                            : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300',
                      )}
                      title={t.title}
                    >
                      <span className={clsx('w-2 h-2 rounded-full shrink-0', DEV_STATUS_COLORS[t.status])} />
                      <span className="flex-1 truncate">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedDay(key)}
                  className="mt-1 min-h-[40px] px-1 text-xs text-primary-600 dark:text-primary-400 hover:underline text-left"
                >
                  +{hiddenCount} ещё
                </button>
              )}
              {isExpanded && dayTasks.length > 3 && (
                <button
                  type="button"
                  onClick={() => setExpandedDay(null)}
                  className="mt-1 min-h-[40px] px-1 text-xs text-surface-400 hover:underline text-left"
                >
                  Свернуть
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Календарь задач (Notion calendar view) ─────────────────────────────
/** Месячная сетка по дедлайнам. Клик по задаче — карточка, клик по дню —
 *  создание задачи с дедлайном в этот день. Подзадачи не показываем —
 *  как на доске (они видны в карточке родителя). */
function MonthCalendar({ tasks, onOpen, onCreateAt, canCreate, onDeadDrop }: {
  tasks: DevTask[]
  onOpen: (id: string) => void
  onCreateAt: (dateISO: string) => void
  canCreate?: boolean
  /** DnD пилюли задачи на дату: страница сохраняет через updateField (canManage-guard внутри). */
  onDeadDrop?: (id: string, dateISO: string) => void
}) {
  const [monthOffset, setMonthOffset] = useState(0)
  const today = new Date()
  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)

  const year = base.getFullYear()
  const month = base.getMonth()
  const monthLabel = base.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })

  // Задачи по дням (дедлайн без учёта времени). Группируем ВСЕ задачи
  // с deadline — без месячного префикс-фильтра, чтобы серые хвосты
  // соседнего месяца тоже показывали свои задачи.
  const byDay = useMemo(() => {
    const map = new Map<string, DevTask[]>()
    for (const t of tasks) {
      if (!t.deadline) continue
      const key = String(t.deadline).slice(0, 10)
      const list = map.get(key) || []
      list.push(t)
      map.set(key, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    }
    return map
  }, [tasks])

  // Сетка: начиная с понедельника, 6 недель (42 ячейки) — стабильная высота.
  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const shift = (first.getDay() + 6) % 7 // Пн = 0
    const start = new Date(year, month, 1 - shift)
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return { date: d, key, inMonth: d.getMonth() === month }
    })
  }, [year, month])

  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const navBtn = 'p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors'

  // Режим «Месяц / Неделя» как в мат-календаре: неделя — та же повестка,
  // что на мобилке, но во всю ширину десктопа (группировка byDay общая).
  const [calMode, setCalMode] = useState<'month' | 'week'>(() => {
    try { return localStorage.getItem('dev-board-cal-mode') === 'week' ? 'week' : 'month' } catch { return 'month' }
  })
  const changeCalMode = (m: 'month' | 'week') => {
    setCalMode(m)
    try { localStorage.setItem('dev-board-cal-mode', m) } catch { /* приватный режим */ }
  }

  // Desktop-сетка не трогаем (hidden на mobile), на mobile — повестка
  // недели WeekAgenda с тем же byDay (без дублирования группировки).
  return (
    <>
      <WeekAgenda byDay={byDay} onOpen={onOpen} onCreateAt={onCreateAt} canCreate={canCreate} />
      {/* Desktop-сетка в стиле мат-календаря (/calendar): без «рамки в рамке» —
          дни — отдельные скруглённые карточки, шапка дней — plain-текст.
          Виджеты наши (пилюли, +N, DnD, +) — без изменений. */}
      <div className="min-h-0 flex-1 hidden md:flex flex-col">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-sm font-semibold text-surface-800 dark:text-surface-200 capitalize">
          {monthLabel}
        </span>
        <div className="flex-1" />
        <div
          className="inline-flex items-center rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-0.5"
          role="tablist"
          aria-label="Режим календаря"
        >
          {([
            { v: 'month' as const, label: 'Месяц' },
            { v: 'week' as const, label: 'Неделя' },
          ]).map(({ v, label }) => (
            <button
              key={v}
              role="tab"
              aria-selected={calMode === v}
              onClick={() => changeCalMode(v)}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-md transition-colors',
                calMode === v
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button className={navBtn} onClick={() => setMonthOffset(o => o - 1)} title="Предыдущий месяц" aria-label="Предыдущий месяц"><ChevronLeft size={16} /></button>
        <button
          className="text-xs px-2 py-1 rounded-md text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
          onClick={() => setMonthOffset(0)}
        >
          Сегодня
        </button>
        <button className={navBtn} onClick={() => setMonthOffset(o => o + 1)} title="Следующий месяц" aria-label="Следующий месяц"><ChevronRight size={16} /></button>
      </div>

      {calMode === 'week' ? (
        <WeekAgenda
          byDay={byDay}
          onOpen={onOpen}
          onCreateAt={onCreateAt}
          canCreate={canCreate}
          className="hidden md:block"
        />
      ) : (
      <>
      <div className="grid grid-cols-7 gap-2 mb-2 px-1">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => (
          <div key={d} className="text-xs font-medium text-surface-400 dark:text-surface-500 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map(({ date, key, inMonth }) => {
          const dayTasks = byDay.get(key) || []
          const isToday = key === todayKey
          return (
            <div
              key={key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
              onDrop={e => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain')
                if (id && onDeadDrop) onDeadDrop(id, key)
              }}
              className={clsx(
                'min-h-[104px] rounded-2xl border p-2.5 transition-all group flex flex-col',
                inMonth
                  ? 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700'
                  : 'bg-surface-50/60 dark:bg-surface-900/40 border-surface-200/70 dark:border-surface-700/50 opacity-55',
                isToday && 'border-primary-500 dark:border-primary-400',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={clsx(
                    'text-sm leading-none tabular-nums',
                    isToday
                      ? 'text-primary-600 dark:text-primary-400 font-bold'
                      : inMonth
                        ? 'text-surface-700 dark:text-surface-200 font-medium'
                        : 'text-surface-400 dark:text-surface-500',
                  )}
                >
                  {date.getDate()}
                </span>
                {inMonth && canCreate !== false && (
                  <button
                    className="flex items-center gap-0.5 text-[10px] text-primary-600 dark:text-primary-400 opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100 transition-opacity font-medium"
                    title="Задача на этот день"
                    aria-label={`Создать задачу на ${key}`}
                    onClick={() => onCreateAt(key)}
                  >
                    <Plus size={12} /> создать
                  </button>
                )}
              </div>
              {/* Как в мат-календаре: все задачи дня сразу, без «+N ещё» —
                  ячейка тянется по высоте под содержимое. */}
              {dayTasks.length > 0 && (
                <div className="space-y-1 mt-1">
                  {dayTasks.map(t => (
                    <button
                      key={t.id}
                      draggable={canCreate !== false}
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', t.id)
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={() => onOpen(t.id)}
                  className={clsx(
                    'text-left text-[11px] px-1.5 py-1 rounded truncate w-full transition-colors cursor-grab active:cursor-grabbing dev-lift',
                        t.status === 'done'
                          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 line-through'
                          : isDevTaskOverdue(t)
                            ? 'bg-red-50 dark:bg-red-900/25 text-red-700 dark:text-red-400 font-medium'
                            : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700',
                      )}
                      title={`${t.title} (перетащите на дату, чтобы сменить дедлайн)`}
                    >
                  {t.title}
                </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </>
      )}
      </div>
    </>
  )
}

// ── Страница доски ────────────────────────────────────────────────────
// ── ⌘K быстрый поиск задач ───────────────────────────────────────────
// Палитра-команд: фильтр по названию по мере ввода (максимум 8),
// стрелки вверх/вниз и Enter для выбора, Esc закрывает (обрабатывает Modal).
// Slash-команды (префикс `>` или `/`):
//   `>create <название> [@имя] [#тег...]` — создать задачу
//   `/done <текст>` — перенести top-1 совпадения в «Готово»
//   `/move <статус> <текст>` — перенести top-1 совпадения в статус
//   `/assign @имя <текст>` — назначить top-1 совпадению исполнителя
function searchTasksByText(tasks: DevTask[], text: string): DevTask[] {
  const query = String(text ?? '').trim().toLowerCase()
  if (!query) return []
  return tasks.filter(t => {
    if (!t || typeof t !== 'object') return false
    const tags = Array.isArray(t.tags) ? t.tags.join(' ') : ''
    const hay = [
      t.title ?? '',
      t.description ?? '',
      tags,
      t.assignee?.name ?? '',
    ].join(' ').toLowerCase()
    return hay.includes(query)
  })
}

/** Матчинг токена статуса: англ. ключ или русская подпись. */
function matchSlashStatus(token: string): DevTaskStatus | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  for (const s of DEV_TASK_STATUSES) {
    if (s === t) return s
  }
  for (const s of DEV_TASK_STATUSES) {
    if ((DEV_STATUS_LABELS[s] || '').toLowerCase() === t) return s
  }
  // Короткие алиасы на всякий случай.
  const alias: Record<string, DevTaskStatus> = {
    review: 'in_review', test: 'testing', backlog: 'backlog', todo: 'todo',
    progress: 'in_progress', done: 'done',
  }
  return alias[t] || null
}

function findUserByName(users: BoardUser[], name: string): BoardUser | undefined {
  const q = String(name ?? '').trim().toLowerCase()
  if (!q) return undefined
  return users.find(u => u && String(u.name ?? '').toLowerCase().includes(q))
}

/**
 * Выделяет @исполнителя из тела `>create`: имя может быть из нескольких слов,
 * остаток слов возвращается в запрос/заголовок (longest-prefix по справочнику).
 * Не нашли даже префикс — возвращаем nameError, запрос не трогаем.
 */
function splitCreateAssignee(users: BoardUser[], withoutTags: string): {
  query: string
  assigneeId: string | null
  nameError: string | null
} {
  const atMatch = withoutTags.match(/@([^\n]+)/)
  if (!atMatch) return { query: withoutTags, assigneeId: null, nameError: null }
  const namePart = atMatch[1].trim()
  const atIdx = withoutTags.indexOf(atMatch[0])
  const before = withoutTags.slice(0, atIdx)
  const after = withoutTags.slice(atIdx + atMatch[0].length)
  let found = findUserByName(users, namePart)
  let matched = namePart
  if (!found) {
    const words = namePart.split(/\s+/).filter(Boolean)
    for (let len = words.length - 1; len >= 1 && !found; len--) {
      const cand = words.slice(0, len).join(' ')
      const f = findUserByName(users, cand)
      if (f) { found = f; matched = cand }
    }
  }
  if (!found) return { query: withoutTags, assigneeId: null, nameError: namePart }
  const rest = namePart.slice(matched.length).trim()
  return { query: `${before} ${rest} ${after}`, assigneeId: found.id, nameError: null }
}

function QuickSearchModal({ open, tasks, users, canManage, onClose, onPick, onCreateCommand, onMoveCommand, onAssignCommand }: {
  open: boolean
  tasks: DevTask[]
  users: BoardUser[]
  canManage?: boolean
  onClose: () => void
  onPick: (id: string) => void
  /** Slash: создать задачу (страница дёргает create + тосты). */
  onCreateCommand: (title: string, assigneeId: string | null, tags: string[]) => void
  /** Slash: перенести задачу (идёт через /move — доступен и без manage). */
  onMoveCommand: (id: string, status: DevTaskStatus) => void
  /** Slash: назначить исполнителя (только manage). */
  onAssignCommand: (id: string, assigneeId: string) => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [slashError, setSlashError] = useState<string | null>(null)

  const isSlash = q.startsWith('>') || q.startsWith('/')

  const results = useMemo(() => {
    if (isSlash) {
      // В slash-режиме показываем превью цели команды.
      const body = q.slice(1).trim()
      const low = body.toLowerCase()
      if (q.startsWith('>')) {
        const rest = body.replace(/^create\s+/i, '')
        const withoutTagsPrev = rest.replace(/#\S+/g, ' ')
        const { query: prevQuery } = splitCreateAssignee(users, withoutTagsPrev)
        return searchTasksByText(tasks, prevQuery).slice(0, 3)
      }
      if (low.startsWith('done')) return searchTasksByText(tasks, body.slice(4)).slice(0, 3)
      if (low.startsWith('move')) {
        const parts = body.slice(4).trim().split(/\s+/)
        parts.shift()
        return searchTasksByText(tasks, parts.join(' ')).slice(0, 3)
      }
      if (low.startsWith('assign')) {
        const rest = body.slice(6).trim().split(/\s+/).filter(Boolean)
        if (rest.length && rest[0].startsWith('@')) {
          let skip = 1
          if (rest.length >= 2) {
            const two = `${rest[0].slice(1)} ${rest[1]}`.toLowerCase()
            if (users.some(u => u.name.toLowerCase().includes(two))) skip = 2
          }
          return searchTasksByText(tasks, rest.slice(skip).join(' ')).slice(0, 3)
        }
        return searchTasksByText(tasks, rest.join(' ')).slice(0, 3)
      }
      return searchTasksByText(tasks, body).slice(0, 3)
    }
    const query = q.trim().toLowerCase()
    // Пустой запрос: первые 8 валидных задач (битые null-элементы от бэка отсекаем —
    // иначе рендер t.title ронял палитру).
    if (!query) return tasks.filter((t): t is DevTask => t != null && typeof t === 'object').slice(0, 8)
    return tasks.filter(t => {
      if (!t || typeof t !== 'object') return false
      const tags = Array.isArray(t.tags) ? t.tags.join(' ') : ''
      const hay = [
        t.title ?? '',
        t.description ?? '',
        tags,
        t.assignee?.name ?? '',
      ].join(' ').toLowerCase()
      return hay.includes(query)
    }).slice(0, 8)
  }, [tasks, q, isSlash, users])

  useEffect(() => { if (open) { setQ(''); setActive(0); setSlashError(null) } }, [open])
  useEffect(() => { setActive(0); setSlashError(null) }, [q])

  const runSlash = () => {
    const raw = q.trim()
    setSlashError(null)
    // ── >create ──
    if (raw.startsWith('>')) {
      if (canManage === false) { setSlashError('Создавать задачи могут CEO и PM разработки'); return }
      const body = raw.slice(1).trim().replace(/^create\s+/i, '')
      const tags = Array.from(body.matchAll(/#(\S+)/g))
        .map(m => m[1].replace(/[^0-9A-Za-zА-Яа-яЁё_-]+$/u, '').trim())
        .filter(Boolean)
      const withoutTags = body.replace(/#\S+/g, ' ')
      const { query: titleQuery, assigneeId, nameError } = splitCreateAssignee(users, withoutTags)
      if (nameError) { setSlashError(`Исполнитель «${nameError}» не найден`); return }
      const title = titleQuery.replace(/\s+/g, ' ').trim()
      if (!title) { setSlashError('Укажите название: >create Название [@имя] [#тег]'); return }
      onCreateCommand(title, assigneeId, tags)
      return
    }
    // ── /done ──
    const body = raw.slice(1).trim()
    const low = body.toLowerCase()
    if (low === 'done' || low.startsWith('done ')) {
      const query = body.slice(4).trim()
      if (!query) { setSlashError('Укажите текст поиска: /done название задачи'); return }
      const target = searchTasksByText(tasks, query)[0]
      if (!target) { setSlashError('Ничего не найдено'); return }
      onMoveCommand(target.id, 'done')
      return
    }
    // ── /move ──
    if (low === 'move' || low.startsWith('move ')) {
      const rest = body.slice(4).trim()
      const [statusToken, ...queryParts] = rest.split(/\s+/)
      const status = matchSlashStatus(statusToken || '')
      if (!status) { setSlashError('Укажите статус: /move <статус> <текст> (backlog, todo, in_progress, in_review, testing, done)'); return }
      const query = queryParts.join(' ').trim()
      if (!query) { setSlashError('Укажите текст поиска: /move done название задачи'); return }
      const target = searchTasksByText(tasks, query)[0]
      if (!target) { setSlashError('Ничего не найдено'); return }
      onMoveCommand(target.id, status)
      return
    }
    // ── /assign ──
    if (low === 'assign' || low.startsWith('assign ')) {
      if (canManage === false) { setSlashError('Назначать исполнителя могут CEO и PM разработки'); return }
      const rest = body.slice(6).trim().split(/\s+/).filter(Boolean)
      if (!rest.length || !rest[0].startsWith('@')) {
        setSlashError('Формат: /assign @имя текст поиска');
        return
      }
      let namePart = rest[0].slice(1)
      let skip = 1
      if (rest.length >= 2) {
        const two = `${rest[0].slice(1)} ${rest[1]}`
        if (users.some(u => u.name.toLowerCase().includes(two.toLowerCase()))) {
          namePart = two
          skip = 2
        }
      }
      const found = findUserByName(users, namePart)
      if (!found) { setSlashError(`Исполнитель «${namePart}» не найден`); return }
      const query = rest.slice(skip).join(' ').trim()
      if (!query) { setSlashError('Укажите текст поиска: /assign @имя название задачи'); return }
      const target = searchTasksByText(tasks, query)[0]
      if (!target) { setSlashError('Ничего не найдено'); return }
      onAssignCommand(target.id, found.id)
      return
    }
    setSlashError('Неизвестная команда. Подсказка ниже — используйте >create, /done, /move, /assign')
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive(i => Math.min(i + 1, Math.max(results.length - 1, 0)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (isSlash) { runSlash(); return }
        const picked = results[active]
        if (picked) onPick(picked.id)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, results, active, onPick, onCreateCommand, onMoveCommand, onAssignCommand, q, tasks, users, canManage])

  return (
    <Modal open={open} onClose={onClose} title="Быстрый поиск задачи" size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            className="input !pl-8"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Название, тег, исполнитель… или /команда, >create"
            autoFocus
            aria-label="Быстрый поиск задачи"
          />
        </div>
        {isSlash && (
          <div className="rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 px-3 py-2 text-[11px] leading-relaxed text-surface-500 dark:text-surface-400">
            <p className="font-semibold text-surface-700 dark:text-surface-200 mb-1">Команды:</p>
            <p><code className="font-mono text-surface-700 dark:text-surface-200">&gt;create Название [@имя] [#тег]</code> — создать задачу</p>
            <p><code className="font-mono text-surface-700 dark:text-surface-200">/done текст</code> — top-1 совпадение → «Готово»</p>
            <p><code className="font-mono text-surface-700 dark:text-surface-200">/move статус текст</code> — top-1 совпадение → статус</p>
            <p><code className="font-mono text-surface-700 dark:text-surface-200">/assign @имя текст</code> — назначить top-1 исполнителя</p>
          </div>
        )}
        {slashError && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
            {slashError}
          </p>
        )}
        <div className="max-h-80 overflow-y-auto -mx-1">
          {!results.length ? (
            <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-6">Ничего не найдено</p>
          ) : results.map((t, i) => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              onMouseEnter={() => setActive(i)}
              className={clsx(
                'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors',
                i === active ? 'bg-surface-100 dark:bg-surface-800' : 'hover:bg-surface-50 dark:hover:bg-surface-800/60',
              )}
            >
              <span className={clsx('w-2 h-2 rounded-full shrink-0', DEV_STATUS_COLORS[t.status] ?? 'bg-surface-400')} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-surface-800 dark:text-surface-200 truncate">{String(t.title ?? '—')}</span>
                <span className="block text-[11px] text-surface-400 truncate">
                  {DEV_PRIORITY_LABELS[t.priority] || t.priority}
                  {' · '}
                  {t.assignee?.name || 'Без исполнителя'}
                  {' · '}
                  {DEV_STATUS_LABELS[t.status]}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-surface-400 border-t border-surface-200 dark:border-surface-800 pt-2">
          <span>↑↓ навигация</span><span>{isSlash ? 'Enter выполнить команду' : 'Enter открыть'}</span><span>Esc закрыть</span>
        </div>
      </div>
    </Modal>
  )
}

// ── Timeline-вид (Gantt-лайт) ──────────────────────────────────────────
/** Полосы startDate→deadline. Нет startDate — однодневка на deadline.
 *  Без обоих дат задача не показывается. Drag полосы на день сдвигает
 *  даты (сохраняется через updateMut страницы, только manage).
 *  Группировка переиспользует groupBy доски (status/assignee/priority). */
function TimelineView({ tasks, users, groupBy, onOpen, onDatesChange, canManage }: {
  tasks: DevTask[]
  users: BoardUser[]
  groupBy: GroupBy
  onOpen: (id: string) => void
  onDatesChange: (id: string, dates: { startDate: string | null; deadline: string | null }) => void
  canManage?: boolean
}) {
  const [zoom, setZoom] = useState<'week' | 'month'>(() => {
    try {
      const z = localStorage.getItem('dev-board-timeline-zoom')
      return z === 'week' ? 'week' : 'month'
    } catch { return 'month' }
  })
  const changeZoom = (z: 'week' | 'month') => {
    setZoom(z)
    try { localStorage.setItem('dev-board-timeline-zoom', z) } catch { /* ignore */ }
  }

  const dated = useMemo(() => tasks.filter(t => t.startDate || t.deadline), [tasks])

  const toKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
  const addDays = (key: string, n: number) => {
    if (!DATE_KEY_RE.test(key || '') || !Number.isFinite(n)) return key
    const [y, m, d] = key.split('-').map(Number)
    const dt = new Date(y, (m || 1) - 1, d || 1)
    if (Number.isNaN(dt.getTime())) return key
    dt.setDate(dt.getDate() + n)
    return toKey(dt)
  }
  const diffDays = (a: string, b: string) => {
    if (!DATE_KEY_RE.test(a || '') || !DATE_KEY_RE.test(b || '')) return 0
    const pa = a.split('-').map(Number)
    const pb = b.split('-').map(Number)
    const da = new Date(pa[0], pa[1] - 1, pa[2]).getTime()
    const db = new Date(pb[0], pb[1] - 1, pb[2]).getTime()
    if (Number.isNaN(da) || Number.isNaN(db)) return 0
    return Math.round((db - da) / 86_400_000)
  }

  // Видимый спан задачи: с обеими датами — как есть; с одной —
  // показываем условную неделю (пунктиром), иначе полоса схлопывается
  // в точку 1 дня и таймлайн нечитаем. Реальные даты при DnD не меняются.
  // Даты могут прийти не строкой/битыми — валидируем форматом, иначе ''.
  const spanOf = (t: DevTask): { s: string; e: string; approx: boolean } => {
    const rawStart = typeof t.startDate === 'string' ? t.startDate.slice(0, 10) : ''
    const rawEnd = typeof t.deadline === 'string' ? t.deadline.slice(0, 10) : ''
    const start = DATE_KEY_RE.test(rawStart) ? rawStart : ''
    const end = DATE_KEY_RE.test(rawEnd) ? rawEnd : ''
    if (start && end) return { s: start, e: end, approx: false }
    if (end) return { s: addDays(end, -6), e: end, approx: true }
    return { s: start, e: addDays(start, 6), approx: true }
  }

  // Смещение недель в режиме «Неделя» (0 — текущая Пн–Вс).
  const [weekOffset, setWeekOffset] = useState(0)
  // Смещение месяцев в режиме «Месяц» (0 — текущий, строго 1..последнее число).
  const [monthOffset, setMonthOffset] = useState(0)

  // Диапазон дней: неделя — строго Пн–Вс (со смещением стрелками);
  // месяц — min..max спанов ±3 дня.
  const days = useMemo(() => {
    if (!dated.length) return [] as string[]
    if (zoom === 'week') {
      const now = new Date()
      const dow = (now.getDay() + 6) % 7 // Пн = 0
      const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + weekOffset * 7)
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)
        return toKey(d)
      })
    }
    let min = ''
    let max = ''
    if (zoom === 'month') {
      // Строго текущий месяц (со смещением): с 1-го по последнее число.
      const nowM = new Date()
      const first = new Date(nowM.getFullYear(), nowM.getMonth() + monthOffset, 1)
      const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
      min = toKey(first)
      max = toKey(new Date(first.getFullYear(), first.getMonth(), lastDay))
    } else {
      for (const t of dated) {
        const { s, e } = spanOf(t)
        if (!s || !e) continue
        if (!min || s < min) min = s
        if (!max || e > max) max = e
      }
      if (!min || !max) return [] as string[]
      min = addDays(min, -3)
      max = addDays(max, 3)
    }
    if (!min || !max) return [] as string[]
    min = addDays(min, -3)
    max = addDays(max, 3)
    const out: string[] = []
    let cur = min
    let guard = 0
    while (cur <= max && guard < 400) {
      out.push(cur)
      cur = addDays(cur, 1)
      guard++
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dated, zoom, weekOffset, monthOffset])

  const dayIndex = useMemo(() => new Map(days.map((d, i) => [d, i])), [days])
  /** Ширина скролл-контейнера: в режиме недели делим её на 7 дней,
   *  чтобы полоса не болталась слева, а занимала всю ширину. */
  const scrollRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (typeof w === 'number') setWrapW(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom])
  const dayW = zoom === 'week'
    ? Math.max(88, Math.floor(((wrapW || 0) - 232) / 7) || 88)
    : 40
  /** В режиме недели шрифт и строки крупнее — места хватает. */
  const barText = zoom === 'week' ? 'text-xs' : 'text-[10px]'
  const barH = zoom === 'week' ? 26 : 20
  /** Сегодня для подсветки колонки (дд.мм.гггг → ключ). */
  const tlToday = toKey(new Date())
  /** Русское склонение: 1 задача, 3 задачи, 20 задач. */
  const taskWord = (n: number) => {
    const m10 = n % 10
    const m100 = n % 100
    if (m10 === 1 && m100 !== 11) return 'задача'
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'задачи'
    return 'задач'
  }

  const groups = useMemo(() => {
    if (!dated.length) return [] as { key: string; label: string; dotClass?: string; tasks: DevTask[] }[]
    if (groupBy === 'assignee') {
      const cols = users.map(u => ({
        key: `assignee:${u.id}`,
        label: u.name,
        dotClass: undefined as string | undefined,
        tasks: dated.filter(t => t.assigneeId === u.id),
      })).filter(g => g.tasks.length)
      const none = dated.filter(t => !t.assigneeId)
      if (none.length) cols.push({ key: 'assignee:none', label: 'Без исполнителя', dotClass: undefined, tasks: none })
      return cols.length ? cols : [{ key: 'all', label: 'Все задачи', dotClass: undefined, tasks: dated }]
    }
    if (groupBy === 'priority') {
      return (Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[])
        .map(p => ({
          key: `priority:${p}`,
          label: DEV_PRIORITY_LABELS[p],
          dotClass: PRIORITY_DOTS[p],
          tasks: dated.filter(t => t.priority === p),
        }))
        .filter(g => g.tasks.length)
    }
    return DEV_TASK_STATUSES
      .map(s => ({
        key: `status:${s}`,
        label: DEV_STATUS_LABELS[s],
        dotClass: DEV_STATUS_COLORS[s],
        tasks: dated.filter(t => t.status === s),
      }))
      .filter(g => g.tasks.length)
  }, [dated, groupBy, users])

  const onBarDrop = (e: React.DragEvent, dayKey: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (!id) return
    const task = dated.find(t => t.id === id)
    if (!task) return
    const start = (task.startDate || '').slice(0, 10)
    const end = (task.deadline || '').slice(0, 10)
    if (start && end) {
      const dur = Math.max(diffDays(start, end), 0)
      onDatesChange(id, { startDate: dayKey, deadline: addDays(dayKey, dur) })
    } else if (end) {
      onDatesChange(id, { startDate: null, deadline: dayKey })
    } else if (start) {
      onDatesChange(id, { startDate: dayKey, deadline: null })
    }
  }

  if (!dated.length) {
    return (
      <div className="card min-h-0 flex-1 w-full flex flex-col items-center justify-center py-14 text-center px-4">
        <p className="text-sm text-surface-400 dark:text-surface-500">
          Нет задач с датами — задайте startDate/дедлайн, и они появятся на таймлайне
        </p>
      </div>
    )
  }

  return (
    <div className="card min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-surface-800 dark:text-surface-200">
          Таймлайн · {dated.length} {taskWord(dated.length)}
        </span>
        <span
          className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-surface-400 dark:text-surface-500"
          title="Пунктирная полоса — нет startDate: показана условная неделя до дедлайна"
        >
          <span className="inline-block w-6 h-[8px] rounded border border-dashed border-current opacity-70" />
          оценка
        </span>
        <div className="flex-1" />
        {zoom === 'week' && (
          <div className="inline-flex items-center gap-0.5" role="group" aria-label="Листание недель">
            <button
              type="button"
              onClick={() => setWeekOffset(o => o - 1)}
              aria-label="Предыдущая неделя"
              title="Предыдущая неделя"
              className="p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            {weekOffset !== 0 && (
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="text-[11px] px-2 py-1 rounded-md text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
              >
                Сегодня
              </button>
            )}
            <button
              type="button"
              onClick={() => setWeekOffset(o => o + 1)}
              aria-label="Следующая неделя"
              title="Следующая неделя"
              className="p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        {zoom === 'month' && (
          <div className="inline-flex items-center gap-0.5" role="group" aria-label="Листание месяцев">
            <button
              type="button"
              onClick={() => setMonthOffset(o => o - 1)}
              aria-label="Предыдущий месяц"
              title="Предыдущий месяц"
              className="p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            {monthOffset !== 0 && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="text-[11px] px-2 py-1 rounded-md text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
              >
                Сегодня
              </button>
            )}
            <button
              type="button"
              onClick={() => setMonthOffset(o => o + 1)}
              aria-label="Следующий месяц"
              title="Следующий месяц"
              className="p-1.5 rounded-md text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        <div className="inline-flex items-center rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-0.5">
          {(['week', 'month'] as const).map(z => (
            <button
              key={z}
              onClick={() => changeZoom(z)}
              aria-pressed={zoom === z}
              className={clsx(
                'text-xs px-2.5 py-1 rounded-md transition-colors',
                zoom === z
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
              )}
            >
              {z === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
        </div>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 min-h-0">
        <div style={{ minWidth: zoom === 'week' ? '100%' : 220 + days.length * dayW }}>
          {/* Шапка дней */}
          <div className="flex sticky top-0 bg-white dark:bg-surface-900 z-10">
            <div className="w-44 shrink-0" />
            {days.map(d => {
              const [, m, day] = d.split('-')
              const isTodayCol = d === tlToday
              return (
                <div
                  key={d}
                  className={clsx(
                    'shrink-0 text-center tabular-nums border-l border-surface-100 dark:border-surface-800 py-1',
                    zoom === 'week' ? 'text-xs' : 'text-[10px]',
                    isTodayCol
                      ? 'text-primary-600 dark:text-primary-400 font-bold'
                      : 'text-surface-400 dark:text-surface-500',
                  )}
                  style={{ width: dayW }}
                  title={d}
                >
                  {day}.{m}
                </div>
              )
            })}
          </div>
          {groups.map(g => (
            <div key={g.key} className="border-t border-surface-100 dark:border-surface-800">
              <div className="flex items-center gap-1.5 px-1 py-1.5 text-xs font-semibold text-surface-700 dark:text-surface-300">
                {g.dotClass && <span className={clsx('w-2 h-2 rounded-full shrink-0', g.dotClass)} />}
                <span className="truncate">{g.label}</span>
                <span className="text-surface-400 font-normal tabular-nums">{g.tasks.length}</span>
              </div>
              {g.tasks.map(t => {
                const { s, e, approx } = spanOf(t)
                const si = dayIndex.get(s) ?? 0
                const ei = dayIndex.get(e) ?? si
                const left = Math.min(si, ei) * dayW
                const width = (Math.abs(ei - si) + 1) * dayW - 6
                const overdue = isDevTaskOverdue(t)
                return (
                  <div key={t.id} className="flex items-center">
                    <button
                      onClick={() => onOpen(t.id)}
                      className="w-44 shrink-0 text-left text-[11px] text-surface-600 dark:text-surface-400 truncate px-1 py-1 hover:text-primary-600 dark:hover:text-primary-400"
                      title={t.title}
                    >
                      {t.title}
                    </button>
                    <div className="relative" style={{ width: days.length * dayW, height: barH + 6 }}>
                      {/* Сетка дней под полосой (dnd-цели) */}
                      <div className="absolute inset-0 flex">
                        {days.map(d => (
                          <div
                            key={d}
                            style={{ width: dayW }}
                            className={clsx(
                              'shrink-0 border-l border-surface-100 dark:border-surface-800/60',
                              d === tlToday && 'bg-primary-500/[0.07] dark:bg-primary-400/[0.08]',
                            )}
                            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                            onDrop={e => onBarDrop(e, d)}
                          />
                        ))}
                      </div>
                      <div
                        draggable={canManage !== false}
                        onDragStart={e => {
                          e.dataTransfer.setData('text/plain', t.id)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onClick={() => onOpen(t.id)}
                        className={clsx(
                          `absolute top-[3px] rounded-md px-2 truncate transition-colors ${barText} dev-fade-enter`,
                          canManage !== false ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          approx && 'border border-dashed border-current opacity-90',
                          t.status === 'done'
                            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                            : overdue
                              ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                              : 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 hover:bg-primary-200 dark:hover:bg-primary-900/60',
                        )}
                        style={{ left, width: Math.max(width, 96), height: barH, lineHeight: `${barH}px` }}
                        title={approx
                          ? `${t.title} — дедлайн ${e} (startDate нет, показана условная неделя; тяните, чтобы задать даты)`
                          : `${t.title} — ${s} → ${e} (тяните, чтобы сменить даты)`}
                      >
                        {t.title}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Модалка вебхуков (Outbox) ───────────────────────────────────────────
/** Подписки на события доски. CRUD без PATCH: toggle вкл/выкл реализован
 *  как DELETE + пересоздание. События — строго по контракту бэка
 *  (DEV_WEBHOOK_EVENTS из devBoardTypes, иначе 400). */

function webhookIsActive(w: DevWebhook): boolean {
  if (typeof w.isActive === 'boolean') return w.isActive
  if (typeof w.isEnabled === 'boolean') return w.isEnabled
  if (typeof (w as any).active === 'boolean') return (w as any).active
  if (typeof (w as any).enabled === 'boolean') return (w as any).enabled
  return true
}

const WEBHOOK_EVENT_DEFAULTS: string[] = ['task.created', 'task.done']

function WebhooksModal({ open, onClose, projects, canManage }: {
  open: boolean
  onClose: () => void
  projects: { value: string; label: string }[]
  /** dev-tracker.manage — без него CRUD подписок заблокирован с тостом. */
  canManage?: boolean
}) {
  const [formUrl, setFormUrl] = useState('')
  const [formProject, setFormProject] = useState('')
  const [formEvents, setFormEvents] = useState<string[]>([...WEBHOOK_EVENT_DEFAULTS])
  const [formSecret, setFormSecret] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  // Двойные клики по CRUD вебхуков: async-функции без isPending дублировали
  // подписки/удаления — держим локальные флаги (второй рубеж к disabled).
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dev-tracker', 'webhooks'],
    queryFn: () => devTrackerApi.getWebhooks(),
    enabled: open,
    retry: 1,
    staleTime: 30_000,
  })
  const webhooks: DevWebhook[] = Array.isArray(data) ? data : []

  const { data: deliveriesData, isLoading: deliveriesLoading, isError: deliveriesError, refetch: refetchDeliveries } = useQuery({
    queryKey: ['dev-tracker', 'webhooks', selectedId, 'deliveries'],
    queryFn: () => devTrackerApi.getDeliveries(selectedId as string),
    enabled: open && !!selectedId,
    retry: 1,
    staleTime: 15_000,
  })
  const deliveries: DevWebhookDelivery[] = Array.isArray(deliveriesData)
    ? deliveriesData
    : ((deliveriesData as any)?.items ?? (deliveriesData as any)?.deliveries ?? [])

  const toggleEvent = (ev: string) => {
    setFormEvents(prev => (prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]))
  }

  const createWebhook = async () => {
    if (canManage === false) { toast.error('Недостаточно прав'); return }
    const url = formUrl.trim()
    if (!url) { toast.error('Введите URL подписки'); return }
    // Валидация до отправки: мусор вместо URL и ссылки 2000+ давали 400/413 от бэка.
    if (!/^https?:\/\/.+/i.test(url)) { toast.error('URL должен начинаться с http(s)://'); return }
    if (url.length > 2000) { toast.error('URL слишком длинный (максимум 2000 символов)'); return }
    if (!formEvents.length) { toast.error('Выберите хотя бы одно событие'); return }
    if (creating) return
    setCreating(true)
    try {
      await devTrackerApi.createWebhook({
        url,
        projectId: formProject || undefined,
        events: formEvents,
        secret: formSecret.trim() || undefined,
      })
      toast.success('Подписка создана')
      setFormUrl(''); setFormProject(''); setFormSecret(''); setFormEvents([...WEBHOOK_EVENT_DEFAULTS])
      refetch()
    } catch (e: any) {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось создать подписку'))
    } finally {
      setCreating(false)
    }
  }

  const deleteWebhook = async (id: string) => {
    if (canManage === false) { toast.error('Недостаточно прав'); return }
    if (busyId) return
    setBusyId(id)
    try {
      await devTrackerApi.deleteWebhook(id)
      toast.success('Подписка удалена')
      if (selectedId === id) setSelectedId(null)
      refetch()
    } catch (e: any) {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось удалить подписку'))
    } finally {
      setBusyId(cur => (cur === id ? null : cur))
    }
  }

  // Toggle без PATCH: DELETE + POST с инвертированным флагом, молча.
  // Secret бэк в GET может не отдавать — если вернулся, пробрасываем дальше,
  // иначе переключатель молча сбросил бы подпись.
  const toggleWebhook = async (w: DevWebhook) => {
    if (canManage === false) { toast.error('Недостаточно прав'); return }
    if (busyId) return
    setBusyId(w.id)
    const next = !webhookIsActive(w)
    try {
      await devTrackerApi.deleteWebhook(w.id)
      await devTrackerApi.createWebhook({
        url: w.url,
        projectId: (w.projectId || undefined) as string | undefined,
        events: w.events ?? [],
        secret: w.secret || undefined,
        isActive: next,
      })
      refetch()
    } catch (e: any) {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось переключить подписку'))
      refetch()
    } finally {
      setBusyId(cur => (cur === w.id ? null : cur))
    }
  }

  const testWebhook = async (id: string) => {
    if (canManage === false) { toast.error('Недостаточно прав'); return }
    setTestingId(id)
    try {
      const res = await devTrackerApi.testWebhook(id)
      const ok = (res as any)?.ok
      const status = (res as any)?.status
      if (ok === false) toast.error(`Тест не прошёл${status ? `: ${status}` : ''}`)
      else toast.success(`Тестовая доставка отправлена${status ? ` (${status})` : ''}`)
    } catch (e: any) {
      const s = e?.response?.status
      toast.error(s === 404 ? 'Бэкенд ещё не поддерживает тест доставки' : (e?.response?.data?.message || 'Тест доставки не удался'))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Уведомления (вебхуки)" size="lg">
      <div className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-6">Загружаю подписки…</p>
        ) : isError ? (
          <div className="text-center py-6 space-y-3">
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Бэкенд пока не отдаёт подписки — попробуйте позже.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="btn-secondary !py-1.5 min-h-[40px] text-sm"
            >
              Повторить
            </button>
          </div>
        ) : !webhooks.length ? (
          <p className="text-sm text-surface-500 dark:text-surface-400 text-center py-4">
            Подписок пока нет — создайте первую ниже.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {webhooks.map(w => {
              const active = webhookIsActive(w)
              const selected = selectedId === w.id
              return (
                <div key={w.id} className="rounded-lg border border-surface-200 dark:border-surface-700 p-2.5 space-y-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={active}
                      aria-label={`Переключить подписку ${w.url}`}
                      onClick={() => toggleWebhook(w)}
                      disabled={busyId === w.id}
                      className={clsx(
                        'relative w-8 h-[18px] rounded-full transition-colors shrink-0 disabled:opacity-50',
                        active ? 'bg-emerald-500' : 'bg-surface-300 dark:bg-surface-600',
                      )}
                      title={active ? 'Выключить' : 'Включить'}
                    >
                      <span
                        className={clsx(
                          'absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all',
                          active ? 'left-[16px]' : 'left-[2px]',
                        )}
                      />
                    </button>
                    <span className="text-xs font-mono text-surface-700 dark:text-surface-300 truncate flex-1" title={w.url}>
                      {w.url}
                    </span>
                    <button
                      type="button"
                      onClick={() => testWebhook(w.id)}
                      disabled={testingId === w.id}
                      className="text-xs px-2 py-1 rounded-md border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors disabled:opacity-50 shrink-0"
                      title="Отправить тестовое событие"
                    >
                      {testingId === w.id ? 'Тест…' : 'Test'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteWebhook(w.id)}
                      disabled={busyId === w.id}
                      className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 p-1 rounded text-surface-400 hover:text-red-500 transition-colors shrink-0 disabled:opacity-50"
                      title="Удалить подписку"
                      aria-label={`Удалить подписку ${w.url}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {!!(w.events?.length) && (
                    <div className="flex flex-wrap gap-1">
                      {w.events!.map(ev => (
                        <span key={ev} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400 font-mono">
                          {ev}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelectedId(selected ? null : w.id)}
                    className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline"
                  >
                    {selected ? 'Скрыть журнал доставок' : 'Журнал последних доставок'}
                  </button>
                  {selected && (
                    <div className="rounded-md bg-surface-50 dark:bg-surface-800/60 px-2 py-1.5 space-y-1">
                      {deliveriesLoading ? (
                        <p className="text-[11px] text-surface-400">Загрузка доставок…</p>
                      ) : deliveriesError ? (
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] text-surface-400 flex-1">Не удалось загрузить доставки.</p>
                          <button
                            type="button"
                            onClick={() => refetchDeliveries()}
                            className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline shrink-0 min-h-[40px] px-1"
                          >
                            Повторить
                          </button>
                        </div>
                      ) : !deliveries.length ? (
                        <p className="text-[11px] text-surface-400">Доставок пока нет</p>
                      ) : (
                        deliveries.slice(0, 20).map((d, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px] text-surface-500 dark:text-surface-400">
                            <span className="font-mono truncate flex-1">{d.event}</span>
                            <span className={clsx(
                              'font-medium shrink-0',
                              String(d.status).toLowerCase().includes('ok') || String(d.status).startsWith('2')
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-red-600 dark:text-red-400',
                            )}>
                              {d.status}
                            </span>
                            {d.error && <span className="truncate max-w-[160px] text-red-500" title={d.error}>{d.error}</span>}
                            <span className="tabular-nums shrink-0">{String(d.createdAt || '').slice(0, 16).replace('T', ' ')}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Новая подписка */}
        <div className="rounded-lg border border-surface-200 dark:border-surface-700 p-3 space-y-3">
          <p className="text-xs font-semibold text-surface-700 dark:text-surface-300">Новая подписка</p>
          <FormField label="URL">
            <input
              className="input !py-1.5 text-sm font-mono"
              value={formUrl}
              onChange={e => setFormUrl(e.target.value)}
              placeholder="https://…/hook"
              aria-label="URL подписки"
              maxLength={2000}
              inputMode="url"
            />
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
            {!!projects.length && (
              <FormField label="Проект">
                <Select
                  value={formProject}
                  onChange={setFormProject}
                  placeholder="Все проекты"
                  options={projects}
                  className="w-full min-w-0 [&>button]:min-h-[42px] [&>button]:!py-2 [&>button]:text-sm"
                />
              </FormField>
            )}
            <FormField label="Secret (подпись)">
              <input
                className="input min-h-[42px] !py-2 text-sm font-mono"
                value={formSecret}
                onChange={e => setFormSecret(e.target.value)}
                placeholder="необязательно"
              />
            </FormField>
          </div>
          <div>
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-1.5">События</p>
            <div className="flex flex-wrap gap-1.5">
              {DEV_WEBHOOK_EVENTS.map(ev => (
                <button
                  key={ev}
                  type="button"
                  onClick={() => toggleEvent(ev)}
                  className={clsx(
                    'text-xs font-mono px-2 py-1 rounded-full border transition-colors',
                    formEvents.includes(ev)
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                      : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400',
                  )}
                >
                  {ev}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary !py-1.5 min-h-[40px] text-sm disabled:opacity-60"
              onClick={createWebhook}
              disabled={creating}
            >
              {creating ? 'Создание…' : 'Создать подписку'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function DevBoardPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const myId = user?.id || ''
  const canManage = userCan(user, 'dev-tracker.manage')

  // Вид (доска/таблица/календарь/таймлайн) — сохраняется между визитами.
  const [view, setView] = useState<BoardView>(() => {
    try {
      const v = localStorage.getItem('dev-board-view')
      return v === 'table' || v === 'calendar' || v === 'timeline' || v === 'board' ? (v as BoardView) : 'board'
    } catch { return 'board' }
  })
  const pageRef = useRef<HTMLDivElement>(null)
  const changeView = (v: BoardView) => {
    setView(v)
    try { localStorage.setItem('dev-board-view', v) } catch { /* приватный режим */ }
    // Виды разной высоты: повестка тянет страницу вниз, пустой таймлайн —
    // нет. Без сброса скролла main остаётся старый scrollTop и браузер
    // дёргает контент при схлопывании. Возвращаемся наверх доски.
    pageRef.current?.closest('main')?.scrollTo({ top: 0 })
  }

  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'' | DevTaskPriority>('')
  // Фильтр по тегам (ANY-совпадение): клик по тегу toggles, дублирует
  // серверный ?tags= клиентским условием в `filtered`.
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const toggleTag = (tag: string) => {
    setTagFilter(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]))
  }
  // Фильтр по проекту «Разработка»: '' — все, 'none' — без проекта, иначе id.
  // Пришёл из ссылки вида /dev-board?project=<id> (кнопка со страницы проекта).
  const [searchParams, setSearchParams] = useSearchParams()
  const [projectFilter, setProjectFilter] = useState<string>(() => searchParams.get('project') || '')
  const [onlyMine, setOnlyMine] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  // Только блокеры: серверный ?blocked=true в queryFn + клиентская страховка.
  const [blockedOnly, setBlockedOnly] = useState(false)
  // Спринт: '' — все, 'none' — без спринта, иначе id (серверный ?sprint=).
  const [sprintFilter, setSprintFilter] = useState('')
  // Mobile: панель фильтров свернута по умолчанию (раскрывается кнопкой).
  const [filtersOpen, setFiltersOpen] = useState(false)
  /** Число активных фильтров для бейджа «Фильтры (N)» на mobile. */
  const activeFilterCount =
    (assigneeFilter ? 1 : 0) +
    (priorityFilter ? 1 : 0) +
    (projectFilter ? 1 : 0) +
    (sprintFilter ? 1 : 0) +
    (onlyMine ? 1 : 0) +
    (overdueOnly ? 1 : 0) +
    (blockedOnly ? 1 : 0) +
    (tagFilter.length ? 1 : 0)
  const clearFilters = () => {
    setAssigneeFilter('')
    setPriorityFilter('')
    setProjectFilter('')
    setSprintFilter('')
    setOnlyMine(false)
    setOverdueOnly(false)
    setBlockedOnly(false)
    setTagFilter([])
  }
  const [groupBy, setGroupBy] = useState<GroupBy>('status')
  // WIP-лимиты колонок — только UI (localStorage 'dev-board-wip').
  const [wipLimits] = useState(loadWip)

  // projectFilter ↔ ?project= двусторонне (без циклов — через сравнение).
  // URL→state: внешняя ссылка/навигация меняет фильтр доски.
  useEffect(() => {
    const fromUrl = searchParams.get('project') || ''
    setProjectFilter(prev => (prev === fromUrl ? prev : fromUrl))
  }, [searchParams])
  // state→URL: смена фильтра в UI отражается в адресе (replace, без истории).
  useEffect(() => {
    const cur = searchParams.get('project') || ''
    const next = projectFilter || ''
    if (cur === next) return
    const ns = new URLSearchParams(searchParams)
    if (next) ns.set('project', next)
    else ns.delete('project')
    setSearchParams(ns, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter])

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [createStatus, setCreateStatus] = useState<DevTaskStatus | null>(null)
  const [createDate, setCreateDate] = useState<string | undefined>(undefined)

  const [sortKey, setSortKey] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [searchOpen, setSearchOpen] = useState(false)

  // Теги уходят и на сервер (?tags=a,b, ANY), и дублируются клиентским
  // условием в `filtered` (страховка + мгновенная реакция без refetch).
  // blockedOnly/sprintFilter — тоже в queryKey: серверные ?blocked=true
  // и ?sprint= (бэк может быть не готов — тогда fallback на клиентский фильтр).
  // Теги сортируем: ['a','b'] и ['b','a'] — один ключ, а не два кэша.
  const tagKey = [...tagFilter].sort().join(',')
  const blockedKey = blockedOnly ? 'blocked' : ''
  const listQueryKey = useMemo(
    () => [...LIST_KEY, tagKey, blockedKey, sprintFilter] as const,
    [tagKey, blockedKey, sprintFilter],
  )

  const { data: tasks, isLoading, isError, error, refetch, isFetching } = useQuery<DevTask[]>({
    queryKey: listQueryKey,
    queryFn: async () => {
      const needServerFilter = blockedOnly || (sprintFilter !== '')
      if (!needServerFilter) {
        return devTrackerApi.list(undefined, tagFilter.length ? tagFilter : undefined)
      }
      try {
        return await devTrackerApi.list(undefined, tagFilter.length ? tagFilter : undefined, {
          blocked: blockedOnly || undefined,
          sprint: sprintFilter || undefined,
        })
      } catch (e: any) {
        // Бэк ещё не знает ?blocked=/?sprint= (400/404) — забираем всё
        // и дофильтровываем клиентом в `filtered`, доска не падает.
        const s = e?.response?.status
        if (s === 400 || s === 404) {
          return devTrackerApi.list(undefined, tagFilter.length ? tagFilter : undefined)
        }
        throw e
      }
    },
    retry: 1,
  })
  const isForbidden = (error as any)?.response?.status === 403

  // Проекты раздела «Разработка» — для фильтра доски и привязки задач.
  // /dev/projects хранит ВСЕ проекты, поэтому отбираем dev-типы по projectType.
  const { data: rawProjects } = useQuery<any[]>({
    queryKey: ['dev-projects-for-board'],
    queryFn: () => projectsApi.list({}),
    staleTime: 120_000,
  })
  const devProjects = useMemo(
    () => selectDevProjects(Array.isArray(rawProjects) ? rawProjects : [])
      .map((p: any) => ({ id: String(p.id), name: String(p.name ?? 'Без названия').trim() || 'Без названия' })),
    [rawProjects],
  )

  // Ссылка /dev-board?create=1 (со страницы проекта) — сразу открываем модалку
  // создания; параметр убираем, чтобы F5 не открывал её повторно.
  // Без dev-tracker.manage модалку не открываем — иначе человек без прав
  // упрётся в 403 «Недостаточно прав для этого действия» от бэкенда.
  // ref — защита от повторного срабатывания на ОДИН приход параметра
  // (StrictMode/дабл-эфект). Сбрасываем, когда параметр пропал из URL:
  // иначе повторный переход по ссылке ?create=1 в рамках SPA модалку больше
  // не открыл бы. F5 не переоткрывает — параметр вычищен replace-навигацией.
  const autoCreateSeen = useRef(false)
  useEffect(() => {
    if (searchParams.get('create') !== '1') {
      autoCreateSeen.current = false
      return
    }
    if (autoCreateSeen.current) return
    autoCreateSeen.current = true
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    setSearchParams(next, { replace: true })
    if (!canManage) {
      toast.error('Создавать задачи могут CEO и PM разработки')
      return
    }
    setCreateStatus('todo')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, canManage])

  // Исполнители — активные сотрудники dev-команды и руководство.
  // Первым идём в скоупнутый GET /dev-tracker/assignees (доступен с правом
  // просмотра доски); usersApi.list требует employees.view и у PM даёт 403 —
  // он остаётся fallback'ом. Пустой ответ — тоже fallback, а не пустой список.
  const { data: rawUsers } = useQuery<BoardUser[]>({
    queryKey: ['users', 'dev-board-assignees'],
    queryFn: async () => {
      try {
        const scoped = await devTrackerApi.assignees()
        if (Array.isArray(scoped) && scoped.length) return scoped as BoardUser[]
      } catch { /* fallback ниже */ }
      return usersApi.list()
    },
    staleTime: 60_000,
  })
  const users = useMemo(() => {
    const list = Array.isArray(rawUsers) ? rawUsers : []
    // Элементы могут быть null (битый ответ) — доступ к .isActive без гарда ронял страницу.
    const safe = list.filter((u): u is BoardUser => u != null && typeof u === 'object' && typeof (u as BoardUser).id === 'string')
    const filtered = safe.filter(u =>
      u.isActive !== false && (!u.role || ASSIGNEE_ROLES.includes(u.role)),
    )
    return filtered.length ? filtered : safe.filter(u => u.isActive !== false)
  }, [rawUsers])

  // Спринты (GET /dev-tracker/sprints). Бэк может быть не готов —
  // тихо работаем без списка (фильтр «все/без спринта» остаётся).
  const { data: sprintsData } = useQuery({
    queryKey: ['dev-tracker', 'sprints'],
    queryFn: () => devTrackerApi.getSprints(),
    retry: 1,
    staleTime: 60_000,
  })
  const sprints: DevSprint[] = useMemo(() => {
    if (Array.isArray(sprintsData)) return sprintsData
    return []
  }, [sprintsData])
  const sprintNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of sprints) map.set(s.id, s.name)
    return map
  }, [sprints])

  // Поповеры/состояния: triage, завершение спринта, вебхуки, bulk-блокер.
  const [triageOpen, setTriageOpen] = useState(false)
  const [triageAssignee, setTriageAssignee] = useState('')
  const [webhooksOpen, setWebhooksOpen] = useState(false)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [completeTarget, setCompleteTarget] = useState('backlog')
  const [bulkBlockOpen, setBulkBlockOpen] = useState(false)
  const [bulkBlockReason, setBulkBlockReason] = useState('')

  // Свои поповеры (triage/complete) ui-кит не закрывает — Esc закрываем сами.
  useEffect(() => {
    if (!triageOpen && !completeOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setTriageOpen(false); setCompleteOpen(false) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [triageOpen, completeOpen])

  // ⌘K / Ctrl+K открывает палитру быстрого поиска.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setSearchOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Перемещение карточки: оптимистично переставляем в кэше, при ошибке
  // откатываем снимок. Позиция — в конец колонки (position = её длина).
  const moveMut = useMutation({
    mutationKey: ['dev-tracker-move'],
    mutationFn: ({ id, status, position }: { id: string; status: DevTaskStatus; position: number }) =>
      devTrackerApi.move(id, { status, position }),
    onMutate: async ({ id, status, position }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<DevTask[]>(listQueryKey)
      qc.setQueryData<DevTask[]>(listQueryKey, (old = []) =>
        old.map(t => t.id === id ? { ...t, status, position } : t),
      )
      return { previous }
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx && ctx.previous !== undefined) qc.setQueryData(listQueryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Не удалось переместить задачу')
    },
    onSettled: () => {
      // Не затираем оптимистичное состояние, пока летят другие move/update-
      // мутации: refetch по одному ключу сбросил бы кэш под ещё летящей
      // оптимистичной правкой другого типа (оба ключа считаются вместе).
      // isMutating считает только pending-мутации: только что settled-мутация
      // в счёт уже не входит, поэтому «никого в полёте» — это 0, а не 1.
      const inflight =
        qc.isMutating({ mutationKey: ['dev-tracker-move'] }) +
        qc.isMutating({ mutationKey: ['dev-tracker-update-inline'] })
      if (inflight === 0) qc.invalidateQueries({ queryKey: LIST_KEY })
    },
  })

  // Inline-правка полей (приоритет/исполнитель/дедлайн) — оптимистично,
  // с откатом снимка при ошибке. Доступно только с правом manage.
  const updateMut = useMutation({
    mutationKey: ['dev-tracker-update-inline'],
    mutationFn: ({ id, data }: { id: string; data: any }) => devTrackerApi.update(id, data),
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: LIST_KEY })
      const previous = qc.getQueryData<DevTask[]>(listQueryKey)
      // Shallow-merge {...t, ...data} рвал assignee: при смене assigneeId
      // подтягиваем объект assignee из кэша пользователей, иначе stale
      // assignee оставался в UI. Не нашли — сбрасываем в undefined,
      // чтобы refetch подтянул актуальное значение.
      const patch: any = { ...data }
      if (data && 'assigneeId' in data) {
        if (data.assigneeId == null) {
          patch.assignee = null
        } else {
          const cached = qc.getQueryData<BoardUser[]>(['users', 'dev-board-assignees'])
          const list = Array.isArray(cached) && cached.length ? cached : users
          const found = list.find(u => u.id === data.assigneeId)
          patch.assignee = found
            ? { id: found.id, name: found.name, avatarUrl: (found as any).avatar ?? (found as any).avatarUrl ?? null }
            : undefined
        }
      }
      qc.setQueryData<DevTask[]>(listQueryKey, (old = []) =>
        old.map(t => t.id === id ? { ...t, ...patch } : t),
      )
      return { previous }
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(listQueryKey, ctx.previous)
      toast.error(e?.response?.data?.message || 'Не удалось сохранить')
    },
    onSettled: () => {
      // Как в moveMut: move и update считаются вместе, иначе settle одного
      // типа инвалидирует кэш под летящим оптимистичным правком другого.
      // isMutating считает только pending — settled-мутация уже не в счётчике.
      const inflight =
        qc.isMutating({ mutationKey: ['dev-tracker-move'] }) +
        qc.isMutating({ mutationKey: ['dev-tracker-update-inline'] })
      if (inflight === 0) qc.invalidateQueries({ queryKey: LIST_KEY })
    },
  })

  // Quick-add из колонки/таблицы: без тоста на успех, чтобы не спамить.
  const createMut = useMutation({
    mutationKey: ['dev-tracker-quick-add'],
    mutationFn: (data: any) => devTrackerApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось создать задачу'))
    },
  })

  const quickAdd = (
    title: string,
    opts: { status?: DevTaskStatus; priority?: DevTaskPriority; assigneeId?: string | null; projectId?: string | null },
  ) => {
    if (!canManage) { toast.error('Создавать задачи могут CEO и PM разработки'); return }
    createMut.mutate({
      title,
      status: opts.status ?? 'backlog',
      priority: opts.priority ?? 'medium',
      taskType: 'feature',
      assigneeId: opts.assigneeId ?? undefined,
      projectId: opts.projectId ?? undefined,
    })
  }

  /** Проект, выбранный в фильтре, — чтобы quick-add и модалка создавали
   *  задачу сразу в контексте выбранного проекта. */
  const activeProjectId = projectFilter && projectFilter !== 'none' ? projectFilter : undefined

  const updateField = (id: string, data: any) => {
    if (!canManage) { toast.error('Недостаточно прав'); return }
    updateMut.mutate({ id, data })
  }

  // Смена статуса из таблицы/доски всегда идёт через /move — он доступен
  // всем с правом просмотра, в отличие от обычного PATCH.
  const changeStatus = (id: string, status: DevTaskStatus) => {
    const task = (tasks || []).find(t => t.id === id)
    if (!task || task.status === status) return
    const position = (tasks || []).filter(t => t.status === status).length
    moveMut.mutate({ id, status, position })
  }

  // ── Slash-команды палитры ⌘K ─────────────────────────────────────────
  const slashCreate = (title: string, assigneeId: string | null, tags: string[]) => {
    if (!canManage) { toast.error('Создавать задачи могут CEO и PM разработки'); return }
    createMut.mutate({
      title,
      status: 'backlog',
      priority: 'medium',
      taskType: 'feature',
      assigneeId: assigneeId ?? undefined,
      projectId: activeProjectId,
      tags,
    })
    setSearchOpen(false)
  }
  const slashMove = (id: string, status: DevTaskStatus) => {
    // move идёт через /move — доступен с правом просмотра, как на доске.
    changeStatus(id, status)
    setSearchOpen(false)
  }
  const slashAssign = (id: string, assigneeId: string) => {
    if (!canManage) { toast.error('Назначать исполнителя могут CEO и PM разработки'); return }
    updateMut.mutate({ id, data: { assigneeId } })
    setSearchOpen(false)
  }

  // ── Triage просрочек (POST /dev-tracker/triage-overdue) ───────────────
  const triageMut = useMutation({
    mutationFn: (assigneeId?: string) =>
      devTrackerApi.triageOverdue({
        assigneeId: assigneeId || undefined,
        projectId: activeProjectId,
      }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      setTriageOpen(false)
      const n = res?.assigned ?? res?.updated ?? 0
      toast.success(`Назначено: ${n}`)
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 404 ? 'Бэкенд ещё не поддерживает разбор просрочек' : (e?.response?.data?.message || 'Не удалось разобрать просрочки'))
    },
  })

  // ── Завершение спринта (POST /dev-tracker/sprints/:id/complete) ───────
  const completeSprintMut = useMutation({
    mutationFn: ({ id, moveTo }: { id: string; moveTo: string }) =>
      devTrackerApi.completeSprint(id, moveTo),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      qc.invalidateQueries({ queryKey: ['dev-tracker', 'sprints'] })
      setCompleteOpen(false)
      const n = res?.moved ?? res?.completed ?? res?.updated ?? null
      toast.success(n != null ? `Спринт завершён, перенесено: ${n}` : 'Спринт завершён')
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 404 ? 'Бэкенд ещё не поддерживает завершение спринтов' : (e?.response?.data?.message || 'Не удалось завершить спринт'))
    },
  })

  /** Triage/complete идут только с dev-tracker.manage (кнопки скрыты без права — здесь второй рубеж). */
  const runTriage = (assigneeId?: string) => {
    if (!canManage) { toast.error('Недостаточно прав'); return }
    triageMut.mutate(assigneeId)
  }
  const runCompleteSprint = (id: string, moveTo: string) => {
    if (!canManage) { toast.error('Недостаточно прав'); return }
    completeSprintMut.mutate({ id, moveTo })
  }

  const filtered = useMemo(() => {
    return (tasks || []).filter(t => {
      if (!t || typeof t !== 'object') return false
      if (assigneeFilter && t.assigneeId !== assigneeFilter) return false
      if (priorityFilter && t.priority !== priorityFilter) return false
      // Теги-фильтр (ANY): задача подходит, если пересекается хотя бы по одному тегу.
      // t.tags может прийти не массивом (частичный контракт) — Array-guard вместо ??.
      if (tagFilter.length && !tagFilter.some(tag => (Array.isArray(t.tags) ? t.tags : []).includes(tag))) return false
      // Фильтр по проекту «Разработка»: конкретный проект или «без проекта».
      if (projectFilter === 'none' && t.projectId) return false
      if (projectFilter && projectFilter !== 'none' && t.projectId !== projectFilter) return false
      // Спринт: клиентская страховка поверх серверного ?sprint=.
      if (sprintFilter === 'none' && (t as DevTask).sprintId) return false
      if (sprintFilter && sprintFilter !== 'none' && (t as DevTask).sprintId !== sprintFilter) return false
      // Блокеры: клиентская страховка поверх серверного ?blocked=true.
      if (blockedOnly && !(t as DevTask).isBlocked) return false
      if (onlyMine && t.assigneeId !== myId) return false
      if (overdueOnly && !isDevTaskOverdue(t)) return false
      return true
    })
  }, [tasks, assigneeFilter, priorityFilter, tagFilter, projectFilter, sprintFilter, blockedOnly, onlyMine, overdueOnly, myId])

  const byPosition = (a: DevTask, b: DevTask) => (a.position ?? 0) - (b.position ?? 0)

  // Колонки доски строятся динамически под выбранную группировку.
  // Подзадачи (parentTaskId != null) на доске скрыты — они видны в карточке.
  const boardColumns = useMemo<BoardColumn[]>(() => {
    const boardTasks = filtered.filter(t => t.parentTaskId == null)
    if (groupBy === 'priority') {
      return (Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[]).map(p => ({
        key: `priority:${p}`,
        label: DEV_PRIORITY_LABELS[p],
        dotClass: PRIORITY_DOTS[p],
        priority: p,
        tasks: boardTasks.filter(t => t.priority === p).sort(byPosition),
      }))
    }
    if (groupBy === 'assignee') {
      const cols: BoardColumn[] = users.map(u => ({
        key: `assignee:${u.id}`,
        label: u.name,
        assigneeId: u.id,
        tasks: boardTasks.filter(t => t.assigneeId === u.id).sort(byPosition),
      }))
      cols.push({
        key: 'assignee:none',
        label: 'Без исполнителя',
        assigneeId: null,
        tasks: boardTasks.filter(t => !t.assigneeId).sort(byPosition),
      })
      return cols
    }
    return DEV_TASK_STATUSES.map(s => ({
      key: `status:${s}`,
      label: DEV_STATUS_LABELS[s],
      dotClass: DEV_STATUS_COLORS[s],
      status: s,
      tasks: boardTasks.filter(t => t.status === s).sort(byPosition),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, groupBy, users])

  const toggleSort = (k: Exclude<SortKey, null>) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  // Строки таблицы: родитель + его подзадачи (с отступом), сортировка клиентская.
  const tableRows = useMemo(() => {
    const inFilter = new Set(filtered.map(t => t.id))
    const sortList = (list: DevTask[]) => {
      if (!sortKey) return list
      const arr = [...list]
      arr.sort((a, b) => {
        let cmp = 0
        // title может прийти null/не строкой — localeCompare на нём ронял таблицу.
        if (sortKey === 'title') cmp = String(a.title ?? '').localeCompare(String(b.title ?? ''), 'ru')
        else if (sortKey === 'priority') cmp = (DEV_PRIORITY_RANK[a.priority] ?? 0) - (DEV_PRIORITY_RANK[b.priority] ?? 0)
        else if (sortKey === 'deadline') {
          // Битая дата даёт NaN — cmp NaN ломал порядок (сортировка «прыгала»).
          const at = a.deadline ? new Date(a.deadline).getTime() : NaN
          const bt = b.deadline ? new Date(b.deadline).getTime() : NaN
          const av = Number.isFinite(at) ? (at as number) : Number.POSITIVE_INFINITY
          const bv = Number.isFinite(bt) ? (bt as number) : Number.POSITIVE_INFINITY
          cmp = av - bv
        }
        return sortDir === 'desc' ? -cmp : cmp
      })
      return arr
    }
    const topLevel = sortList(filtered.filter(t => t.parentTaskId == null))
    const rows: { task: DevTask; isSub: boolean }[] = []
    for (const t of topLevel) {
      rows.push({ task: t, isSub: false })
      const subs = (tasks || [])
        .filter(s => s.parentTaskId === t.id && inFilter.has(s.id))
        .sort(byPosition)
      for (const s of subs) rows.push({ task: s, isSub: true })
    }
    // Подзадачи, чей родитель отфильтрован, всё равно показываем.
    const topIds = new Set(topLevel.map(t => t.id))
    for (const o of filtered) {
      if (o.parentTaskId != null && !topIds.has(o.parentTaskId)) rows.push({ task: o, isSub: true })
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, tasks, sortKey, sortDir])

  // ── Bulk-выделение в табличном виде (Notion-стиль) ───────────────────
  // Чекбоксы есть только у задач верхнего уровня: подзадачи живут
  // родителем, массово их не трогаем — чтобы не ломать связи.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const tableTopIds = useMemo(
    () => tableRows.filter(r => !r.isSub).map(r => r.task.id),
    [tableRows],
  )
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    setSelected(prev =>
      tableTopIds.length > 0 && tableTopIds.every(id => prev.has(id))
        ? new Set()
        : new Set(tableTopIds),
    )
  }
  // Сбрасываем выделение при смене фильтров/вида — иначе можно применить
  // массовое действие к задачам, которые уже скрыты из вида.
  useEffect(() => {
    setSelected(new Set())
  }, [assigneeFilter, priorityFilter, tagFilter, projectFilter, sprintFilter, blockedOnly, onlyMine, overdueOnly, view])
  // Подчищаем выделение от задач, ушедших из строк (удалены/отфильтрованы
  // сервером): bulk иначе ушёл бы с мёртвыми id. Возвращаем prev-реф без
  // изменений, чтобы не гонять лишние рендеры.
  useEffect(() => {
    setSelected(prev => {
      if (!prev.size) return prev
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (tableTopIds.includes(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [tableTopIds])

  /** Дедлайн для bulk-панели (применить/очистить). */
  const [bulkDeadline, setBulkDeadline] = useState('')
  // Bulk-черновики (дедлайн/блокер) сбрасываем вместе с выделением: панель
  // скрыта при пустом selected, а старый черновик иначе пережил бы сброс
  // фильтров и применился бы к новому выделению.
  useEffect(() => {
    if (selected.size) return
    setBulkDeadline('')
    setBulkBlockOpen(false)
    setBulkBlockReason('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.size])

  type BulkAction = 'status' | 'priority' | 'delete' | 'assignee' | 'deadline' | 'blocked'
  const bulkMut = useMutation({
    mutationFn: ({ action, value }: { action: BulkAction; value: string }) =>
      devTrackerApi.bulk([...selected], action, value),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      setSelected(new Set())
      setBulkDeadline('')
      setBulkBlockOpen(false)
      setBulkBlockReason('')
      toast.success(res?.deleted ? `Удалено задач: ${res.deleted}` : `Обновлено задач: ${res?.updated ?? 0}`)
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 404 ? 'Бэкенд ещё не поддерживает эту операцию' : (e?.response?.data?.message || 'Массовая операция не удалась'))
    },
  })

  /** Bulk с canManage-guard и понятным тостом (как quickAdd). */
  const doBulk = (action: BulkAction, value: string) => {
    if (!canManage) { toast.error('Недостаточно прав'); return }
    if (!selected.size) { toast.error('Выберите задачи'); return }
    // Параллельный bulk поверх летящего — гонка на списке (два invalidate
    // подряд), блокируем повтор до settle. Кнопки уже disabled, это второй рубеж.
    if (bulkMut.isPending) return
    bulkMut.mutate({ action, value })
  }

  const onCardDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(id)
  }

  // Drop в колонку: по статусу — /move (доступен всем), по приоритету или
  // исполнителю — обычный PATCH, только с правом manage.
  const onColumnDrop = (e: React.DragEvent, col: BoardColumn) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || dragId
    setDragOverKey(null)
    setDragId(null)
    if (!id) return
    const task = (tasks || []).find(t => t.id === id)
    if (!task) return
    if (col.status) {
      if (task.status === col.status) return
      // Позиция — в конец колонки по ВСЕМ задачам статуса, а не по видимым
      // col.tasks (фильтры могут скрывать часть — иначе вставим в середину).
      const position = (tasks || []).filter(t => t.status === col.status).length
      moveMut.mutate({ id, status: col.status, position })
      return
    }
    if (!canManage) { toast.error('Недостаточно прав'); return }
    if (col.priority) {
      if (task.priority === col.priority) return
      updateMut.mutate({ id, data: { priority: col.priority } })
    } else if (col.assigneeId !== undefined) {
      if ((task.assigneeId ?? null) === col.assigneeId) return
      updateMut.mutate({ id, data: { assigneeId: col.assigneeId } })
    }
  }



  return (
    <div ref={pageRef} className="dev-board-root flex flex-col h-full min-h-0">
      {/* Стабильный gutter скроллбара: виды разной высоты то показывают
          вертикальный скролл main, то нет — без резерва места весь интерфейс
          прыгает на ширину скроллбара при каждом переключении. :has scoped
          только под нашу страницу, остальные разделы не задеты. */}
      <style>{`main:has(.dev-board-root){scrollbar-gutter:stable}`}</style>
      {/* Шапка: mobile — компактные ряды (заголовок+поиск / виды / фильтры ниже).
          Навигация по разделу (Календарь/Проекты/KPI/Отчёты) живёт в сайдбаре
          (Sidebar DEV_SUBNAV) — дублей в шапке нет. */}
      <div className="md:hidden mb-5 space-y-2.5">
        {/* Ряд 1: заголовок + поиск в одном flex-ряду */}
        <div className="flex items-center gap-2">
          <h1 className="page-title min-w-0 flex-1 truncate">
            Доска разработки
          </h1>
          <button
            onClick={() => setSearchOpen(true)}
            className="btn-secondary min-h-[40px] inline-flex shrink-0 items-center gap-2 px-2.5 text-sm"
            title="Быстрый поиск задачи"
            aria-label="Быстрый поиск задачи"
          >
            <Search size={17} className="shrink-0" />
            <span className="hidden sm:inline">Поиск</span>
          </button>
        </div>
        {/* Ряд 2: переключатель видов — 4 равные кнопки без скролла.
            На 360px подписи не влезают, поэтому только иконки (имена — в
            title/aria-label), активный подсвечен пилюлей. Desktop-ряд ниже. */}
        <div
          className="grid grid-cols-4 gap-0.5 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-0.5"
          role="tablist"
          aria-label="Вид доски"
        >
          {([
            { v: 'board' as const, label: 'Доска', Icon: Columns },
            { v: 'table' as const, label: 'Таблица', Icon: Table2 },
            { v: 'calendar' as const, label: 'Календарь', Icon: CalendarDays },
            { v: 'timeline' as const, label: 'Таймлайн', Icon: GanttChartSquare },
          ]).map(({ v, label, Icon }) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              title={label}
              aria-label={label}
              onClick={() => changeView(v)}
              className={clsx(
                'inline-flex min-h-[40px] items-center justify-center rounded-md transition-colors',
                view === v
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
              )}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        {/* Уведомления (вебхуки) — только с правом manage, ниже видов,
            чтобы не теснить ряд 1 на 360px */}
        {canManage && (
          <button
            onClick={() => setWebhooksOpen(true)}
            className="btn-secondary min-h-[40px] inline-flex w-full items-center justify-center gap-2 text-sm"
            title="Подписки на события доски (вебхуки)"
          >
            ⚙️ Уведомления
          </button>
        )}
      </div>
      {/* Шапка desktop: только заголовок и рабочие контролы доски — навигация
          по разделу в сайдбаре, дублей нет. */}
      <div className="hidden md:flex flex-wrap items-center gap-3 mb-5">
        <h1 className="page-title">
          Доска разработки
        </h1>

        <div className="inline-flex items-center rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-800 p-0.5" role="tablist" aria-label="Вид доски">
          {([
            { v: 'board' as const, label: 'Доска', Icon: Columns },
            { v: 'table' as const, label: 'Таблица', Icon: Table2 },
            { v: 'calendar' as const, label: 'Календарь', Icon: CalendarDays },
            { v: 'timeline' as const, label: 'Таймлайн', Icon: GanttChartSquare },
          ]).map(({ v, label, Icon }) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => changeView(v)}
              className={clsx(
                'inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-md transition-colors',
                view === v
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-surface-100 shadow-sm'
                  : 'text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
              )}
            >
              {Icon ? <Icon size={15} /> : null} {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {canManage && (
          <button
            onClick={() => setWebhooksOpen(true)}
            className="btn-secondary !px-3 !py-1.5 inline-flex shrink-0 items-center gap-1.5 text-sm whitespace-nowrap"
            title="Подписки на события доски (вебхуки)"
            aria-label="Подписки на события доски (вебхуки)"
          >
            <span className="text-base leading-none" aria-hidden="true">⚙️</span>
            <span>Уведомления</span>
          </button>
        )}

        <button
          onClick={() => setSearchOpen(true)}
          className="btn-secondary !px-3 !py-1.5 inline-flex shrink-0 items-center gap-1.5 text-sm whitespace-nowrap"
          title="Быстрый поиск задачи"
          aria-label="Быстрый поиск задачи"
        >
          <Search size={15} className="shrink-0" />
          <span>Поиск</span>
        </button>
      </div>

      {/* Фильтры — mobile: сворачиваемая панель (desktop-блок ниже, hidden md:flex).
          Поиск full-width, селекты grid-cols-2, счётчик активных фильтров. */}
      <div className="md:hidden mb-5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
            className="flex-1 min-h-[40px] inline-flex items-center justify-center gap-2 text-sm px-3 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <SlidersHorizontal size={15} />
            Фильтры{activeFilterCount > 0 && ` (${activeFilterCount})`}
            <ChevronDown size={15} className={clsx('transition-transform', filtersOpen && 'rotate-180')} />
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="min-h-[40px] px-3 text-sm rounded-lg text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            >
              Сбросить
            </button>
          )}
        </div>
        {filtersOpen && (
          <div className="card !p-3 mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                placeholder="Все исполнители"
                options={users.map(u => ({ value: u.id, label: u.name }))}
              />
              <Select
                value={priorityFilter}
                onChange={v => setPriorityFilter(v as '' | DevTaskPriority)}
                placeholder="Все приоритеты"
                options={(Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[])
                  .map(p => ({ value: p, label: DEV_PRIORITY_LABELS[p] }))}
              />
              <Select
                value={projectFilter}
                onChange={setProjectFilter}
                placeholder="Все проекты"
                options={[
                  ...devProjects.map(p => ({ value: p.id, label: p.name })),
                  { value: 'none', label: 'Без проекта' },
                ]}
              />
              <Select
                value={sprintFilter}
                onChange={setSprintFilter}
                placeholder="Все спринты"
                options={[
                  { value: 'none', label: 'Без спринта' },
                  ...sprints.map(s => ({ value: s.id, label: s.name })),
                ]}
              />
              {view === 'board' && (
                <div className="col-span-2">
                  <Select
                    value={groupBy}
                    onChange={v => setGroupBy(v as GroupBy)}
                    options={[
                      { value: 'status', label: 'Группировка: статусы' },
                      { value: 'priority', label: 'Группировка: приоритет' },
                      { value: 'assignee', label: 'Группировка: исполнители' },
                    ]}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setOnlyMine(v => !v)}
                className={clsx(
                  'min-h-[40px] inline-flex items-center gap-1.5 text-sm px-2.5 rounded-lg border transition-colors',
                  onlyMine
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400',
                )}
              >
                <UserIcon size={14} /> Только мои
              </button>
              <button
                onClick={() => setOverdueOnly(v => !v)}
                className={clsx(
                  'min-h-[40px] inline-flex items-center gap-1.5 text-sm px-2.5 rounded-lg border transition-colors',
                  overdueOnly
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400',
                )}
              >
                <AlertTriangle size={14} /> Просроченные
              </button>
              <button
                onClick={() => setBlockedOnly(v => !v)}
                className={clsx(
                  'min-h-[40px] inline-flex items-center gap-1.5 text-sm px-2.5 rounded-lg border transition-colors',
                  blockedOnly
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                    : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400',
                )}
                title="Показать только заблокированные задачи"
              >
                ⛔ Только блокеры
              </button>
              {canManage && (
                <button
                  onClick={() => setTriageOpen(o => !o)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 text-sm px-2.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 transition-colors"
                  title="Назначить просроченные задачи исполнителю"
                >
                  Разобрать просрочки
                </button>
              )}
              {canManage && sprintFilter !== '' && sprintFilter !== 'none' && (
                <button
                  onClick={() => setCompleteOpen(o => !o)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 text-sm px-2.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 transition-colors"
                  title="Завершить выбранный спринт"
                >
                  Завершить спринт
                </button>
              )}
            </div>
            {/* Triage/complete-поповеры: desktop-версии живут в скрытом на
                mobile блоке, поэтому здесь те же контролы inline. */}
            {canManage && triageOpen && (
              <div className="card !p-3 space-y-2 shadow-lg">
                <p className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                  Кому назначить просроченные?
                </p>
                <button
                  className="btn-secondary w-full !py-1.5 !min-h-[40px] text-sm"
                  disabled={triageMut.isPending}
                  onClick={() => runTriage(myId || undefined)}
                >
                  Назначить на меня
                </button>
                <Select
                  value={triageAssignee}
                  onChange={setTriageAssignee}
                  placeholder="Выбрать исполнителя…"
                  options={users.map(u => ({ value: u.id, label: u.name }))}
                />
                <div className="flex gap-2 justify-end">
                  <button className="btn-secondary !py-1 !min-h-[40px] text-xs" onClick={() => setTriageOpen(false)}>
                    Отмена
                  </button>
                  <button
                    className="btn-primary !py-1 !min-h-[40px] text-xs"
                    disabled={!triageAssignee || triageMut.isPending}
                    onClick={() => runTriage(triageAssignee)}
                  >
                    {triageMut.isPending ? 'Назначаю…' : 'Назначить'}
                  </button>
                </div>
              </div>
            )}
            {canManage && completeOpen && sprintFilter !== '' && sprintFilter !== 'none' && (
              <div className="card !p-3 space-y-2 shadow-lg">
                <p className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                  Куда перенести открытые задачи?
                </p>
                <Select
                  value={completeTarget}
                  onChange={setCompleteTarget}
                  options={[
                    { value: 'backlog', label: 'В бэклог' },
                    ...sprints.filter(s => s.id !== sprintFilter).map(s => ({ value: s.id, label: `В спринт «${s.name}»` })),
                  ]}
                />
                <div className="flex gap-2 justify-end">
                  <button className="btn-secondary !py-1 !min-h-[40px] text-xs" onClick={() => setCompleteOpen(false)}>
                    Отмена
                  </button>
                  <button
                    className="btn-primary !py-1 !min-h-[40px] text-xs"
                    disabled={completeSprintMut.isPending}
                    onClick={() => runCompleteSprint(sprintFilter, completeTarget)}
                  >
                    {completeSprintMut.isPending ? 'Завершаю…' : 'Завершить'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Фильтры — chips, всё комбинируется; текстовый поиск — через ⌘K (desktop; mobile выше) */}
      <div className="hidden md:flex flex-wrap items-center gap-2 mb-5">
        <div className="w-40">
          <Select
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            placeholder="Все исполнители"
            options={users.map(u => ({ value: u.id, label: u.name }))}
          />
        </div>
        <div className="w-36">
          <Select
            value={priorityFilter}
            onChange={v => setPriorityFilter(v as '' | DevTaskPriority)}
            placeholder="Все приоритеты"
            options={(Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[])
              .map(p => ({ value: p, label: DEV_PRIORITY_LABELS[p] }))}
          />
        </div>
        {/* Фильтр по проекту «Разработка» — связка со /dev/projects. */}
        <div className="w-48">
          <Select
            value={projectFilter}
            onChange={setProjectFilter}
            placeholder="Все проекты"
            options={[
              ...devProjects.map(p => ({ value: p.id, label: p.name })),
              { value: 'none', label: 'Без проекта' },
            ]}
          />
        </div>
        {view === 'board' && (
          <div className="w-48">
            <Select
              value={groupBy}
              onChange={v => setGroupBy(v as GroupBy)}
              options={[
                { value: 'status', label: 'Группировка: статусы' },
                { value: 'priority', label: 'Группировка: приоритет' },
                { value: 'assignee', label: 'Группировка: исполнители' },
              ]}
            />
          </div>
        )}
        <button
          onClick={() => setOnlyMine(v => !v)}
          className={clsx(
            'inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border transition-colors',
            onlyMine
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
              : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
          )}
        >
          <UserIcon size={14} /> Только мои
        </button>
        <button
          onClick={() => setOverdueOnly(v => !v)}
          className={clsx(
            'inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border transition-colors',
            overdueOnly
              ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
          )}
        >
          <AlertTriangle size={14} /> Просроченные
        </button>
        <button
          onClick={() => setBlockedOnly(v => !v)}
          className={clsx(
            'inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border transition-colors',
            blockedOnly
              ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
              : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200',
          )}
          title="Показать только заблокированные задачи"
        >
          ⛔ Только блокеры
        </button>
        {canManage && (
          <div className="relative">
            <button
              onClick={() => setTriageOpen(o => !o)}
              className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
              title="Назначить просроченные задачи исполнителю"
            >
              Разобрать просрочки
            </button>
            {triageOpen && (
              <div className="absolute z-30 mt-1.5 w-64 card !p-3 space-y-2 shadow-lg">
                <p className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                  Кому назначить просроченные?
                </p>
                <button
                  className="btn-secondary w-full !py-1.5 text-sm"
                  disabled={triageMut.isPending}
                  onClick={() => runTriage(myId || undefined)}
                >
                  Назначить на меня
                </button>
                <div className="w-full">
                  <Select
                    value={triageAssignee}
                    onChange={setTriageAssignee}
                    placeholder="Выбрать исполнителя…"
                    options={users.map(u => ({ value: u.id, label: u.name }))}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="btn-secondary !py-1 text-xs" onClick={() => setTriageOpen(false)}>
                    Отмена
                  </button>
                  <button
                    className="btn-primary !py-1 text-xs"
                    disabled={!triageAssignee || triageMut.isPending}
                    onClick={() => runTriage(triageAssignee)}
                  >
                    {triageMut.isPending ? 'Назначаю…' : 'Назначить'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Фильтр по спринту: все / без спринта / конкретный. */}
        <div className="w-44">
          <Select
            value={sprintFilter}
            onChange={setSprintFilter}
            placeholder="Все спринты"
            options={[
              { value: 'none', label: 'Без спринта' },
              ...sprints.map(s => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
        {canManage && sprintFilter !== '' && sprintFilter !== 'none' && (
          <div className="relative">
            <button
              onClick={() => setCompleteOpen(o => !o)}
              className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
              title="Завершить выбранный спринт"
            >
              Завершить спринт
            </button>
            {completeOpen && (
              <div className="absolute z-30 mt-1.5 w-64 card !p-3 space-y-2 shadow-lg">
                <p className="text-xs font-semibold text-surface-700 dark:text-surface-300">
                  Куда перенести открытые задачи?
                </p>
                <div className="w-full">
                  <Select
                    value={completeTarget}
                    onChange={setCompleteTarget}
                    options={[
                      { value: 'backlog', label: 'В бэклог' },
                      ...sprints.filter(s => s.id !== sprintFilter).map(s => ({ value: s.id, label: `В спринт «${s.name}»` })),
                    ]}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button className="btn-secondary !py-1 text-xs" onClick={() => setCompleteOpen(false)}>
                    Отмена
                  </button>
                  <button
                    className="btn-primary !py-1 text-xs"
                    disabled={completeSprintMut.isPending}
                    onClick={() => runCompleteSprint(sprintFilter, completeTarget)}
                  >
                    {completeSprintMut.isPending ? 'Завершаю…' : 'Завершить'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Активные теги-фильтры: × снимает один, «Очистить» — все. */}
      {!!tagFilter.length && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-xs text-surface-500 dark:text-surface-400">Теги:</span>
          {tagFilter.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300"
            >
              {tag}
              <button
                type="button"
                onClick={() => toggleTag(tag)}
                className="hover:text-primary-900 dark:hover:text-primary-100 transition-colors"
                title={`Убрать тег ${tag}`}
                aria-label={`Убрать тег ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setTagFilter([])}
            className="text-xs text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:underline transition-colors"
          >
            Очистить
          </button>
        </div>
      )}

      {/* Bulk-панель (Notion-стиль): появляется при выделении в таблице. */}
      {view === 'table' && canManage && selected.size > 0 && (
        <div className="card !py-2.5 !px-4 mb-4 flex flex-wrap items-center gap-2 sm:gap-3 text-sm">
          <span className="font-medium text-surface-800 dark:text-surface-200 tabular-nums w-full sm:w-auto">
            Выбрано: {selected.size}
          </span>
          <div className="w-full sm:w-44">
            <Select
              value=""
              onChange={v => v && doBulk('status', v)}
              placeholder="Статус…"
              options={DEV_TASK_STATUSES.map(s => ({ value: s, label: DEV_STATUS_LABELS[s] }))}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              value=""
              onChange={v => v && doBulk('priority', v)}
              placeholder="Приоритет…"
              options={(Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[])
                .map(p => ({ value: p, label: DEV_PRIORITY_LABELS[p] }))}
            />
          </div>
          <div className="w-full sm:w-44">
            <Select
              value=""
              onChange={v => {
                if (!v) return
                doBulk('assignee', v === '__none__' ? '' : v)
              }}
              placeholder="Исполнитель…"
              options={[
                ...users.map(u => ({ value: u.id, label: u.name })),
                { value: '__none__', label: 'Снять исполнителя' },
              ]}
            />
          </div>
          <div className="flex w-full sm:w-auto items-center gap-1.5">
            <BoardDatePicker
              value={bulkDeadline}
              onChange={setBulkDeadline}
              placeholder="Дедлайн…"
              className="flex-1 sm:flex-none sm:w-40"
            />
            <button
              type="button"
              className="min-h-[40px] px-2.5 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors disabled:opacity-50"
              onClick={() => bulkDeadline && doBulk('deadline', bulkDeadline)}
              disabled={!bulkDeadline || bulkMut.isPending}
              title="Применить дедлайн к выбранным"
            >
              ОК
            </button>
            <button
              type="button"
              className="min-h-[40px] px-2 text-xs text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:underline transition-colors"
              onClick={() => doBulk('deadline', '')}
              disabled={bulkMut.isPending}
              title="Очистить дедлайн у выбранных"
            >
              Очистить
            </button>
          </div>
          <div className="flex w-full sm:w-auto flex-wrap items-center gap-1.5">
            {!bulkBlockOpen ? (
              <button
                type="button"
                className="w-full sm:w-auto justify-center min-h-[40px] px-2.5 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                onClick={() => setBulkBlockOpen(true)}
                title="Заблокировать выбранные с указанием причины"
              >
                ⛔ Блокер
              </button>
            ) : (
              <>
                <input
                  className="input !py-1.5 !min-h-[40px] text-sm flex-1 min-w-[140px] sm:w-44 sm:flex-none"
                  value={bulkBlockReason}
                  onChange={e => setBulkBlockReason(e.target.value)}
                  placeholder="Причина блокера…"
                  autoFocus
                  maxLength={500}
                  aria-label="Причина блокера для выбранных задач"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const v = bulkBlockReason.trim()
                      if (!v) { toast.error('Укажите причину блокера'); return }
                      doBulk('blocked', v)
                    }
                    if (e.key === 'Escape') { setBulkBlockOpen(false); setBulkBlockReason('') }
                  }}
                />
                <button
                  type="button"
                  className="min-h-[40px] px-2.5 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                  onClick={() => {
                    const v = bulkBlockReason.trim()
                    if (!v) { toast.error('Укажите причину блокера'); return }
                    doBulk('blocked', v)
                  }}
                  disabled={bulkMut.isPending}
                  title="Заблокировать выбранные"
                >
                  ОК
                </button>
                <button
                  type="button"
                  className="min-h-[40px] px-2 text-xs text-surface-500 dark:text-surface-400 hover:underline transition-colors"
                  onClick={() => { setBulkBlockOpen(false); setBulkBlockReason('') }}
                >
                  Отмена
                </button>
              </>
            )}
            <button
              type="button"
              className="min-h-[40px] px-2 text-xs text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 hover:underline transition-colors"
              onClick={() => doBulk('blocked', '')}
              disabled={bulkMut.isPending}
              title="Снять блокер с выбранных"
            >
              Снять блокер
            </button>
          </div>
          <button
            className="w-full sm:w-auto justify-center min-h-[40px] inline-flex items-center gap-1.5 px-2.5 rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            onClick={() => doBulk('delete', '')}
            disabled={bulkMut.isPending}
          >
            <Trash2 size={14} /> Удалить
          </button>
          <button
            className="min-h-[40px] text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200 transition-colors"
            onClick={() => setSelected(new Set())}
          >
            Снять выделение
          </button>
          {bulkMut.isPending && <span className="text-xs text-surface-400">Применяю…</span>}
        </div>
      )}

      {isLoading ? (
        <PageLoader />
      ) : isError ? (
        <div className="card">
          <EmptyState
            title={isForbidden ? 'Нет доступа' : 'Не удалось загрузить доску'}
            description={
              isForbidden
                ? 'У вас нет прав для просмотра доски разработки.'
                : 'Проверьте подключение и попробуйте ещё раз.'
            }
            action={
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="btn-primary inline-flex items-center gap-2"
              >
                <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
                Повторить
              </button>
            }
          />
        </div>
      ) : (
        <div key={view} className="dev-view-enter flex min-h-0 flex-1 flex-col">
          {view === 'calendar' ? (
        <MonthCalendar
          tasks={filtered.filter(t => t.parentTaskId == null)}
          onOpen={id => navigate(taskUrl(id))}
          canCreate={canManage}
          onCreateAt={iso => {
            // Создание задач — только CEO/PM (dev-tracker.manage).
            // Без права кнопки «+» скрыты, но URL ?create=1 мог открыть модалку —
            // здесь второй рубеж обороны с понятным текстом вместо 403.
            if (!canManage) { toast.error('Создавать задачи могут CEO и PM разработки'); return }
            // Клик по дню календаря — модалка создания с проставленным дедлайном.
            setCreateDate(iso)
            setCreateStatus('todo')
          }}
          onDeadDrop={(id, iso) => updateField(id, { deadline: iso })}
        />
      ) : view === 'table' ? (
        <TasksTable
          rows={tableRows}
          users={users}
          canManage={canManage}
          sortKey={sortKey}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          onStatus={changeStatus}
          onUpdate={updateField}
          onOpen={id => navigate(taskUrl(id))}
          onQuickAdd={title => quickAdd(title, { projectId: activeProjectId })}
          quickAddPending={createMut.isPending}
          selected={selected}
          onToggle={toggleSelect}
          onToggleAll={toggleSelectAll}
          allTopIds={tableTopIds}
          onTagClick={toggleTag}
        />
      ) : view === 'timeline' ? (
        <TimelineView
          tasks={filtered.filter(t => t.parentTaskId == null)}
          users={users}
          groupBy={groupBy}
          onOpen={id => navigate(taskUrl(id))}
          onDatesChange={(id, dates) => updateField(id, dates)}
          canManage={canManage}
        />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 items-start min-h-0 flex-1 snap-x snap-proximity md:snap-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {boardColumns.map(col => (
            <div
              key={col.key}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverKey(col.key) }}
              onDragLeave={() => setDragOverKey(k => (k === col.key ? null : k))}
              onDrop={e => onColumnDrop(e, col)}
              className={clsx(
                'shrink-0 snap-start w-[85vw] max-w-[20rem] md:w-72 md:max-w-none rounded-lg bg-surface-100/70 dark:bg-surface-900/40 border dev-drop-glow',
                dragOverKey === col.key
                  ? 'border-primary-500 dark:border-primary-400'
                  : 'border-surface-200 dark:border-surface-800',
              )}
            >
              <div className="sticky top-0 z-10 rounded-t-lg bg-surface-100/95 dark:bg-surface-900/95 backdrop-blur flex items-center gap-2 px-3 py-2.5">
                {col.dotClass && <span className={clsx('w-2 h-2 rounded-full shrink-0', col.dotClass)} />}
                <span className="text-sm font-semibold text-surface-800 dark:text-surface-200 truncate">
                  {col.label}
                </span>
                {(() => {
                  const limit = col.status ? wipLimits[col.status] : undefined
                  if (limit == null) {
                    return (
                      <span className="text-xs text-surface-400 dark:text-surface-500 tabular-nums">
                        {col.tasks.length}
                      </span>
                    )
                  }
                  const over = col.tasks.length > limit
                  return (
                    <span
                      className={clsx(
                        'text-xs tabular-nums px-1.5 py-0.5 rounded',
                        over
                          ? 'font-bold bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                          : 'text-surface-400 dark:text-surface-500',
                      )}
                      title={over ? `WIP-лимит превышен: ${col.tasks.length}/${limit}` : `WIP-лимит: ${col.tasks.length}/${limit}`}
                    >
                      {col.tasks.length}/{limit}
                    </span>
                  )
                })()}
                {col.status && canManage && (
                  <button
                    className="ml-auto min-w-[40px] min-h-[40px] flex items-center justify-center rounded text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                    title={`Добавить задачу в «${DEV_STATUS_LABELS[col.status]}»`}
                    aria-label={`Добавить задачу в «${DEV_STATUS_LABELS[col.status]}»`}
                    onClick={() => setCreateStatus(col.status || null)}
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>

              <div className="px-2 pb-2 space-y-2 min-h-[60px]">
                {canManage && (
                  <QuickAdd
                    placeholder="Новая задача…"
                    disabled={createMut.isPending}
                    onSubmit={title => quickAdd(title, {
                      status: col.status,
                      priority: col.priority,
                      assigneeId: col.assigneeId,
                      projectId: activeProjectId,
                    })}
                  />
                )}
                {col.tasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    dragging={dragId === task.id}
                    onDragStart={e => onCardDragStart(e, task.id)}
                    onDragEnd={() => { setDragId(null); setDragOverKey(null) }}
                    onTagClick={toggleTag}
                    onStatus={changeStatus}
                    sprintName={task.sprintId ? (sprintNameById.get(task.sprintId) || null) : null}
                  />
                ))}
                {!col.tasks.length && (
                  <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-4">
                    {dragId ? 'Перетащите сюда' : 'Задач нет'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
          )}
        </div>
      )}

      <CreateTaskModal
        open={createStatus !== null}
        status={createStatus || 'backlog'}
        users={users}
        projects={devProjects.map(p => ({ value: p.id, label: p.name }))}
        initialProjectId={activeProjectId}
        initialDeadline={createDate}
        canCreate={canManage}
        onClose={() => { setCreateStatus(null); setCreateDate(undefined) }}
      />

      <QuickSearchModal
        open={searchOpen}
        tasks={Array.isArray(tasks) ? tasks : []}
        users={users}
        canManage={canManage}
        onClose={() => setSearchOpen(false)}
        onPick={id => { setSearchOpen(false); navigate(taskUrl(id)) }}
        onCreateCommand={slashCreate}
        onMoveCommand={slashMove}
        onAssignCommand={slashAssign}
      />

      <WebhooksModal
        open={webhooksOpen}
        onClose={() => setWebhooksOpen(false)}
        projects={devProjects.map(p => ({ value: p.id, label: p.name }))}
        canManage={canManage}
      />
    </div>
  )
}

