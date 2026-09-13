import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi, contentPlanApi, storiesApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { projColor, storiesDailyTarget } from '@/pages/smm/smmShared'
import { Film, Image as ImageIcon, Palette, Camera, Info, ChevronLeft, ChevronRight, X, Check, Minus, Plus, AlertTriangle, MoreHorizontal, CalendarDays, RotateCcw, Ban, Copy, Paperclip, History as HistoryIcon, ChevronUp, ChevronDown } from 'lucide-react'
import { startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isSameDay, addMonths, format, subDays, addDays, differenceInCalendarDays } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import toast from 'react-hot-toast'

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
const isCancelled = (e: any) => e.status === 'cancelled'
/** Дата из YYYY-MM-DD в «12 сент». */
const shortDay = (d?: string | null) => (d ? format(new Date(d + 'T00:00:00'), 'd MMM', { locale: ru }) : '')

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
      if (isDone(e) || isCancelled(e)) return false
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

  const refetchCal = () => {
    qc.invalidateQueries({ queryKey: ['smm-calendar'] })
    qc.invalidateQueries({ queryKey: ['smm-calendar-overdue'] })
  }
  // Перенос: дата меняется, статус возвращается в «запланировано».
  const moveMut = useMutation({
    mutationFn: (v: { itemId: string; date: string }) =>
      contentPlanApi.smartUpdate(v.itemId, { publishDate: v.date, status: 'planned' }),
    onSettled: refetchCal,
  })
  // Отмена: задача уходит из просрочек, но выполненной НЕ считается.
  const cancelMut = useMutation({
    mutationFn: (v: { itemId: string; cancel: boolean }) =>
      contentPlanApi.smartUpdate(v.itemId, { status: v.cancel ? 'cancelled' : 'planned' }),
    onSettled: refetchCal,
  })
  const moveTo = (e: any, d: Date) => { if (e.itemId) moveMut.mutate({ itemId: e.itemId, date: dk(d) }) }
  const setCancelled = (e: any, cancel: boolean) => { if (e.itemId) cancelMut.mutate({ itemId: e.itemId, cancel }) }

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
  // Отменённые остаются в списке, но из счёта убраны: это не работа на день.
  const selActive = selEvents.filter((e: any) => !isCancelled(e))
  const selDone = selActive.filter(isDone).length
  const navList: any[] = (() => {
    const seen = new Set<string>()
    return [...overdue, ...selEvents].filter((x: any) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
  })()
  const openIdx = openId ? navList.findIndex((x: any) => x.id === openId) : -1
  const openEvent = openIdx >= 0 ? navList[openIdx] : null

  // Сводка выбранного дня: что ещё не закрыто.
  const tasksLeft = selActive.length - selDone
  const storiesLeft = trackedProjects.filter((p: any) => storyCountOf(p.id) < dailyTarget(p, sel)).length
  // Остаток по сторис за выбранный день: сколько всего нужно и сколько уже есть
  // (перевыполнение по одному проекту не закрывает норму другого — поэтому min).
  const storiesNeed = trackedProjects.reduce((sum: number, p: any) => sum + dailyTarget(p, sel), 0)
  const storiesDid = trackedProjects.reduce((sum: number, p: any) => sum + Math.min(storyCountOf(p.id), dailyTarget(p, sel)), 0)
  const storiesRest = Math.max(0, storiesNeed - storiesDid)
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
          <Ring done={selDone} total={selActive.length} />
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
                onMove={d => moveTo(e, d)} onCancel={c => setCancelled(e, c)}
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
          <span className="text-xs text-surface-400 dark:text-surface-500">{selDone}/{selActive.length} задач</span>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">Задачи</div>
        {selEvents.length === 0 ? (
          <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-6">На этот день задач нет</p>
        ) : (
          <div className="space-y-2">
            {selEvents.map(e => (
              <TaskRow key={e.id} e={e} onToggle={() => toggleDone(e)} onInfo={() => setOpenId(e.id)}
                onMove={d => moveTo(e, d)} onCancel={c => setCancelled(e, c)} />
            ))}
          </div>
        )}

        {/* Сторис за выбранный день */}
        {trackedProjects.length > 0 && (
          <>
            <div className="flex items-baseline gap-2 mt-5 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500">
                Сторис {isToday(sel) ? 'сегодня' : `за ${format(sel, 'd MMM', { locale: ru })}`}
              </span>
              <span className={clsx('ml-auto text-xs font-bold',
                storiesRest === 0 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400')}>
                {storiesRest === 0 ? 'всё отмечено' : `осталось ${storiesRest} из ${storiesNeed}`}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-200 dark:bg-surface-700 overflow-hidden mb-3">
              <div className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${storiesNeed > 0 ? Math.round((storiesDid / storiesNeed) * 100) : 0}%` }} />
            </div>
            <div className="space-y-2">
              {trackedProjects.map((p: any) => (
                <StoryRow
                  key={p.id}
                  name={p.name}
                  color={projColor(p.id)}
                  count={storyCountOf(p.id)}
                  target={dailyTarget(p, sel)}
                  onSet={n => setStory(p.id, n)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Модалка задачи */}
      {openEvent && (
        <TaskPanel
          e={openEvent}
          pos={openIdx + 1}
          total={navList.length}
          onPrev={() => { if (openIdx > 0) setOpenId(navList[openIdx - 1].id) }}
          onNext={() => { if (openIdx < navList.length - 1) setOpenId(navList[openIdx + 1].id) }}
          onClose={() => setOpenId(null)}
          onToggle={() => toggleDone(openEvent)}
          onMove={d => { moveTo(openEvent, d); toast.success(`Перенесено на ${format(d, 'd MMMM', { locale: ru })}`) }}
          onCancel={c => { setCancelled(openEvent, c); toast.success(c ? 'Задача отменена' : 'Задача возвращена в работу') }}
        />
      )}
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
function TaskRow({ e, onToggle, onInfo, onMove, onCancel, late }: {
  e: any; onToggle: () => void; onInfo: () => void
  onMove?: (d: Date) => void; onCancel?: (cancel: boolean) => void; late?: number
}) {
  const { Icon, tag, group } = taskInfo(e)
  const [menu, setMenu] = useState(false)
  const done = isDone(e)
  const cancelled = isCancelled(e)
  const canAct = !!e.itemId && !!onMove && !!onCancel
  const tomorrow = addDays(new Date(), 1)
  // «закрыто 12 сент, план был 19 авг» — показываем, только если закрыли не в срок.
  const closedLate = done && e.changedAt && e.date && e.changedAt !== e.date

  const pick = (fn: () => void) => () => { setMenu(false); fn() }

  return (
    <div onClick={onInfo} className={clsx('relative flex items-center gap-3 rounded-xl border px-3 py-2.5 transition cursor-pointer hover:border-surface-300 dark:hover:border-surface-600',
      cancelled ? 'bg-surface-50 dark:bg-surface-800/40 border-surface-100 dark:border-surface-700/60 opacity-60'
        : late ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200/70 dark:border-red-900/40'
        : done ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
        : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>

      {cancelled ? (
        <span className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 text-surface-400 dark:text-surface-500" title="Задача отменена"><Ban size={15} /></span>
      ) : (
        <button onClick={ev => { ev.stopPropagation(); onToggle() }} disabled={!e.itemId} title="Отметить готовой"
          className={clsx('w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 transition',
            done ? 'bg-green-500 border-green-500' : 'border-surface-300 dark:border-surface-600 hover:border-green-500')}>
          <Check size={13} className={clsx('text-white transition-opacity', done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
        </button>
      )}

      <div className={clsx('w-8 h-8 rounded-lg shrink-0 flex items-center justify-center', GROUP_CLS[group])}><Icon size={16} /></div>

      <div className="min-w-0 flex-1 overflow-hidden">
        <p className={clsx('text-[13.5px] font-semibold truncate',
          done || cancelled ? 'line-through text-surface-400 dark:text-surface-500' : 'text-surface-900 dark:text-surface-100')}>{taskTitle(e)}</p>
        {/* На телефоне мета в одну строку: ярлык типа скрыт (он понятен по иконке),
            название проекта обрезается, число дней опоздания не сжимается. */}
        <div className="flex items-center gap-2 mt-0.5 flex-nowrap sm:flex-wrap overflow-hidden">
          <span className={clsx('text-[9.5px] font-extrabold uppercase px-1.5 py-0.5 rounded shrink-0 hidden sm:inline-block', GROUP_CLS[group])}>{tag}</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-surface-400 dark:text-surface-500 min-w-0 truncate">
            <i className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: projColor(e.projectId) }} />
            <span className="truncate">{e.projectName}</span>
          </span>
          {late ? (
            <span className="text-[11px] font-bold text-red-500 dark:text-red-400 shrink-0">
              <span className="hidden sm:inline">срок был {shortDay(e.date)} · </span>
              {late} {plural(late, 'день', 'дня', 'дней')}
            </span>
          ) : null}
          {cancelled && (
            <span className="text-[11px] font-semibold text-surface-400 dark:text-surface-500 shrink-0">отменено</span>
          )}
          {closedLate && (
            <span className="text-[11px] font-semibold text-green-600 dark:text-green-400 shrink-0 hidden sm:inline">
              закрыто {shortDay(e.changedAt)}, план был {shortDay(e.date)}
            </span>
          )}
        </div>
      </div>

      {/* Быстрое действие: перенести просрочку на сегодня. */}
      {canAct && !!late && !done && !cancelled && (
        <button onClick={ev => { ev.stopPropagation(); onMove!(new Date()) }}
          className="text-[11.5px] font-bold text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 rounded-lg px-2.5 py-1.5 shrink-0 whitespace-nowrap hover:bg-primary-100 dark:hover:bg-primary-900/40">
          <span className="hidden sm:inline">На </span>сегодня
        </button>
      )}

      {canAct ? (
        <button onClick={ev => { ev.stopPropagation(); setMenu(v => !v) }} title="Ещё"
          className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-primary-600 hover:border-primary-400 flex items-center justify-center shrink-0 transition">
          <MoreHorizontal size={16} />
        </button>
      ) : (
        <button onClick={ev => { ev.stopPropagation(); onInfo() }} title="Подробнее"
          className="w-8 h-8 rounded-lg border border-surface-200 dark:border-surface-600 bg-surface-100 dark:bg-surface-700/60 text-surface-400 hover:text-primary-600 hover:border-primary-400 flex items-center justify-center shrink-0 transition">
          <Info size={16} />
        </button>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={ev => { ev.stopPropagation(); setMenu(false) }} />
          <div onClick={ev => ev.stopPropagation()} className="absolute right-2 top-full mt-1 z-40 w-[236px] rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-1.5">
            {!cancelled && !done && (
              <>
                <p className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-surface-400 dark:text-surface-500">Перенести</p>
                <button onClick={pick(() => onMove!(new Date()))} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800">
                  <CalendarDays size={14} className="text-surface-400" /> На сегодня
                </button>
                <button onClick={pick(() => onMove!(tomorrow))} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800">
                  <CalendarDays size={14} className="text-surface-400" /> На завтра, {format(tomorrow, 'd MMMM', { locale: ru })}
                </button>
                <label className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800 cursor-pointer">
                  <CalendarDays size={14} className="text-surface-400" /> Выбрать дату
                  <input type="date" className="ml-auto w-[104px] bg-transparent text-[12px] text-surface-500 dark:text-surface-400 outline-none"
                    onChange={ev => { const v = ev.target.value; if (v) { setMenu(false); onMove!(new Date(v + 'T00:00:00')) } }} />
                </label>
                <div className="h-px bg-surface-100 dark:bg-surface-800 my-1.5 mx-2" />
              </>
            )}
            <button onClick={pick(onInfo)} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-surface-700 dark:text-surface-200 hover:bg-surface-50 dark:hover:bg-surface-800">
              <Info size={14} className="text-surface-400" /> Подробнее
            </button>
            {cancelled ? (
              <button onClick={pick(() => onCancel!(false))} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
                <RotateCcw size={14} /> Вернуть в работу
              </button>
            ) : (
              <button onClick={pick(() => onCancel!(true))} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
                <Ban size={14} /> Отменить задачу
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Строка сторис: точки нормы + счётчик ──
function StoryRow({ name, color, count, target, onSet }: {
  name: string; color: string; count: number; target: number; onSet: (n: number) => void
}) {
  const full = count >= target
  const over = count > target
  const total = Math.max(target, count)
  const label = over ? `сверх нормы ${count - target}`
    : full ? 'норма закрыта'
    : `осталось ${target - count} из ${target}`
  return (
    <div className={clsx('flex items-center gap-3 rounded-xl border px-3 py-2',
      full ? 'bg-green-50/60 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
        : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <div className="min-w-0 flex-1">
        <p className={clsx('text-[13.5px] font-semibold truncate', full ? 'text-surface-500 dark:text-surface-400' : 'text-surface-800 dark:text-surface-200')}>{name}</p>
        <p className={clsx('text-[11px] font-semibold leading-tight',
          over ? 'text-primary-600 dark:text-primary-400'
            : full ? 'text-green-600 dark:text-green-400'
            : 'text-amber-600 dark:text-amber-500')}>{label}</p>
      </div>
      {/* Точки = норма. Нажатие ставит это число, нажатие по последней горящей — снимает.
          Длинные нормы прячем на узком экране, чтобы строка не ломалась. */}
      {total <= 8 && (
        <div className={clsx('gap-1.5 shrink-0', total <= 2 ? 'flex' : 'hidden min-[420px]:flex')}>
          {Array.from({ length: total }, (_, i) => i + 1).map(i => (
            <button key={i} onClick={() => onSet(i === count ? i - 1 : i)}
              title={`Отметить ${i}`} aria-label={`Отметить ${i}`}
              className={clsx('w-[22px] h-[22px] rounded-full border-2 transition hover:scale-110',
                i > count ? 'border-amber-300 dark:border-amber-700/70 bg-transparent'
                  : i > target ? 'bg-primary-500 border-primary-500'
                  : 'bg-green-500 border-green-500')} />
          ))}
        </div>
      )}
      <div className="flex items-center gap-0.5 shrink-0 bg-surface-100 dark:bg-surface-700/60 rounded-lg p-0.5 border border-surface-200 dark:border-surface-600/50">
        <button onClick={() => onSet(count - 1)} disabled={count <= 0} aria-label="Убрать одну сторис"
          className="w-6 h-6 rounded-md flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-600 disabled:opacity-30"><Minus size={13} /></button>
        <span className="min-w-[22px] text-center text-[13px] font-bold tabular-nums text-surface-900 dark:text-surface-100">{count}</span>
        <button onClick={() => onSet(count + 1)} aria-label="Добавить одну сторис"
          className="w-6 h-6 rounded-md flex items-center justify-center text-surface-500 dark:text-surface-300 hover:bg-white dark:hover:bg-surface-600"><Plus size={13} /></button>
      </div>
    </div>
  )
}

/** Запись журнала в человеческую фразу. */
function historyText(h: any): string {
  if (h.kind === 'move') return `перенесено с ${shortDay(h.from) || '—'} на ${shortDay(h.to) || 'без даты'}`
  if (h.kind === 'status') {
    if (h.to === 'published') return 'отмечено готовым'
    if (h.to === 'cancelled') return 'задача отменена'
    if (h.from === 'published') return 'отметка снята'
    if (h.from === 'cancelled') return 'возвращена в работу'
    return `статус: ${h.to}`
  }
  return 'изменение'
}

// ── Панель задачи: справа на компьютере, снизу на телефоне ──
function TaskPanel({ e, pos, total, onPrev, onNext, onClose, onToggle, onMove, onCancel }: {
  e: any; pos: number; total: number
  onPrev: () => void; onNext: () => void; onClose: () => void
  onToggle: () => void; onMove: (d: Date) => void; onCancel: (cancel: boolean) => void
}) {
  const { tag, group, descLabel } = taskInfo(e)
  const done = isDone(e)
  const cancelled = isCancelled(e)
  const canAct = !!e.itemId
  const desc = (e.scriptText && String(e.scriptText).trim()) || ''
  const caption = (e.caption && String(e.caption).trim()) || ''
  // Ссылку открываем только http(s): поле заполняют руками, javascript:-ссылка не должна пройти.
  const fileHref = typeof e.fileLink === 'string' && /^https?:\/\//i.test(e.fileLink.trim()) ? e.fileLink.trim() : null
  const todayKey = dk(new Date())
  const lateDays = !done && !cancelled && e.date && e.date < todayKey
    ? differenceInCalendarDays(new Date(todayKey + 'T00:00:00'), new Date(e.date + 'T00:00:00')) : 0

  const [picking, setPicking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [drag, setDrag] = useState(0)
  const startY = useRef<number | null>(null)

  // Переключились на другую задачу — сбрасываем раскрытые части.
  useEffect(() => { setPicking(false); setMenu(false); setShowHistory(false); setCopied(false) }, [e.id])

  // Esc закрывает, стрелки листают задачи дня. Пока печатают в поле даты — не мешаем.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (ev.key === 'Escape') onClose()
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); onNext() }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); onPrev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNext, onPrev])

  // На телефоне окно поверх страницы — страница под ним не должна прокручиваться.
  useEffect(() => {
    if (!window.matchMedia('(max-width: 639px)').matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const { data: history } = useQuery({
    queryKey: ['item-history', e.itemId],
    queryFn: () => contentPlanApi.itemHistory(e.itemId),
    enabled: !!e.itemId,
  })

  const move = (d: Date) => { setPicking(false); onMove(d) }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(caption)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Не удалось скопировать')
    }
  }

  const fullDay = (d?: string | null) => (d ? format(new Date(d + 'T00:00:00'), 'd MMMM, EEEEEE', { locale: ru }) : 'без даты')
  const whenLabel = e.kind === 'shoot' ? (group === 'design' ? 'дизайн' : 'съёмка') : 'публикация'

  const status = cancelled ? { text: 'Отменено', cls: 'bg-surface-100 dark:bg-surface-800 text-surface-500 border-surface-200 dark:border-surface-700' }
    : done ? { text: 'Готово', cls: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800/60' }
    : lateDays > 0 ? { text: `Просрочено · ${lateDays} ${plural(lateDays, 'день', 'дня', 'дней')}`, cls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900/60' }
    : { text: 'В работе', cls: 'bg-surface-50 dark:bg-surface-800 text-surface-500 dark:text-surface-400 border-surface-200 dark:border-surface-700' }

  const swipe = {
    onTouchStart: (ev: React.TouchEvent) => { startY.current = ev.touches[0].clientY },
    onTouchMove: (ev: React.TouchEvent) => { if (startY.current != null) setDrag(Math.max(0, ev.touches[0].clientY - startY.current)) },
    onTouchEnd: () => { if (drag > 90) onClose(); setDrag(0); startY.current = null },
  }
  const iconBtn = 'rounded-[14px] sm:rounded-xl border border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 flex items-center justify-center shrink-0 transition'

  return createPortal(
    <div className="fixed inset-0 z-[80] sm:inset-auto sm:top-0 sm:right-0 sm:bottom-0 sm:w-[470px] sm:max-w-full">
      {/* Затемнение только на телефоне: на компьютере список задач остаётся кликабельным. */}
      <div className="sm:hidden absolute inset-0 bg-black/60" onClick={onClose} />

      <div role="dialog" aria-label={taskTitle(e)}
        style={drag ? { transform: `translateY(${drag}px)` } : undefined}
        className={clsx('absolute inset-x-0 bottom-0 max-h-[88vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] shadow-2xl',
          'sm:static sm:h-full sm:max-h-none sm:rounded-none sm:border-l sm:border-surface-200 sm:dark:border-surface-700',
          !drag && 'transition-transform duration-200')}>

        {/* Компьютер: навигация по задачам дня */}
        <div className="hidden sm:flex items-center gap-2 px-4 py-3 border-b border-surface-100 dark:border-surface-800">
          <button onClick={onPrev} disabled={pos <= 1} title="Предыдущая задача (↑)" className={clsx(iconBtn, 'w-8 h-8 disabled:opacity-30')}><ChevronUp size={16} /></button>
          <button onClick={onNext} disabled={pos >= total} title="Следующая задача (↓)" className={clsx(iconBtn, 'w-8 h-8 disabled:opacity-30')}><ChevronDown size={16} /></button>
          <span className="text-[12.5px] font-semibold text-surface-500 dark:text-surface-400">{pos} из {total}</span>
          <button onClick={onClose} title="Закрыть (Esc)" className="ml-auto w-8 h-8 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 flex items-center justify-center"><X size={15} /></button>
        </div>

        {/* Шапка: на телефоне за неё можно потянуть вниз, чтобы закрыть */}
        <div className="px-4 sm:px-5 pb-3 sm:pt-4 touch-none sm:touch-auto" {...swipe}>
          <div className="sm:hidden pt-2 pb-2"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
          <div className="flex items-center gap-1.5">
            <span className={clsx('text-[10px] font-extrabold uppercase tracking-wide px-2 py-[3px] rounded-md', GROUP_CLS[group])}>{tag}</span>
            <span className={clsx('text-[10px] font-extrabold uppercase tracking-wide px-2 py-[2px] rounded-md border', status.cls)}>{status.text}</span>
            <button onClick={onClose} title="Закрыть" className="sm:hidden ml-auto w-[30px] h-[30px] rounded-full bg-surface-100 dark:bg-surface-800 text-surface-500 flex items-center justify-center"><X size={14} /></button>
          </div>
          <h3 className="mt-2 text-[20px] sm:text-[21px] font-extrabold leading-tight tracking-tight text-surface-900 dark:text-surface-100 [text-wrap:balance]">{taskTitle(e)}</h3>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[13px] text-surface-500 dark:text-surface-400">
            <i className="w-[7px] h-[7px] rounded-full inline-block" style={{ background: projColor(e.projectId) }} />
            <b className="font-semibold text-surface-800 dark:text-surface-200">{e.projectName}</b>
            <span>· {whenLabel}</span>
            <button onClick={() => canAct && !done && !cancelled && setPicking(v => !v)}
              disabled={!canAct || done || cancelled}
              title={canAct && !done && !cancelled ? 'Перенести на другую дату' : undefined}
              className="font-semibold text-primary-600 dark:text-primary-400 border-b border-dashed border-primary-300 dark:border-primary-700 disabled:text-surface-700 dark:disabled:text-surface-300 disabled:border-transparent">
              {fullDay(e.date)}{e.kind === 'shoot' && e.time ? `, ${e.time}` : ''}
            </button>
          </div>
          {e.kind === 'shoot' && e.reelDate && (
            <p className="mt-1 text-[12px] text-surface-400 dark:text-surface-500">
              для {group === 'design' ? 'поста' : 'рилса'} · публикация {shortDay(e.reelDate)}
            </p>
          )}
          {picking && (
            <div className="mt-3 flex items-center gap-2 flex-wrap rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 p-2">
              <button onClick={() => move(new Date())} className="h-9 px-3 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 text-[12.5px] font-semibold text-surface-700 dark:text-surface-200">Сегодня</button>
              <button onClick={() => move(addDays(new Date(), 1))} className="h-9 px-3 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 text-[12.5px] font-semibold text-surface-700 dark:text-surface-200">Завтра</button>
              <input type="date" defaultValue={e.date || undefined}
                onChange={ev => { const v = ev.target.value; if (v) move(new Date(v + 'T00:00:00')) }}
                className="ml-auto h-9 px-2 rounded-lg bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 text-[12.5px] text-surface-700 dark:text-surface-200" />
            </div>
          )}
        </div>

        {/* Содержимое прокручивается, кнопки внизу остаются на месте */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 sm:px-5 py-3.5 space-y-4">
          <section>
            <p className="text-[11px] font-extrabold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-1.5">{descLabel}</p>
            {desc ? (
              <p className="text-[14.5px] sm:text-[14px] leading-relaxed whitespace-pre-wrap text-surface-800 dark:text-surface-200">{desc}</p>
            ) : (
              <p className="text-[13px] italic text-surface-400 dark:text-surface-500">Описание пока не заполнено — добавьте его в контент-плане проекта.</p>
            )}
          </section>

          {caption && (
            <section>
              <div className="flex items-center mb-1.5">
                <p className="text-[11px] font-extrabold uppercase tracking-wide text-surface-400 dark:text-surface-500">Подпись к публикации</p>
                <button onClick={copy}
                  className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 text-[12px] font-bold hover:bg-primary-100 dark:hover:bg-primary-900/40">
                  {copied ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />}{copied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
              <p className="text-[14.5px] sm:text-[14px] leading-relaxed whitespace-pre-wrap text-surface-800 dark:text-surface-200">{caption}</p>
            </section>
          )}

          {fileHref && (
            <a href={fileHref} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2.5 h-11 px-3 rounded-xl border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-800 text-[13px]">
              <Paperclip size={15} className="text-surface-400 shrink-0" />
              <span className="flex-1 min-w-0 truncate font-semibold text-surface-800 dark:text-surface-200">{fileHref.replace(/^https?:\/\//i, '')}</span>
              <span className="text-[12.5px] font-bold text-primary-600 dark:text-primary-400 shrink-0">Открыть</span>
            </a>
          )}

          {Array.isArray(history) && history.length > 0 && (
            <section className="border-t border-dashed border-surface-200 dark:border-surface-700 pt-1">
              <button onClick={() => setShowHistory(v => !v)} className="w-full flex items-center gap-2 h-10 text-[13px] text-surface-500 dark:text-surface-400">
                <HistoryIcon size={14} className="shrink-0" />
                <b className="font-semibold text-surface-800 dark:text-surface-200">История</b>
                <span className="truncate">· {historyText(history[0])}</span>
                <ChevronDown size={14} className={clsx('ml-auto shrink-0 transition-transform', showHistory && 'rotate-180')} />
              </button>
              {showHistory && (
                <div className="space-y-1.5 pb-1">
                  {history.map((h: any, i: number) => (
                    <div key={i} className="flex items-baseline gap-2 text-[12px]">
                      <span className="text-surface-400 dark:text-surface-500 tabular-nums shrink-0">{h.at}</span>
                      <span className="text-surface-700 dark:text-surface-300 min-w-0">{historyText(h)}</span>
                      {h.who && <span className="text-surface-400 dark:text-surface-500 ml-auto shrink-0">{h.who}</span>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Действия. На телефоне отступ под полоску айфона. */}
        <div className="flex items-center gap-2 px-4 sm:px-5 pt-3 pb-[max(14px,env(safe-area-inset-bottom))] sm:pb-3.5 border-t border-surface-100 dark:border-surface-800">
          {cancelled ? (
            <button onClick={() => onCancel(false)} disabled={!canAct}
              className="flex-1 h-[50px] sm:h-[42px] rounded-[14px] sm:rounded-xl border border-primary-200 dark:border-primary-800 text-primary-600 dark:text-primary-400 text-[15px] sm:text-[13.5px] font-bold flex items-center justify-center gap-2">
              <RotateCcw size={15} /> Вернуть в работу
            </button>
          ) : (
            <button onClick={onToggle} disabled={!canAct}
              className={clsx('flex-1 h-[50px] sm:h-[42px] rounded-[14px] sm:rounded-xl text-[15px] sm:text-[13.5px] font-bold flex items-center justify-center gap-2 transition disabled:opacity-40',
                done ? 'border border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300'
                  : 'bg-green-500 hover:bg-green-600 text-white')}>
              {done ? 'Снять отметку' : (<><Check size={16} strokeWidth={3} /><span className="sm:hidden">Готово</span><span className="hidden sm:inline">Отметить готовым</span></>)}
            </button>
          )}

          {canAct && !done && !cancelled && (
            <button onClick={() => setPicking(v => !v)} title="Перенести"
              className={clsx(iconBtn, 'w-[50px] h-[50px] sm:w-auto sm:h-[42px] sm:px-3.5 gap-1.5', picking && 'border-primary-400 text-primary-600 dark:text-primary-400')}>
              <CalendarDays size={17} /><span className="hidden sm:inline text-[13px] font-semibold">Перенести</span>
            </button>
          )}

          {canAct && !done && (
            <div className="relative shrink-0">
              <button onClick={() => setMenu(v => !v)} title="Ещё" className={clsx(iconBtn, 'w-[50px] h-[50px] sm:w-[42px] sm:h-[42px]')}>
                <MoreHorizontal size={17} />
              </button>
              {menu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 bottom-full mb-2 z-20 w-[210px] rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 shadow-xl p-1.5">
                    {cancelled ? (
                      <button onClick={() => { setMenu(false); onCancel(false) }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20">
                        <RotateCcw size={14} /> Вернуть в работу
                      </button>
                    ) : (
                      <button onClick={() => { setMenu(false); onCancel(true) }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Ban size={14} /> Отменить задачу
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
