import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, X } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { Avatar, Modal, Skeleton } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { filesApi, tasksApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { invalidateAfterTaskChange } from '@/lib/invalidateQueries'
import { serverMessage } from '@/lib/taskCabinet'
import {
  DEFAULT_DUE_TIME, DUE_PRESETS, addDays, deadlineIso, dueCaption, dushanbeToday, resolveDue, type DuePreset,
} from '@/lib/taskDue'

/**
 * «Новая задача» SMM-специалиста (docs/SMM_DELEGATION_SPEC.md, 17.11.2026):
 * задача себе или команде производства в четыре касания — что сделать,
 * кому, проект, срок. Описание, файлы и «срочно» — по ссылке, когда нужны.
 * На компьютере — окно, на телефоне — лист снизу (так ведёт себя Modal),
 * кнопка «Поставить» закреплена внизу листа.
 */

/** Память формы: последний проект и исполнители (только на этом устройстве). */
const MEMORY_KEY = 'quick-task:last'
interface QuickTaskMemory { projectId: string | null; assigneeIds: string[] }
const EMPTY_MEMORY: QuickTaskMemory = { projectId: null, assigneeIds: [] }

function readMemory(): QuickTaskMemory {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) return EMPTY_MEMORY
    const v = JSON.parse(raw)
    return {
      projectId: typeof v?.projectId === 'string' ? v.projectId : null,
      assigneeIds: Array.isArray(v?.assigneeIds) ? v.assigneeIds.filter((x: unknown): x is string => typeof x === 'string') : [],
    }
  } catch {
    return EMPTY_MEMORY
  }
}

function writeMemory(v: QuickTaskMemory) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(v)) } catch { /* приватный режим — не помним */ }
}

const MAX_FILES = 10

/** Чип выбора: на телефоне 44 px (правило .chip), на компьютере 40 px. */
const chipCls = (on: boolean) => clsx('chip text-sm lg:min-h-[40px]', on && 'chip-on')

function Group({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2.5">
      <span id={id} className="text-[13px] font-semibold text-surface-500 dark:text-surface-400">{label}</span>
      {children}
    </div>
  )
}

export interface QuickTaskSheetProps {
  open: boolean
  onClose: () => void
  /** Проект, с которым открыть форму (со страницы проекта). undefined — как в
   *  прошлый раз; null — «Без проекта». */
  projectId?: string | null
}

export default function QuickTaskSheet({ open, onClose, projectId: presetProject }: QuickTaskSheetProps) {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()

  const [title, setTitle] = useState('')
  const [assignees, setAssignees] = useState<string[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [due, setDue] = useState<DuePreset>('tomorrow')
  const [customDate, setCustomDate] = useState('')
  const [customTime, setCustomTime] = useState(DEFAULT_DUE_TIME)
  const [more, setMore] = useState(false)
  const [description, setDescription] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [files, setFiles] = useState<File[]>([])

  // Выбор из памяти восстанавливаем один раз за открытие — когда придёт
  // список людей и проектов (по нему отсекаем ушедших и чужие проекты).
  const memoryRef = useRef<QuickTaskMemory>(EMPTY_MEMORY)
  const restoredRef = useRef(false)

  // Каждое открытие — чистая форма. Эффект объявлен ДО восстановления
  // памяти: в одном коммите React выполняет эффекты по порядку.
  useEffect(() => {
    if (!open) return
    const mem = readMemory()
    memoryRef.current = mem
    restoredRef.current = false
    setTitle('')
    setAssignees([])
    setProjectId(presetProject !== undefined ? presetProject : mem.projectId)
    setDue('tomorrow')
    setCustomDate('')
    setCustomTime(DEFAULT_DUE_TIME)
    setMore(false)
    setDescription('')
    setUrgent(false)
    setFiles([])
  }, [open, presetProject])

  const optionsQ = useQuery({
    // Ключ с проектом: команда выбранного проекта приходит первой (inTeam).
    queryKey: ['tasks-delegation-options', projectId ?? ''],
    queryFn: () => tasksApi.delegationOptions(projectId),
    enabled: open && !!user,
    staleTime: 60_000,
    // Пока грузится порядок для другого проекта — показываем прежний список.
    placeholderData: keepPreviousData,
  })
  const options = optionsQ.data
  const people = options?.people ?? []
  const projects = options?.projects ?? []

  useEffect(() => {
    if (!open || !options || restoredRef.current) return
    restoredRef.current = true
    const valid = new Set<string>(options.people.map(p => p.id))
    if (user?.id) valid.add(user.id)
    setAssignees(memoryRef.current.assigneeIds.filter(id => valid.has(id)))
    // Функциональное обновление — берём проект, выбранный при открытии, а не
    // значение из прошлого рендера.
    setProjectId(cur => (cur && !options.projects.some(p => p.id === cur) ? null : cur))
  }, [open, options, user?.id])

  const toggleAssignee = (id: string) =>
    setAssignees(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]))

  const now = new Date()
  const today = dushanbeToday(now)
  const dueValue = resolveDue(due, now, { date: customDate, time: customTime })
  const pickDue = (key: DuePreset) => {
    setDue(key)
    if (key === 'date' && !customDate) setCustomDate(addDays(today, 1))
  }

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    setFiles(cur => {
      const next = [...cur, ...picked]
      if (next.length > MAX_FILES) toast.error(`Не больше ${MAX_FILES} файлов`)
      return next.slice(0, MAX_FILES)
    })
  }

  type CreatePayload = { body: Record<string, unknown>; files: File[]; projectId: string | null; assigneeIds: string[] }
  const createMut = useMutation({
    mutationFn: async (p: CreatePayload) => {
      const task = await tasksApi.create(p.body)
      // Файлы — после создания, к готовой задаче (тот же путь, что в карточке
      // задачи). Задача уже поставлена, поэтому сбой файла её не отменяет.
      let failed = 0
      if (task?.id) {
        for (const f of p.files) {
          try { await filesApi.upload(f, undefined, task.id) } catch { failed += 1 }
        }
      }
      return { failed }
    },
    onSuccess: ({ failed }, p) => {
      writeMemory({ projectId: p.projectId, assigneeIds: p.assigneeIds })
      // Все списки задач и счётчик проверки (tasks-review-count в TASK_QUERY_KEYS).
      invalidateAfterTaskChange(qc, p.projectId ?? undefined)
      if (failed) toast.error(`Задача поставлена, но не загрузились файлы: ${failed}`)
      else toast.success('Задача поставлена')
      onClose()
    },
    onError: (e: unknown) => toast.error(serverMessage(e, 'Не удалось поставить задачу')),
  })

  const canSubmit = !!title.trim() && assignees.length > 0 && !!dueValue && !createMut.isPending
  const submit = () => {
    // Срок считаем в момент нажатия: форма могла простоять открытой за полночь.
    const d = resolveDue(due, new Date(), { date: customDate, time: customTime })
    if (!canSubmit || !d) return
    const body: Record<string, unknown> = {
      title: title.trim(),
      assigneeIds: assignees,
      projectId: projectId ?? null,
      deadline: deadlineIso(d.date, d.time),
    }
    if (description.trim()) body.description = description.trim()
    if (urgent) body.priority = 'high'
    createMut.mutate({ body, files, projectId, assigneeIds: assignees })
  }

  // Подсказка у кнопки — когда исполнитель один и это не «Себе».
  const single = assignees.length === 1 && assignees[0] !== user?.id
    ? people.find(p => p.id === assignees[0])
    : undefined
  const hint = single ? `${single.name} получит задачу в Telegram` : ''

  // Клавиатура на телефоне не должна выскакивать сразу — фокус в поле
  // только там, где есть мышь.
  const finePointer = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: fine)').matches
  const dirty = !!title.trim() || !!description.trim() || files.length > 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новая задача"
      size="lg"
      // Набранное не теряем от случайного клика мимо или Escape.
      closeOnBackdropClick={!dirty}
      closeOnEscape={!dirty}
    >
      <form
        onSubmit={e => { e.preventDefault(); submit() }}
        className="flex flex-col gap-5"
      >
        <input
          aria-label="Что нужно сделать"
          placeholder="Что нужно сделать?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={300}
          autoFocus={finePointer}
          enterKeyHint="done"
          // С клавиатуры компьютера Enter ставит задачу; на телефоне «Готово»
          // только прячет клавиатуру — кому и срок ещё выбирают.
          onKeyDown={e => {
            if (e.key === 'Enter' && !finePointer) { e.preventDefault(); e.currentTarget.blur() }
          }}
          className="input min-h-[52px] rounded-xl px-3.5 text-[17px] font-medium"
        />

        <Group id="qt-who" label="Кому">
          {optionsQ.isLoading && !options ? (
            <div className="flex flex-wrap gap-2">
              {['w-24', 'w-32', 'w-28', 'w-20'].map(w => <Skeleton key={w} className={clsx('h-11 lg:h-10 rounded-full', w)} />)}
            </div>
          ) : optionsQ.isError && !options ? (
            <p className="text-sm text-red-600 dark:text-red-400">{serverMessage(optionsQ.error, 'Не удалось загрузить список людей')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {user && (
                <button
                  type="button"
                  aria-pressed={assignees.includes(user.id)}
                  onClick={() => toggleAssignee(user.id)}
                  className={clsx(chipCls(assignees.includes(user.id)), 'pl-1 pr-3.5 gap-2')}
                >
                  <Avatar name={user.name} src={user.avatar || undefined} size={28} />
                  Себе
                </button>
              )}
              {people.map(p => {
                const on = assignees.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAssignee(p.id)}
                    className={clsx(chipCls(on), 'pl-1 pr-3.5 gap-2 max-w-full')}
                  >
                    <Avatar name={p.name} src={p.avatar || undefined} size={28} />
                    <span className="truncate max-w-[12rem]">{p.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </Group>

        {projects.length > 0 && (
          <Group id="qt-proj" label="Проект">
            <div className="flex flex-wrap gap-2">
              {projects.map(p => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={projectId === p.id}
                  onClick={() => setProjectId(p.id)}
                  className={clsx(chipCls(projectId === p.id), 'px-4 max-w-full')}
                >
                  <span className="truncate max-w-[14rem]">{p.name}</span>
                </button>
              ))}
              <button
                type="button"
                aria-pressed={projectId === null}
                onClick={() => setProjectId(null)}
                className={clsx(chipCls(projectId === null), 'px-4')}
              >Без проекта</button>
            </div>
          </Group>
        )}

        <Group
          id="qt-due"
          label={<>Срок{dueValue && <span className="font-normal"> · {dueCaption(dueValue.date, dueValue.time, now)}</span>}</>}
        >
          <div className="flex flex-wrap gap-2">
            {DUE_PRESETS.map(d => (
              <button
                key={d.key}
                type="button"
                aria-pressed={due === d.key}
                onClick={() => pickDue(d.key)}
                className={clsx(chipCls(due === d.key), 'px-4')}
              >{d.label}</button>
            ))}
          </div>
          {due === 'date' && (
            <div className="flex flex-wrap items-center gap-2">
              <DatePicker
                value={customDate}
                onChange={setCustomDate}
                minDate={today}
                minimal
                pill
                clearable={false}
                placeholder="Выберите день"
                className="[&>button]:min-h-[44px] lg:[&>button]:min-h-[40px]"
              />
              <label className="inline-flex items-center gap-2 text-sm text-surface-500 dark:text-surface-400">
                до
                <input
                  type="time"
                  value={customTime}
                  onChange={e => setCustomTime(e.target.value || DEFAULT_DUE_TIME)}
                  aria-label="Время срока"
                  className="input w-[7.5rem] min-h-[44px] lg:min-h-[40px]"
                />
              </label>
            </div>
          )}
        </Group>

        {more ? (
          <div className="flex flex-col gap-3">
            <textarea
              aria-label="Описание"
              placeholder="Описание: подробности, ссылки, пожелания"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              className="input min-h-[88px] resize-y"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="btn-secondary min-h-[44px] lg:min-h-[40px] cursor-pointer">
                <Paperclip size={16} /> Прикрепить файлы
                <input type="file" multiple className="hidden" onChange={onPickFiles} />
              </label>
              <button
                type="button"
                aria-pressed={urgent}
                onClick={() => setUrgent(u => !u)}
                className={clsx(chipCls(urgent), 'px-4')}
              >Срочно</button>
            </div>
            {files.length > 0 && (
              <ul className="flex flex-col">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 min-w-0 text-sm text-surface-700 dark:text-surface-200">
                    <Paperclip size={14} className="shrink-0 text-surface-400" aria-hidden="true" />
                    <span className="truncate flex-1 min-w-0">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Убрать файл ${f.name}`}
                      onClick={() => setFiles(cur => cur.filter((_, j) => j !== i))}
                      className="w-11 h-11 lg:w-8 lg:h-8 shrink-0 inline-flex items-center justify-center rounded-lg text-surface-400 hover:text-red-500 hover:bg-surface-100 dark:hover:bg-surface-700"
                    ><X size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMore(true)}
            className="self-start min-h-[44px] lg:min-h-[36px] text-sm font-medium text-primary-600 dark:text-primary-300 hover:underline"
          >+ Описание, файлы, срочно</button>
        )}

        {/* Кнопка закреплена внизу листа: тело окна прокручивается, а она
            остаётся на виду. Отрицательные поля — в край окна (тело с p-5). */}
        <div className="sticky bottom-0 -mx-5 -mb-5 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-surface-50 dark:bg-surface-800 border-t border-surface-100 dark:border-surface-700 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="text-xs text-surface-500 dark:text-surface-400 text-center sm:text-left sm:flex-1 min-w-0">{hint}</span>
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary w-full sm:w-auto min-h-[52px] sm:min-h-[44px] px-5 text-base sm:text-[15px] rounded-xl"
          >{createMut.isPending ? 'Ставим…' : 'Поставить'}</button>
        </div>
      </form>
    </Modal>
  )
}
