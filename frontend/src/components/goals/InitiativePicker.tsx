// «Привязать проект или задачу» к результату отдела («Компас компании»,
// 16.11.2026, docs/GOALS_SPEC.md §7): POST /compass/key-results/:id/initiatives.
// Проекты — из общего списка /projects (ищем по названию на месте; проекты
// направления отдела — первыми), задачи — поиском /tasks?search= (без запроса
// список задач слишком велик, поэтому ищем от двух букв).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Loader2, Search } from 'lucide-react'
import { Modal } from '@/components/ui'
import { projectsApi, tasksApi } from '@/services/api.service'
import { compassApi, compassKeys } from '@/services/goals.api'
import { isDevProjectType, projectTypeLabel } from '@/lib/projectType'
import { getTaskStatusLabel, normalizeTaskStatus } from '@/lib/taskStatus'
import { dayMonthLabel } from '@/lib/goals'
import { errorText } from '@/components/sales/leadUtils'
import type { KeyResultView } from '@/types/goals'

type Kind = 'project' | 'task'

interface ProjectRow { id: string; name: string; projectType?: string | null; status?: string | null }
interface TaskRow {
  id: string; title: string; status?: string | null; deadline?: string | null
  project?: { name?: string | null } | null
}
interface Row { id: string; title: string; sub: string; taken: boolean; first: boolean }

const PROJECT_STATUS: Record<string, string> = {
  planning: 'планируется', in_progress: 'в работе', completed: 'завершён', on_hold: 'на паузе', archived: 'в архиве',
}

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()

/** «25 ноября» из срока задачи (YYYY-MM-DD или ISO-время — день по Душанбе). */
function dueLabel(d: string | null | undefined): string | null {
  if (!d) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return dayMonthLabel(d)
  const t = Date.parse(d)
  return Number.isNaN(t) ? null : dayMonthLabel(new Date(t + 5 * 3600 * 1000).toISOString().slice(0, 10))
}

const MAX_ROWS = 50

export default function InitiativePicker({ open, onClose, kr }: {
  open: boolean
  onClose: () => void
  kr: Pick<KeyResultView, 'id' | 'title' | 'department' | 'initiatives'>
}) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<Kind>('project')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [picked, setPicked] = useState('')

  // Поиск задач — с паузой 300 мс, чтобы не дёргать сервер на каждую букву.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Закрыли окно — следующее открытие начинается с чистого листа.
  useEffect(() => {
    if (open) return
    setKind('project'); setSearch(''); setDebounced(''); setPicked('')
  }, [open])

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
    staleTime: 30_000,
    enabled: open && kind === 'project',
  })
  const tasksQ = useQuery({
    queryKey: ['compass-picker', 'tasks', debounced],
    queryFn: () => tasksApi.list({ search: debounced }),
    staleTime: 30_000,
    // Пока ищется новое слово — показываем прежние находки, без мигания.
    placeholderData: keepPreviousData,
    enabled: open && kind === 'task' && debounced.length >= 2,
  })

  const taken = useMemo(() => new Set(kr.initiatives.map(i => `${i.kind}:${i.refId}`)), [kr.initiatives])

  const rows = useMemo<Row[]>(() => {
    const s = norm(search)
    if (kind === 'project') {
      const all: ProjectRow[] = Array.isArray(projectsQ.data) ? projectsQ.data : []
      // Проекты своего направления — первыми: SMM-отделу SMM-проекты,
      // разработке — сайты, боты, CRM.
      const ownType = (p: ProjectRow) => kr.department === 'smm' ? p.projectType === 'SMM'
        : kr.department === 'dev' ? isDevProjectType(p.projectType) : false
      return all
        .filter(p => !s || norm(p.name).includes(s))
        .map(p => ({
          id: p.id,
          title: p.name,
          sub: [projectTypeLabel(p.projectType), p.status ? PROJECT_STATUS[p.status] : null].filter(Boolean).join(' · '),
          taken: taken.has(`project:${p.id}`),
          first: ownType(p),
        }))
        .sort((a, b) => Number(b.first) - Number(a.first) || a.title.localeCompare(b.title, 'ru'))
        .slice(0, MAX_ROWS)
    }
    const all: TaskRow[] = Array.isArray(tasksQ.data) ? tasksQ.data : []
    return all
      .filter(t => normalizeTaskStatus(t.status) !== 'cancelled')
      .map(t => {
        const due = dueLabel(t.deadline)
        return {
          id: t.id,
          title: t.title,
          sub: [t.project?.name || null, getTaskStatusLabel(t.status).toLowerCase(), due ? `до ${due}` : null]
            .filter(Boolean).join(' · '),
          taken: taken.has(`task:${t.id}`),
          first: false,
        }
      })
      .slice(0, MAX_ROWS)
  }, [kind, search, projectsQ.data, tasksQ.data, taken, kr.department])

  const attach = useMutation({
    mutationFn: () => compassApi.addInitiative(kr.id, { kind, refId: picked }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: compassKeys.all })
      toast.success(kind === 'project' ? 'Проект привязан' : 'Задача привязана')
      onClose()
    },
    // 409 — уже привязано, 403 — нет прав: показываем, что сказал сервер.
    onError: (e) => toast.error(errorText(e, 'Не удалось привязать')),
  })

  const q = kind === 'project' ? projectsQ : tasksQ
  const needMore = kind === 'task' && debounced.length < 2
  const pickedRow = rows.find(r => r.id === picked)

  let body: ReactNode
  if (needMore) {
    body = <p className="text-sm text-surface-500 dark:text-surface-400 py-4">Напишите хотя бы две буквы из названия задачи.</p>
  } else if (q.isPending) {
    body = (
      <p className="flex items-center gap-2 text-sm text-surface-500 py-4" role="status">
        <Loader2 size={15} className="animate-spin" aria-hidden="true" /> {kind === 'project' ? 'Загружаем проекты…' : 'Ищем задачи…'}
      </p>
    )
  } else if (q.isError) {
    body = (
      <div className="flex items-center justify-between gap-3 py-3 text-sm text-surface-600 dark:text-surface-300" role="alert">
        {kind === 'project' ? 'Не удалось загрузить проекты.' : 'Не удалось найти задачи.'}
        <button type="button" onClick={() => q.refetch()} className="btn-secondary min-h-[44px] lg:min-h-[36px]">Повторить</button>
      </div>
    )
  } else if (!rows.length) {
    body = <p className="text-sm text-surface-500 dark:text-surface-400 py-4">{search.trim() ? 'Ничего не нашлось.' : 'Проектов пока нет.'}</p>
  } else {
    body = (
      <fieldset>
        <legend className="sr-only">{kind === 'project' ? 'Проект' : 'Задача'}</legend>
        <ul className="flex flex-col gap-1.5">
          {rows.map(r => (
            <li key={r.id}>
              <label className={clsx('flex items-center gap-3 min-h-[44px] rounded-lg border px-3 py-2 text-sm',
                r.taken ? 'opacity-50 cursor-not-allowed border-surface-200 dark:border-surface-700'
                  : picked === r.id ? 'border-primary-600 dark:border-surface-300 bg-surface-100 dark:bg-surface-700/60 cursor-pointer'
                  : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700/40 cursor-pointer')}>
                <input type="radio" name={`initiative-${kr.id}`} value={r.id} checked={picked === r.id} disabled={r.taken}
                  onChange={() => setPicked(r.id)} className="shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-surface-900 dark:text-surface-100 break-words">{r.title}</span>
                  {(r.sub || r.taken) && (
                    <span className="block text-xs text-surface-500 dark:text-surface-400">
                      {r.taken ? 'уже привязано к этому результату' : r.sub}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title="Привязать проект или задачу" size="md">
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-surface-600 dark:text-surface-300">
          Что двигает результат «{kr.title}». Привязанное видно на странице отдела.
        </p>

        <div role="group" aria-label="Что привязать" className="flex gap-2">
          {(['project', 'task'] as const).map(k => (
            <button key={k} type="button" aria-pressed={kind === k}
              onClick={() => { setKind(k); setPicked('') }}
              className={clsx('chip', kind === k && 'chip-on')}>
              {k === 'project' ? 'Проект' : 'Задача'}
            </button>
          ))}
        </div>

        <label className="relative block">
          <span className="sr-only">{kind === 'project' ? 'Поиск проекта' : 'Поиск задачи'}</span>
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" aria-hidden="true" />
          <input className="input pl-9" value={search} onChange={e => { setSearch(e.target.value); setPicked('') }}
            placeholder={kind === 'project' ? 'Название проекта' : 'Название задачи'} autoFocus />
        </label>

        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">{body}</div>

        <div className="flex flex-col-reverse xs:flex-row xs:justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost min-h-[44px] lg:min-h-[36px]">Отмена</button>
          <button type="button" onClick={() => attach.mutate()} disabled={!pickedRow || pickedRow.taken || attach.isPending}
            className="btn-primary min-h-[44px] lg:min-h-[36px] disabled:opacity-60">
            {attach.isPending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />} Привязать
          </button>
        </div>
      </div>
    </Modal>
  )
}
