import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tasksApi, commentsApi, filesApi, taskResultsApi, taskChecklistApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { useAuthStore } from '@/store/auth.store'
import { useTranslation } from '@/i18n'
import { PageLoader, StatusBadge, PriorityBadge, Avatar, ProgressBar, Modal, ConfirmDialog } from '@/components/ui'
import MiniMarkdown from '@/components/ui/MiniMarkdown'
import {
  ArrowLeft, Send, Edit2, Trash2, Paperclip, Upload,
  CheckCircle, RotateCcw, LinkIcon, MessageSquare, AlertTriangle,
  Plus, Square, CheckSquare, Users, Check,
  Github, GitBranch, GitPullRequest, ExternalLink, Copy, Clock,
} from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import clsx from 'clsx'

const PM_ROLES = ['admin', 'founder', 'co_founder', 'smm_director', 'project_manager', 'head_smm']
const WORKER_ROLES = ['smm_specialist', 'designer', 'marketer', 'targetologist', 'sales_manager', 'developer', 'employee']

/** Доступные tech tags + их цвета. Можно вводить и свои — fallback цвет
 *  применяется в render'е. */
const AVAILABLE_TAGS = [
  'frontend', 'backend', 'fullstack', 'mobile', 'devops',
  'bug', 'feature', 'refactor', 'optimization', 'tech-debt',
  'urgent', 'blocked', 'research', 'docs',
]
// Светофорная палитра тегов: 🟢 положительные (feature/docs/research/scope),
// 🟡 нейтральные / в процессе (refactor/optimization/frontend/backend/...),
// 🔴 проблемные / срочные (bug/urgent/blocked/tech-debt).
const GREEN_TAG  = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-900/50'
const AMBER_TAG  = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-900/50'
const RED_TAG    = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-900/50'
const SLATE_TAG  = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-600'

const TAG_COLORS: Record<string, string> = {
  // 🟢 фичи и позитив
  feature:      GREEN_TAG,
  docs:         GREEN_TAG,
  research:     GREEN_TAG,
  // 🟡 техническая работа в процессе
  frontend:     AMBER_TAG,
  backend:      AMBER_TAG,
  fullstack:    AMBER_TAG,
  mobile:       AMBER_TAG,
  devops:       AMBER_TAG,
  refactor:     AMBER_TAG,
  optimization: AMBER_TAG,
  // 🔴 проблемы и срочное
  bug:          RED_TAG,
  urgent:       RED_TAG,
  blocked:      RED_TAG,
  'tech-debt':  RED_TAG,
}
// Fallback для пользовательских тегов — нейтральный серый
const DEFAULT_TAG_COLOR = SLATE_TAG

/** Превращает заголовок задачи в slug для имени Git-ветки.
 *  "Разработать сайт" → "razrabotat-sayt". Транслит + дефисы. */
function slugifyForBranch(title: string): string {
  const map: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  return title.toLowerCase()
    .split('').map(c => map[c] ?? c).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

const STATUS_FLOW: Record<string, string[]> = {
  new:         ['in_progress'],
  in_progress: ['review'],
  returned:    ['in_progress'],
  review:      [],
  done:        [],
  cancelled:   [],
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const { t } = useTranslation()

  const [comment, setComment] = useState('')
  const [editingComment, setEditingComment] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [activeTab, setActiveTab] = useState<'comments' | 'files' | 'results' | 'checklist'>('results')
  const [returnReason, setReturnReason] = useState('')
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [showResultModal, setShowResultModal] = useState(false)
  const [resultType, setResultType] = useState<'link' | 'comment' | 'media'>('comment')
  const [resultContent, setResultContent] = useState('')
  const [newCheckItem, setNewCheckItem] = useState('')
  const [editingCheckItem, setEditingCheckItem] = useState<string | null>(null)
  const [editCheckText, setEditCheckText] = useState('')
  const [deleteResultId, setDeleteResultId] = useState<string | null>(null)

  const role = user?.role || 'employee'
  const isPM = PM_ROLES.includes(role)
  const isWorker = WORKER_ROLES.includes(role)

  // Computed later once task is loaded — assignee + creator may also edit checklist
  const canEditChecklist = (task: any) => isPM ||
    task?.assigneeId === user?.id || task?.createdById === user?.id

  const { data: task, isLoading, error } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!),
    retry: false,
  })

  // Клавиатурные шорткаты для разработчиков. Срабатывают только когда
  // фокус НЕ в input/textarea (иначе мешали бы вводу). ? показывает help.
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  useEffect(() => {
    if (!task) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key.toLowerCase()) {
        case '?':
        case '/':
          if (e.shiftKey || e.key === '/') {
            e.preventDefault()
            setShowShortcutHelp(v => !v)
          }
          break
        case 'c': {
          // C — копировать ветку
          const branch = task?.techMeta?.branch
          if (branch) {
            navigator.clipboard.writeText(branch).then(
              () => toast.success(`Скопировано: ${branch}`),
              () => toast.error('Не удалось скопировать'),
            )
          }
          break
        }
        case 'o': {
          // O — открыть PR
          const prUrl = task?.techMeta?.prUrl
          if (prUrl) window.open(prUrl, '_blank', 'noopener,noreferrer')
          break
        }
        case 'g': {
          // G — открыть репозиторий
          const repoUrl = task?.techMeta?.repoUrl
          if (repoUrl) window.open(repoUrl, '_blank', 'noopener,noreferrer')
          break
        }
        case 'l': {
          // L — открыть live/staging
          const url = task?.techMeta?.stagingUrl || task?.techMeta?.liveUrl
          if (url) window.open(url, '_blank', 'noopener,noreferrer')
          break
        }
        case 'escape':
          setShowShortcutHelp(false)
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [task])

  const { data: files } = useQuery({
    queryKey: ['task-files', id],
    queryFn: () => filesApi.byTask(id!),
    enabled: activeTab === 'files',
  })

  const { data: results } = useQuery({
    queryKey: ['task-results', id],
    queryFn: () => taskResultsApi.list(id!),
  })

  const { data: checklist } = useQuery({
    queryKey: ['task-checklist', id],
    queryFn: () => taskChecklistApi.list(id!),
  })

  const addCheckItem = useMutation({
    mutationFn: (text: string) => taskChecklistApi.create(id!, text),
    onMutate: async (text: string) => {
      setNewCheckItem('')
      await qc.cancelQueries({ queryKey: ['task-checklist', id] })
      const previous = qc.getQueryData(['task-checklist', id])
      const tempItem = { id: `temp-${Date.now()}`, text, isDone: false }
      qc.setQueryData(['task-checklist', id], (old: any[]) => old ? [...old, tempItem] : [tempItem])
      return { previous }
    },
    onError: (e: any, _vars: any, context: any) => {
      qc.setQueryData(['task-checklist', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-checklist', id] }),
  })

  const toggleCheckItem = useMutation({
    mutationFn: (itemId: string) => taskChecklistApi.toggle(id!, itemId),
    onMutate: async (itemId: string) => {
      await qc.cancelQueries({ queryKey: ['task-checklist', id] })
      const previous = qc.getQueryData(['task-checklist', id])
      qc.setQueryData(['task-checklist', id], (old: any[]) => old?.map((item: any) => item.id === itemId ? { ...item, isDone: !item.isDone } : item) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['task-checklist', id], context?.previous)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-checklist', id] }),
  })

  const removeCheckItem = useMutation({
    mutationFn: (itemId: string) => taskChecklistApi.remove(id!, itemId),
    onMutate: async (itemId: string) => {
      await qc.cancelQueries({ queryKey: ['task-checklist', id] })
      const previous = qc.getQueryData(['task-checklist', id])
      qc.setQueryData(['task-checklist', id], (old: any[]) => old?.filter((item: any) => item.id !== itemId) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['task-checklist', id], context?.previous)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-checklist', id] }),
  })

  const editCheckItemMut = useMutation({
    mutationFn: ({ itemId, text }: { itemId: string; text: string }) => taskChecklistApi.update(id!, itemId, text),
    onMutate: async ({ itemId, text }: { itemId: string; text: string }) => {
      setEditingCheckItem(null)
      await qc.cancelQueries({ queryKey: ['task-checklist', id] })
      const previous = qc.getQueryData(['task-checklist', id])
      qc.setQueryData(['task-checklist', id], (old: any[]) => old?.map((item: any) => item.id === itemId ? { ...item, text } : item) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['task-checklist', id], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-checklist', id] }),
  })

  const deleteResult = useMutation({
    mutationFn: (resultId: string) => taskResultsApi.remove(id!, resultId),
    onMutate: async (resultId: string) => {
      setDeleteResultId(null)
      await qc.cancelQueries({ queryKey: ['task-results', id] })
      const previous = qc.getQueryData(['task-results', id])
      qc.setQueryData(['task-results', id], (old: any[]) => old?.filter((r: any) => r.id !== resultId) ?? [])
      return { previous }
    },
    onError: (_err: any, _vars: any, context: any) => {
      qc.setQueryData(['task-results', id], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-results', id] }),
  })

  const updateTask = useMutation({
    mutationFn: (data: any) => tasksApi.update(id!, data),
    onMutate: async (data: any) => {
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, ...data } : old)
      return { previous }
    },
    onError: (e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Статус обновлён')
    },
  })

  const addResult = useMutation<any, any, void>({
    mutationFn: () => taskResultsApi.create(id!, { type: resultType, content: resultContent }),
    onMutate: async () => {
      const content = resultContent
      const type = resultType
      setResultContent('')
      setShowResultModal(false)
      await qc.cancelQueries({ queryKey: ['task-results', id] })
      const previous = qc.getQueryData(['task-results', id])
      const tempResult = { id: `temp-${Date.now()}`, type, content, submittedBy: { name: user?.name }, createdAt: new Date().toISOString() }
      qc.setQueryData(['task-results', id], (old: any[]) => old ? [tempResult, ...old] : [tempResult])
      return { previous }
    },
    onError: (e: any, _v: any, context: any) => {
      qc.setQueryData(['task-results', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-results', id] })
      toast.success('Результат загружен')
    },
  })

  const submitForReview = useMutation<any, any, void>({
    mutationFn: () => tasksApi.update(id!, { status: 'review' }),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, status: 'review' } : old)
      return { previous }
    },
    onError: (e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Сначала загрузите результат работы')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Задача отправлена на проверку')
    },
  })

  const approveTask = useMutation<any, any, void>({
    mutationFn: () => tasksApi.approve(id!),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, status: 'done', reviewedAt: new Date().toISOString() } : old)
      return { previous }
    },
    onError: (e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Задача подтверждена ✓')
    },
  })

  const returnTask = useMutation<any, any, void>({
    mutationFn: () => tasksApi.returnTask(id!, returnReason || 'Требует доработки'),
    onMutate: async () => {
      const reason = returnReason || 'Требует доработки'
      setShowReturnModal(false)
      setReturnReason('')
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, status: 'returned', returnReason: reason } : old)
      return { previous }
    },
    onError: (e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Ошибка')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task', id] })
      invalidateAfterTaskChange(qc)
      toast.success('Задача возвращена в работу')
    },
  })

  const addComment = useMutation<any, any, void>({
    mutationFn: () => commentsApi.create(id!, comment),
    onMutate: async () => {
      const msg = comment
      setComment('')
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      const tempComment = { id: `temp-${Date.now()}`, message: msg, authorId: user?.id, author: { name: user?.name }, createdAt: new Date().toISOString() }
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, comments: [...(old.comments || []), tempComment] } : old)
      return { previous }
    },
    onError: (e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error(e?.response?.data?.message || 'Не удалось добавить комментарий')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  })

  const deleteComment = useMutation({
    mutationFn: (cid: string) => commentsApi.remove(id!, cid),
    onMutate: async (cid: string) => {
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, comments: (old.comments || []).filter((c: any) => c.id !== cid) } : old)
      return { previous }
    },
    onError: (_e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error('Ошибка удаления')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  })

  const updateComment = useMutation({
    mutationFn: ({ cid, msg }: any) => commentsApi.update(id!, cid, msg),
    onMutate: async ({ cid, msg }: any) => {
      setEditingComment(null)
      await qc.cancelQueries({ queryKey: ['task', id] })
      const previous = qc.getQueryData(['task', id])
      qc.setQueryData(['task', id], (old: any) => old ? { ...old, comments: (old.comments || []).map((c: any) => c.id === cid ? { ...c, message: msg, isEdited: true } : c) } : old)
      return { previous }
    },
    onError: (_e: any, _v: any, context: any) => {
      qc.setQueryData(['task', id], context?.previous)
      toast.error('Ошибка')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  })

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      await filesApi.upload(file, undefined, id)
      qc.invalidateQueries({ queryKey: ['task-files', id] })
      qc.invalidateQueries({ queryKey: ['files'] })
      qc.invalidateQueries({ queryKey: ['files-project'] })
      toast.success(t('files.uploaded'))
    } catch {
      toast.error(t('files.uploadError') || 'Ошибка загрузки файла')
    }
  }

  if (isLoading) return <PageLoader />
  if (!task) {
    const status = (error as any)?.response?.status
    const isMissing = status === 404 || status === 403
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400 hover:text-primary-600"
        >
          <ArrowLeft size={16} /> Назад
        </button>
        <div className="card flex flex-col items-center justify-center py-16 px-6 text-center max-w-lg mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-1">
            {isMissing ? 'Задача не найдена' : 'Не удалось загрузить задачу'}
          </h2>
          <p className="text-sm text-surface-500 dark:text-surface-400 mb-5">
            {isMissing
              ? 'Возможно, она была удалена или у вас нет к ней доступа. Уведомление можно удалить из списка.'
              : 'Произошла ошибка при загрузке. Попробуйте обновить страницу.'}
          </p>
          <div className="flex gap-2">
            <button onClick={() => navigate('/notifications')} className="btn-secondary text-sm">
              К уведомлениям
            </button>
            <button onClick={() => navigate('/tasks')} className="btn-primary text-sm">
              К списку задач
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && !['done', 'cancelled'].includes(task.status)
  const isReturned = task.status === 'returned'
  const isOnReview = task.status === 'review'
  const isDone = task.status === 'done'

  // Status options worker can move to
  const allowedNextStatuses = STATUS_FLOW[task.status] || []
  const canChangeStatus = isWorker && allowedNextStatuses.length > 0
  const resultCount = results?.length || 0
  const hasResult = resultCount > 0
  const canSubmitReview = isWorker && task.status === 'in_progress' && hasResult
  const canSubmitReviewNoResult = isWorker && task.status === 'in_progress' && !hasResult

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-xl text-surface-600 dark:text-surface-400">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{task.title}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.project && (
              <Link to={`/projects/${task.project.id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">
                {task.project.name}
              </Link>
            )}
            {isOverdue && (
              <span className="text-xs font-semibold text-red-500 flex items-center gap-1">
                <AlertTriangle size={12} /> Просрочено
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {isReturned && task.returnReason && (
        <div className="card border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/10">
          <div className="flex items-start gap-2">
            <RotateCcw size={16} className="text-orange-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">Задача возвращена в работу</p>
              <p className="text-sm text-orange-600 dark:text-orange-300 mt-0.5">{task.returnReason}</p>
            </div>
          </div>
        </div>
      )}

      {/* PM actions: approve / return */}
      {isPM && isOnReview && (
        <div className="card border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 mb-3">
            Задача ожидает проверки
          </p>
          {resultCount > 0 && (
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
              Загружено результатов: {resultCount} — посмотрите во вкладке «Результаты»
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => approveTask.mutate()}
              disabled={approveTask.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={16} /> Подтвердить
            </button>
            <button
              onClick={() => setShowReturnModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition-colors"
            >
              <RotateCcw size={16} /> Вернуть в работу
            </button>
          </div>
        </div>
      )}

      {/* Worker actions: upload result + submit review */}
      {isWorker && ['in_progress', 'returned'].includes(task.status) && (
        <div className="card bg-primary-50 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800">
          <p className="text-sm font-semibold text-primary-700 dark:text-primary-400 mb-3">
            {hasResult ? `Результатов загружено: ${resultCount}` : 'Загрузите результат работы'}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowResultModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              <Upload size={15} /> Загрузить результат
            </button>
            {task.status === 'in_progress' && (
              <button
                onClick={() => submitForReview.mutate()}
                disabled={submitForReview.isPending || !hasResult}
                title={!hasResult ? 'Сначала загрузите результат' : ''}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                  hasResult
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : 'bg-surface-200 dark:bg-surface-700 text-surface-400 cursor-not-allowed'
                )}
              >
                <Send size={15} /> Отправить на проверку
              </button>
            )}
            {task.status === 'returned' && hasResult && (
              <button
                onClick={() => updateTask.mutate({ status: 'in_progress' })}
                disabled={updateTask.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors"
              >
                Взять в работу
              </button>
            )}
          </div>
          {canSubmitReviewNoResult && (
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-2">
              Кнопка «Отправить на проверку» станет активной после загрузки результата
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main */}
        <div className="lg:col-span-2 space-y-4">
          {task.description && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">{t('tasks.description')}</h3>
              <MiniMarkdown
                text={task.description}
                className="text-surface-700 dark:text-surface-300"
              />
            </div>
          )}

          {/* Tech tags — категоризация задачи (frontend/backend/bug/etc.) */}
          {Array.isArray(task.tags) && task.tags.length > 0 && (
            <div className="card">
              <h3 className="font-semibold mb-2 text-surface-700 dark:text-surface-300 text-sm">Теги</h3>
              <div className="flex flex-wrap gap-1.5">
                {task.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className={clsx(
                      'text-[11px] font-medium px-2 py-0.5 rounded-full border',
                      TAG_COLORS[tag] || DEFAULT_TAG_COLOR,
                    )}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* X/Y Progress */}
          {task.totalCount > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-surface-700 dark:text-surface-300">Прогресс</h3>
                <span className="text-sm font-bold text-primary-600 dark:text-primary-400">
                  {task.doneCount} / {task.totalCount}
                </span>
              </div>
              <ProgressBar value={Math.round((task.doneCount / task.totalCount) * 100)} />
              {isPM && !isDone && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => updateTask.mutate({ doneCount: Math.max(0, (task.doneCount || 0) - 1) })}
                    disabled={task.doneCount <= 0}
                    className="px-3 py-1 text-sm bg-surface-100 dark:bg-surface-700 rounded-lg hover:bg-surface-200 dark:hover:bg-surface-600 disabled:opacity-40"
                  >
                    −
                  </button>
                  <button
                    onClick={() => updateTask.mutate({ doneCount: Math.min(task.totalCount, (task.doneCount || 0) + 1) })}
                    disabled={task.doneCount >= task.totalCount}
                    className="px-3 py-1 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-40"
                  >
                    +1
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-surface-100 dark:border-surface-700 flex-wrap">
            {(['results', 'checklist', 'comments', 'files'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={clsx(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  activeTab === tab
                    ? 'border-primary-600 text-primary-600 dark:text-primary-400 dark:border-primary-400'
                    : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-300'
                )}
              >
                {tab === 'results' && `Результаты (${results?.length || 0})`}
                {tab === 'checklist' && `Чек-лист (${checklist?.filter((i: any) => i.isDone).length || 0}/${checklist?.length || 0})`}
                {tab === 'comments' && `Комментарии (${task.comments?.length || 0})`}
                {tab === 'files' && t('files.title')}
              </button>
            ))}
          </div>

          {/* Results tab */}
          {activeTab === 'results' && (
            <div className="space-y-3">
              {!results?.length ? (
                <div className="text-center py-8 text-surface-400 dark:text-surface-500">
                  <MessageSquare size={32} className="mx-auto mb-2 opacity-40" />
                  <p className="text-sm">Результатов пока нет</p>
                  {isWorker && ['in_progress', 'returned'].includes(task.status) && (
                    <button onClick={() => setShowResultModal(true)} className="mt-3 btn-primary text-sm">
                      Загрузить результат
                    </button>
                  )}
                </div>
              ) : (
                results.map((r: any) => (
                  <div key={r.id} className="flex gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-700/50 group">
                    <Avatar name={r.submittedBy?.name} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium text-surface-900 dark:text-surface-100">{r.submittedBy?.name}</span>
                        <span className="text-xs text-surface-400">{format(new Date(r.createdAt), 'dd.MM HH:mm', { locale: ru })}</span>
                        <span className={clsx('text-[10px] px-1.5 py-0.5 rounded-full font-medium', {
                          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400': r.type === 'link',
                          'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400': r.type === 'media',
                          'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300': r.type === 'comment',
                        })}>
                          {r.type === 'link' ? 'Ссылка' : r.type === 'media' ? 'Медиа' : 'Комментарий'}
                        </span>
                      </div>
                      {r.type === 'link' ? (
                        <a href={r.content} target="_blank" rel="noreferrer"
                          className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 break-all">
                          <LinkIcon size={12} className="shrink-0" /> {r.content}
                        </a>
                      ) : (
                        <p className="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap">{r.content}</p>
                      )}
                    </div>
                    {isPM && (
                      <button
                        onClick={() => setDeleteResultId(r.id)}
                        className="hidden group-hover:flex p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-red-400 shrink-0 self-start"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Checklist tab */}
          {activeTab === 'checklist' && (
            <div className="space-y-2">
              {checklist?.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-700/30 group">
                  <button
                    onClick={() => toggleCheckItem.mutate(item.id)}
                    className={clsx('shrink-0 transition-colors', item.isDone ? 'text-green-500' : 'text-surface-300 dark:text-surface-600 hover:text-primary-500')}
                  >
                    {item.isDone ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  {editingCheckItem === item.id ? (
                    <div className="flex gap-2 flex-1">
                      <input
                        autoFocus
                        value={editCheckText}
                        onChange={e => setEditCheckText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && editCheckText.trim()) editCheckItemMut.mutate({ itemId: item.id, text: editCheckText })
                          if (e.key === 'Escape') setEditingCheckItem(null)
                        }}
                        className="input flex-1 text-sm py-1"
                      />
                      <button onClick={() => editCheckText.trim() && editCheckItemMut.mutate({ itemId: item.id, text: editCheckText })} className="btn-primary text-xs px-2 py-1">✓</button>
                      <button onClick={() => setEditingCheckItem(null)} className="btn-secondary text-xs px-2 py-1">✕</button>
                    </div>
                  ) : (
                    <span className={clsx('flex-1 text-sm', item.isDone ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-800 dark:text-surface-200')}>
                      {item.text}
                    </span>
                  )}
                  {canEditChecklist(task) && editingCheckItem !== item.id && (
                    <div className="flex sm:hidden sm:group-hover:flex items-center gap-1">
                      <button
                        onClick={() => { setEditingCheckItem(item.id); setEditCheckText(item.text) }}
                        className="p-1 text-surface-400 hover:text-primary-500 transition-colors"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        onClick={() => removeCheckItem.mutate(item.id)}
                        className="p-1 text-surface-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {!checklist?.length && (
                <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">Чек-лист пуст</p>
              )}
              {canEditChecklist(task) && !isDone && (
                <div className="flex gap-2 pt-2">
                  <input
                    value={newCheckItem}
                    onChange={e => setNewCheckItem(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && newCheckItem.trim() && addCheckItem.mutate(newCheckItem)}
                    placeholder="Добавить пункт..."
                    className="input flex-1 text-sm"
                  />
                  <button
                    onClick={() => newCheckItem.trim() && addCheckItem.mutate(newCheckItem)}
                    disabled={!newCheckItem.trim() || addCheckItem.isPending}
                    className="btn-primary flex items-center gap-1"
                  >
                    <Plus size={15} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Comments tab */}
          {activeTab === 'comments' && (
            <div className="space-y-3">
              {task.comments?.map((c: any) => (
                <div key={c.id} className="flex gap-3">
                  <Avatar name={c.author?.name} size={32} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-surface-900 dark:text-surface-100">{c.author?.name}</span>
                      <span className="text-xs text-surface-400 dark:text-surface-500">{format(new Date(c.createdAt), 'dd.MM HH:mm')}</span>
                    </div>
                    {editingComment === c.id ? (
                      <div className="flex gap-2">
                        <input value={editText} onChange={e => setEditText(e.target.value)} className="input flex-1 text-sm" />
                        <button onClick={() => updateComment.mutate({ cid: c.id, msg: editText })} className="btn-primary text-xs">{t('common.save')}</button>
                        <button onClick={() => setEditingComment(null)} className="btn-secondary text-xs">{t('common.cancel')}</button>
                      </div>
                    ) : (
                      <div className="bg-surface-50 dark:bg-surface-700/50 rounded-xl p-3 group relative">
                        {c.message && c.message.trim() ? (
                          <MiniMarkdown
                            text={c.message}
                            className="text-surface-700 dark:text-surface-300"
                          />
                        ) : (
                          <p className="text-xs italic text-surface-400 dark:text-surface-500">(пустое сообщение)</p>
                        )}
                        {(c.authorId === user?.id || user?.role === 'admin') && (
                          <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                            <button onClick={() => { setEditingComment(c.id); setEditText(c.message || '') }} className="p-1 hover:bg-surface-200 dark:hover:bg-surface-600 rounded-lg text-surface-500">
                              <Edit2 size={12} />
                            </button>
                            <button onClick={() => deleteComment.mutate(c.id)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg text-red-500">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex gap-3">
                <Avatar name={user?.name} size={32} />
                <div className="flex-1 flex gap-2">
                  <input
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && comment.trim() && addComment.mutate()}
                    placeholder="Комментарий..."
                    className="input flex-1 text-sm"
                  />
                  <button onClick={() => comment.trim() && addComment.mutate()} disabled={!comment.trim()} className="btn-primary">
                    <Send size={15} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Files tab */}
          {activeTab === 'files' && (
            <div className="space-y-3">
              <label className="btn-secondary cursor-pointer">
                <Upload size={15} /> {t('files.upload')}
                <input type="file" className="hidden" onChange={uploadFile} />
              </label>
              <div className="space-y-2">
                {files?.map((f: any) => (
                  <a key={f.id} href={`${import.meta.env.VITE_API_URL || ''}${f.path}`} target="_blank" rel="noreferrer" download={f.originalName}
                    className="flex items-center gap-3 p-3 bg-surface-50 dark:bg-surface-700/50 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-700"
                  >
                    <Paperclip size={15} className="text-primary-600 dark:text-primary-400 shrink-0" />
                    <span className="text-sm text-surface-700 dark:text-surface-300 flex-1 truncate">{f.originalName}</span>
                    <span className="text-xs text-surface-400 dark:text-surface-500">{(f.size / 1024).toFixed(1)} KB</span>
                  </a>
                ))}
                {!files?.length && <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-4">{t('files.noFiles')}</p>}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar info — Notion-style property panel */}
        <div className="space-y-3">
          {/* Status control (PM only when not in done/cancelled) — Notion-style */}
          {isPM && !['done', 'cancelled'].includes(task.status) && (
            <div className="notion-panel">
              <div className="notion-section">
                <h3 className="notion-section-title">Статус задачи</h3>
                <select
                  value={task.status}
                  onChange={e => updateTask.mutate({ status: e.target.value })}
                  className="input w-full text-sm"
                >
                  {['new','in_progress','review','returned','done','cancelled'].map(s => (
                    <option key={s} value={s}>
                      {({ new: 'Новая', in_progress: 'В работе', review: 'На проверке', returned: 'Возвращено', done: 'Готово', cancelled: 'Отменена' } as any)[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Единая Notion-style property panel — все блоки sidebar'а
              внутри одной мягкой панели с тонкими разделителями. */}
          <div className="notion-panel">
            {/* Section: Детали */}
            <div className="notion-section">
              <MultiAssigneesBlock task={task} currentUserId={user?.id} />
              <div className="notion-prop-row">
                <span className="notion-prop-label">📅 Дедлайн</span>
                <span className={clsx('notion-prop-value', isOverdue && 'text-red-500 font-medium')}>
                  {task.deadline ? format(new Date(task.deadline), 'dd MMM yyyy', { locale: ru }) : '—'}
                </span>
              </div>
              {isDone && task.reviewedAt && (
                <div className="notion-prop-row">
                  <span className="notion-prop-label">✓ Подтверждено</span>
                  <span className="notion-prop-value text-green-600 dark:text-green-400">
                    {format(new Date(task.reviewedAt), 'dd MMM yyyy', { locale: ru })}
                  </span>
                </div>
              )}
              <div className="notion-prop-row">
                <span className="notion-prop-label">🕐 Создана</span>
                <span className="notion-prop-value">{format(new Date(task.createdAt), 'dd MMM yyyy', { locale: ru })}</span>
              </div>
              {Number(task.estimatedHours) > 0 && (
                <div className="pt-1">
                  <TimeTrackingBlock estimated={Number(task.estimatedHours) || 0} logged={Number(task.loggedHours) || 0} />
                </div>
              )}
            </div>

            {/* Section: Acceptance Criteria — inline без card-обертки */}
            <AcceptanceCriteriaBlock
              task={task}
              canEdit={canEditChecklist(task)}
              currentUserId={user?.id}
              onSave={(criteria) => updateTask.mutate({ acceptanceCriteria: criteria })}
              saving={updateTask.isPending}
            />

            {/* Section: Tech details */}
            <TechMetaBlock
              task={task}
              canEdit={canEditChecklist(task)}
              onSave={(meta) => updateTask.mutate({ techMeta: meta })}
              saving={updateTask.isPending}
            />

            {/* Section: Story points + tags */}
            <DevMetaBlock
              task={task}
              canEdit={canEditChecklist(task)}
              onSave={(patch) => updateTask.mutate(patch)}
              saving={updateTask.isPending}
            />

            {/* Section: Related tasks (только если есть данные) */}
            <RelatedTasksBlock task={task} />
          </div>
        </div>
      </div>

      {/* Modal: keyboard shortcuts help (опен по ?) */}
      <Modal open={showShortcutHelp} onClose={() => setShowShortcutHelp(false)} title="⌨ Клавиатурные сокращения" size="sm">
        <div className="space-y-2 text-sm">
          {[
            { key: 'C', desc: 'Скопировать имя ветки' },
            { key: 'O', desc: 'Открыть Pull Request' },
            { key: 'G', desc: 'Открыть репозиторий' },
            { key: 'L', desc: 'Открыть staging / live URL' },
            { key: '?', desc: 'Показать / скрыть это окно' },
            { key: 'Esc', desc: 'Закрыть это окно' },
          ].map(s => (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="text-surface-600 dark:text-surface-300">{s.desc}</span>
              <kbd className="px-2 py-0.5 text-xs font-mono bg-surface-100 dark:bg-surface-700 rounded border border-surface-200 dark:border-surface-600">
                {s.key}
              </kbd>
            </div>
          ))}
          <p className="text-[11px] text-surface-400 dark:text-surface-500 pt-2 border-t border-surface-100 dark:border-surface-700">
            Шорткаты не срабатывают пока курсор в поле ввода.
          </p>
        </div>
      </Modal>

      {/* Modal: Load result */}
      <Modal open={showResultModal} onClose={() => setShowResultModal(false)} title="Загрузить результат" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Тип результата</label>
            <div className="flex gap-2">
              {(['comment', 'link', 'media'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setResultType(type)}
                  className={clsx('flex-1 py-2 rounded-xl text-sm font-medium border transition-colors', {
                    'border-primary-600 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400': resultType === type,
                    'border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:border-surface-300': resultType !== type,
                  })}
                >
                  {type === 'comment' ? 'Описание' : type === 'link' ? 'Ссылка' : 'Медиа'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label mb-1">
              {resultType === 'link' ? 'URL ссылка' : resultType === 'media' ? 'Ссылка на медиа' : 'Описание результата'}
            </label>
            {resultType === 'comment' ? (
              <textarea
                value={resultContent}
                onChange={e => setResultContent(e.target.value)}
                rows={4}
                placeholder="Опишите что сделано..."
                className="input w-full resize-none"
              />
            ) : (
              <input
                value={resultContent}
                onChange={e => setResultContent(e.target.value)}
                placeholder={resultType === 'link' ? 'https://...' : 'https://drive.google.com/...'}
                className="input w-full"
              />
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowResultModal(false)} className="btn-secondary">Отмена</button>
            <button
              onClick={() => addResult.mutate()}
              disabled={!resultContent.trim() || addResult.isPending}
              className="btn-primary"
            >
              Сохранить
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteResultId}
        onClose={() => setDeleteResultId(null)}
        onConfirm={() => deleteResult.mutate(deleteResultId!)}
        title="Удалить результат?"
        message="Результат работы будет удалён безвозвратно."
        danger
      />

      {/* Modal: Return reason */}
      <Modal open={showReturnModal} onClose={() => setShowReturnModal(false)} title="Вернуть задачу в работу" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label mb-1">Причина возврата</label>
            <textarea
              value={returnReason}
              onChange={e => setReturnReason(e.target.value)}
              rows={3}
              placeholder="Укажите что нужно доработать..."
              className="input w-full resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowReturnModal(false)} className="btn-secondary">Отмена</button>
            <button
              onClick={() => returnTask.mutate()}
              disabled={returnTask.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              <RotateCcw size={15} /> Вернуть
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Multi-assignee блок в виде вертикального таймлайна.
 *  Каждый исполнитель = карточка-этап. Справа — линия статусов:
 *    ✓ зелёный — этап завершён (имя зачёркнуто, карточка приглушена)
 *    ◉ синий пульсирующий — текущий «фокус» (первый невыполненный)
 *    ◯ пустой — будущий этап
 *  Сверху — заголовок «Сейчас задача у: <имя>» + прогресс-бар.
 *  Кнопка «Я сделал свою часть» показывается на карточке текущего
 *  пользователя, если он назначен и ещё не отметил. */

/** Time tracking — прогресс часов «Затрачено / Запланировано». */
function TimeTrackingBlock({ estimated, logged }: { estimated: number; logged: number }) {
  const pct = estimated > 0 ? Math.min(200, Math.round((logged / estimated) * 100)) : 0
  const color = pct > 100 ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="pt-2 border-t border-surface-100 dark:border-surface-700/50">
      <div className="flex items-center justify-between mb-1">
        <span className="text-surface-500 dark:text-surface-400 flex items-center gap-1">
          <Clock size={12} /> Затрачено
        </span>
        <span className={clsx('font-medium', pct > 100 ? 'text-red-500' : 'text-surface-700 dark:text-surface-300')}>
          {logged.toFixed(1)} / {estimated.toFixed(1)} ч.
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
        <div className={clsx('h-full transition-all', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {pct > 100 && (
        <p className="text-[10px] text-red-500 mt-1">Перерасход: {(logged - estimated).toFixed(1)} ч.</p>
      )}
    </div>
  )
}

/** Технические детали для dev-задач: репозиторий, ветка, PR, live preview.
 *  Просмотр + inline-редактор. Поля с copy-buttons и external-link иконками. */
interface TechMeta {
  repoUrl?: string
  branch?: string
  prUrl?: string
  liveUrl?: string
  stagingUrl?: string
  localDevPort?: string
  sentryUrl?: string
  ciStatusUrl?: string
}

function TechMetaBlock({
  task, canEdit, onSave, saving,
}: {
  task: any
  canEdit: boolean
  onSave: (meta: any) => void
  saving: boolean
}) {
  const meta = (task?.techMeta || {}) as TechMeta
  const hasAny = !!(meta.repoUrl || meta.branch || meta.prUrl || meta.liveUrl ||
    meta.stagingUrl || meta.localDevPort || meta.sentryUrl || meta.ciStatusUrl)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<TechMeta>(meta)

  const copy = (text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text).then(
      () => toast.success('Скопировано'),
      () => toast.error('Не удалось скопировать'),
    )
  }

  // Если нет данных и нет права редактирования — карточка не нужна.
  if (!hasAny && !canEdit) return null

  if (editing && canEdit) {
    return (
      <div className="notion-section space-y-3">
        <h3 className="notion-section-title">
          🔧 Технические детали
        </h3>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] text-surface-500 dark:text-surface-400 flex items-center gap-1 mb-1"><Github size={11} /> Репозиторий</label>
            <input
              value={draft.repoUrl || ''}
              onChange={e => setDraft(d => ({ ...d, repoUrl: e.target.value }))}
              className="input py-1.5 text-sm"
              placeholder="https://github.com/org/repo"
            />
          </div>
          <div>
            <label className="text-[11px] text-surface-500 dark:text-surface-400 flex items-center gap-1 mb-1">
              <GitBranch size={11} /> Ветка
              <button
                type="button"
                onClick={() => {
                  // Авто-генерация имени ветки из тайтла задачи + короткий ID.
                  const shortId = (task?.id || '').slice(0, 8)
                  const slug = slugifyForBranch(task?.title || 'task')
                  const prefix = task?.tags?.includes('bug') ? 'fix' : 'feature'
                  const branch = `${prefix}/${shortId}-${slug}`
                  setDraft(d => ({ ...d, branch }))
                }}
                className="ml-1 text-[10px] text-primary-600 dark:text-primary-400 hover:underline"
              >авто</button>
            </label>
            <input
              value={draft.branch || ''}
              onChange={e => setDraft(d => ({ ...d, branch: e.target.value }))}
              className="input py-1.5 text-sm font-mono"
              placeholder="feature/task-name"
            />
          </div>
          <div>
            <label className="text-[11px] text-surface-500 dark:text-surface-400 flex items-center gap-1 mb-1"><GitPullRequest size={11} /> Pull Request</label>
            <input
              value={draft.prUrl || ''}
              onChange={e => setDraft(d => ({ ...d, prUrl: e.target.value }))}
              className="input py-1.5 text-sm"
              placeholder="https://github.com/org/repo/pull/123"
            />
          </div>
          <div>
            <label className="text-[11px] text-surface-500 dark:text-surface-400 flex items-center gap-1 mb-1"><ExternalLink size={11} /> Production URL</label>
            <input
              value={draft.liveUrl || ''}
              onChange={e => setDraft(d => ({ ...d, liveUrl: e.target.value }))}
              className="input py-1.5 text-sm"
              placeholder="https://example.com"
            />
          </div>
          <div>
            <label className="text-[11px] text-surface-500 dark:text-surface-400 flex items-center gap-1 mb-1"><ExternalLink size={11} /> Staging / Preview URL</label>
            <input
              value={draft.stagingUrl || ''}
              onChange={e => setDraft(d => ({ ...d, stagingUrl: e.target.value }))}
              className="input py-1.5 text-sm"
              placeholder="https://staging.example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-surface-500 dark:text-surface-400 mb-1 block">Local dev port</label>
              <input
                value={draft.localDevPort || ''}
                onChange={e => setDraft(d => ({ ...d, localDevPort: e.target.value }))}
                className="input py-1.5 text-sm font-mono"
                placeholder="3000"
              />
            </div>
            <div>
              <label className="text-[11px] text-surface-500 dark:text-surface-400 mb-1 block">Sentry URL</label>
              <input
                value={draft.sentryUrl || ''}
                onChange={e => setDraft(d => ({ ...d, sentryUrl: e.target.value }))}
                className="input py-1.5 text-sm"
                placeholder="https://sentry.io/..."
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-surface-500 dark:text-surface-400 mb-1 block">CI status badge URL</label>
            <input
              value={draft.ciStatusUrl || ''}
              onChange={e => setDraft(d => ({ ...d, ciStatusUrl: e.target.value }))}
              className="input py-1.5 text-sm"
              placeholder="https://github.com/.../actions/workflows/.../badge.svg"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => { setDraft(meta); setEditing(false) }}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/30"
          >Отмена</button>
          <button
            type="button"
            onClick={() => {
              // Нормализуем: пустые поля → undefined, чтобы не хранить шум.
              const clean: any = {}
              if (draft.repoUrl?.trim())      clean.repoUrl      = draft.repoUrl.trim()
              if (draft.branch?.trim())       clean.branch       = draft.branch.trim()
              if (draft.prUrl?.trim())        clean.prUrl        = draft.prUrl.trim()
              if (draft.liveUrl?.trim())      clean.liveUrl      = draft.liveUrl.trim()
              if (draft.stagingUrl?.trim())   clean.stagingUrl   = draft.stagingUrl.trim()
              if (draft.localDevPort?.trim()) clean.localDevPort = draft.localDevPort.trim()
              if (draft.sentryUrl?.trim())    clean.sentryUrl    = draft.sentryUrl.trim()
              if (draft.ciStatusUrl?.trim())  clean.ciStatusUrl  = draft.ciStatusUrl.trim()
              onSave(Object.keys(clean).length === 0 ? null : clean)
              setEditing(false)
            }}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50"
          >Сохранить</button>
        </div>
      </div>
    )
  }

  return (
    <div className="notion-section">
      <div className="flex items-center justify-between">
        <h3 className="notion-section-title">
          🔧 Технические детали
        </h3>
        {canEdit && (
          <button
            onClick={() => { setDraft(meta); setEditing(true) }}
            className="p-1 text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
            title="Изменить"
          >
            <Edit2 size={13} />
          </button>
        )}
      </div>
      {hasAny ? (
        <div className="space-y-1.5 text-sm">
          {meta.repoUrl && (
            <TechRow
              icon={<Github size={13} />}
              label="Репозиторий"
              value={meta.repoUrl}
              isUrl
              onCopy={() => copy(meta.repoUrl!)}
            />
          )}
          {meta.branch && (
            <TechRow
              icon={<GitBranch size={13} />}
              label="Ветка"
              value={meta.branch}
              onCopy={() => copy(meta.branch!)}
              mono
            />
          )}
          {meta.prUrl && (
            <TechRow
              icon={<GitPullRequest size={13} />}
              label="PR"
              value={meta.prUrl}
              isUrl
              onCopy={() => copy(meta.prUrl!)}
            />
          )}
          {meta.liveUrl && (
            <TechRow
              icon={<ExternalLink size={13} />}
              label="Production"
              value={meta.liveUrl}
              isUrl
              onCopy={() => copy(meta.liveUrl!)}
            />
          )}
          {meta.stagingUrl && (
            <TechRow
              icon={<ExternalLink size={13} />}
              label="Staging"
              value={meta.stagingUrl}
              isUrl
              onCopy={() => copy(meta.stagingUrl!)}
            />
          )}
          {meta.localDevPort && (
            <TechRow
              icon={<ExternalLink size={13} />}
              label="Local"
              value={`localhost:${meta.localDevPort}`}
              isUrl={false}
              onCopy={() => copy(`localhost:${meta.localDevPort}`)}
              mono
            />
          )}
          {meta.sentryUrl && (
            <TechRow
              icon={<AlertTriangle size={13} />}
              label="Sentry"
              value={meta.sentryUrl}
              isUrl
              onCopy={() => copy(meta.sentryUrl!)}
            />
          )}
          {meta.ciStatusUrl && (
            <div className="pt-1">
              <img
                src={meta.ciStatusUrl}
                alt="CI status"
                className="h-5 inline-block"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => { setDraft({}); setEditing(true) }}
          className="w-full py-2 text-xs text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg flex items-center justify-center gap-1"
        >
          <Plus size={12} /> Добавить ссылки
        </button>
      )}
    </div>
  )
}

function TechRow({
  icon, label, value, isUrl, mono, onCopy,
}: {
  icon: React.ReactNode
  label: string
  value: string
  isUrl?: boolean
  mono?: boolean
  onCopy: () => void
}) {
  return (
    <div className="flex items-center gap-2 group">
      <span className="text-surface-400 dark:text-surface-500 shrink-0">{icon}</span>
      <span className="text-[11px] text-surface-500 dark:text-surface-400 shrink-0">{label}:</span>
      <span className="flex-1 min-w-0">
        {isUrl ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className={clsx(
              'text-primary-600 dark:text-primary-400 hover:underline truncate block',
              mono && 'font-mono text-xs',
            )}
            title={value}
          >
            {value}
          </a>
        ) : (
          <span
            className={clsx(
              'text-surface-700 dark:text-surface-300 truncate block',
              mono && 'font-mono text-xs',
            )}
            title={value}
          >
            {value}
          </span>
        )}
      </span>
      <button
        onClick={onCopy}
        className="p-1 text-surface-300 dark:text-surface-600 hover:text-primary-600 dark:hover:text-primary-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        title="Скопировать"
      >
        <Copy size={11} />
      </button>
    </div>
  )
}

/** Acceptance Criteria — структурированный Definition of Done.
 *  PM создаёт критерии, dev (или PM) отмечает выполнение.
 *  Прогресс показывается баром, видно кто и когда закрыл каждый пункт. */
function AcceptanceCriteriaBlock({
  task, canEdit, currentUserId, onSave, saving,
}: {
  task: any
  canEdit: boolean
  currentUserId?: string
  onSave: (criteria: any) => void
  saving: boolean
}) {
  const criteria: Array<{ id: string; text: string; done: boolean; doneBy?: string; doneAt?: string }> =
    Array.isArray(task?.acceptanceCriteria) ? task.acceptanceCriteria : []
  const [adding, setAdding] = useState(false)
  const [newText, setNewText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const doneCount = criteria.filter(c => c.done).length
  const total = criteria.length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const add = () => {
    if (!newText.trim()) return
    const next = [
      ...criteria,
      { id: crypto.randomUUID(), text: newText.trim(), done: false },
    ]
    onSave(next)
    setNewText('')
    setAdding(false)
  }
  const toggle = (id: string) => {
    const next = criteria.map(c => c.id === id
      ? { ...c, done: !c.done,
          doneBy: !c.done ? currentUserId : undefined,
          doneAt: !c.done ? new Date().toISOString() : undefined }
      : c,
    )
    onSave(next)
  }
  const remove = (id: string) => onSave(criteria.filter(c => c.id !== id))
  const saveEdit = (id: string) => {
    if (!editText.trim()) { setEditingId(null); return }
    onSave(criteria.map(c => c.id === id ? { ...c, text: editText.trim() } : c))
    setEditingId(null)
  }

  if (total === 0 && !canEdit) return null

  return (
    <div className="notion-section">
      <div className="flex items-center justify-between">
        <h3 className="notion-section-title">
          ✅ Критерии приёмки {total > 0 && <span className="normal-case tracking-normal font-normal text-surface-400">{doneCount}/{total}</span>}
        </h3>
        {canEdit && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1"
          ><Plus size={12} /> Добавить</button>
        )}
      </div>
      {total > 0 && (
        <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
          <div
            className={clsx('h-full transition-all', pct === 100 ? 'bg-emerald-500' : 'bg-primary-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="space-y-1.5">
        {criteria.map(c => (
          <div key={c.id} className="flex items-start gap-2 group">
            <button
              onClick={() => canEdit && toggle(c.id)}
              disabled={!canEdit || saving}
              className={clsx(
                'mt-0.5 shrink-0',
                canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-70',
              )}
            >
              {c.done
                ? <CheckSquare size={15} className="text-emerald-500" />
                : <Square size={15} className="text-surface-400" />}
            </button>
            {editingId === c.id ? (
              <div className="flex-1 flex gap-1">
                <input
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveEdit(c.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  autoFocus
                  className="input py-0.5 px-2 text-sm flex-1"
                />
                <button onClick={() => saveEdit(c.id)} className="p-0.5 text-emerald-600"><Check size={13} /></button>
              </div>
            ) : (
              <>
                <span className={clsx(
                  'flex-1 text-sm',
                  c.done && 'line-through text-surface-400',
                )}>{c.text}</span>
                {canEdit && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 shrink-0">
                    <button
                      onClick={() => { setEditingId(c.id); setEditText(c.text) }}
                      className="p-0.5 text-surface-400 hover:text-primary-600"
                      title="Изменить"
                    ><Edit2 size={11} /></button>
                    <button
                      onClick={() => remove(c.id)}
                      className="p-0.5 text-surface-400 hover:text-red-500"
                      title="Удалить"
                    ><Trash2 size={11} /></button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {adding && canEdit && (
        <div className="flex gap-1 pt-1">
          <input
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') add()
              if (e.key === 'Escape') { setAdding(false); setNewText('') }
            }}
            autoFocus
            placeholder="Например: тесты покрывают edge-cases"
            className="input py-1 px-2 text-sm flex-1"
          />
          <button onClick={add} className="px-2 py-1 text-xs rounded-lg bg-primary-600 hover:bg-primary-700 text-white">
            <Check size={13} />
          </button>
          <button onClick={() => { setAdding(false); setNewText('') }} className="px-2 py-1 text-xs rounded-lg border border-surface-200 dark:border-surface-700">
            ✕
          </button>
        </div>
      )}
      {total === 0 && !adding && canEdit && (
        <p className="text-xs text-surface-400 dark:text-surface-500 italic">
          Опишите критерии готовности — задача считается закрытой когда все ✓
        </p>
      )}
    </div>
  )
}

/** Story points + tech tags редактор. Маленькая карточка с двумя
 *  быстрыми селекторами для dev-метрик. */
function DevMetaBlock({
  task, canEdit, onSave, saving,
}: {
  task: any
  canEdit: boolean
  onSave: (patch: any) => void
  saving: boolean
}) {
  const points: number | null = typeof task?.storyPoints === 'number' ? task.storyPoints : null
  const tags: string[] = Array.isArray(task?.tags) ? task.tags : []
  const [editingTags, setEditingTags] = useState(false)

  const togglePoints = (p: number) => {
    if (saving) return
    onSave({ storyPoints: points === p ? null : p })
  }
  const toggleTag = (t: string) => {
    if (saving) return
    const next = tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t]
    onSave({ tags: next })
  }

  // Карточка не показывается обычным просмотрщикам если ничего не задано.
  if (!canEdit && points === null && tags.length === 0) return null

  return (
    <div className="notion-section space-y-3">
      <h3 className="notion-section-title">📊 Оценка и теги</h3>
      <div>
        <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-1.5">Story points (Fibonacci)</div>
        {canEdit ? (
          <div className="flex flex-wrap gap-1">
            {[1, 2, 3, 5, 8, 13].map(p => (
              <button
                key={p}
                onClick={() => togglePoints(p)}
                disabled={saving}
                className={clsx(
                  'w-8 h-8 rounded-lg text-xs font-semibold transition-colors',
                  points === p
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
                )}
              >{p}</button>
            ))}
          </div>
        ) : (
          <span className="text-sm font-semibold text-primary-600 dark:text-primary-400">
            {points ?? '—'}
          </span>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-surface-500 dark:text-surface-400">Теги</span>
          {canEdit && (
            <button
              onClick={() => setEditingTags(v => !v)}
              className="text-[11px] text-primary-600 dark:text-primary-400 hover:underline"
            >{editingTags ? 'Готово' : 'Изменить'}</button>
          )}
        </div>
        {editingTags && canEdit ? (
          <div className="flex flex-wrap gap-1">
            {AVAILABLE_TAGS.map(t => {
              const active = tags.includes(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  disabled={saving}
                  className={clsx(
                    'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                    active
                      ? TAG_COLORS[t] || 'bg-primary-100 text-primary-700 border-primary-200'
                      : 'bg-transparent border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-400 hover:border-primary-300',
                  )}
                >{t}</button>
              )
            })}
          </div>
        ) : (
          tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tags.map(t => (
                <span
                  key={t}
                  className={clsx(
                    'text-[11px] px-2 py-0.5 rounded-full border',
                    TAG_COLORS[t] || DEFAULT_TAG_COLOR,
                  )}
                >{t}</span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-surface-400 italic">Не выбрано</span>
          )
        )}
      </div>
    </div>
  )
}

/** Связанные задачи: blocks (эта блокирует) / blockedBy (блокируется этими).
 *  Просто отображаем ссылки на задачи, реальный редактор пока в общую
 *  форму update не вынесен — добавление через API напрямую. */
function RelatedTasksBlock({ task }: { task: any }) {
  const blocks: string[] = Array.isArray(task?.blocksTaskIds) ? task.blocksTaskIds : []
  const blockedBy: string[] = Array.isArray(task?.blockedByTaskIds) ? task.blockedByTaskIds : []
  if (blocks.length === 0 && blockedBy.length === 0) return null
  return (
    <div className="notion-section space-y-2">
      <h3 className="notion-section-title">🔗 Связанные задачи</h3>
      {blockedBy.length > 0 && (
        <div>
          <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-1">⏸ Блокируется</div>
          <ul className="space-y-1">
            {blockedBy.map(id => (
              <li key={id}>
                <Link to={`/tasks/${id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline font-mono">
                  #{id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {blocks.length > 0 && (
        <div>
          <div className="text-[11px] text-surface-500 dark:text-surface-400 mb-1">▶ Блокирует</div>
          <ul className="space-y-1">
            {blocks.map(id => (
              <li key={id}>
                <Link to={`/tasks/${id}`} className="text-xs text-primary-600 dark:text-primary-400 hover:underline font-mono">
                  #{id.slice(0, 8)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function MultiAssigneesBlock({ task, currentUserId }: { task: any; currentUserId?: string }) {
  const qc = useQueryClient()
  const assignees: Array<{ userId: string; isDone: boolean; doneAt?: string; user: any }> =
    Array.isArray(task?.assignees) && task.assignees.length > 0
      ? task.assignees
      : (task?.assigneeId
          ? [{ userId: task.assigneeId, isDone: false, user: task.assignee || { id: task.assigneeId, name: '—' } }]
          : [])

  const total = assignees.length
  const doneCount = assignees.filter(a => a.isDone).length
  const allDone = total > 0 && doneCount === total
  const currentIdx = assignees.findIndex(a => !a.isDone) // индекс «фокуса»
  const currentAssignee = currentIdx >= 0 ? assignees[currentIdx] : null
  const me = currentUserId ? assignees.find(a => a.userId === currentUserId) : null
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0

  const markDoneMut = useMutation({
    mutationFn: () => tasksApi.markMyPartDone(task.id),
    onSuccess: () => {
      invalidateAfterTaskChange(qc, task.projectId)
      qc.invalidateQueries({ queryKey: ['task', task.id] })
      toast.success('✓ Ваша часть отмечена готовой')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось отметить'),
  })

  if (total === 0) {
    return (
      <div className="flex justify-between text-sm">
        <span className="text-surface-500 dark:text-surface-400">Исполнители</span>
        <span className="text-surface-400">—</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-surface-500 dark:text-surface-400 text-xs flex items-center gap-1">
            <Users size={12} /> Прогресс задачи
          </div>
          <div className="font-semibold text-sm mt-0.5 text-surface-900 dark:text-surface-100">
            {allDone
              ? '🎯 Все исполнители завершили — задача на проверке'
              : currentAssignee
                ? <>Сейчас у: <span className="text-primary-600 dark:text-primary-400">{currentAssignee.user?.name || '—'}</span>{currentAssignee.userId === currentUserId && <span className="text-[11px] text-primary-500"> (вы)</span>}</>
                : '—'}
          </div>
        </div>
        <span className={clsx(
          'text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0',
          allDone
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
        )}>
          {doneCount}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-surface-100 dark:bg-surface-700 overflow-hidden">
        <div
          className={clsx('h-full transition-all duration-300', allDone ? 'bg-emerald-500' : 'bg-primary-500')}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Timeline */}
      <div className="relative pt-1">
        {/* вертикальная линия */}
        <div className="absolute right-3 top-3 bottom-3 w-px bg-surface-200 dark:bg-surface-700" />

        <div className="space-y-2">
          {assignees.map((a, idx) => {
            const isCurrent = !a.isDone && idx === currentIdx
            const isMe = a.userId === currentUserId
            return (
              <div key={a.userId} className="relative pr-9">
                {/* card */}
                <div
                  className={clsx(
                    'rounded-xl px-3 py-2.5 border transition-colors',
                    a.isDone
                      ? 'bg-surface-50 dark:bg-surface-800/40 border-surface-100 dark:border-surface-700'
                      : isCurrent
                        ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                        : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Avatar name={a.user?.name} size={28} />
                    <div className="flex-1 min-w-0">
                      <div className={clsx(
                        'text-sm font-medium truncate',
                        a.isDone
                          ? 'text-surface-400 dark:text-surface-500 line-through'
                          : 'text-surface-900 dark:text-surface-100',
                      )}>
                        {a.user?.name || '—'}
                        {isMe && <span className="text-[11px] text-primary-500 ml-1 no-underline">(вы)</span>}
                      </div>
                      <div className="text-[11px] text-surface-500 dark:text-surface-400">
                        {a.isDone && a.doneAt
                          ? `Сделано ${new Date(a.doneAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                          : isCurrent
                            ? '🔵 В работе сейчас'
                            : 'Ожидает своей очереди'}
                      </div>
                    </div>
                  </div>

                  {/* Кнопка «Я сделал свою часть» — ТОЛЬКО на текущем шаге.
                      Если я на нескольких шагах, кнопка только на активном. */}
                  {isMe && !a.isDone && isCurrent && (
                    <button
                      onClick={() => markDoneMut.mutate()}
                      disabled={markDoneMut.isPending}
                      className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium disabled:opacity-50"
                    >
                      <CheckCircle size={13} />
                      {markDoneMut.isPending ? 'Сохраняю...' : 'Я сделал свою часть'}
                    </button>
                  )}
                  {isMe && !a.isDone && !isCurrent && (
                    <div className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 text-center">
                      ⏳ Ждите своей очереди
                    </div>
                  )}
                </div>

                {/* status circle on the line */}
                <span
                  className={clsx(
                    'absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center ring-4',
                    a.isDone
                      ? 'bg-emerald-500 text-white ring-white dark:ring-surface-900'
                      : isCurrent
                        ? 'bg-primary-500 text-white ring-white dark:ring-surface-900 animate-pulse'
                        : 'bg-surface-200 dark:bg-surface-700 ring-white dark:ring-surface-900',
                  )}
                  title={a.isDone ? 'Готово' : isCurrent ? 'В работе' : 'Ожидает'}
                >
                  {a.isDone && <Check size={11} strokeWidth={3} />}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {me && me.isDone && !allDone && (
        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 text-center pt-1">
          ✓ Ваша часть готова. Ждём остальных.
        </div>
      )}
    </div>
  )
}
