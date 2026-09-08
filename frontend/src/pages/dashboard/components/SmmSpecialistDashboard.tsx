import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { projectsApi, storiesApi, contentPlanApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { ProgressBar } from '@/components/ui'
import { Film, Image as ImageIcon, Palette, Camera, Minus, Plus, Check, ListChecks } from 'lucide-react'
import { format, startOfMonth, addDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

/** Дневной план сторис проекта (smmData.storiesPerDay, дефолт 3, максимум 12). */
function dailyTarget(project: any): number {
  const v = Number(project?.smmData?.storiesPerDay)
  return Number.isFinite(v) && v > 0 ? Math.min(v, 12) : 3
}

/** Тип задачи контент-плана → иконка + подпись. Публикации, съёмки и
 *  задачи подготовки (съёмка под рилс / дизайн под пост) сводятся к единому виду. */
function taskMeta(e: any): { Icon: any; tag: string; cls: string } {
  if (e.kind === 'shoot') {
    // Задача подготовки: под рилс — «Съёмка», под пост — «Дизайн»; ручная съёмка — «Съёмка».
    if (e.parentKind === 'post') return { Icon: Palette, tag: 'Дизайн', cls: 'text-fuchsia-500 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-900/20' }
    return { Icon: Camera, tag: 'Съёмка', cls: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' }
  }
  if (e.contentType === 'reel') return { Icon: Film, tag: 'Рилс', cls: 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20' }
  return { Icon: ImageIcon, tag: 'Публикация', cls: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20' }
}

function taskTitle(e: any): string {
  if (e.kind === 'shoot') return (e.title && e.title.trim()) || (e.parentKind === 'post' ? 'Дизайн макета' : 'Съёмка')
  return (e.topic && e.topic.trim()) || 'Без названия'
}

/**
 * Главная SMM-специалиста (Вариант B — две колонки):
 *  • слева (шире) — «Главные задачи»: контент-план его проектов, сгруппированный
 *    Просрочено / Сегодня / На неделе (рилсы, публикации, съёмки, дизайн);
 *  • справа — «Сторис сегодня»: отметка выложенных сторис по каждому проекту
 *    (степпер, дневная норма из storiesPerDay) + месячный прогресс.
 */
export default function SmmSpecialistDashboard() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  // Окно задач: захватываем просрочку за месяц и неделю вперёд.
  const winFrom = format(addDays(new Date(), -31), 'yyyy-MM-dd')
  const winTo = format(addDays(new Date(), 8), 'yyyy-MM-dd')

  const { data: projectsList } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: monthStories } = useQuery({
    queryKey: ['stories-my-month', monthStart, today],
    queryFn: () => storiesApi.my(monthStart, today),
  })
  const { data: cal } = useQuery({
    queryKey: ['smm-cal-home', winFrom, winTo],
    queryFn: () => contentPlanApi.smmCalendar({ from: winFrom, to: winTo }),
  })

  // Мои SMM-проекты: я в составе или менеджер; активные, сторис не в архиве.
  const myProjects = useMemo(() => {
    const all = (projectsList || []).filter((p: any) => !p.isArchived && (p.projectType || 'SMM') === 'SMM')
    return all.filter((p: any) =>
      p.members?.some((m: any) => m.id === user?.id) ||
      p.managerId === user?.id ||
      p.manager?.id === user?.id ||
      (Array.isArray(p.smmData?.smmSpecialistIds) && p.smmData.smmSpecialistIds.includes(user?.id)),
    )
  }, [projectsList, user])
  const myProjectIds = useMemo(() => new Set(myProjects.map((p: any) => p.id)), [myProjects])
  const trackedProjects = useMemo(
    () => myProjects.filter((p: any) => !p.storiesArchived && dailyTarget(p) > 0),
    [myProjects],
  )

  // Фактические сторис за СЕГОДНЯ по каждому проекту (мои логи).
  const todayByProject = useMemo(() => {
    const map: Record<string, number> = {}
    ;(monthStories || []).forEach((s: any) => {
      if (s.date === today) map[s.projectId] = (map[s.projectId] || 0) + (s.storiesCount || s.count || 0)
    })
    return map
  }, [monthStories, today])

  // Локальный оптимистичный оверрайд для мгновенного отклика степпера.
  const [pending, setPending] = useState<Record<string, number>>({})
  const countOf = (pid: string) => (pid in pending ? pending[pid] : (todayByProject[pid] || 0))

  const upsert = useMutation({
    mutationFn: (v: { projectId: string; storiesCount: number }) =>
      storiesApi.upsert({ projectId: v.projectId, date: today, storiesCount: v.storiesCount }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['stories-my-month'] })
      qc.invalidateQueries({ queryKey: ['stories-today'] })
      qc.invalidateQueries({ queryKey: ['stories-month'] })
    },
  })
  const setCount = (pid: string, next: number) => {
    const target = dailyTarget(myProjects.find((p: any) => p.id === pid))
    const clamped = Math.max(0, Math.min(Math.max(target + 5, 30), next))
    setPending(prev => ({ ...prev, [pid]: clamped }))
    upsert.mutate({ projectId: pid, storiesCount: clamped })
  }

  // Месячная сводка сторис (мои логи vs план проектов).
  const daysElapsed = new Date().getDate()
  const monthActual = useMemo(
    () => (monthStories || []).reduce((s: number, r: any) => s + (r.storiesCount || r.count || 0), 0),
    [monthStories],
  )
  const monthExpected = trackedProjects.reduce((s: number, p: any) => s + dailyTarget(p) * daysElapsed, 0)
  const monthPct = monthExpected > 0 ? Math.min(100, Math.round((monthActual / monthExpected) * 100)) : 0
  const doneToday = trackedProjects.filter((p: any) => countOf(p.id) >= dailyTarget(p)).length

  // ── Задачи из контент-плана (мои проекты, не сторис, не выполненные) ──
  const tasks = useMemo(() => {
    const events: any[] = (cal?.events || []).filter((e: any) =>
      myProjectIds.has(e.projectId) &&
      e.date &&
      e.contentType !== 'story' &&
      e.status !== 'published' && e.status !== 'cancelled',
    )
    const over: any[] = [], now: any[] = [], week: any[] = []
    const weekEnd = format(addDays(new Date(), 7), 'yyyy-MM-dd')
    for (const e of events) {
      if (e.date < today) over.push(e)
      else if (e.date === today) now.push(e)
      else if (e.date <= weekEnd) week.push(e)
    }
    const byDate = (a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    return { over: over.sort(byDate), now: now.sort(byDate), week: week.sort(byDate) }
  }, [cal, myProjectIds, today])

  const totalTasks = tasks.over.length + tasks.now.length + tasks.week.length

  const colorById = useMemo(() => {
    const m: Record<string, string> = {}
    myProjects.forEach((p: any) => { m[p.id] = p.color || '#6d8bf5' })
    return m
  }, [myProjects])

  const TaskRow = ({ e, danger }: { e: any; danger?: boolean }) => {
    const { Icon, tag, cls } = taskMeta(e)
    const d = new Date(e.date + 'T00:00:00')
    return (
      <Link
        to="/smm"
        className="flex items-center gap-3 p-2.5 rounded-xl bg-surface-50 dark:bg-surface-800/50 hover:bg-surface-100 dark:hover:bg-surface-700/60 border border-surface-100 dark:border-surface-700/60 transition-colors group"
      >
        <div className={clsx('w-8 h-8 rounded-lg shrink-0 flex items-center justify-center', cls)}>
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-surface-900 dark:text-surface-100 truncate">{taskTitle(e)}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={clsx('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded', cls)}>{tag}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500 truncate">
              <i className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: colorById[e.projectId] }} />
              {e.projectName}
            </span>
          </div>
        </div>
        <span className={clsx(
          'text-[11px] font-semibold shrink-0',
          danger ? 'text-red-500 dark:text-red-400'
            : e.date === today ? 'text-primary-600 dark:text-primary-400'
            : 'text-surface-400 dark:text-surface-500',
        )}>
          {e.date === today ? 'Сегодня' : format(d, 'd MMM', { locale: ru })}
        </span>
      </Link>
    )
  }

  const Group = ({ label, items, danger }: { label: string; items: any[]; danger?: boolean }) => {
    if (!items.length) return null
    return (
      <div className="mb-1">
        <div className={clsx(
          'flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide mb-2 mt-3 first:mt-0',
          danger ? 'text-red-500 dark:text-red-400' : 'text-surface-400 dark:text-surface-500',
        )}>
          {label}
          <span className={clsx('rounded-full px-1.5 text-[10px]', danger ? 'bg-red-50 dark:bg-red-900/20' : 'bg-surface-100 dark:bg-surface-700')}>
            {items.length}
          </span>
        </div>
        <div className="space-y-2">
          {items.map((e: any) => <TaskRow key={e.id} e={e} danger={danger} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5 items-start">
      {/* ── Главные задачи ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100">Главные задачи</h2>
          <Link to="/smm" className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Контент-план →</Link>
        </div>
        {totalTasks === 0 ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-10">На ближайшую неделю задач нет 🎉</p>
        ) : (
          <>
            <Group label="Просрочено" items={tasks.over} danger />
            <Group label="Сегодня" items={tasks.now} />
            <Group label="На неделе" items={tasks.week} />
          </>
        )}
      </div>

      {/* ── Сторис сегодня ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
            <ListChecks size={17} className="text-primary-600 dark:text-primary-400" />
            Сторис сегодня
          </h2>
          {trackedProjects.length > 0 && (
            <span className={clsx(
              'text-[10px] font-bold px-2 py-0.5 rounded-full',
              doneToday === trackedProjects.length
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-surface-100 text-surface-500 dark:bg-surface-700 dark:text-surface-400',
            )}>
              {doneToday}/{trackedProjects.length}
            </span>
          )}
        </div>

        {trackedProjects.length === 0 ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-8">Нет проектов со сторис</p>
        ) : (
          <div className="space-y-1">
            {trackedProjects.map((p: any) => {
              const target = dailyTarget(p)
              const count = countOf(p.id)
              const done = count >= target
              return (
                <div key={p.id} className={clsx(
                  'flex items-center gap-2.5 py-2 px-1.5 rounded-xl transition-colors',
                  done ? 'bg-green-50/60 dark:bg-green-900/10' : 'hover:bg-surface-50 dark:hover:bg-surface-800/40',
                )}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color || '#6d8bf5' }} />
                  <span className={clsx('text-[13px] font-medium flex-1 min-w-0 truncate',
                    done ? 'text-surface-500 dark:text-surface-400' : 'text-surface-800 dark:text-surface-200')}>
                    {p.name}
                  </span>
                  {/* точки-прогресс до нормы */}
                  <div className="hidden sm:flex gap-1 shrink-0">
                    {Array.from({ length: target }, (_, i) => i).map(i => (
                      <span key={i} className={clsx('w-2.5 h-2.5 rounded-full',
                        i < count ? 'bg-green-500' : 'bg-surface-200 dark:bg-surface-600')} />
                    ))}
                  </div>
                  {/* степпер: точное число выложенных сторис */}
                  <div className="flex items-center gap-0.5 shrink-0 bg-surface-100 dark:bg-surface-700/60 rounded-lg p-0.5 border border-surface-200 dark:border-surface-600/50">
                    <button
                      type="button" onClick={() => setCount(p.id, count - 1)} disabled={count <= 0}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-600 disabled:opacity-30 transition-colors"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="min-w-[22px] text-center text-[13px] font-bold tabular-nums text-surface-900 dark:text-surface-100">{count}</span>
                    <button
                      type="button" onClick={() => setCount(p.id, count + 1)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-600 transition-colors"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                  {done
                    ? <Check size={16} className="text-green-500 shrink-0" />
                    : <span className="w-4 shrink-0" />}
                </div>
              )
            })}
          </div>
        )}

        {/* Месячный прогресс */}
        {trackedProjects.length > 0 && (
          <div className="mt-3 pt-3 border-t border-surface-100 dark:border-surface-700 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-400 dark:text-surface-500">План сторис за месяц</span>
              <div className="flex items-center gap-1.5">
                <span className={clsx('text-xs font-bold',
                  monthPct >= 80 ? 'text-green-600 dark:text-green-400'
                  : monthPct >= 50 ? 'text-surface-600 dark:text-surface-400'
                  : 'text-red-500 dark:text-red-400')}>{monthPct}%</span>
                <span className="text-xs text-surface-500 dark:text-surface-400 tabular-nums">{monthActual}/{monthExpected}</span>
              </div>
            </div>
            <ProgressBar value={monthPct} />
          </div>
        )}
      </div>
    </div>
  )
}
