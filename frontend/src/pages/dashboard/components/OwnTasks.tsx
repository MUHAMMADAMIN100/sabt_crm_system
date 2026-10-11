// «Свои задачи» в календаре кабинета (вариант 3, решение владельца 11.10.2026).
//
// СММ-специалист, видеограф, монтажёр и дизайнер ставят себе задачу прямо в
// клетке дня: «+» в клетке открывает окошко со списком своих задач этого дня
// и строкой ввода. Это обычная личная задача (tasks.scope = 'personal'):
// проект не нужен, в списках её видит только автор, а напоминания «план на
// сегодня» и «через час» приходят ему самому (PersonalReminderScheduler).
//
// Незакрытая задача прошлых дней не теряется в прошлом, а переезжает на
// сегодня с пометкой «с 9 окт»: своя задача — не дедлайн перед кем-то, и
// отдельный блок просрочки ей не нужен.
//
// Здесь же строки клетки календаря (CellLines): на компьютере в клетке видно
// не цифры, а названия — рилсы, публикации, свои задачи. Сторис остаются
// числом. На телефоне клетка мала, там по-прежнему точки.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowRight, Check, Clock, CornerDownLeft, Plus, Trash2, User, X } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { tasksApi } from '@/services/api.service'
import { normalizeTaskStatus } from '@/lib/taskStatus'

// Свой лёгкий список (GET /tasks/own), а не общий ['my-tasks']: тот несёт все
// задачи человека с проектами, и перезапрос его после каждой заметки делал
// добавление задачи заметно медленным (замечание владельца 11.10.2026).
const KEY = ['own-tasks'] as const
/** Причина удаления: сервер её требует, у своей задачи она всегда одна. */
const REMOVE_REASON = 'Своя задача — удалена автором'
/** Время по умолчанию, когда его не указали, — как в форме календаря.
 *  Отдельного признака «без времени» у задачи нет, поэтому 12:00 не показываем. */
const NO_TIME = '12:00'

export type OwnTask = {
  id: string; title: string
  /** День, в котором задача показана (сегодня — если переехала из прошлого). */
  day: string
  /** Исходный день переехавшей задачи. */
  from: string | null
  time: string | null
  done: boolean
  /** Ещё сохраняется на сервере. На вид и поведение не влияет: действия с
   *  такой строкой дожидаются настоящего id сами. */
  pending: boolean
}

const deadlineOf = (day: string, time: string | null) =>
  new Date(`${day}T${time || NO_TIME}:00`).toISOString()
const dayDate = (day: string) => new Date(`${day}T00:00:00`)
const shiftDay = (day: string, n: number) => format(addDays(dayDate(day), n), 'yyyy-MM-dd')
/** «сегодня», «завтра» или «14 октября» — для подписей и уведомлений. */
const dayWord = (day: string, todayKey: string) =>
  day === todayKey ? 'сегодня'
    : day === shiftDay(todayKey, 1) ? 'завтра'
    : format(dayDate(day), 'd MMMM', { locale: ru })

/** Время прямо в строке: «18:00 отправить отчёт» → название и время отдельно.
 *  Только с двоеточием: «15.10» слишком похоже на дату. */
export function splitTime(raw: string): { title: string; time: string | null } {
  const m = raw.match(/(^|\s)(?:в\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=$|[\s,.;])/i)
  if (!m || m.index === undefined) return { title: raw.trim(), time: null }
  const title = `${raw.slice(0, m.index)} ${raw.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim()
  // Одно время без названия — это ещё не задача.
  if (!title) return { title: raw.trim(), time: null }
  return { title, time: `${m[2].length === 1 ? '0' : ''}${m[2]}:${m[3]}` }
}

/** Сообщение с «Отменить»: добавил, перенёс или удалил по ошибке — вернуть
 *  можно одним нажатием, без подтверждений заранее. */
function undoToast(text: string, undo: () => void) {
  toast(t => (
    <span className="flex items-center gap-3">
      <span>{text}</span>
      <button type="button" onClick={() => { toast.dismiss(t.id); undo() }}
        className="font-bold text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap">
        Отменить
      </button>
    </span>
  ), { duration: 5000 })
}

export function useOwnTasks(todayKey: string) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: KEY, queryFn: tasksApi.own, staleTime: 30_000 })
  // Переехавшая задача, закрытая в этой сессии, остаётся в сегодняшнем дне
  // зачёркнутой — как закрытая просрочка в кабинете.
  const [keep, setKeep] = useState<Set<string>>(() => new Set())
  // Задача, которая ещё сохраняется: по временному id ждём настоящий. Так её
  // можно отметить, перенести или удалить сразу, не дожидаясь ответа сервера.
  const pending = useRef(new Map<string, Promise<string | null>>())

  const byDay = useMemo(() => {
    const m: Record<string, OwnTask[]> = {}
    for (const t of (Array.isArray(data) ? data : []) as any[]) {
      if (!t.deadline || t.status === 'cancelled') continue
      const dt = new Date(t.deadline)
      if (isNaN(dt.getTime())) continue
      const own = format(dt, 'yyyy-MM-dd')
      const hm = format(dt, 'HH:mm')
      const done = normalizeTaskStatus(t.status) === 'done'
      const carried = own < todayKey && (!done || keep.has(t.id))
      const day = carried ? todayKey : own
      ;(m[day] ||= []).push({
        id: t.id, title: t.title, day, from: carried ? own : null,
        time: hm === NO_TIME ? null : hm, done, pending: String(t.id).startsWith('tmp-'),
      })
    }
    // Порядок не зависит от отметки — строки не прыгают после галочки.
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => (a.time || '99').localeCompare(b.time || '99')
        || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id))
    }
    return m
  }, [data, todayKey, keep])

  // Всё ниже меняет кэш СРАЗУ и не перезапрашивает список после успеха:
  // ответ сервера для экрана ничего не добавляет. Список перечитываем только
  // после ошибки — чтобы вернуть правду.
  const setList = (fn: (list: any[]) => any[]) =>
    qc.setQueryData<any>(KEY, (old: any) => fn(Array.isArray(old) ? old : []))
  const patchRow = (id: string, fields: Record<string, unknown>) =>
    setList(list => list.map(x => x.id === id ? { ...x, ...fields } : x))
  const failed = (e: any, text: string) => {
    toast.error(e?.response?.data?.message || text)
    void qc.invalidateQueries({ queryKey: KEY })
  }
  // Общий список задач (бейдж просрочки, «Мои задачи» у других ролей) только
  // помечаем устаревшим: он тяжёлый, перечитается сам при следующем заходе.
  const touchShared = () => { void qc.invalidateQueries({ queryKey: ['my-tasks'], refetchType: 'none' }) }
  /** Настоящий id строки: у только что добавленной ждём ответа сервера. */
  const realId = async (id: string): Promise<string | null> =>
    id.startsWith('tmp-') ? (await pending.current.get(id)) ?? null : id

  const removeById = async (id: string) => {
    setList(list => list.filter(x => x.id !== id))
    try { await tasksApi.remove(id, REMOVE_REASON); touchShared() }
    catch (e) { failed(e, 'Не удалось удалить задачу') }
  }

  /** Создание: строка появляется сразу с временным id, после ответа сервера
   *  подменяется настоящей — без повторной загрузки списка. */
  const create = (v: { title: string; day: string; time: string | null; done?: boolean }, undoText?: string) => {
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const deadline = deadlineOf(v.day, v.time)
    // Идёт первая загрузка списка — её ответ затёр бы новую строку: отменяем
    // и перечитываем уже после сохранения.
    const wasLoading = qc.isFetching({ queryKey: KEY }) > 0
    if (wasLoading) void qc.cancelQueries({ queryKey: KEY })
    setList(list => [...list, { id: tmpId, title: v.title, status: v.done ? 'done' : 'new', deadline }])
    const saved: Promise<string | null> = tasksApi
      .create({ title: v.title, scope: 'personal', deadline, ...(v.done ? { status: 'done' } : {}) })
      .then((task: any) => {
        patchRow(tmpId, { id: task.id, status: task.status, deadline: task.deadline })
        touchShared()
        if (undoText) undoToast(undoText, () => { void removeById(task.id) })
        return task.id as string
      })
      .catch((e: any) => {
        setList(list => list.filter(x => x.id !== tmpId))
        failed(e, 'Не удалось добавить задачу')
        return null
      })
      .finally(() => {
        pending.current.delete(tmpId)
        if (wasLoading) void qc.invalidateQueries({ queryKey: KEY })
      })
    pending.current.set(tmpId, saved)
  }

  const setDone = async (t: OwnTask, done: boolean) => {
    const status = done ? 'done' : 'in_progress'
    if (done) setKeep(prev => new Set(prev).add(t.id))
    patchRow(t.id, { status })
    const id = await realId(t.id)
    if (!id) return
    if (id !== t.id) {                 // строку успели подменить настоящей
      if (done) setKeep(prev => new Set(prev).add(id))
      patchRow(id, { status })
    }
    try { await tasksApi.update(id, { status }); touchShared() }
    catch (e) { failed(e, 'Не удалось отметить задачу') }
  }

  /** Перенос на другой день; время дня у задачи сохраняется. */
  const moveTo = async (t: OwnTask, day: string, undoText?: string) => {
    const deadline = deadlineOf(day, t.time)
    patchRow(t.id, { deadline })
    const id = await realId(t.id)
    if (!id) return
    if (id !== t.id) patchRow(id, { deadline })
    try {
      await tasksApi.update(id, { deadline })
      touchShared()
      if (undoText) undoToast(undoText, () => { void moveTo({ ...t, id }, t.from || t.day) })
    } catch (e) { failed(e, 'Не удалось перенести задачу') }
  }

  /** Удаление сразу, без вопроса: вернуть можно из сообщения «Отменить». */
  const remove = async (t: OwnTask) => {
    setList(list => list.filter(x => x.id !== t.id))
    const id = await realId(t.id)
    if (!id) return
    setList(list => list.filter(x => x.id !== id))
    try {
      await tasksApi.remove(id, REMOVE_REASON)
      touchShared()
      undoToast('Задача удалена', () => create({ title: t.title, day: t.from || t.day, time: t.time, done: t.done }))
    } catch (e) { failed(e, 'Не удалось удалить задачу') }
  }

  return {
    byDay,
    of: (day: string) => byDay[day] || [],
    add: (title: string, day: string, time: string | null) =>
      create({ title, day, time }, `Добавлено на ${dayWord(day, todayKey)}`),
    toggle: (t: OwnTask) => { void setDone(t, !t.done) },
    move: (t: OwnTask, day: string) => { void moveTo(t, day, `Перенесено на ${dayWord(day, todayKey)}`) },
    remove: (t: OwnTask) => { void remove(t) },
  }
}

export type OwnTasksApi = ReturnType<typeof useOwnTasks>

/** Точка своей задачи в ячейке календаря на телефоне. */
export function OwnMark({ done, className }: { done?: boolean; className?: string }) {
  return (
    <i title="Своя задача" className={clsx('rounded-full shrink-0', className || 'w-2 h-2',
      done ? 'bg-surface-300 dark:bg-surface-600' : 'bg-surface-700 dark:bg-surface-300')} />
  )
}

// ── Клетка календаря на компьютере ──

export type CellLine = {
  key: string
  kind: 'reel' | 'maket' | 'shoot' | 'edit' | 'design' | 'own'
  proj?: string | null
  text: string
  state: 'open' | 'late' | 'done'
}

const BADGE: Record<string, { letter: string; cls: string }> = {
  reel:   { letter: 'Р', cls: 'bg-blue-500/20 text-blue-500 dark:text-blue-400' },
  maket:  { letter: 'М', cls: 'bg-amber-500/20 text-amber-600 dark:text-amber-400' },
  shoot:  { letter: 'С', cls: 'bg-lime-500/20 text-lime-600 dark:text-lime-400' },
  edit:   { letter: 'М', cls: 'bg-violet-500/20 text-violet-500 dark:text-violet-400' },
  design: { letter: 'Д', cls: 'bg-fuchsia-500/20 text-fuchsia-500 dark:text-fuchsia-400' },
}

/** Буква-метка вида задачи: Р — рилс, М — публикация (в кабинете производства
 *  С — съёмка, М — монтаж, Д — дизайн). */
export function CellBadge({ kind }: { kind: string }) {
  const b = BADGE[kind] || BADGE.maket
  return (
    <span className={clsx('w-3 h-3 rounded-[3px] shrink-0 inline-flex items-center justify-center text-[8px] font-bold leading-none', b.cls)}>
      {b.letter}
    </span>
  )
}

/** Квадратик своей задачи — как пустая галочка. */
export function OwnBox() {
  return <i className="w-[9px] h-[9px] mx-[1.5px] rounded-[3px] border-[1.5px] border-surface-400 dark:border-surface-400 shrink-0 inline-block" />
}

/** Строки клетки: до трёх названий, дальше «ещё N». Просроченное красным,
 *  сделанное зачёркнуто. Только на компьютере. */
export function CellLines({ lines, max = 3 }: { lines: CellLine[]; max?: number }) {
  if (lines.length === 0) return null
  const shown = lines.length > max ? lines.slice(0, max - 1) : lines
  const rest = lines.length - shown.length
  return (
    <span className="hidden sm:flex flex-col gap-[3px] min-w-0 w-full">
      {shown.map(l => (
        <span key={l.key} title={l.proj ? `${l.proj} · ${l.text}` : l.text}
          className="flex items-center gap-1 min-w-0 text-[10.5px] leading-[1.3]">
          {l.state === 'done' ? <Check size={11} strokeWidth={3} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
            : l.kind === 'own' ? <OwnBox />
            : <CellBadge kind={l.kind} />}
          {l.proj ? <span className="text-surface-400 dark:text-surface-500 truncate shrink-[2] max-w-[58%]">{l.proj}</span> : null}
          <span className={clsx('truncate min-w-0',
            l.state === 'done' ? 'line-through text-surface-400 dark:text-surface-500'
              : l.state === 'late' ? 'font-medium text-red-500 dark:text-red-400'
              : 'font-medium text-surface-800 dark:text-surface-100')}>{l.text}</span>
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] font-medium text-surface-400 dark:text-surface-500">ещё {rest}</span>}
    </span>
  )
}

/** Свои задачи дня как строки клетки. */
export function ownLines(tasks: OwnTask[]): CellLine[] {
  return tasks.map((t): CellLine => ({
    key: t.id, kind: 'own',
    text: t.time ? `${t.time} · ${t.title}` : t.title,
    state: t.done ? 'done' : t.from ? 'late' : 'open',
  }))
}

/** «+» в клетке дня. На сегодняшней клетке виден всегда, на будущих — бледный
 *  и проявляется при наведении (у клетки класс group). На телефоне его роль
 *  играет сама клетка: нажал на день — открылось окно со строкой ввода. */
export function CellPlus({ today, label, onClick }: {
  today: boolean; label: string; onClick: (ev: RMouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <>
      <button type="button" title={label} aria-label={label}
        onClick={ev => { ev.stopPropagation(); onClick(ev) }}
        className={clsx('hidden sm:flex items-center justify-center w-9 h-[22px] rounded-[7px] border transition shrink-0',
          today ? 'border-primary-400 bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-300'
            : 'border-surface-200 dark:border-surface-700 text-surface-300 dark:text-surface-600 group-hover:border-primary-400 group-hover:bg-primary-50 dark:group-hover:bg-primary-900/30 group-hover:text-primary-600 dark:group-hover:text-primary-300')}>
        <Plus size={12} strokeWidth={2.6} />
      </button>
      {today && (
        <span className="sm:hidden w-[18px] h-[18px] rounded-md bg-primary-600 text-white flex items-center justify-center shrink-0">
          <Plus size={12} strokeWidth={3} />
        </span>
      )}
    </>
  )
}

// ── Строка задачи и строка ввода ──

function OwnRow({ t, own, todayKey, compact }: { t: OwnTask; own: OwnTasksApi; todayKey: string; compact?: boolean }) {
  const moveLabel = t.day === todayKey ? 'Завтра' : '+1 день'
  const moveTitle = t.day === todayKey ? 'Перенести на завтра' : 'Перенести на день позже'
  const carried = t.from && !t.done
    ? <span className="font-semibold text-red-500 dark:text-red-400">с {format(dayDate(t.from), 'd MMM', { locale: ru })}</span>
    : null
  // В окне дня своя задача стоит в общем списке «Задачи» и выглядит как
  // соседние строки (TaskRow): та же галочка, плитка-значок, название, мета.
  if (!compact) return (
    <div className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2.5 transition', 
      t.done ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
        : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
      <button type="button" onClick={() => own.toggle(t)}
        title={t.done ? 'Снять отметку' : 'Отметить готовой'}
        className={clsx('w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition',
          t.done ? 'bg-green-500 border-green-500' : 'border-surface-300 dark:border-surface-600 hover:border-green-500')}>
        <Check size={13} className={clsx('text-white transition-opacity', t.done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
      </button>

      <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center bg-surface-200/70 dark:bg-surface-700/60 text-surface-500 dark:text-surface-300">
        <User size={16} />
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        <p className={clsx('text-[13.5px] font-semibold truncate',
          t.done ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>{t.title}</p>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-surface-400 dark:text-surface-500">
          <span className="text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 bg-surface-200/70 dark:bg-surface-700/60 text-surface-500 dark:text-surface-400">Своя</span>
          {t.time && <span className="shrink-0">до {t.time}</span>}
          {carried}
        </div>
      </div>

      {!t.done && (
        <button type="button" onClick={() => own.move(t, shiftDay(t.day, 1))} title={moveTitle}
          className="h-8 px-2.5 shrink-0 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-[11.5px] font-medium text-surface-500 dark:text-surface-300 hover:text-primary-600 hover:border-primary-400 flex items-center gap-1 whitespace-nowrap transition">
          <ArrowRight size={12} /> {moveLabel}
        </button>
      )}
      <button type="button" onClick={() => own.remove(t)} title="Удалить"
        className="w-8 h-8 shrink-0 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-red-500 hover:border-red-300 flex items-center justify-center transition">
        <Trash2 size={15} />
      </button>
    </div>
  )
  // Окошко у клетки — плотнее.
  return (
    <div className={clsx('flex items-center gap-1 rounded-xl border pr-1.5 transition', 
      t.done ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
        : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
      <button type="button" onClick={() => own.toggle(t)}
        title={t.done ? 'Снять отметку' : 'Отметить готовой'}
        className={clsx('w-10 shrink-0 flex items-center justify-center', compact ? 'h-9' : 'h-11')}>
        <span className={clsx('rounded-md border-2 flex items-center justify-center transition',
          compact ? 'w-[18px] h-[18px]' : 'w-[22px] h-[22px]',
          t.done ? 'bg-green-500 border-green-500' : 'border-surface-300 dark:border-surface-600')}>
          <Check size={compact ? 11 : 13} className={clsx('text-white transition-opacity', t.done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <p className={clsx('truncate', compact ? 'text-[12.5px] font-medium' : 'text-[13.5px] font-semibold',
          t.done ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>{t.title}</p>
        {(t.time || (t.from && !t.done)) && (
          <p className="text-[11px] leading-tight text-surface-400 dark:text-surface-500 pb-1">
            {t.time && <span>до {t.time}</span>}
            {t.time && t.from && !t.done && ' · '}
            {t.from && !t.done && (
              <span className="font-semibold text-red-500 dark:text-red-400">с {format(dayDate(t.from), 'd MMM', { locale: ru })}</span>
            )}
          </p>
        )}
      </div>

      {!t.done && (
        <button type="button" onClick={() => own.move(t, shiftDay(t.day, 1))}
          title={t.day === todayKey ? 'Перенести на завтра' : 'Перенести на день позже'}
          className="h-7 px-2 shrink-0 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-[11.5px] font-medium text-surface-500 dark:text-surface-300 hover:text-primary-600 hover:border-primary-400 flex items-center gap-1 whitespace-nowrap transition">
          <ArrowRight size={12} /> {t.day === todayKey ? 'Завтра' : '+1 день'}
        </button>
      )}
      <button type="button" onClick={() => own.remove(t)} title="Удалить"
        className="w-8 h-7 shrink-0 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-900 text-surface-400 hover:text-red-500 hover:border-red-300 flex items-center justify-center transition">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

/** Строка ввода: Enter добавляет и оставляет курсор для следующей задачи.
 *  Время можно написать прямо в тексте («18:00 отчёт»); на телефоне, где
 *  набирать цифры неудобно, рядом есть кнопка с часами. */
function OwnInput({ target, todayKey, own, autoFocus, onEscape, compact }: {
  target: string; todayKey: string; own: OwnTasksApi
  autoFocus?: boolean; onEscape?: () => void; compact?: boolean
}) {
  const [text, setText] = useState('')
  const [manual, setManual] = useState('')
  const [clock, setClock] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const parsed = splitTime(text)
  const time = parsed.time || manual || null
  const submit = () => {
    if (!parsed.title) return
    own.add(parsed.title, target, time)
    setText(''); setManual(''); setClock(false)
    inputRef.current?.focus()
  }
  const placeholder = target === todayKey
    ? 'Что нужно сделать сегодня?'
    : `Что нужно сделать ${format(dayDate(target), 'd MMMM', { locale: ru })}?`

  return (
    <div className="flex items-center gap-1.5">
      <div className={clsx('flex-1 min-w-0 flex items-center gap-1.5 rounded-xl border border-primary-400 ring-[3px] ring-primary-500/20 bg-white dark:bg-surface-900 pl-3 pr-1.5',
        compact ? 'h-10' : 'h-11')}>
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          maxLength={200}
          aria-label="Новая своя задача"
          placeholder={placeholder}
          onChange={ev => setText(ev.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Enter') { ev.preventDefault(); submit() }
            // Esc сначала очищает строку и только потом закрывает окно под ней.
            if (ev.key === 'Escape') {
              if (text) { ev.stopPropagation(); setText('') }
              else if (onEscape) { ev.stopPropagation(); onEscape() }
            }
          }}
          className={clsx('flex-1 min-w-0 bg-transparent outline-none font-medium text-base text-surface-900 dark:text-surface-100 placeholder:text-surface-400 dark:placeholder:text-surface-500 placeholder:font-normal',
            compact ? 'sm:text-[13.5px]' : 'sm:text-sm')}
        />
        {time && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-300">
            <Clock size={11} /> {time}
          </span>
        )}
      </div>
      {clock ? (
        <input type="time" autoFocus value={manual} onChange={ev => setManual(ev.target.value)} aria-label="Время"
          className="sm:hidden h-11 w-[104px] shrink-0 rounded-xl border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 px-2 text-base text-surface-700 dark:text-surface-200 outline-none" />
      ) : (
        <button type="button" onClick={() => setClock(true)} title="Время" aria-label="Время"
          className="sm:hidden w-11 h-11 shrink-0 rounded-xl border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-300 flex items-center justify-center">
          <Clock size={17} />
        </button>
      )}
      <button type="button" onClick={submit} disabled={!parsed.title} title="Добавить" aria-label="Добавить"
        className={clsx('shrink-0 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white flex items-center justify-center transition',
          compact ? 'w-10 h-10' : 'w-11 h-11')}>
        <CornerDownLeft size={16} className="hidden sm:block" />
        <Plus size={19} className="sm:hidden" />
      </button>
    </div>
  )
}

/** Свои задачи в окне дня. Отдельного заголовка нет: своя задача — такая же
 *  задача дня, поэтому блок стоит ВНУТРИ раздела «Задачи» (решение владельца
 *  11.10.2026): строка ввода и под ней свои задачи, дальше — задачи из
 *  контент-плана. Из прошедшего дня новая задача ставится на сегодня —
 *  незакрытая всё равно переехала бы туда. */
export function OwnDayTasks({ dayKey, todayKey, own, autoFocus, className }: {
  dayKey: string; todayKey: string; own: OwnTasksApi
  /** День открыт кнопкой «+ Своя задача» — курсор сразу в строке. */
  autoFocus?: boolean
  className?: string
}) {
  const tasks = own.of(dayKey)
  const past = dayKey < todayKey
  return (
    <div className={clsx('space-y-2', className ?? 'mb-2')}>
      <OwnInput target={past ? todayKey : dayKey} todayKey={todayKey} own={own} autoFocus={autoFocus} />
      {past && <p className="text-[11px] text-surface-400 dark:text-surface-500">Этот день прошёл — новая задача встанет на сегодня.</p>}
      {tasks.map(t => <OwnRow key={t.id} t={t} own={own} todayKey={todayKey} />)}
    </div>
  )
}

/** Окошко своих задач (компьютер): задачи дня и строка ввода. Открывается
 *  вплотную под нажатой кнопкой «+» — сначала оно вставало под всей клеткой,
 *  и владелец заметил, что это далеко от места нажатия. Рисуется поверх
 *  страницы от координат кнопки; при нехватке места снизу открывается вверх. */
export function OwnPopover({ anchor, dayKey, todayKey, own, onClose }: {
  anchor: HTMLElement; dayKey: string; todayKey: string; own: OwnTasksApi; onClose: () => void
}) {
  const WIDTH = 380
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const tasks = own.of(dayKey)

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const h = boxRef.current?.offsetHeight || 200
      let top = r.bottom + 6
      if (top + h + 8 > window.innerHeight) top = Math.max(8, r.top - h - 6)
      const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, tasks.length])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div className="fixed inset-0 z-[90]" onClick={onClose} />
      <div ref={boxRef} role="dialog" aria-label="Свои задачи дня"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: WIDTH }}
        className="fixed z-[91] rounded-xl border border-primary-400 bg-white dark:bg-surface-900 shadow-2xl p-2.5">
        <div className="flex items-center mb-1.5">
          <span className="text-xs font-semibold text-primary-600 dark:text-primary-300">
            Свои задачи · {format(dayDate(dayKey), 'EEEE, d MMMM', { locale: ru })}
          </span>
          <button type="button" onClick={onClose} title="Закрыть"
            className="ml-auto w-7 h-7 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 flex items-center justify-center">
            <X size={13} />
          </button>
        </div>
        {tasks.length > 0 && (
          <div className="space-y-1.5 mb-2 max-h-[40vh] overflow-y-auto">
            {tasks.map(t => <OwnRow key={t.id} t={t} own={own} todayKey={todayKey} compact />)}
          </div>
        )}
        <OwnInput target={dayKey} todayKey={todayKey} own={own} autoFocus onEscape={onClose} compact />
        <p className="mt-1.5 text-[11px] text-surface-400 dark:text-surface-500">
          Enter — добавить и писать следующую · время можно написать в строке: 18:00
        </p>
      </div>
    </>,
    document.body,
  )
}
