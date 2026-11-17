import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ExternalLink, FileText, X } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Spinner } from '@/components/ui'
import { filesApi, taskResultsApi, tasksApi } from '@/services/api.service'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { normalizeTaskStatus } from '@/lib/taskStatus'
import { assigneeNotes, isAwaitingReview, peopleLabel, serverMessage, taskAssignees } from '@/lib/taskCabinet'
import { dueLabel, pluralRu, whenLabel } from '@/lib/taskDue'
import type { CabinetTask, TaskFileItem, TaskResultItem } from '@/types/taskCabinet'

/**
 * Проверка сданной задачи (docs/SMM_DELEGATION_SPEC.md, 17.11.2026).
 * На компьютере — панель справа от списка (variant="side"), на телефоне —
 * экран поверх (variant="screen"). «Принять» — одной кнопкой; «Вернуть»
 * сначала раскрывает обязательное поле «Что поправить».
 */

const FILE_BASE = import.meta.env.VITE_API_URL || ''
/** Путь файла с сервера (/uploads/…) → адрес; полный http(s) — как есть. */
const fileUrl = (path?: string | null): string => {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  return `${FILE_BASE}${path.startsWith('/') ? '' : '/'}${path}`
}
/** Ссылку из результата открываем, только если это http(s). */
const safeHref = (v?: string | null): string | null => {
  const s = (v || '').trim()
  return /^https?:\/\//i.test(s) ? s : null
}
const isImage = (f: TaskFileItem) => typeof f.mimetype === 'string' && f.mimetype.startsWith('image/')

const rowBase = 'flex items-center gap-2.5 min-h-[44px] lg:min-h-[40px] min-w-0 text-sm text-surface-800 dark:text-surface-100'
const rowLink = clsx(rowBase, 'hover:text-primary-600 dark:hover:text-primary-300')

function ResultLink({ href, icon, children }: { href: string | null; icon: ReactNode; children: ReactNode }) {
  if (!href) {
    return <div className={rowBase}>{icon}<span className="truncate min-w-0">{children}</span></div>
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={rowLink}>
      {icon}<span className="truncate min-w-0 underline-offset-2 hover:underline">{children}</span>
    </a>
  )
}

interface Props {
  task: CabinetTask
  variant: 'side' | 'screen'
  onClose: () => void
}

export default function TaskReviewPanel({ task, variant, onClose }: Props) {
  const qc = useQueryClient()
  const now = new Date()
  const status = normalizeTaskStatus(task.status)
  const awaiting = isAwaitingReview(task, now)
  const screen = variant === 'screen'

  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  useEffect(() => { setReturning(false); setReason('') }, [task.id])

  // Те же ключи, что у карточки задачи, — кэш общий.
  const resultsQ = useQuery({
    queryKey: ['task-results', task.id],
    queryFn: () => taskResultsApi.list(task.id),
    staleTime: 30_000,
  })
  const filesQ = useQuery({
    queryKey: ['task-files', task.id],
    queryFn: () => filesApi.byTask(task.id),
    staleTime: 30_000,
  })

  const finish = () => {
    invalidateAfterTaskChange(qc, task.projectId ?? task.project?.id ?? undefined)
    onClose()
  }
  const approveMut = useMutation({
    mutationFn: () => tasksApi.approve(task.id),
    onSuccess: () => { toast.success('Принято'); finish() },
    onError: (e: unknown) => toast.error(serverMessage(e, 'Не удалось принять задачу')),
  })
  const returnMut = useMutation({
    mutationFn: (why: string) => tasksApi.returnTask(task.id, why),
    onSuccess: () => { toast.success('Вернули на доработку'); finish() },
    onError: (e: unknown) => toast.error(serverMessage(e, 'Не удалось вернуть задачу')),
  })
  const busy = approveMut.isPending || returnMut.isPending

  // Escape: сначала закрывает поле «Что поправить», потом панель. Если
  // поверх открыто другое окно (форма задачи, фото) — Escape его.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-review-screen])')) return
      if (returning) { setReturning(false); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [returning, onClose])

  const people = taskAssignees(task)
  const reviewedAt = whenLabel(task.reviewedAt, now)
  const stateLabel = awaiting
    ? 'Сдано на проверку'
    : status === 'cancelled'
      ? 'Отменена'
      : status === 'done'
        ? (reviewedAt ? `Принято ${reviewedAt}` : 'Готово')
        : (task.reworkCount ?? 0) > 0 ? 'На доработке' : status === 'new' ? 'Новая' : 'В работе'

  const due = dueLabel(task.deadline, now)
  const submitted = whenLabel(task.completedAt, now, true)
  const metaParts: ReactNode[] = [peopleLabel(people)]
  if (task.project?.name) metaParts.push(task.project.name)
  if (status === 'done' && submitted) metaParts.push(`сдано ${submitted}`)
  else if (status === 'new' || status === 'in_progress') {
    metaParts.push(<span key="due" className={due.late ? 'text-red-600 dark:text-red-400' : undefined}>{due.text}</span>)
  }

  const files = filesQ.data ?? []
  const images = files.filter(isImage)
  const otherFiles = files.filter(f => !isImage(f))
  const results: TaskResultItem[] = resultsQ.data ?? []
  const notes = assigneeNotes(task)
  const loading = resultsQ.isLoading || filesQ.isLoading
  const hasResults = images.length + otherFiles.length + results.length + notes.length > 0
  const showResults = hasResults || status === 'done'
  const titleId = `review-title-${task.id}`

  const btnBase = clsx('w-full', screen ? 'min-h-[52px] text-base rounded-xl' : 'min-h-[44px] text-[15px]')
  const btnSecondary = clsx(btnBase, 'btn-secondary')
  const btnPrimary = clsx(btnBase, 'btn-primary')

  const actions = awaiting ? (
    returning ? (
      <div className="flex flex-col gap-2">
        <label htmlFor={`return-${task.id}`} className="text-[13px] font-semibold text-surface-600 dark:text-surface-300">Что поправить</label>
        <textarea
          id={`return-${task.id}`}
          autoFocus
          value={reason}
          onChange={e => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Например: фон светлее, логотип крупнее"
          className="input min-h-[84px] resize-y"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={busy} onClick={() => { setReturning(false); setReason('') }} className={btnSecondary}>Отмена</button>
          <button
            type="button"
            disabled={!reason.trim() || busy}
            onClick={() => returnMut.mutate(reason.trim())}
            className={btnPrimary}
          >{returnMut.isPending ? 'Возвращаем…' : 'Вернуть'}</button>
        </div>
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" disabled={busy} onClick={() => setReturning(true)} className={btnSecondary}>Вернуть</button>
        <button type="button" disabled={busy} onClick={() => approveMut.mutate()} className={btnPrimary}>
          {approveMut.isPending ? 'Принимаем…' : 'Принять'}
        </button>
      </div>
    )
  ) : null

  const body = (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className={clsx('text-[13px] font-semibold', awaiting ? 'text-amber-600 dark:text-amber-400' : 'text-surface-500 dark:text-surface-400')}>
          {stateLabel}
        </span>
        <h2 id={titleId} className={clsx('font-bold leading-snug text-surface-900 dark:text-surface-50 break-words', screen ? 'text-[21px]' : 'text-[19px] pr-9')}>
          {task.title}
        </h2>
        <p className="text-[13px] sm:text-sm text-surface-500 dark:text-surface-400 break-words">
          {metaParts.map((p, i) => <span key={i}>{i > 0 && ' · '}{p}</span>)}
        </p>
      </div>

      {task.description && (
        <p className="text-sm text-surface-600 dark:text-surface-300 whitespace-pre-wrap break-words line-clamp-6">{task.description}</p>
      )}

      {showResults && (
        loading ? (
          <div className="py-2"><Spinner size={20} /></div>
        ) : !hasResults ? (
          <p className="text-sm text-surface-500 dark:text-surface-400">Файлов и заметок к задаче нет.</p>
        ) : (
          <div className="flex flex-col gap-3 min-w-0">
            {images.length > 0 && (
              <div className={clsx('grid gap-2', screen ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 xl:grid-cols-4')}>
                {images.map(f => (
                  <a
                    key={f.id}
                    href={fileUrl(f.path)}
                    target="_blank"
                    rel="noreferrer"
                    title={f.originalName}
                    className="block aspect-[4/5] rounded-lg overflow-hidden bg-surface-200 dark:bg-surface-700"
                  >
                    <img src={fileUrl(f.path)} alt={f.originalName} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            )}
            {(otherFiles.length > 0 || results.some(r => r.type !== 'comment')) && (
              <div className="flex flex-col">
                {otherFiles.map(f => (
                  <ResultLink key={f.id} href={fileUrl(f.path)} icon={<FileText size={16} className="shrink-0 text-surface-400" />}>
                    {f.originalName}
                  </ResultLink>
                ))}
                {results.filter(r => r.type !== 'comment').map(r => (
                  r.type === 'file' ? (
                    <ResultLink key={r.id} href={fileUrl(r.filePath) || safeHref(r.content)} icon={<FileText size={16} className="shrink-0 text-surface-400" />}>
                      {r.fileName || r.content}
                    </ResultLink>
                  ) : (
                    <ResultLink key={r.id} href={safeHref(r.content)} icon={<ExternalLink size={16} className="shrink-0 text-surface-400" />}>
                      {r.content}
                    </ResultLink>
                  )
                ))}
              </div>
            )}
            {results.filter(r => r.type === 'comment' && r.content?.trim()).map(r => (
              <p key={r.id} className="text-sm sm:text-[15px] leading-relaxed text-surface-700 dark:text-surface-200 whitespace-pre-wrap break-words">
                «{r.content.trim()}»
              </p>
            ))}
            {notes.map((n, i) => (
              <p key={`note-${i}`} className="text-sm sm:text-[15px] leading-relaxed text-surface-700 dark:text-surface-200 whitespace-pre-wrap break-words">
                {people.length > 1 && <span className="text-surface-500 dark:text-surface-400">{n.name}: </span>}«{n.note}»
              </p>
            ))}
          </div>
        )
      )}

      {awaiting && (task.reworkCount ?? 0) > 0 && task.returnReason && (
        <p className="text-[13px] text-surface-500 dark:text-surface-400 break-words">
          Возвращали {task.reworkCount} {pluralRu(task.reworkCount ?? 0, 'раз', 'раза', 'раз')}, в последний раз: «{task.returnReason}»
        </p>
      )}

      <Link
        to={`/tasks/${task.id}`}
        className="self-start inline-flex items-center min-h-[44px] lg:min-h-0 text-sm font-medium text-primary-600 dark:text-primary-300 hover:underline"
      >Открыть задачу целиком</Link>
    </div>
  )

  if (screen) {
    return createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-review-screen
        className="fixed inset-0 z-50 flex flex-col bg-surface-100 dark:bg-surface-900 animate-fade-in"
      >
        <div className="shrink-0 flex items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label="Назад к задачам"
            className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-800"
          ><ChevronLeft size={22} /></button>
          <span className="text-[15px] text-surface-500 dark:text-surface-400">Задачи</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-6">{body}</div>
        {actions && (
          <div className="shrink-0 border-t border-surface-200 dark:border-surface-700 px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-surface-100 dark:bg-surface-900">
            {actions}
          </div>
        )}
      </div>,
      document.body,
    )
  }

  return (
    <section aria-labelledby={titleId} className="card relative rounded-2xl p-5 xl:p-6 flex flex-col gap-5">
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть"
        className="absolute top-3 right-3 w-9 h-9 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700"
      ><X size={18} /></button>
      {body}
      {actions}
    </section>
  )
}
