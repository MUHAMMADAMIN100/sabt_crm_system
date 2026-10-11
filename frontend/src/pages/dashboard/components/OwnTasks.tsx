// «Свои задачи» в календаре кабинета (вариант A, решение владельца 11.10.2026).
//
// СММ-специалист, видеограф, монтажёр и дизайнер ставят себе задачу прямо в
// дне календаря панели: «забрать штатив», «позвонить клиенту». Это обычная
// личная задача (tasks.scope = 'personal'): проект не нужен, видит её только
// автор, уведомления никому не уходят, а напоминания «план на сегодня» и
// «через час» приходят ему самому — этим занят PersonalReminderScheduler.
//
// Незакрытая задача прошлых дней не теряется в прошлом, а переезжает на
// сегодня с пометкой «с 9 окт»: своя задача — не дедлайн перед кем-то, и
// отдельный блок просрочки ей не нужен.
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Check, Clock, Plus, Trash2, User, X } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { tasksApi } from '@/services/api.service'
import { normalizeTaskStatus } from '@/lib/taskStatus'

const KEY = ['my-tasks'] as const
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
  /** Ещё сохраняется: отмечать и удалять рано. */
  pending: boolean
}

const deadlineOf = (day: string, time: string | null) =>
  new Date(`${day}T${time || NO_TIME}:00`).toISOString()

export function useOwnTasks(todayKey: string) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: KEY, queryFn: tasksApi.my })
  // Переехавшая задача, закрытая в этой сессии, остаётся в сегодняшнем дне
  // зачёркнутой — как закрытая просрочка в кабинете.
  const [keep, setKeep] = useState<Set<string>>(() => new Set())

  const byDay = useMemo(() => {
    const m: Record<string, OwnTask[]> = {}
    for (const t of (Array.isArray(data) ? data : []) as any[]) {
      if (t.scope !== 'personal' || !t.deadline || t.status === 'cancelled') continue
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

  const patch = async (fn: (list: any[]) => any[]) => {
    await qc.cancelQueries({ queryKey: KEY })
    const prev = qc.getQueryData<any>(KEY)
    qc.setQueryData<any>(KEY, (old: any) => fn(Array.isArray(old) ? old : []))
    return { prev }
  }
  const rollback = (ctx: any) => { if (ctx?.prev) qc.setQueryData(KEY, ctx.prev) }
  const refresh = () => qc.invalidateQueries({ queryKey: KEY })

  const add = useMutation({
    mutationFn: (v: { title: string; day: string; time: string | null }) =>
      tasksApi.create({ title: v.title, scope: 'personal', deadline: deadlineOf(v.day, v.time) }),
    onMutate: (v) => patch(list => [...list, {
      id: `tmp-${Date.now()}`, title: v.title, scope: 'personal', status: 'new', deadline: deadlineOf(v.day, v.time),
    }]),
    onError: (e: any, _v, ctx) => {
      rollback(ctx)
      toast.error(e?.response?.data?.message || 'Не удалось добавить задачу')
    },
    onSettled: refresh,
  })
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => tasksApi.update(v.id, { status: v.done ? 'done' : 'in_progress' }),
    onMutate: (v) => {
      if (v.done) setKeep(prev => new Set(prev).add(v.id))
      return patch(list => list.map(t => t.id === v.id ? { ...t, status: v.done ? 'done' : 'in_progress' } : t))
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  })
  const remove = useMutation({
    // Сервер требует причину удаления — у своей задачи она всегда одна.
    mutationFn: (id: string) => tasksApi.remove(id, 'Своя задача — удалена автором'),
    onMutate: (id) => patch(list => list.filter(t => t.id !== id)),
    onError: (e: any, _v, ctx) => {
      rollback(ctx)
      toast.error(e?.response?.data?.message || 'Не удалось удалить задачу')
    },
    onSettled: refresh,
  })

  return {
    byDay,
    of: (day: string) => byDay[day] || [],
    add: (title: string, day: string, time: string | null) => add.mutate({ title, day, time }),
    toggle: (t: OwnTask) => toggle.mutate({ id: t.id, done: !t.done }),
    remove: (t: OwnTask) => remove.mutate(t.id),
  }
}

export type OwnTasksApi = ReturnType<typeof useOwnTasks>

/** Точка своей задачи в ячейке календаря: кружок, а не квадрат производства. */
export function OwnMark({ done, className }: { done?: boolean; className?: string }) {
  return (
    <i title="Своя задача" className={clsx('rounded-full shrink-0', className || 'w-2 h-2',
      done ? 'bg-surface-300 dark:bg-surface-600' : 'bg-surface-700 dark:bg-surface-300')} />
  )
}

/** Блок «Свои задачи» в окне дня: список и добавление. В прошлых днях
 *  добавлять нельзя — незакрытая задача всё равно переехала бы на сегодня. */
export function OwnDayTasks({ dayKey, todayKey, own }: { dayKey: string; todayKey: string; own: OwnTasksApi }) {
  const tasks = own.of(dayKey)
  const canAdd = dayKey >= todayKey
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState('')
  const [timeOpen, setTimeOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (!canAdd && tasks.length === 0) return null

  const close = () => { setOpen(false); setTitle(''); setTime(''); setTimeOpen(false) }
  const submit = () => {
    const v = title.trim()
    if (!v) return
    own.add(v, dayKey, time || null)
    close()
  }
  const dayLabel = dayKey === todayKey ? 'сегодня' : format(new Date(`${dayKey}T00:00:00`), 'd MMMM', { locale: ru })

  return (
    <div className="mt-5">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-surface-600 dark:text-surface-300">Свои задачи</span>
        <span className="ml-auto text-[11px] text-surface-400 dark:text-surface-500">видите только вы</span>
      </div>

      <div className="space-y-2">
        {tasks.map(t => (
          <div key={t.id} className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2.5 transition',
            t.pending && 'opacity-60',
            t.done ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
              : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
            <button type="button" disabled={t.pending} onClick={() => own.toggle(t)}
              title={t.done ? 'Снять отметку' : 'Отметить готовой'}
              className={clsx('w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition',
                t.done ? 'bg-green-500 border-green-500' : 'border-surface-300 dark:border-surface-600 hover:border-green-500')}>
              <Check size={13} className={clsx('text-white transition-opacity', t.done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
            </button>

            <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center bg-surface-200/70 dark:bg-surface-700/60 text-surface-600 dark:text-surface-300">
              <User size={16} />
            </div>

            <div className="min-w-0 flex-1 overflow-hidden">
              <p className={clsx('text-[13.5px] font-semibold truncate',
                t.done ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>{t.title}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-surface-400 dark:text-surface-500">
                <span>своя</span>
                {t.time && <span>· до {t.time}</span>}
                {t.from && !t.done && (
                  <span className="font-bold text-red-500 dark:text-red-400">
                    · с {format(new Date(`${t.from}T00:00:00`), 'd MMM', { locale: ru })}
                  </span>
                )}
              </div>
            </div>

            {confirmId === t.id ? (
              <button type="button" autoFocus onBlur={() => setConfirmId(null)}
                onClick={() => { setConfirmId(null); own.remove(t) }}
                className="h-8 px-2.5 rounded-lg text-[11.5px] font-bold shrink-0 whitespace-nowrap border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                Удалить?
              </button>
            ) : (
              <button type="button" disabled={t.pending} onClick={() => setConfirmId(t.id)} title="Удалить"
                className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-red-500 hover:border-red-300 flex items-center justify-center shrink-0 transition">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}

        {canAdd && !open && (
          <button type="button" onClick={() => setOpen(true)}
            className="w-full h-11 rounded-xl border border-dashed border-surface-300 dark:border-surface-600 text-[13px] font-semibold text-surface-500 dark:text-surface-400 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 flex items-center justify-center gap-1.5 transition">
            <Plus size={15} /> Своя задача
          </button>
        )}

        {canAdd && open && (
          <div className="rounded-xl border-[1.5px] border-primary-500 ring-[3px] ring-primary-500/20 bg-white dark:bg-surface-900 p-2.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-primary-600 dark:text-primary-400">Новая своя задача на {dayLabel}</span>
              <button type="button" onClick={close} title="Отмена"
                className="ml-auto w-7 h-7 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 flex items-center justify-center">
                <X size={14} />
              </button>
            </div>
            <input
              autoFocus
              value={title}
              maxLength={200}
              onChange={ev => setTitle(ev.target.value)}
              onKeyDown={ev => {
                if (ev.key === 'Enter') { ev.preventDefault(); submit() }
                // Esc сворачивает строку, а не закрывает окно дня под ней.
                if (ev.key === 'Escape') { ev.stopPropagation(); close() }
              }}
              placeholder="Что нужно сделать?"
              className="w-full bg-transparent outline-none text-base font-semibold text-surface-900 dark:text-surface-100 placeholder:text-surface-400 dark:placeholder:text-surface-500 placeholder:font-normal"
            />
            <div className="flex items-center gap-2">
              {timeOpen ? (
                <input type="time" autoFocus value={time} onChange={ev => setTime(ev.target.value)} aria-label="Время"
                  className="h-11 w-[116px] shrink-0 rounded-xl border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 px-2.5 text-base text-surface-700 dark:text-surface-200 outline-none" />
              ) : (
                <button type="button" onClick={() => setTimeOpen(true)}
                  className="h-11 px-3 shrink-0 rounded-xl border border-surface-200 dark:border-surface-600 bg-surface-50 dark:bg-surface-800 text-[12.5px] font-semibold text-surface-600 dark:text-surface-300 flex items-center gap-1.5">
                  <Clock size={14} /> Время
                </button>
              )}
              <button type="button" onClick={submit} disabled={!title.trim()}
                className="h-11 flex-1 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-bold transition">
                Добавить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
