import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Briefcase, Plus, Trash2, CalendarDays, Send,
  Check, ChevronDown, CircleDot, CornerDownRight, Copy, Eye, FileText, Flag,
  Hash, History, Link2, ListChecks, Loader2, Paperclip, Pencil, Tags, Type,
  AlignLeft, X, Ban, User as UserIcon,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import api from '@/lib/api'
import { devTrackerApi, usersApi, projectsApi, filesApi } from '@/services/api.service'
import { Markdown } from './markdown'
import './animations.css'
import { BoardDatePicker } from './BoardDatePicker'
import { Avatar, PageLoader, ConfirmDialog, EmptyState } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import {
  DEV_TASK_STATUSES, DEV_STATUS_LABELS, DEV_STATUS_COLORS,
  DEV_PRIORITY_LABELS, DEV_TASK_TYPE_LABELS, DEV_STORY_POINTS,
  TYPE_ICONS, PRIORITY_DOTS,
  isDevTaskOverdue, fmtDeadline,
  ASSIGNEE_ROLES, selectDevProjects,
  type DevTask, type DevTaskStatus, type DevTaskPriority, type DevTaskType,
  type DevTaskDetail, type BoardUser,
} from './devBoardTypes'
import { boardUrl, taskUrl, projectUrl } from '@/pages/dev/devLinks'

/**
 * Детальная карточка задачи «Доски разработки» в духе страницы базы данных
 * Notion: хлебная крошка родителя, крупный inline-заголовок, вертикальный
 * список свойств (иконка + подпись + значение), подзадачи с прогрессом,
 * автосохраняемое описание и комментарии.
 *
 * Права:
 *  - смена статуса и отметка подзадач идут через PATCH /dev-tracker/:id/move —
 *    доступно всем, у кого есть право просмотра доски;
 *  - остальные поля (title/description/priority/taskType/assigneeId/
 *    storyPoints/tags/deadline) и удаление — только dev-tracker.manage
 *    (обычный PATCH /dev-tracker/:id).
 *
 * Типы и константы — общие из ./devBoardTypes (единый источник модуля),
 * ссылки — через @/pages/dev/devLinks.
 */

// ── Тип детального ответа GET /dev-tracker/:id ──────────────────────────
type Detail = DevTaskDetail

// ── Локальные типы ленты истории (контракт этой страницы) ───────────────

/** Запись ленты истории: GET /dev-tracker/:id/history. */
interface DevHistoryEntry {
  id: string
  field: string
  from: string | null
  to: string | null
  actor: { id: string; name: string } | null
  createdAt: string
}

/** '2026-09-21T14:03:..' → '21.09, 14:03'. */
function fmtHistoryDate(iso: string): string {
  // createdAt может прийти null/пустым (частичный контракт) — new Date(null)
  // даёт эпоху 01.01.1970 вместо «нет даты», поэтому явный гард.
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ', ')
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}, ${p(d.getHours())}:${p(d.getMinutes())}`
}

const HISTORY_FIELD_LABELS: Record<string, string> = {
  status: 'статус',
  assignee: 'исполнителя',
  priority: 'приоритет',
  deadline: 'дедлайн',
  title: 'название',
  description: 'описание',
  blockedReason: 'причину блокера',
  isBlocked: 'блокер',
  tags: 'теги',
  storyPoints: 'story points',
  taskType: 'тип задачи',
  projectId: 'проект',
  parentTaskId: 'родительскую задачу',
  attachments: 'вложения',
}

/** Человекочитаемое значение истории: status/priority через лейблы, остальное сырым. */
function historyValue(field: string, v: string | null): string {
  if (v == null || v === '') return '—'
  if (field === 'status') return DEV_STATUS_LABELS[v as DevTaskStatus] ?? v
  if (field === 'priority') return DEV_PRIORITY_LABELS[v as DevTaskPriority] ?? v
  if (field === 'deadline' && /^\d{4}-\d{2}-\d{2}/.test(v)) return fmtDeadline(v, true)
  // Длинные тексты (описание/вложения) не раздуваем строку истории.
  if ((field === 'description' || field === 'attachments') && v.length > 120) {
    return `${v.slice(0, 120).trimEnd()}…`
  }
  return v
}

/** Имя файла — последний сегмент URL. */
function fileNameFromUrl(url: string): string {
  try {
    const clean = url.split('?')[0].split('#')[0]
    const seg = clean.split('/').filter(Boolean).pop() || url
    return decodeURIComponent(seg)
  } catch {
    return url
  }
}

/** Картинки — превью <img>, остальное — ссылкой. */
function isImageUrl(url: string): boolean {
  return /\.(jpe?g|png|gif|webp)(\?.*)?(#.*)?$/i.test(url)
}

/** Относительный /uploads/... резолвим через VITE_API_URL, http(s) — как есть. */
function resolveFileUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const base = (import.meta.env.VITE_API_URL as string | undefined) || ''
  return `${base}${url.startsWith('/') ? url : `/${url}`}`
}

/** Опасные схемы (javascript:/data:/vbscript:) во вложениях запрещены. */
function isSafeAttachmentUrl(url: string): boolean {
  return !/^\s*(javascript|data|vbscript|file)\s*:/i.test(url || '')
}

const LIST_KEY = ['dev-tracker', 'list'] as const

// BoardUser — общий из ./devBoardTypes (единый источник, те же поля
// avatar/avatarUrl, что на доске).

// ─ Notion-стиль: строка свойства и выпадающий выбор значения ─────────
interface SelectOption {
  value: string
  label: string
  dotClass?: string
}

/** Строка блока свойств: серая подпись слева, значение справа. */
function PropRow({ icon: Icon, label, children }: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  label: string
  children: ReactNode
}) {
  // Mobile (360–480px): подпись над значением; sm+ — как было (подпись слева).
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3 px-3 py-2">
      <div className="shrink-0 flex items-center gap-2 sm:pt-1 sm:w-36 text-xs text-surface-400 dark:text-surface-500">
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 min-w-0 max-w-full break-words">{children}</div>
    </div>
  )
}

/**
 * Выпадающий выбор значения (Notion popover). Без прав возвращает обычный
 * текст — кликать не по чему, значение просто отображается.
 */
function NotionSelect({ value, options, onChange, canEdit, placeholder = '—', renderValue, label }: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  canEdit: boolean
  placeholder?: string
  renderValue?: (o: SelectOption) => ReactNode
  /** Подпись свойства (PropRow) — для aria-label триггера: без неё
   *  скринридер читает только значение («Срочный») без контекста («Приоритет»). */
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Не отдаём Escape родителям и возвращаем фокус на триггер,
        // иначе фокус падает в body и клавиатурный пользователь теряется.
        e.stopPropagation()
        setOpen(false)
        btnRef.current?.focus({ preventScroll: true })
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = options.find(o => o.value === value)
  const shown = active ? (renderValue ? renderValue(active) : active.label) : null

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-2 min-w-0 text-sm text-surface-700 dark:text-surface-300">
        {shown ?? <span className="text-surface-400 dark:text-surface-500">{placeholder}</span>}
      </span>
    )
  }

  return (
    <div ref={ref} className="relative block max-w-full">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label ? `${label}: ${active?.label ?? placeholder}` : undefined}
        className="inline-flex items-center gap-1.5 max-w-full min-h-[40px] sm:min-h-0 -mx-1.5 px-1.5 py-0.5 rounded text-sm text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors text-left"
      >
        <span className="min-w-0 break-words">
          {shown ?? <span className="text-surface-400 dark:text-surface-500">{placeholder}</span>}
        </span>
        <ChevronDown size={12} className="shrink-0 text-surface-400" />
      </button>
      {open && (
        <div role="listbox" className="absolute right-0 sm:left-0 sm:right-auto z-40 mt-1 min-w-[210px] max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-1">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-surface-400 dark:text-surface-500">Нет вариантов</p>
          ) : options.map(o => (
            <button
              key={o.value || '__empty'}
              type="button"
              role="option"
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={clsx(
                'w-full min-h-[40px] flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors',
                'text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800',
                o.value === value && 'bg-surface-50 dark:bg-surface-800/70',
              )}
            >
              {o.dotClass && <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', o.dotClass)} />}
              <span className="flex-1 truncate">{o.label}</span>
              {o.value === value && <Check size={13} className="shrink-0 text-primary-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Превью вложения: битая картинка → иконка файла, а не пустой <img>. */
function AttachThumb({ url }: { url: string }) {
  const [broken, setBroken] = useState(false)
  const src = resolveFileUrl(url)
  if (!isImageUrl(url) || broken) {
    return (
      <span className="w-14 h-14 shrink-0 rounded-md bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
        <FileText size={20} className="text-surface-400" />
      </span>
    )
  }
  return (
    <a href={src} target="_blank" rel="noreferrer noopener" className="shrink-0">
      <img
        src={src}
        alt={fileNameFromUrl(url)}
        loading="lazy"
        className="w-14 h-14 max-w-full rounded-md object-cover bg-surface-100 dark:bg-surface-800"
        onError={() => setBroken(true)}
      />
    </a>
  )
}

export default function DevTaskDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore(s => s.user)
  const canManage = userCan(user, 'dev-tracker.manage')

  const detailKey = ['dev-tracker', 'detail', id] as const

  const { data: task, isLoading, isError, error, refetch } = useQuery<Detail>({
    queryKey: detailKey,
    queryFn: () => devTrackerApi.get(id),
    enabled: !!id,
    retry: 1,
  })
  const detailStatus = (error as { response?: { status?: number } } | null)?.response?.status

  // Название родителя для хлебной крошки — отдельный лёгкий запрос.
  const parentId = task?.parentTaskId || ''
  const { data: parent } = useQuery<Detail>({
    queryKey: ['dev-tracker', 'detail', parentId],
    queryFn: () => devTrackerApi.get(parentId),
    enabled: !!parentId,
    staleTime: 60_000,
  })

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

  // Проекты «Разработка» — из /dev/projects, но отбираем dev-типы по projectType.
  // ВАЖНО: хук выше ранних return isLoading/isError (Rules of Hooks).
  const { data: rawProjects } = useQuery<any[]>({
    queryKey: ['dev-projects-for-task'],
    queryFn: () => projectsApi.list({}),
    staleTime: 120_000,
  })

  // Лента истории — напрямую тем же axios-инстансом (api.service не трогаем):
  // GET /dev-tracker/:id/history. Retry выключен; 404 трактуем как «История
  // пуста», а сетевые/5xx ошибки — отдельной плашкой (см. historyStatus ниже).
  const historyKey = ['dev-tracker', 'detail', id, 'history'] as const
  // ВАЖНО: берём `error` (объект axios), а не `isError` (boolean) — иначе
  // response.status ниже недоступен (TS2352) и любая ошибка истории выглядела
  // бы как «не загрузилось» без статуса. 404 отличаем от сети/5xx по нему.
  const { data: historyData, isLoading: historyLoading, error: historyError, refetch: refetchHistory } = useQuery<DevHistoryEntry[]>({
    queryKey: historyKey,
    queryFn: () => api.get(`/dev-tracker/${id}/history`).then(r => r.data),
    enabled: !!id,
    retry: false,
    staleTime: 30_000,
  })
  const history: DevHistoryEntry[] = Array.isArray(historyData) ? historyData : []
  // 404 (задача/эндпоинт недоступны) остаётся «История пуста»; прочие ошибки
  // (сеть/5xx) не должны выглядеть как отсутствие данных.
  const historyStatus = (historyError as unknown as { response?: { status?: number } } | null)?.response?.status

  // ── Локальное состояние ────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [description, setDescription] = useState('')
  const [commentText, setCommentText] = useState('')
  const [newSubtask, setNewSubtask] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Блокер: черновик причины (синхронизируется с задачей, сохраняется на blur).
  const [blockReason, setBlockReason] = useState('')
  // Описание: режим просмотра (Markdown) / редактирование (textarea с автосейвом).
  const [descEditing, setDescEditing] = useState(false)
  // Файлы: ссылка для добавления + загрузка через filesApi.
  const [attachLink, setAttachLink] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  // Клонирование: маленький popover «с подзадачами?».
  const [cloneOpen, setCloneOpen] = useState(false)
  // @mention в комментарии: запрос после `@`, индекс подсветки, выбранные id.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const cloneRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const mentionWrapRef = useRef<HTMLDivElement>(null)

  // Mention-поповер закрываем кликом мимо (как clone/NotionSelect).
  useEffect(() => {
    if (mentionQuery == null) return
    const close = (e: MouseEvent) => {
      if (!mentionWrapRef.current?.contains(e.target as Node)) setMentionQuery(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [mentionQuery == null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Popover клонирования закрываем кликом мимо и по Esc.
  useEffect(() => {
    if (!cloneOpen) return
    const close = (e: MouseEvent) => {
      if (!cloneRef.current?.contains(e.target as Node)) setCloneOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCloneOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [cloneOpen])
  // Описание не должно уезжать на сервер сразу после загрузки: автосохранение
  // включаем только после правки пользователем.
  const descTouched = useRef(false)
  // Pending-значение черновика: пишется синхронно в onChange и сбрасывается
  // по факту отправки — cleanup-Flush (см. эффект синхронизации задачи ниже)
  // подхватывает его при размонтировании/смене задачи.
  const descPending = useRef<string | null>(null)
  // Значение, которое бэк уже отклонил: без этого флага onError (откат кэша
  // меняет deps) перезапускал бы таймер по кругу — PATCH каждые 800 мс и спам
  // тостов при устойчивой ошибке (403/413/офлайн). Сбрасывается в onChange.
  const descFailedRef = useRef<string | null>(null)
  // id задачи-владельца черновика: обновляется в теле эффекта, а не в рендере,
  // чтобы cleanup шлёт flush на ПРЕДЫДУЩУЙ задаче при A→B, а не на новую.
  const descIdRef = useRef('')
  const canManageRef = useRef(canManage)
  canManageRef.current = canManage

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description || '')
    setEditingTitle(false)
    descTouched.current = false
    descIdRef.current = task.id
    return () => {
      // Flush черновика описания — и при размонтировании, и при смене задачи:
      // переход A→B меняет params без размонтирования (тот же роут), отдельный
      // эффект на [] такое не ловил и правка <800 мс до ухода терялась.
      // Fire-and-forget: без тостов, ошибку глотаем.
      if (descTouched.current && descPending.current != null && canManageRef.current && descIdRef.current) {
        const draft = descPending.current
        descTouched.current = false
        descPending.current = null
        devTrackerApi.update(descIdRef.current, { description: draft || null }).catch(() => {})
      }
    }
  }, [task?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Черновик причины блокера — отдельно от title/description, чтобы рефетч
  // blockedReason не сбрасывал несохранённое описание и наоборот.
  useEffect(() => {
    if (task) setBlockReason(task.blockedReason || '')
  }, [task?.id, task?.blockedReason]) // eslint-disable-line react-hooks/exhaustive-deps

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: detailKey })
    qc.invalidateQueries({ queryKey: LIST_KEY })
  }

  /** Позиция в конце целевой колонки (по кэшу списка доски).
   *  Ключ доски — LIST_KEY + суффиксы фильтров (см. DevBoardPage listQueryKey),
   *  поэтому точный getQueryData(LIST_KEY) почти всегда undefined и позиция
   *  «уезжала» в 0. Ищем по префиксу: берём кэш, в котором есть эта задача. */
  const nextPosition = (status: DevTaskStatus, excludeId: string) => {
    let fallback = 0
    for (const [, data] of qc.getQueriesData<DevTask[]>({ queryKey: LIST_KEY })) {
      if (!Array.isArray(data) || data.length === 0) continue
      const count = data.filter(t => t.status === status && t.id !== excludeId).length
      if (data.some(t => t.id === excludeId)) return count
      fallback = count
    }
    return fallback
  }

  // ── Мутации ───────────────────────────────────────────────────────
  const updateMut = useMutation({
    mutationKey: ['dev-tracker-update', id],
    mutationFn: (data: any) => devTrackerApi.update(id, data),
    onMutate: async (data: any) => {
      await qc.cancelQueries({ queryKey: detailKey })
      const previous = qc.getQueryData<Detail>(detailKey)
      const patch: any = { ...data }
      // Смена исполнителя: обновляем и объект assignee оптимистично,
      // иначе shallow-merge {...old, ...data} оставит stale assignee.
      if ('assigneeId' in data) {
        if (data.assigneeId == null) {
          patch.assignee = null
        } else if (previous?.assignee?.id === data.assigneeId) {
          // Тот же исполнитель — сохраняем полный объект (аватар), иначе
          // optimistic merge сбросит avatarUrl до рефетча.
          patch.assignee = previous.assignee
        } else {
          const cachedUsers = qc.getQueryData<BoardUser[]>(['users', 'dev-board-assignees'])
          const found = (Array.isArray(cachedUsers) ? cachedUsers : []).find(u => u.id === data.assigneeId)
          // Аватар берём из кэша пользователей (avatarUrl || avatar, как на
          // доске): иначе optimistic merge стирал аватар до рефетча.
          // Не нашли в кэше — оставляем stale до рефетча, а не undefined.
          if (found) patch.assignee = { id: found.id, name: found.name, avatarUrl: found.avatarUrl ?? found.avatar ?? previous?.assignee?.avatarUrl ?? null }
          else delete patch.assignee
        }
        // Минимум: сразу инвалидируй список, чтобы refetch подтянул assignee.
        qc.invalidateQueries({ queryKey: LIST_KEY })
      }
      qc.setQueryData<Detail>(detailKey, (old: any) => old ? { ...old, ...patch } : old)
      return { previous }
    },
    onError: (e: any, variables: any, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(detailKey, ctx.previous)
      // Описание не теряем при ошибке: таймер уже снял touched/pending перед
      // mutate — возвращаем черновик, чтобы следующая правка/Flush довели его
      // до сервера, а rollback не оставил в textarea мёртвый текст.
      if (variables && typeof variables === 'object' && 'description' in variables) {
        descTouched.current = true
        const failed = typeof variables.description === 'string' ? variables.description : ''
        descPending.current = failed
        descFailedRef.current = failed
      }
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось сохранить'))
    },
    onSettled: () => {
      // isMutating считает только pending-мутации: settled уже не в счётчике,
      // поэтому «последняя завершилась» — это 0, а не 1 (иначе одиночный
      // апдейт никогда не инвалидировался и кэш расходился с сервером).
      if (qc.isMutating({ mutationKey: ['dev-tracker-update', id] }) === 0) invalidateAll()
    },
  })

  /**
   * Смена статуса (своя или подзадачи) — только через /move: он доступен
   * каждому с правом просмотра доски, в отличие от обычного PATCH.
   */
  const moveMut = useMutation({
    mutationKey: ['dev-tracker-detail-move'],
    mutationFn: ({ taskId, status, position }: { taskId: string; status: DevTaskStatus; position: number }) =>
      devTrackerApi.move(taskId, { status, position }),
    onMutate: async ({ taskId, status }) => {
      await qc.cancelQueries({ queryKey: detailKey })
      const previous = qc.getQueryData<Detail>(detailKey)
      qc.setQueryData<Detail>(detailKey, (old: any) => {
        if (!old) return old
        // completedAt обновляем оптимистично вместе со статусом.
        if (old.id === taskId) {
          return {
            ...old,
            status,
            completedAt: status === 'done' ? (old.completedAt ?? new Date().toISOString()) : null,
          }
        }
        return {
          ...old,
          subtasks: (old.subtasks || []).map((s: DevTask) =>
            s.id === taskId
              ? { ...s, status, completedAt: status === 'done' ? (s.completedAt ?? new Date().toISOString()) : null }
              : s,
          ),
        }
      })
      return { previous }
    },
    onError: (e: any, _v, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(detailKey, ctx.previous)
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось изменить статус'))
    },
    onSettled: () => {
      // Инвалидируем, только когда последний move завершился: ранний refetch
      // успевал затереть оптимистичный статус ещё летящих мутаций при быстрых
      // переключениях чек-боксов подзадач. isMutating считает только pending,
      // settled уже исключён — «все долетели» это 0.
      if (qc.isMutating({ mutationKey: ['dev-tracker-detail-move'] }) === 0) invalidateAll()
    },
  })

  const subtaskCreateMut = useMutation({
    mutationKey: ['dev-tracker-subtask-create', id],
    mutationFn: (subtaskTitle: string) => {
      if (!canManage) return Promise.reject(new Error('Недостаточно прав'))
      return devTrackerApi.create({
        title: subtaskTitle,
        parentTaskId: id,
        status: 'todo',
        // Подзадача наследует проект родителя, иначе теряется привязка.
        ...(task?.projectId ? { projectId: task.projectId } : {}),
      })
    },
    onSuccess: () => {
      setNewSubtask('')
      invalidateAll()
      toast.success('Подзадача добавлена')
    },
    // Guard внутри mutationFn реджектит Error('Недостаточно прав') без response —
    // без e?.message тост показывал бы generic вместо понятного текста.
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось добавить подзадачу'))
    },
  })

  const subtaskDeleteMut = useMutation({
    mutationKey: ['dev-tracker-subtask-delete', id],
    mutationFn: (subtaskId: string) => {
      if (!canManage) return Promise.reject(new Error('Недостаточно прав'))
      return devTrackerApi.remove(subtaskId)
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Подзадача удалена')
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось удалить подзадачу'))
    },
  })

  const commentMut = useMutation({
    mutationFn: (payload: { text: string; mentions: string[] }) =>
      api.post(`/dev-tracker/${id}/comments`, payload).then(r => r.data),
    onSuccess: () => {
      setCommentText('')
      setMentionIds([])
      setMentionQuery(null)
      qc.invalidateQueries({ queryKey: detailKey })
      toast.success('Комментарий добавлен')
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось отправить комментарий'))
    },
  })

  /** Отправка комментария вместе с mentions (UUID упомянутых). */
  const sendComment = () => {
    const v = commentText.trim()
    if (!v || commentMut.isPending) return
    if (v.length > 5000) { toast.error('Комментарий слишком длинный (максимум 5000 символов)'); return }
    // Чистим stale id: пользователь мог стереть @Имя из текста после вставки.
    const validIds = mentionIds.filter(mid => {
      const u = users.find(x => x.id === mid)
      return u ? v.includes(`@${u.name}`) : false
    })
    commentMut.mutate({ text: v, mentions: validIds })
  }

  /** Клонирование задачи (только manage): существующий devTrackerApi.clone
   *  (новых методов в api.service не добавляем), с canManage-guard. */
  const cloneMut = useMutation({
    mutationFn: (withSubtasks: boolean) => {
      if (!canManage) return Promise.reject(new Error('Недостаточно прав'))
      return devTrackerApi.clone(id, withSubtasks)
    },
    onSuccess: (fresh: any) => {
      setCloneOpen(false)
      qc.invalidateQueries({ queryKey: LIST_KEY })
      toast.success('Задача клонирована')
      const nid = fresh?.id
      if (nid) navigate(taskUrl(nid))
      else qc.invalidateQueries({ queryKey: detailKey })
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось клонировать задачу'))
    },
  })

  const deleteMut = useMutation({
    mutationFn: () => {
      if (!canManage) return Promise.reject(new Error('Недостаточно прав'))
      return devTrackerApi.remove(id)
    },
    onSuccess: () => {
      // Кэш удалённой задачи убираем иначе по Back страница мелькает старым
      // телом до 404-рефетча: react-query держит данные и при isError.
      qc.removeQueries({ queryKey: detailKey })
      qc.invalidateQueries({ queryKey: LIST_KEY })
      toast.success('Задача удалена')
      navigate(boardUrl())
    },
    onError: (e: any) => {
      const s = e?.response?.status
      toast.error(s === 403 ? 'Недостаточно прав' : (e?.response?.data?.message || e?.message || 'Не удалось удалить задачу'))
    },
  })

  // ── Автосохранение описания (дебаунс 800 мс) ───────────────────────
  // Deps включают task.description/canManage (иначе stale closure при рефетче
  // параллельно с набором). descPending дублирует черновик синхронно из
  // onChange; flush при размонтировании/смене задачи — в cleanup эффекта
  // синхронизации задачи выше.
  useEffect(() => {
    if (!canManage || !task || !descTouched.current) return
    const value = description.trim()
    // Сравниваем trim↔trim: иначе значение бэка с пробелами даёт ложное
    // «не совпало» и лишний PATCH.
    if (value === (task.description || '').trim()) {
      descPending.current = null
      return
    }
    descPending.current = value
    // Уже отклонено сервером — не планируем повтор (retry-цикл). Повтор
    // разрешён только после новой правки (onChange) или flush-а при уходе.
    if (descFailedRef.current === value) return
    const t = window.setTimeout(() => {
      descTouched.current = false
      descPending.current = null
      updateMut.mutate({ description: value || null })
    }, 800)
    return () => window.clearTimeout(t)
  }, [description, task?.description, canManage]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Хелперы редактирования ────────────────────────────────────────
  const requireManage = () => {
    if (!canManage) toast.error('Недостаточно прав')
    return canManage
  }

  /** Значение истории: id исполнителя резолвим в имя — иначе в ленте UUID. */
  const historyDisplay = (field: string, v: string | null): string => {
    if (field === 'assignee' && v) {
      const u = users.find(x => x.id === v)
      if (u) return u.name
    }
    return historyValue(field, v)
  }

  const commitTitle = () => {
    setEditingTitle(false)
    // Инпут рендерится только с manage, но коммит без гарда уходил бы в PATCH
    // при потере прав между открытием и blur (скрытая кнопка ≠ защита).
    if (!requireManage()) { setTitle(task?.title || ''); return }
    const v = title.trim()
    if (!v) { setTitle(task?.title || ''); return }
    if (v.length > 255) { toast.error('Название слишком длинное (максимум 255 символов)'); setTitle(task?.title || ''); return }
    if (v !== task?.title) updateMut.mutate({ title: v })
  }

  const changeStatus = (status: DevTaskStatus, taskId: string, current: DevTaskStatus) => {
    if (status === current) return
    moveMut.mutate({ taskId, status, position: nextPosition(status, taskId) })
  }

  if (isLoading) return <PageLoader />
  if (isError || !task) {
    const isForbidden = detailStatus === 403
    const isNotFound = detailStatus === 404 || (!isError && !task)
    return (
      <EmptyState
        title={isForbidden ? 'Нет доступа' : isNotFound ? 'Задача не найдена' : 'Не удалось загрузить задачу'}
        description={
          isForbidden
            ? 'У вас нет прав для просмотра этой задачи.'
            : isNotFound
              ? 'Возможно, она была удалена или у вас нет доступа.'
              : 'Проверьте подключение и попробуйте ещё раз.'
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!isForbidden && !isNotFound && (
              <button type="button" onClick={() => refetch()} className="btn-primary inline-flex items-center gap-1.5">
                Повторить
              </button>
            )}
            <Link to={boardUrl()} className="btn-secondary inline-flex items-center gap-1.5">
              <ArrowLeft size={15} /> Назад к доске
            </Link>
          </div>
        }
      />
    )
  }

  const TypeIcon = TYPE_ICONS[task.taskType]?.icon || Plus
  const overdue = isDevTaskOverdue(task)
  // comments/subtasks/tags могут прийти объектом вместо массива (частичный
  // контракт) — || [] пропустил бы объект дальше и .map ронял страницу.
  const comments = Array.isArray(task.comments) ? task.comments : []
  const subtasks: DevTask[] = Array.isArray(task.subtasks) ? task.subtasks : []
  const subTotalRaw = subtasks.length || task.subtasksCount || 0
  const subDoneRaw = subtasks.length
    ? subtasks.filter(s => s.status === 'done').length
    : (task.subtasksDone || 0)
  const subTotal = Number.isFinite(Number(subTotalRaw)) && Number(subTotalRaw) >= 0 ? Math.floor(Number(subTotalRaw)) : 0
  const subDone = Number.isFinite(Number(subDoneRaw)) && Number(subDoneRaw) >= 0 ? Math.min(Math.floor(Number(subDoneRaw)), subTotal || Math.floor(Number(subDoneRaw))) : 0
  const subPct = subTotal ? Math.min(100, Math.max(0, Math.round((Math.min(subDone, subTotal) / subTotal) * 100))) : 0

  const statusOptions: SelectOption[] = DEV_TASK_STATUSES.map(s => ({
    value: s, label: DEV_STATUS_LABELS[s], dotClass: DEV_STATUS_COLORS[s],
  }))
  const priorityOptions: SelectOption[] = (Object.keys(DEV_PRIORITY_LABELS) as DevTaskPriority[])
    .map(p => ({ value: p, label: DEV_PRIORITY_LABELS[p], dotClass: PRIORITY_DOTS[p] }))
  const typeOptions: SelectOption[] = (Object.keys(DEV_TASK_TYPE_LABELS) as DevTaskType[])
    .map(t => ({ value: t, label: DEV_TASK_TYPE_LABELS[t] }))
  const assigneeOptions: SelectOption[] = [
    { value: '', label: 'Не назначен' },
    ...users.map(u => ({ value: u.id, label: u.name })),
  ]
  // rawProjects загружен хуком выше ранних return; здесь только маппинг.
  const devProjectOptions: SelectOption[] = [
    { value: '', label: 'Без проекта' },
    ...selectDevProjects(Array.isArray(rawProjects) ? rawProjects : [])
      .map((p: any) => ({ value: String(p.id), label: String(p.name ?? 'Без названия').trim() || 'Без названия' })),
  ]
  const pointsOptions: SelectOption[] = [
    { value: '', label: 'Не оценено' },
    ...DEV_STORY_POINTS.map(sp => ({ value: String(sp), label: String(sp) })),
  ]

  /** Поля, доступные только с правом управления: без него — предупреждение. */
  const guardedUpdate = (data: any) => {
    if (!requireManage()) return
    if (updateMut.isPending) return
    updateMut.mutate(data)
  }

  // ── Файлы (attachments: string[] через PATCH) ─────────────────────
  const attachments: string[] = Array.isArray((task as { attachments?: unknown }).attachments)
    ? ((task as unknown as { attachments: unknown[] }).attachments).filter((a): a is string => typeof a === 'string')
    : []
  // Файлы — поля обычного PATCH /dev-tracker/:id, а бэк требует на него
  // dev-tracker.manage (controller: @Patch(':id') → @RequirePerm). Форма
  // «или автор» показывала контролы и обещала 403 при сохранении — держимся
  // контракта бэка (см. шапку файла: «остальные поля … только manage»).
  const canEditFiles = canManage

  const saveAttachments = (next: string[]) => {
    if (!canEditFiles) { toast.error('Недостаточно прав'); return }
    if (next.length > 10) { toast.error('Максимум 10 файлов'); return }
    if (next.some(u => !isSafeAttachmentUrl(u))) { toast.error('Некорректная ссылка на файл'); return }
    updateMut.mutate({ attachments: next })
  }

  const addAttachLink = () => {
    const v = attachLink.trim()
    if (!v) return
    if (!isSafeAttachmentUrl(v)) { toast.error('Некорректная ссылка на файл'); return }
    if (attachments.length >= 10) { toast.error('Максимум 10 файлов'); return }
    if (attachments.includes(v)) { toast.error('Такой файл уже добавлен'); return }
    setAttachLink('')
    saveAttachments([...attachments, v])
  }

  const removeAttachment = (url: string) => {
    saveAttachments(attachments.filter(a => a !== url))
  }

  /** Загрузка файла через существующий filesApi.upload (без привязки к
   *  project/task — связь хранится строкой в attachments), затем PATCH. */
  const uploadAttachment = async (file: File) => {
    if (!canEditFiles) { toast.error('Недостаточно прав'); return }
    if (attachments.length >= 10) { toast.error('Максимум 10 файлов'); return }
    setUploadingFile(true)
    try {
      const res: any = await filesApi.upload(file)
      const url: string = typeof res === 'string' ? res : (res?.path || res?.url || '')
      if (!url) { toast.error('Не удалось получить ссылку на файл'); return }
      if (!isSafeAttachmentUrl(url)) { toast.error('Некорректная ссылка на файл'); return }
      if (attachments.includes(url)) { toast.error('Такой файл уже добавлен'); return }
      saveAttachments([...attachments, url])
      toast.success('Файл добавлен')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось загрузить файл')
    } finally {
      setUploadingFile(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // ── @mention в комментарии ────────────────────────────────────────
  const mentionFiltered = mentionQuery == null
    ? []
    : users
      .filter(u => u && String(u.name ?? '').toLowerCase().includes(String(mentionQuery ?? '').toLowerCase()))
      .slice(0, 7)
  // Индекс подсветки клампим к актуальному списку: пользователи подгружаются
  // асинхронно и список может ужаться без смены query — иначе Enter/aria
  // уйдут в undefined.
  const safeMentionIndex = mentionFiltered.length
    ? Math.min(Math.max(mentionIndex, 0), mentionFiltered.length - 1)
    : 0

  /** Вставить @Имя в позицию курсора и запомнить id для mentions. */
  const insertMention = (u: BoardUser) => {
    const el = commentRef.current
    const cur = el?.selectionStart ?? commentText.length
    const before = commentText.slice(0, cur)
    const after = commentText.slice(cur)
    const atPos = before.lastIndexOf('@')
    const head = atPos >= 0 ? before.slice(0, atPos) : before
    const next = `${head}@${u.name} ${after.replace(/^\S*/, '')}`
    setCommentText(next)
    setMentionIds(prev => (prev.includes(u.id) ? prev : [...prev, u.id]))
    setMentionQuery(null)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = (head + `@${u.name} `).length
      try { el.setSelectionRange(pos, pos) } catch {}
    })
  }

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setCommentText(v)
    const pos = e.target.selectionStart ?? v.length
    const m = v.slice(0, pos).match(/@([A-Za-zА-Яа-яЁё0-9_.-]*)$/)
    if (m) {
      setMentionQuery(m[1])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  return (
    <div className="dev-board-root max-w-3xl min-w-0 w-full dev-view-enter">
      {/* Шапка: назад + клонирование + удаление */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-5">
        <Link
          to={boardUrl()}
          className="inline-flex items-center gap-1.5 min-h-[40px] text-sm text-surface-500 dark:text-surface-400 hover:text-surface-800 dark:hover:text-surface-200"
        >
          <ArrowLeft size={16} /> Назад к доске
        </Link>
        <div className="flex-1" />
        {canManage && (
          <div ref={cloneRef} className="relative">
            <button
              type="button"
              className="btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1.5 text-sm"
              onClick={() => setCloneOpen(o => !o)}
              disabled={cloneMut.isPending}
              title="Создать копию задачи"
            >
              {cloneMut.isPending ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
              Клонировать
            </button>
            {cloneOpen && (
              <div className="absolute right-0 z-40 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-1.5 dev-pop-enter">
                <p className="px-2 py-1 text-xs text-surface-500 dark:text-surface-400">Клонировать с подзадачами?</p>
                <button
                  type="button"
                  onClick={() => { if (requireManage()) cloneMut.mutate(false) }}
                  disabled={cloneMut.isPending}
                  className="w-full min-h-[40px] text-left px-2 py-1.5 rounded text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                >
                  Без подзадач
                </button>
                <button
                  type="button"
                  onClick={() => { if (requireManage()) cloneMut.mutate(true) }}
                  disabled={cloneMut.isPending}
                  className="w-full min-h-[40px] text-left px-2 py-1.5 rounded text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                >
                  С подзадачами
                </button>
              </div>
            )}
          </div>
        )}
        {canManage && (
          <button
            type="button"
            className="btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} /> Удалить
          </button>
        )}
      </div>

      {/* Хлебная крошка родителя (self-parent === цикл — не показываем). */}
      {parentId && parentId !== id && (
        <Link
          to={taskUrl(parentId)}
          className="inline-flex items-center gap-1.5 mb-1 max-w-full text-xs text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
          title="Перейти к родительской задаче"
        >
          <CornerDownRight size={13} className="shrink-0" />
          <span className="truncate">{parent?.title || 'Родительская задача'}</span>
        </Link>
      )}

      {/* Проект «Разработка», к которому привязана задача — ссылка на проект. */}
      {task.project && (
        <Link
          to={projectUrl(task.project.id)}
          className="inline-flex items-center gap-1.5 mb-1 max-w-full text-xs font-medium text-sky-600 dark:text-sky-400 hover:underline"
          title="Перейти к проекту"
        >
          <Briefcase size={13} className="shrink-0" />
          <span className="truncate">{task.project.name}</span>
        </Link>
      )}

      {/* Заголовок страницы */}
      <div className="flex items-start gap-2.5 mb-1">
        <TypeIcon size={22} className={clsx('mt-1.5 shrink-0', TYPE_ICONS[task.taskType]?.className)} />
        {editingTitle && canManage ? (
          <input
            autoFocus
            aria-label="Название задачи"
            maxLength={255}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') { setTitle(task.title); setEditingTitle(false) }
            }}
            className="page-title flex-1 min-w-0 max-w-full bg-transparent border-b border-primary-500 focus:outline-none pb-0.5"
            placeholder="Название задачи"
          />
        ) : (
          <h1
            onClick={() => { if (canManage) setEditingTitle(true) }}
            className={clsx(
              'page-title flex-1 min-w-0 break-words rounded px-1 -mx-1',
              canManage && 'cursor-text hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors',
            )}
            title={canManage ? 'Кликните, чтобы переименовать' : undefined}
            // Клавиатура: h1 кликабелен только с manage — дублируем мышь Enter/Space.
            tabIndex={canManage ? 0 : undefined}
            onKeyDown={e => {
              if (!canManage) return
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingTitle(true) }
            }}
          >
            {task.title}
          </h1>
        )}
      </div>
      {/* Блокер виден всем: красный бейдж с причиной под заголовком. */}
      {task.isBlocked && (
        <div className="mb-3 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-2.5 py-1.5 text-sm text-red-700 dark:text-red-300">
          <span aria-hidden="true" className="shrink-0">⛔</span>
          <span className="min-w-0 break-words">
            {task.blockedReason?.trim() ? task.blockedReason : 'Заблокирована'}
          </span>
        </div>
      )}
      <p className="mb-5 text-[11px] text-surface-400 dark:text-surface-500">
        Создана {fmtDeadline(task.createdAt, true)}
        {task.completedAt && ` · завершена ${fmtDeadline(task.completedAt, true)}`}
        {' · обновлена '}{fmtDeadline(task.updatedAt, true)}
      </p>

      {/* Блок свойств — как в Notion: подпись слева, значение справа.
          Без overflow-hidden: иначе popover NotionSelect (absolute) клиппится
          карточкой и селекты исполнителей/проектов уходят под обрезку. */}
      <div className="card !p-0 mb-6 divide-y divide-surface-100 dark:divide-surface-800/70">
        <PropRow icon={CircleDot} label="Статус">
          <NotionSelect
            label="Статус"
            value={task.status}
            options={statusOptions}
            canEdit
            onChange={v => changeStatus(v as DevTaskStatus, task.id, task.status)}
            renderValue={o => (
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', DEV_STATUS_COLORS[o.value as DevTaskStatus])} />
                <span className="break-words">{o.label}</span>
              </span>
            )}
          />
        </PropRow>

        <PropRow icon={Flag} label="Приоритет">
          <NotionSelect
            label="Приоритет"
            value={task.priority}
            options={priorityOptions}
            canEdit={canManage}
            onChange={v => guardedUpdate({ priority: v })}
            renderValue={o => (
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', PRIORITY_DOTS[o.value as DevTaskPriority])} />
                <span className="break-words">{o.label}</span>
              </span>
            )}
          />
        </PropRow>

        <PropRow icon={Ban} label="Блокер">
          {canManage ? (
            <div className="flex flex-col gap-1.5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-red-600"
                  checked={!!task.isBlocked}
                  onChange={e => {
                    if (!requireManage()) return
                    const checked = e.target.checked
                    updateMut.mutate({
                      isBlocked: checked,
                      blockedReason: checked
                        ? (blockReason.trim() || task.blockedReason || null)
                        : (task.blockedReason ?? null),
                    })
                  }}
                />
                Заблокирована
              </label>
              {task.isBlocked && (
                <input
                  className="input !py-1 text-sm w-full max-w-full min-h-[40px] sm:min-h-[34px]"
                  placeholder="Причина блокировки…"
                  aria-label="Причина блокировки"
                  maxLength={500}
                  value={blockReason}
                  onChange={e => setBlockReason(e.target.value)}
                  onBlur={() => {
                    if (!requireManage()) { setBlockReason(task.blockedReason || ''); return }
                    const v = blockReason.trim()
                    if (v.length > 500) { toast.error('Причина слишком длинная (максимум 500 символов)'); return }
                    if ((v || '') !== (task.blockedReason || '')) {
                      updateMut.mutate({ blockedReason: v || null })
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                />
              )}
            </div>
          ) : task.isBlocked ? (
            <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full text-sm text-red-600 dark:text-red-400">
              <span aria-hidden="true" className="shrink-0">⛔</span>{' '}
              <span className="min-w-0 break-words">{task.blockedReason?.trim() ? task.blockedReason : 'Заблокирована'}</span>
            </span>
          ) : (
            <span className="text-sm text-surface-400 dark:text-surface-500">—</span>
          )}
        </PropRow>

        <PropRow icon={Type} label="Тип задачи">
          <NotionSelect
            label="Тип задачи"
            value={task.taskType}
            options={typeOptions}
            canEdit={canManage}
            onChange={v => guardedUpdate({ taskType: v })}
            renderValue={o => {
              const ItemIcon = TYPE_ICONS[o.value as DevTaskType]?.icon || Plus
              return (
                <span className="inline-flex items-center gap-2 min-w-0">
                  <ItemIcon size={14} className={clsx('shrink-0', TYPE_ICONS[o.value as DevTaskType]?.className)} />
                  <span className="break-words">{o.label}</span>
                </span>
              )
            }}
          />
        </PropRow>

        <PropRow icon={UserIcon} label="Исполнитель">
          <NotionSelect
            label="Исполнитель"
            value={task.assigneeId || ''}
            options={assigneeOptions}
            canEdit={canManage}
            placeholder="Не назначен"
            onChange={v => guardedUpdate({ assigneeId: v || null })}
            renderValue={o => o.value === '' ? (
              <span className="text-surface-400 dark:text-surface-500">{o.label}</span>
            ) : (
              <span className="inline-flex items-center gap-2 min-w-0">
                <Avatar
                  name={o.label}
                  src={task.assigneeId === o.value ? task.assignee?.avatarUrl || task.assignee?.avatar || undefined : undefined}
                  size={20}
                  zoomable={false}
                />
                <span className="break-words">{o.label}</span>
              </span>
            )}
          />
        </PropRow>

        <PropRow icon={CalendarDays} label="Дедлайн">
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <BoardDatePicker
                value={task.deadline ? String(task.deadline).slice(0, 10) : ''}
                onChange={v => { if (requireManage()) updateMut.mutate({ deadline: v || null }) }}
                placeholder="Без дедлайна"
                className={clsx('w-auto min-w-[190px] max-w-[230px]', overdue && '[&>button]:!border-red-500 [&>button]:!text-red-600 dark:[&>button]:!text-red-400')}
              />
              {overdue && (
                <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
                  Просрочен: {fmtDeadline(task.deadline!, true)}
                </span>
              )}
            </div>
          ) : task.deadline ? (
            <span className={clsx('text-sm inline-flex items-center gap-1.5', overdue ? 'text-red-600 dark:text-red-400' : 'text-surface-700 dark:text-surface-300')}>
              <CalendarDays size={13} /> {fmtDeadline(task.deadline, true)}
            </span>
          ) : (
            <span className="text-sm text-surface-400 dark:text-surface-500">—</span>
          )}
        </PropRow>

        <PropRow icon={Hash} label="Story points">
          <NotionSelect
            label="Story points"
            value={task.storyPoints != null ? String(task.storyPoints) : ''}
            options={pointsOptions}
            canEdit={canManage}
            placeholder="Не оценено"
            onChange={v => guardedUpdate({ storyPoints: v ? Number(v) : null })}
          />
        </PropRow>

        <PropRow icon={Tags} label="Теги">
          {canManage ? (
            <input
              className="input !py-1 !w-full sm:!w-auto !min-w-0 sm:!min-w-[240px] max-w-full min-h-[40px] sm:min-h-[34px]"
              defaultValue={(Array.isArray(task.tags) ? task.tags : []).join(', ')}
              key={`tags-${task.id}-${(Array.isArray(task.tags) ? task.tags : []).join('|')}`}
              placeholder="frontend, срочно"
              aria-label="Теги через запятую"
              maxLength={1000}
              onBlur={e => {
                const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                if (tags.length > 20) { toast.error('Слишком много тегов (максимум 20)'); return }
                if (tags.some(t => t.length > 50)) { toast.error('Тег слишком длинный (максимум 50 символов)'); return }
                const prev = Array.isArray(task.tags) ? task.tags : []
                // Без изменений — без PATCH: лишний сетевой шум и запись в истории.
                if (tags.length === prev.length && tags.every((t, i) => t === prev[i])) return
                guardedUpdate({ tags })
              }}
            />
          ) : Array.isArray(task.tags) && task.tags.length ? (
            <span className="flex flex-wrap gap-1 min-w-0 max-w-full">
              {task.tags.map(t => (
                <span key={String(t)} className="px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-800 text-[11px] text-surface-600 dark:text-surface-300 break-words max-w-full">
                  {String(t)}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-sm text-surface-400 dark:text-surface-500">—</span>
          )}
        </PropRow>

        <PropRow icon={Briefcase} label="Проект">
          {canManage ? (
            <NotionSelect
              label="Проект"
              value={task.projectId || ''}
              options={devProjectOptions}
              canEdit
              placeholder="Без проекта"
              onChange={v => guardedUpdate({ projectId: v || null })}
              renderValue={o => o.value === '' ? (
                <span className="text-surface-400 dark:text-surface-500">{o.label}</span>
              ) : (
                <span className="inline-flex items-center gap-2 min-w-0">
                  <Briefcase size={14} className="shrink-0 text-sky-500 dark:text-sky-400" />
                  <span className="break-words">{o.label}</span>
                </span>
              )}
            />
          ) : task.project ? (
            <Link
              to={projectUrl(task.project.id)}
              className="text-sm inline-flex items-center gap-1.5 min-w-0 max-w-full break-words text-sky-600 dark:text-sky-400 hover:underline"
            >
              <Briefcase size={13} className="shrink-0" />{' '}
              <span className="min-w-0 break-words">{task.project.name}</span>
            </Link>
          ) : (
            <span className="text-sm text-surface-400 dark:text-surface-500">—</span>
          )}
        </PropRow>
      </div>

      {/* Подзадачи — прогресс + чек-лист в духе Notion */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <ListChecks size={15} className="text-surface-400 dark:text-surface-500 shrink-0" />
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Подзадачи</h2>
          {subTotal > 0 && (
            <span className="text-xs text-surface-400 dark:text-surface-500 tabular-nums">{subDone}/{subTotal}</span>
          )}
        </div>

        {subTotal > 0 && (
          <div className="h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mb-3">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${subPct}%` }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={subPct}
              aria-label={`Подзадачи выполнено ${subDone} из ${subTotal}`}
              title={`Выполнено ${subDone} из ${subTotal}`}
            />
          </div>
        )}

        <div className="space-y-0.5">
          {/* На coarse-pointer (тач) × всегда видима: hover там не бывает. */}
          <style>{'@media (pointer:coarse){.dev-subtask-del{opacity:1 !important;}}'}</style>
          {subtasks.map(s => {
            const done = s.status === 'done'
            return (
              <div
                key={s.id}
                className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
              >
                <input
                  type="checkbox"
                  className="w-5 h-5 sm:w-4 sm:h-4 shrink-0 cursor-pointer accent-emerald-600"
                  checked={done}
                  onChange={() => changeStatus(done ? 'todo' : 'done', s.id, s.status)}
                  title={done ? 'Вернуть в работу' : 'Отметить выполненной'}
                  aria-label={`${done ? 'Вернуть в работу' : 'Отметить выполненной'}: ${s.title}`}
                />
                <button
                  type="button"
                  onClick={() => navigate(taskUrl(s.id))}
                  className={clsx(
                    'flex-1 min-w-0 text-left text-sm truncate transition-colors',
                    done
                      ? 'text-surface-400 dark:text-surface-500 line-through'
                      : 'text-surface-800 dark:text-surface-200 hover:text-primary-600 dark:hover:text-primary-400',
                  )}
                  title={s.title}
                >
                  {s.title}
                </button>
                <span
                  className={clsx('w-2 h-2 rounded-full shrink-0', DEV_STATUS_COLORS[s.status])}
                  title={DEV_STATUS_LABELS[s.status]}
                />
                {s.assignee && (
                  <Avatar name={s.assignee.name} src={s.assignee.avatarUrl || s.assignee.avatar || undefined} size={20} zoomable={false} />
                )}
                {canManage && (
                <button
                  type="button"
                  onClick={() => { if (requireManage()) subtaskDeleteMut.mutate(s.id) }}
                  title="Удалить подзадачу"
                    aria-label={`Удалить подзадачу «${s.title}»`}
                    className="dev-subtask-del min-w-[40px] min-h-[40px] md:min-w-0 md:min-h-0 inline-flex items-center justify-center p-1 rounded shrink-0 text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-surface-200 dark:hover:bg-surface-700 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )
          })}
          {!subtasks.length && (
            <p className="px-2 text-sm text-surface-400 dark:text-surface-500">Подзадач пока нет.</p>
          )}
        </div>

        {canManage && (
          addingSubtask ? (
            <form
              className="mt-2"
              onSubmit={e => {
                e.preventDefault()
                if (!requireManage()) return
                // Двойной Enter до settle дублировал подзадачу.
                if (subtaskCreateMut.isPending) return
                const v = newSubtask.trim()
                if (!v) return
                if (v.length > 255) { toast.error('Название слишком длинное (максимум 255 символов)'); return }
                subtaskCreateMut.mutate(v)
              }}
            >
              <input
                autoFocus
                className="input !py-1.5 text-sm max-w-full min-h-[40px] sm:min-h-[34px]"
                placeholder="Название подзадачи… Enter — создать, Esc — отмена"
                aria-label="Название новой подзадачи"
                maxLength={255}
                value={newSubtask}
                onChange={e => setNewSubtask(e.target.value)}
                disabled={subtaskCreateMut.isPending}
                onBlur={() => { if (!newSubtask.trim()) setAddingSubtask(false) }}
                onKeyDown={e => {
                  if (e.key === 'Escape') { setNewSubtask(''); setAddingSubtask(false) }
                }}
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingSubtask(true)}
              className="mt-2 inline-flex items-center gap-1.5 min-h-[40px] px-2 py-1 rounded text-sm text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
            >
              {subtaskCreateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Добавить подзадачу
            </button>
          )
        )}
      </section>

      {/* Описание — просмотр через Markdown, редактирование в textarea с автосейвом 800 мс */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-1.5">
          <AlignLeft size={15} className="text-surface-400 dark:text-surface-500 shrink-0" />
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Описание</h2>
          {canManage && (
            <span role="status" className="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500">
              {updateMut.isPending && <Loader2 size={11} className="animate-spin" aria-hidden="true" />}
              {updateMut.isPending ? 'Сохранение…' : 'Сохраняется автоматически'}
            </span>
          )}
          <div className="flex-1" />
          {canManage && (description || task.description) && (
            <button
              type="button"
              onClick={() => setDescEditing(v => !v)}
              className="inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 px-1.5 py-0.5 rounded text-[11px] text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
              title={descEditing ? 'Показать просмотр' : 'Редактировать описание'}
            >
              {descEditing ? <Eye size={12} /> : <Pencil size={12} />}
              {descEditing ? 'Просмотр' : 'Редактировать'}
            </button>
          )}
        </div>
        {!canManage ? (
          description || task.description ? (
            <Markdown
              text={description || task.description || ''}
              className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed space-y-1.5"
            />
          ) : (
            <p className="text-sm text-surface-400 dark:text-surface-500">Описание не добавлено</p>
          )
        ) : descEditing || !(description || task.description) ? (
          <>
            <textarea
              className="input min-h-[160px] resize-y w-full leading-relaxed"
              value={description}
              aria-label="Описание задачи"
              maxLength={5000}
              onChange={e => {
                // descPending — синхронно в onChange: эффект автосейва может не
                // успеть до размонтирования/смены задачи, cleanup-Flush берёт его отсюда.
                descTouched.current = true
                descFailedRef.current = null // новая правка — разрешаем автосейв
                descPending.current = e.target.value.trim()
                setDescription(e.target.value)
              }}
              placeholder="Добавить описание… (Markdown: **жирный**, *курсив*, `код`, - список)"
            />
            {(description || task.description) && (
              <button
                type="button"
                onClick={() => setDescEditing(false)}
                className="mt-1.5 inline-flex items-center gap-1 min-h-[40px] sm:min-h-0 text-[11px] text-surface-500 dark:text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
              >
                <Eye size={12} /> Показать просмотр
              </button>
            )}
          </>
        ) : (
          <div
            onClick={() => setDescEditing(true)}
            className="rounded-lg px-2 py-1.5 -mx-2 cursor-text hover:bg-surface-100 dark:hover:bg-surface-800/60 transition-colors"
            title="Кликните, чтобы редактировать"
          >
            <Markdown
              text={description || task.description || ''}
              className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed space-y-1.5"
            />
          </div>
        )}
      </section>

      {/* Файлы — картинки превью, остальное ссылкой; правит только manage
          (бэк: PATCH /dev-tracker/:id требует dev-tracker.manage) */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Paperclip size={15} className="text-surface-400 dark:text-surface-500 shrink-0" />
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Файлы</h2>
          {attachments.length > 0 && (
            <span className="text-xs text-surface-400 dark:text-surface-500 tabular-nums">{attachments.length}/10</span>
          )}
        </div>

        {attachments.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 mb-2">
            {attachments.map(url => (
              <div
                key={url}
                className="group min-w-0 max-w-full flex items-center gap-2.5 p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900"
              >
                <AttachThumb url={url} />
                <a
                  href={resolveFileUrl(url)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex-1 min-w-0 text-sm text-surface-700 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-400 hover:underline truncate"
                  title={url}
                >
                  {fileNameFromUrl(url)}
                </a>
                {canEditFiles && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(url)}
                    title="Убрать файл"
                    aria-label={`Убрать файл ${fileNameFromUrl(url)}`}
                    className="min-w-[40px] min-h-[40px] sm:min-w-0 sm:min-h-0 inline-flex items-center justify-center p-1 rounded shrink-0 text-surface-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-surface-400 dark:text-surface-500 mb-2">Файлов пока нет.</p>
        )}

        {canEditFiles && (
          <div className="flex flex-col sm:flex-row gap-2">
            <label className={clsx('btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center justify-center gap-1.5 text-sm cursor-pointer w-full sm:w-fit', uploadingFile && 'opacity-50 pointer-events-none')}>
              {uploadingFile ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
              {uploadingFile ? 'Загрузка…' : 'Загрузить файл'}
              <input ref={fileRef} type="file" className="hidden" disabled={uploadingFile} onChange={e => { const f = e.target.files?.[0]; if (f) uploadAttachment(f) }} />
            </label>
            <div className="flex gap-2 flex-1 min-w-0">
              <input
                className="input !py-1.5 text-sm flex-1 min-w-0 max-w-full min-h-[40px] sm:min-h-[34px]"
                placeholder="Вставить ссылку (https://…)"
                aria-label="Ссылка на файл"
                value={attachLink}
                onChange={e => setAttachLink(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttachLink() } }}
              />
              <button
                type="button"
                className="btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1 text-sm shrink-0"
                disabled={!attachLink.trim() || updateMut.isPending}
                onClick={addAttachLink}
                title="Добавить ссылку"
              >
                <Link2 size={14} /> Добавить
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Комментарии — рендер через Markdown, @mention сотрудников */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Комментарии</h2>
          {comments.length > 0 && (
            <span className="text-xs text-surface-400 dark:text-surface-500 tabular-nums">{comments.length}</span>
          )}
        </div>

        <div className="space-y-4 mb-4">
          {comments.map(c => (
            <div key={c.id} className="flex gap-3 min-w-0">
              <span className="shrink-0">
                <Avatar name={c.author?.name || '?'} size={30} zoomable={false} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap min-w-0">
                  <span className="text-sm font-semibold break-words min-w-0 text-surface-800 dark:text-surface-200">
                    {c.author?.name || 'Удалённый пользователь'}
                  </span>
                  <span className="text-[11px] break-words text-surface-400 dark:text-surface-500">
                    {fmtHistoryDate(c.createdAt)}
                  </span>
                </div>
                <Markdown
                  text={c.text}
                  className="text-sm text-surface-700 dark:text-surface-300 leading-relaxed space-y-1 mt-0.5"
                />
              </div>
            </div>
          ))}
          {!comments.length && (
            <p className="text-sm text-surface-400 dark:text-surface-500">Комментариев пока нет.</p>
          )}
        </div>

        <div className="relative flex gap-2 items-start">
          <div ref={mentionWrapRef} className="flex-1 min-w-0 relative">
            <textarea
              ref={commentRef}
              className="input w-full min-h-[44px] resize-y"
              aria-label="Комментарий"
              maxLength={5000}
              aria-autocomplete="list"
              aria-activedescendant={
                mentionQuery != null && mentionFiltered[safeMentionIndex]
                  ? `mention-opt-${mentionFiltered[safeMentionIndex].id}`
                  : undefined
              }
              placeholder="Написать комментарий… @ — упомянуть (Ctrl+Enter — отправить)"
              value={commentText}
              onChange={handleCommentChange}
              onKeyDown={e => {
                if (mentionQuery != null && mentionFiltered.length > 0) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => (i + 1) % mentionFiltered.length); return }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => (i - 1 + mentionFiltered.length) % mentionFiltered.length); return }
                  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); insertMention(mentionFiltered[safeMentionIndex] || mentionFiltered[0]); return }
                  if (e.key === 'Escape') { setMentionQuery(null); return }
                }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commentText.trim()) {
                  sendComment()
                }
              }}
            />
            {mentionQuery != null && mentionFiltered.length > 0 && (
              <div
                role="listbox"
                aria-label="Упоминания сотрудников"
                className="absolute left-0 right-0 bottom-full z-40 mb-1 max-w-[calc(100vw-2rem)] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-1 max-h-52 overflow-y-auto"
              >
                {mentionFiltered.map((u, i) => (
                  <button
                    key={u.id}
                    id={`mention-opt-${u.id}`}
                    type="button"
                    role="option"
                    aria-selected={i === safeMentionIndex}
                    onMouseDown={ev => { ev.preventDefault(); insertMention(u) }}
                    // Клавиатурный Enter по кнопке даёт click (detail=0), mousedown
                    // не срабатывает — без этого Tab+Enter молча ничего не вставлял.
                    onClick={ev => { if (ev.detail === 0) insertMention(u) }}
                    onMouseEnter={() => setMentionIndex(i)}
                    className={clsx(
                      'w-full flex items-center gap-2 px-2 py-1.5 min-h-[40px] rounded text-sm text-left transition-colors',
                      'text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800',
                      i === safeMentionIndex && 'bg-surface-100 dark:bg-surface-800',
                    )}
                  >
                    <Avatar name={u.name} size={22} zoomable={false} />
                    <span className="flex-1 truncate">{u.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="btn-primary !px-3 !min-h-[44px] min-w-[44px] shrink-0"
            disabled={commentMut.isPending || !commentText.trim()}
            onClick={sendComment}
            title="Отправить"
            aria-label="Отправить комментарий"
          >
            <Send size={16} />
          </button>
        </div>
      </section>

      {/* История — кто и что менял; смотрят все с правом view */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <History size={15} className="text-surface-400 dark:text-surface-500 shrink-0" />
          <h2 className="text-sm font-semibold text-surface-800 dark:text-surface-200">История</h2>
          {history.length > 0 && (
            <span className="text-xs text-surface-400 dark:text-surface-500 tabular-nums">{history.length}</span>
          )}
        </div>
        {historyLoading ? (
          <p className="text-sm text-surface-400 dark:text-surface-500">Загрузка истории…</p>
        ) : historyError && historyStatus !== 404 && !history.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-surface-400 dark:text-surface-500 flex-1 min-w-[200px]">Не удалось загрузить историю. Обновите страницу.</p>
            <button
              type="button"
              onClick={() => refetchHistory()}
              className="btn-secondary !py-1.5 min-h-[40px] text-sm"
            >
              Повторить
            </button>
          </div>
        ) : history.length ? (
          <div className="space-y-2">
            {history.map(h => {
              const FieldIcon = h.field === 'status'
                ? CircleDot
                : h.field === 'assignee'
                  ? UserIcon
                  : h.field === 'priority'
                    ? Flag
                    : h.field === 'deadline'
                      ? CalendarDays
                      : Type
              return (
                <div key={h.id} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                    <FieldIcon size={13} className="text-surface-500 dark:text-surface-400" />
                  </span>
                  <p className="min-w-0 flex-1 text-surface-700 dark:text-surface-300 break-words">
                    <span className="font-medium text-surface-800 dark:text-surface-200">
                      {h.actor?.name || 'Кто-то'}
                    </span>
                    {' изменил(а) '}{HISTORY_FIELD_LABELS[h.field] || h.field}{': '}
                    <span>{historyDisplay(h.field, h.from)}</span>
                    {' → '}
                    <span className="font-medium">{historyDisplay(h.field, h.to)}</span>
                    <span className="text-[11px] text-surface-400 dark:text-surface-500 whitespace-nowrap">
                      {' · '}{fmtHistoryDate(h.createdAt)}
                    </span>
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-surface-400 dark:text-surface-500">История пуста</p>
        )}
      </section>

      {/* Delete-confirm модалка — общий ConfirmDialog/Modal уже рендерит
          bottom-sheet w-full на mobile; на ≤639px дополнительно ограничиваем
          панель viewport'ом, десктоп (sm+) не трогаем. */}
      <style>{'@media (max-width:639px){div[role="dialog"].relative{max-width:calc(100vw-2rem) !important;border-radius:0.75rem !important;}}'}</style>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { if (!requireManage()) return; if (deleteMut.isPending) return; deleteMut.mutate() }}
        title="Удалить задачу?"
        message={`«${task.title}» будет удалена безвозвратно вместе с подзадачами и комментариями.`}
        danger
      />
    </div>
  )
}
