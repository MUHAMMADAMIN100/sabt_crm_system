import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, contentPlanApi, storiesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { projColor, storiesDailyTarget } from '@/pages/smm/smmShared'
import { Film, Image as ImageIcon, Palette, Camera, Info, ChevronLeft, ChevronRight, X, Check, Minus, Plus, AlertTriangle } from 'lucide-react'
import { startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isSameDay, addMonths, format, subDays, differenceInCalendarDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const dk = (d: Date) => format(d, 'yyyy-MM-dd')

/** Дневная норма сторис проекта на дату — единая формула (месяц / дни месяца). */
function dailyTarget(p: any, date: Date = new Date()): number { return storiesDailyTarget(p, date) }

/** Месячная норма сторис проекта: явная, либо дневная × дни месяца. */
function monthlyTarget(p: any, date: Date): number {
  const sd = (p as any)?.smmData || {}
  const m = (p as any)?.storiesPerMonth ?? sd.storiesPerMonth
  if (m != null && Number.isFinite(Number(m))) return Math.max(0, Number(m))
  const dim = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return dailyTarget(p, date) * dim
}

/** Русское склонение по числу. */
function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, h = n % 100
  if (d === 1 && h !== 11) return one
  if (d >= 2 && d <= 4 && (h < 10 || h >= 20)) return few
  return many
}

/** Мета задачи: иконка, ярлык, цветовая группа, подпись описания. */
function taskInfo(e: any): { Icon: any; tag: string; group: 'reel' | 'maket' | 'shoot' | 'design'; descLabel: string } {
  if (e.kind === 'shoot') {
    if (e.parentKind === 'post') return { Icon: Palette, tag: 'Дизайн', group: 'design', descLabel: 'Описание' }
    return { Icon: Camera, tag: 'Съёмка', group: 'shoot', descLabel: 'Что снять' }
  }
  if (e.contentType === 'reel' || e.contentType === 'video') return { Icon: Film, tag: 'Рилс', group: 'reel', descLabel: 'Сценарий' }
  return { Icon: ImageIcon, tag: 'Макет', group: 'maket', descLabel: 'Описание' }
}
function taskTitle(e: any): string {
  if (e.kind === 'shoot') return (e.title && e.title.trim()) || (e.parentKind === 'post' ? 'Дизайн макета' : 'Съёмка')
  return (e.topic && e.topic.trim()) || 'Без названия'
}
const isDone = (e: any) => e.status === 'published'

// Цвета типов (иконка/ярлык): Рилс — синий, Макет — янтарный, Съёмка — лаймовый, Дизайн — фуксия.
const GROUP_CLS: Record<string, string> = {
  reel: 'text-blue-500 dark:text-blue-400 bg-blue-500/12',
  maket: 'text-amber-500 dark:text-amber-400 bg-amber-500/12',
  shoot: 'text-lime-600 dark:text-lime-400 bg-lime-500/12',
  design: 'text-fuchsia-500 dark:text-fuchsia-400 bg-fuchsia-500/12',
}

/**
 * Панель дня SMM-специалиста: мини-календарь месяца с цифрами по типам
 * (Рилс/Макет/Сторис разными цветами) + детали выбранного дня — задачи
 * (отметка «готово» + модалка с инфо) и сторис (степпер по проектам).
 */
export default function SmmSpecialistDashboard() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [cursor, setCursor] = useState(() => new Date())
  const [sel, setSel] = useState(() => new Date())
  const [openId, setOpenId] = useState<string | null>(null)
  const [pendingStory, setPendingStory] = useState<Record<string, number>>({})

  const from = dk(startOfMonth(cursor))
  const to = dk(endOfMonth(cursor))
  const selKey = dk(sel)
  const todayKey = dk(new Date())

  const { data: projectsList } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.list() })
  const { data: cal } = useQuery({ queryKey: ['smm-calendar', from, to], queryFn: () => contentPlanApi.smmCalendar({ from, to }) })
  const { data: myStories } = useQuery({ queryKey: ['stories-my-month', from, to], queryFn: () => storiesApi.my(from, to) })
  // Просрочки ищем шире текущего месяца: задача могла «повиснуть» в прошлом.
  const overdueFrom = useMemo(() => dk(subDays(new Date(), 75)), [])
  const { data: overdueCal } = useQuery({
    queryKey: ['smm-calendar-overdue', overdueFrom, todayKey],
    queryFn: () => contentPlanApi.smmCalendar({ from: overdueFrom, to: todayKey }),
  })

  // Личный кабинет — ТОЛЬКО свои проекты (назначен специалистом, участник или
  // менеджер). Все проекты агентства специалист видит в разделе «СММ», здесь
  // же панель дня показывает его собственную работу — см. canMark.
  const myProjects = useMemo(
    () => (projectsList || []).filter((p: any) => !p.isArchived && (p.projectType || 'SMM') === 'SMM'),
    [projectsList],
  )
  const isMgmt = ['admin', 'founder', 'co_founder', 'smm_director'].includes(user?.role || '')
  const canMark = (p: any) => isMgmt ||
    p.members?.some((m: any) => m.id === user?.id) ||
    p.managerId === user?.id || p.manager?.id === user?.id ||
    (Array.isArray(p.smmData?.smmSpecialistIds) && p.smmData.smmSpecialistIds.includes(user?.id))
  // Свои проекты: по ним показываем задачи, считаем мини-месяц и отмечаем сторис.
  const mine = useMemo(() => myProjects.filter((p: any) => canMark(p)), [myProjects, user?.id, isMgmt])
  const myProjectIds = useMemo(() => new Set(mine.map((p: any) => p.id)), [mine])
  const trackedProjects = useMemo(
    () => mine.filter((p: any) => !p.storiesArchived && dailyTarget(p) > 0),
    [mine],
  )

  // Контент-события (мои проекты): публикации (рилс/макет) + задачи подготовки (съёмка/дизайн).
  const contentByDay = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const e of (cal?.events || [])) {
      if (!myProjectIds.has(e.projectId) || !e.date) continue
      const isPub = e.kind === 'publication' && e.contentType !== 'story'
      const isShoot = e.kind === 'shoot'
      if (!isPub && !isShoot) continue
      ;(map[e.date] ||= []).push(e)
    }
    return map
  }, [cal, myProjectIds])

  // Сторис по дням (мои логи): dateKey -> projectId -> count.
  const storyByDay = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    for (const s of (myStories || [])) {
      if (!myProjectIds.has(s.projectId)) continue
      ;(map[s.date] ||= {})[s.projectId] = (map[s.date]?.[s.projectId] || 0) + (s.storiesCount || s.count || 0)
    }
    return map
  }, [myStories, myProjectIds])

  const counts = (dstr: string) => {
    const ev = contentByDay[dstr] || []
    const reel = ev.filter(e => e.kind === 'publication' && (e.contentType === 'reel' || e.contentType === 'video')).length
    const maket = ev.filter(e => e.kind === 'publication' && e.contentType === 'design').length
    const story = Object.values(storyByDay[dstr] || {}).reduce((a, b) => a + b, 0)
    return { reel, maket, story }
  }

  // Просроченное: задача прошлых дней, которую не отметили готовой.
  const overdue = useMemo(() => {
    const list = (overdueCal?.events || []).filter((e: any) => {
      if (!e.date || e.date >= todayKey || !myProjectIds.has(e.projectId)) return false
      if (isDone(e)) return false
      return (e.kind === 'publication' && e.contentType !== 'story') || e.kind === 'shoot'
    })
    return list.sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
  }, [overdueCal, myProjectIds, todayKey])

  const overdueByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of overdue) m[e.date] = (m[e.date] || 0) + 1
    return m
  }, [overdue])

  // Цифры месяца для сводки: сторис факт/норма и сданные рилсы.
  const monthStories = useMemo(
    () => Object.values(storyByDay).reduce((sum, byProject) => sum + Object.values(byProject).reduce((a, b) => a + b, 0), 0),
    [storyByDay],
  )
  const monthStoriesTarget = useMemo(
    () => trackedProjects.reduce((sum: number, p: any) => sum + monthlyTarget(p, cursor), 0),
    [trackedProjects, cursor],
  )
  const reelsDone = useMemo(
    () => Object.values(contentByDay).flat().filter((e: any) =>
      e.kind === 'publication' && (e.contentType === 'reel' || e.contentType === 'video') && isDone(e)).length,
    [contentByDay],
  )

  // ── Мутации ──
  const markMut = useMutation({
    mutationFn: (v: { itemId: string; done: boolean }) => contentPlanApi.smartUpdate(v.itemId, { status: v.done ? 'planned' : 'published' }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['smm-calendar', from, to] })
      const prev = qc.getQueryData<any>(['smm-calendar', from, to])
      const patch = (old: any) => old
        ? { ...old, events: old.events.map((e: any) => e.itemId === v.itemId ? { ...e, status: v.done ? 'planned' : 'published' } : e) }
        : old
      qc.setQueryData<any>(['smm-calendar', from, to], patch)
      qc.setQueriesData({ queryKey: ['smm-calendar-overdue'] }, patch)
      return { prev }
    },
    onError: (_e, _v, ctx: any) => { if (ctx?.prev) qc.setQueryData(['smm-calendar', from, to], ctx.prev) },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['smm-calendar'] })
      qc.invalidateQueries({ queryKey: ['smm-calendar-overdue'] })
    },
  })
  const toggleDone = (e: any) => { if (e.itemId) markMut.mutate({ itemId: e.itemId, done: isDone(e) }) }

  const storyMut = useMutation({
    mutationFn: (v: { projectId: string; storiesCount: number }) =>
      storiesApi.upsert({ projectId: v.projectId, date: selKey, storiesCount: v.storiesCount }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['stories-my-month'] }),
  })
  const storyCountOf = (pid: string) => (pid in pendingStory ? pendingStory[pid] : (storyByDay[selKey]?.[pid] || 0))
  const setStory = (pid: string, next: number) => {
    const target = dailyTarget(myProjects.find((p: any) => p.id === pid), sel)
    const n = Math.max(0, Math.min(Math.max(target + 5, 30), next))
    setPendingStory(prev => ({ ...prev, [pid]: n }))
    storyMut.mutate({ projectId: pid, storiesCount: n })
  }

  // Смена месяца: курсор + выбранный день (сегодня, если месяц текущий).
  const goMonth = (delta: number) => {
    const nc = addMonths(cursor, delta)
    setCursor(nc)
    const now = new Date()
    setSel(nc.getMonth() === now.getMonth() && nc.getFullYear() === now.getFullYear() ? now : startOfMonth(nc))
    setPendingStory({})
  }

  // ── Мини-календарь ──
  const monthStart = startOfMonth(cursor)
  const days = eachDayOfInterval({ start: monthStart, end: endOfMonth(cursor) })
  const pad = (getDay(monthStart) + 6) % 7

  const selEvents = (contentByDay[selKey] || []).slice().sort((a, b) => {
    // публикации выше задач подготовки; внутри — по названию
    const order = (e: any) => (e.kind === 'shoot' ? 1 : 0)
    return order(a) - order(b) || taskTitle(a).localeCompare(taskTitle(b), 'ru')
  })
  const selDone = selEvents.filter(isDone).length
  const openEvent = openId ? ([...overdue, ...selEvents].find(e => e.id === openId) || null) : null

  // Сводка выбранного дня: что ещё не закрыто.
  const tasksLeft = selEvents.length - selDone
  const storiesLeft = trackedProjects.filter((p: any) => storyCountOf(p.id) < dailyTarget(p, sel)).length
  const summary = [
    tasksLeft > 0 ? `${tasksLeft} ${plural(tasksLeft, 'задача', 'задачи', 'задач')}` : null,
    storiesLeft > 0 ? `сторис по ${storiesLeft} ${plural(storiesLeft, 'проекту', 'проектам', 'проектам')}` : null,
  ].filter(Boolean)

  const Chip = ({ letter, n, g }: { letter: string; n: number; g: string }) =>
    n > 0 ? <span className={clsx('text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none', GROUP_CLS[g])}>{letter} {n}</span> : null

  return (
    <div className="space-y-4">
      {/* Сводка дня */}
      <div className="card">
        <div className="flex items-center gap-4">
          <Ring done={selDone} total={selEvents.length} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold text-surface-900 dark:text-surface-100 first-letter:uppercase leading-tight">
              {isToday(sel) ? 'Сегодня' : format(sel, 'EEEE, d MMMM', { locale: ru })}
            </h2>
            <p className="text-xs text-surface-400 dark:text-surface-500 mt-0.5">
              {summary.length ? `Осталось: ${summary.join(' · ')}` : 'Всё закрыто — задач и сторис на этот день не осталось'}
            </p>
          </div>
        </div>
        {/* Цифры — отдельной строкой: на телефоне во всю ширину карточки,
            на компьютере с отступом под колонку заголовка (кольцо 68 + gap 16). */}
        <div className="flex flex-wrap gap-2 mt-3 sm:pl-[84px]">
          {overdue.length > 0 && (
            <Metric value={String(overdue.length)} label="просрочено" tone="danger" />
          )}
          <Metric
            value={`${monthStories}/${monthStoriesTarget}`}
            label={`сторис за ${format(cursor, 'LLLL', { locale: ru })}`}
            bar={monthStoriesTarget > 0 ? Math.min(1, monthStories / monthStoriesTarget) : 0}
          />
          <Metric value={String(reelsDone)} label="рилсов сдано" tone={reelsDone > 0 ? 'ok' : undefined} />
        </div>
      </div>

      {/* Просроченное */}
      {overdue.length > 0 && (
        <div className="card border-red-200/70 dark:border-red-900/40">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-red-500 dark:text-red-400 mb-2">
            <AlertTriangle size={13} /> Просрочено · {overdue.length}
          </div>
          <div className="space-y-2">
            {overdue.map(e => (
              <TaskRow key={e.id} e={e} onToggle={() => toggleDone(e)} onInfo={() => setOpenId(e.id)}
                late={Math.max(1, differenceInCalendarDays(new Date(todayKey + 'T00:00:00'), new Date(e.date + 'T00:00:00')))} />
            ))}
          </div>
        </div>
      )}

      {/* Мини-месяц */}
      <div className="card">
        <div className="flex items-center justify-center gap-4 mb-3">
          <button onClick={() => goMonth(-1)} className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronLeft size={16} /></button>
          <b className="text-sm font-bold capitalize min-w-[130px] text-center">{format(cursor, 'LLLL yyyy', { locale: ru })}</b>
          <button onClick={() => goMonth(1)} className="w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 flex items-center justify-center"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK.map(w => <div key={w} className="text-center text-[9.5px] font-bold uppercase text-surface-400 dark:text-surface-500 pb-1">{w}</div>)}
          {Array.from({ length: pad }).map((_, i) => <div key={`p${i}`} />)}
          {days.map(d => {
            const key = dk(d)
            const c = counts(key)
            const late = overdueByDay[key] || 0
            const isSel = isSameDay(d, sel)
            const t = isToday(d)
            return (
              <button
                key={key}
                onClick={() => { setSel(d); setPendingStory({}) }}
                className={clsx(
                  'min-h-[66px] rounded-xl border p-1.5 flex flex-col text-left transition',
                  t ? 'bg-primary-50 dark:bg-primary-900/20' : 'bg-surface-50 dark:bg-surface-800/40',
                  isSel ? 'border-primary-500 ring-1 ring-primary-500'
                    : late > 0 ? 'border-red-300 dark:border-red-800/70'
                    : 'border-surface-100 dark:border-surface-700/60 hover:border-surface-300 dark:hover:border-surface-600',
                )}
              >
                <span className={clsx('text-[11px] font-bold text-right leading-none', t ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400 dark:text-surface-500')}>{format(d, 'd')}</span>
                <span className="flex flex-wrap gap-1 mt-auto">
                  {late > 0 && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-red-500/15 text-red-500 dark:text-red-400" title="Просрочено">! {late}</span>}
                  <Chip letter="Р" n={c.reel} g="reel" />
                  <Chip letter="М" n={c.maket} g="maket" />
                  {c.story > 0 && <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-emerald-500/12 text-emerald-500 dark:text-emerald-400">С {c.story}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Детали дня */}
      <div className="card">
        <div className="flex items-baseline gap-2.5 mb-3">
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">
            {isToday(sel) ? 'Сегодня' : format(sel, 'd MMMM', { locale: ru })}
          </h2>
          <span className="text-xs text-surface-400 dark:text-surface-500">{selDone}/{selEvents.length} задач</span>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">Задачи</div>
        {selEvents.length === 0 ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-6">На этот день задач нет</p>
        ) : (
          <div className="space-y-2">
            {selEvents.map(e => (
              <TaskRow key={e.id} e={e} onToggle={() => toggleDone(e)} onInfo={() => setOpenId(e.id)} />
            ))}
          </div>
        )}

        {/* Сторис за выбранный день */}
        {trackedProjects.length > 0 && (
          <>
            <div className="flex items-baseline gap-2 mt-5 mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">
                Сторис {isToday(sel) ? 'сегодня' : `за ${format(sel, 'd MMM', { locale: ru })}`}
              </span>
              <span className="text-[11px] text-surface-400 dark:text-surface-500">
                {trackedProjects.length - storiesLeft} из {trackedProjects.length} проектов
              </span>
            </div>
            <div className="space-y-2">
              {trackedProjects.map((p: any) => {
                const target = dailyTarget(p, sel)
                const cnt = storyCountOf(p.id)
                const full = cnt >= target
                return (
                  <div key={p.id} className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2.5',
                    full ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40' : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: projColor(p.id) }} />
                    <span className={clsx('text-[13.5px] font-semibold flex-1 min-w-0 truncate', full ? 'text-surface-500 dark:text-surface-400' : 'text-surface-800 dark:text-surface-200')}>{p.name}</span>
                    <span className="hidden sm:flex gap-1 shrink-0">
                      {Array.from({ length: target }, (_, i) => i).map(i => (
                        <span key={i} className={clsx('w-2.5 h-2.5 rounded-full', i < cnt ? 'bg-green-500' : 'bg-surface-200 dark:bg-surface-600')} />
                      ))}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0 bg-surface-100 dark:bg-surface-700/60 rounded-lg p-0.5 border border-surface-200 dark:border-surface-600/50">
                      <button onClick={() => setStory(p.id, cnt - 1)} disabled={cnt <= 0} className="w-6 h-6 rounded-md flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-600 disabled:opacity-30"><Minus size={13} /></button>
                      <span className="min-w-[22px] text-center text-[13px] font-bold tabular-nums text-surface-900 dark:text-surface-100">{cnt}</span>
                      <button onClick={() => setStory(p.id, cnt + 1)} className="w-6 h-6 rounded-md flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-600"><Plus size={13} /></button>
                    </div>
                    {full ? (
                      <span className="text-[10.5px] font-bold text-green-600 dark:text-green-400 shrink-0 w-[62px] text-center">готово</span>
                    ) : (
                      <button onClick={() => setStory(p.id, target)} title={`Поставить дневную норму: ${target}`}
                        className="text-[10.5px] font-bold text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 rounded-lg px-2 py-1 shrink-0 w-[62px] hover:bg-primary-50 dark:hover:bg-primary-900/20">
                        норма {target}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Модалка задачи */}
      {openEvent && <TaskModal e={openEvent} onClose={() => setOpenId(null)} onToggle={() => { toggleDone(openEvent); setOpenId(null) }} />}
    </div>
  )
}

// ── Кольцо прогресса дня ──
function Ring({ done, total }: { done: number; total: number }) {
  const C = 2 * Math.PI * 15.5
  const pct = total > 0 ? Math.min(1, done / total) : 0
  const full = total > 0 && done >= total
  return (
    <svg viewBox="0 0 36 36" className="w-[68px] h-[68px] shrink-0" role="img" aria-label={`Сделано ${done} из ${total}`}>
      <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" className="text-surface-200 dark:text-surface-700" />
      {pct > 0 && (
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
          className={full ? 'text-green-500' : 'text-primary-500'}
          strokeDasharray={`${(C * pct).toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 18 18)" />
      )}
      <text x="18" y="17.8" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" className="text-surface-900 dark:text-surface-100">{done}/{total}</text>
      <text x="18" y="23.6" textAnchor="middle" fontSize="4.4" fill="currentColor" className="text-surface-400 dark:text-surface-500">задач</text>
    </svg>
  )
}

// ── Цифра сводки ──
function Metric({ value, label, tone, bar }: { value: string; label: string; tone?: 'danger' | 'ok'; bar?: number }) {
  return (
    <div className={clsx('rounded-xl border px-3 py-1.5 flex-1 min-w-[calc(50%-0.25rem)] sm:flex-none sm:min-w-[96px]',
      tone === 'danger' ? 'border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-900/10'
        : 'border-surface-100 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-800/50')}>
      <div className={clsx('text-[17px] font-extrabold tabular-nums leading-tight',
        tone === 'danger' ? 'text-red-500 dark:text-red-400'
          : tone === 'ok' ? 'text-green-600 dark:text-green-400'
          : 'text-surface-900 dark:text-surface-100')}>{value}</div>
      <div className="text-[10.5px] text-surface-400 dark:text-surface-500">{label}</div>
      {bar !== undefined && (
        <div className="h-1 rounded-full bg-surface-200 dark:bg-surface-700 mt-1 overflow-hidden">
          <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

// ── Строка задачи (день и просрочки) ──
function TaskRow({ e, onToggle, onInfo, late }: { e: any; onToggle: () => void; onInfo: () => void; late?: number }) {
  const { Icon, tag, group } = taskInfo(e)
  const done = isDone(e)
  return (
    <div className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2.5 transition',
      late ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200/70 dark:border-red-900/40'
        : done ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
        : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
      <button onClick={onToggle} disabled={!e.itemId}
        className={clsx('w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition',
          done ? 'bg-green-500 border-green-500' : 'border-surface-300 dark:border-surface-600 hover:border-green-500')}>
        <Check size={13} className={clsx('text-white transition-opacity', done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
      </button>
      <div className={clsx('w-8 h-8 rounded-lg shrink-0 flex items-center justify-center', GROUP_CLS[group])}><Icon size={16} /></div>
      <div className="min-w-0 flex-1">
        <p className={clsx('text-[13.5px] font-semibold truncate', done ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>{taskTitle(e)}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={clsx('text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded', GROUP_CLS[group])}>{tag}</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500 truncate">
            <i className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: projColor(e.projectId) }} />{e.projectName}
          </span>
          {late ? (
            <span className="text-[11px] font-bold text-red-500 dark:text-red-400">
              срок был {format(new Date(e.date + 'T00:00:00'), 'd MMM', { locale: ru })} · {late} {plural(late, 'день', 'дня', 'дней')}
            </span>
          ) : null}
        </div>
      </div>
      <button onClick={onInfo} title="Подробнее"
        className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-primary-600 hover:border-primary-400 flex items-center justify-center shrink-0 transition">
        <Info size={16} />
      </button>
    </div>
  )
}

// ── Модалка с информацией о задаче ──
function TaskModal({ e, onClose, onToggle }: { e: any; onClose: () => void; onToggle: () => void }) {
  const { Icon, tag, group, descLabel } = taskInfo(e)
  const done = isDone(e)
  const desc = (e.scriptText && String(e.scriptText).trim()) || ''
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-100 dark:border-surface-800">
          <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', GROUP_CLS[group])}><Icon size={20} /></div>
          <div className="min-w-0">
            <div className={clsx('text-[10px] font-extrabold uppercase tracking-wide', GROUP_CLS[group].split(' ').filter(c => c.includes('text-')).join(' '))}>{tag}</div>
            <div className="text-[16px] font-extrabold text-surface-900 dark:text-surface-100 leading-tight">{taskTitle(e)}</div>
          </div>
          <button onClick={onClose} className="ml-auto w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-700 text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 flex items-center justify-center shrink-0"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between py-2 border-b border-surface-100 dark:border-surface-800 text-[13px]">
            <span className="text-surface-400 dark:text-surface-500">Проект</span>
            <span className="font-bold text-surface-900 dark:text-surface-100 inline-flex items-center gap-2"><i className="w-2 h-2 rounded-full" style={{ background: projColor(e.projectId) }} />{e.projectName}</span>
          </div>
          <div className="flex items-center justify-between py-2 border-b border-surface-100 dark:border-surface-800 text-[13px]">
            <span className="text-surface-400 dark:text-surface-500">Дата</span>
            <span className="font-bold text-surface-900 dark:text-surface-100">{e.date ? format(new Date(e.date + 'T00:00:00'), 'd MMMM', { locale: ru }) : '—'}</span>
          </div>
          <div className="flex items-center justify-between py-2 text-[13px]">
            <span className="text-surface-400 dark:text-surface-500">Статус</span>
            <span className={clsx('text-[11px] font-extrabold px-2.5 py-0.5 rounded-full', done ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400')}>{done ? 'Готово' : 'В работе'}</span>
          </div>
          <div className="text-[11px] font-extrabold uppercase tracking-wide text-surface-400 dark:text-surface-500 mt-3 mb-2">{descLabel}</div>
          <div className={clsx('text-[13px] leading-relaxed rounded-xl border border-surface-100 dark:border-surface-800 bg-surface-50 dark:bg-surface-800/50 px-3.5 py-3 max-h-[160px] overflow-y-auto whitespace-pre-wrap', !desc && 'text-surface-400 dark:text-surface-500 italic')}>
            {desc || 'Описание пока не заполнено — добавьте его в контент-плане проекта.'}
          </div>
        </div>
        <div className="flex gap-2.5 px-5 pb-5">
          {e.itemId && (
            <button onClick={onToggle} className={clsx('flex-1 rounded-xl py-2.5 text-[13px] font-bold', done ? 'border border-surface-200 dark:border-surface-600 text-surface-500 dark:text-surface-300' : 'bg-green-500 text-white')}>
              {done ? 'Снять отметку' : '✓ Отметить готовым'}
            </button>
          )}
          <button onClick={onClose} className="flex-1 rounded-xl py-2.5 text-[13px] font-bold border border-surface-200 dark:border-surface-600 text-surface-600 dark:text-surface-300">Закрыть</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
