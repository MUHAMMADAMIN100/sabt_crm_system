// Кабинет производства — видеограф, монтажёр, дизайнер.
//
// Один компонент на три роли намеренно: показываем не «задачи роли», а то,
// что назначено ЛИЧНО человеку (content_plan_items.assigneeId). Поэтому
// «Видеограф / Монтажёр» второй ролью видит и съёмки, и монтаж в одном
// списке — ярлык у каждой карточки свой, и разделять кабинеты не нужно.
//
// Строение повторяет кабинет СММ-специалиста: цифры дня, мини-месяц,
// модальное окно дня, просрочка. Но ячейка календаря другая: у этих людей
// задача всегда одного вида, и точки по ТИПАМ ничего не говорят. Вместо них
// точки-прогресс — одна на задачу: зелёная сделана, цвет роли в работе,
// красный контур просрочена. Видно и объём дня, и сколько уже закрыто.
import { useMemo, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday,
  addMonths, format, subDays, differenceInCalendarDays,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  Camera, Scissors, Palette, Film, Image as ImageIcon,
  ChevronLeft, ChevronRight, AlertTriangle, X,
} from 'lucide-react'
import clsx from 'clsx'
import { contentPlanApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { TaskPanel, TaskRow } from './SmmSpecialistDashboard'

const dk = (d: Date) => format(d, 'yyyy-MM-dd')
const WEEK = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

type Item = {
  id: string; projectId: string; projectName: string
  stage: 'shoot' | 'edit' | 'design' | null
  topic: string | null; status: string; date: string
  time: string | null; durationMin: number | null
  contentType?: string | null
  parentId: string | null; parentTopic: string | null; parentType: string | null
  parentDate: string | null; scriptText: string | null
  caption?: string | null; fileLink?: string | null
  assigneeId?: string | null; assigneeName?: string | null
}

/** Карточка → событие календаря, каким его ждёт панель задачи из кабинета
 *  СММ. Панель одна на оба кабинета, чтобы дизайнер видел то же, что и
 *  специалист: описание, подпись, файл, историю. */
function toEvent(it: Item) {
  return {
    id: it.id, itemId: it.id,
    kind: it.stage ? 'shoot' : 'publication',
    prepStage: it.stage, parentKind: it.parentType,
    contentType: it.contentType === 'reel' ? 'reel' : 'design',
    title: it.parentTopic, topic: it.topic,
    projectId: it.projectId, projectName: it.projectName,
    date: it.date, time: it.time, durationMin: it.durationMin, reelDate: it.parentDate,
    status: it.status, scriptText: it.scriptText, caption: it.caption ?? null, fileLink: it.fileLink ?? null,
  }
}

/** Ярлык, иконка и цвет по этапу. Карточка без этапа — это публикация,
 *  назначенная лично (пока такого не бывает, но пусть не ломается). */
// rgb — для тепловой заливки ячейки (насыщенность считается от числа задач,
// поэтому цвет задаётся инлайном, а не классом).
const STAGE = {
  shoot:  { label: 'Съёмка', Icon: Camera,   cls: 'text-lime-600 dark:text-lime-400 bg-lime-500/12',          rgb: '132,204,22' },
  edit:   { label: 'Монтаж', Icon: Scissors, cls: 'text-violet-500 dark:text-violet-400 bg-violet-500/12',    rgb: '139,92,246' },
  design: { label: 'Дизайн', Icon: Palette,  cls: 'text-fuchsia-500 dark:text-fuchsia-400 bg-fuchsia-500/12', rgb: '217,70,239' },
} as const

type Meta = { label: string; Icon: any; cls: string; rgb: string }
function meta(it: Item): Meta {
  if (it.stage && STAGE[it.stage]) return STAGE[it.stage]
  return it.contentType === 'reel'
    ? { label: 'Рилс', Icon: Film, cls: 'text-blue-500 dark:text-blue-400 bg-blue-500/12', rgb: '59,130,246' }
    : { label: 'Макет', Icon: ImageIcon, cls: 'text-amber-500 dark:text-amber-400 bg-amber-500/12', rgb: '245,158,11' }
}

export default function ProductionDashboard() {
  const user = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const [cursor, setCursor] = useState(() => new Date())
  const [sel, setSel] = useState(() => new Date())
  const [dayOpen, setDayOpen] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const closeDay = () => { setDayOpen(false); setOpenId(null) }
  // Просрочка, закрытая в этой сессии: строка не исчезает, а остаётся
  // зачёркнутой — так видно, что именно сделал, и можно снять отметку,
  // если промахнулся. После перезагрузки страницы сделанное уходит из блока.
  const [keep, setKeep] = useState<Set<string>>(() => new Set())
  // Escape закрывает окно дня — но если поверх открыта панель задачи, Escape
  // закрывает сначала её (панель слушает клавишу сама).
  useEffect(() => {
    if (!dayOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !openId) setDayOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dayOpen, openId])

  const from = dk(startOfMonth(cursor))
  const to = dk(endOfMonth(cursor))
  const selKey = dk(sel)
  const todayKey = dk(new Date())

  // Основного видеографа назначает руководитель видеографии (основатель и
  // админ — запасной ключ). Передать же СВОЮ съёмку может сам исполнитель:
  // ради этого всё и затевалось — основной отдаёт напарнику то, что не
  // успевает. Оба правила проверяются и на сервере.
  const canManage = ['video_director', 'admin', 'founder', 'co_founder']
    .some(r => r === user?.role || r === user?.secondaryRole)
  const isVideo = ['videographer', 'video_director']
    .some(r => r === user?.role || r === user?.secondaryRole)
  const { data: assignees } = useQuery({
    queryKey: ['shoot-assignees'],
    queryFn: () => contentPlanApi.shootAssignees(),
    enabled: canManage || isVideo,
    staleTime: 5 * 60_000,
  })
  const candidates = (assignees?.candidates ?? []) as { id: string; name: string; avatar?: string | null }[]
  const defaultVideographerId: string | null = assignees?.defaultId ?? null
  /** Съёмку передаёт её исполнитель или тот, кто распоряжается съёмками. */
  const canGiveItem = (it: Item) => it.stage === 'shoot' && (canManage || it.assigneeId === user?.id)

  const { data } = useQuery({ queryKey: ['my-work', from, to], queryFn: () => contentPlanApi.myWork(from, to) })
  // Просрочку ищем шире месяца: задача могла повиснуть в прошлом.
  const overdueFrom = useMemo(() => dk(subDays(new Date(), 90)), [])
  const { data: pastData } = useQuery({
    queryKey: ['my-work-overdue', overdueFrom, todayKey],
    queryFn: () => contentPlanApi.myWork(overdueFrom, todayKey),
  })

  const items: Item[] = data?.items ?? []
  const byDay = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const it of items) if (it.date) (m[it.date] ||= []).push(it)
    return m
  }, [items])

  const overdue = useMemo(() => {
    const list = (pastData?.items ?? []) as Item[]
    return list
      .filter(it => it.date && it.date < todayKey && (!isDone(it) || keep.has(it.id)) && !isCancelled(it))
      .sort((a, b) => a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName, 'ru') || a.id.localeCompare(b.id))
  }, [pastData, todayKey, keep])
  // В счётчике и на календаре — только несделанное; закрытое в этой сессии
  // считаем отдельно для строки «сегодня закрыто N».
  const overdueOpen = useMemo(() => overdue.filter(it => !isDone(it)), [overdue])
  const closedToday = overdue.length - overdueOpen.length
  const overdueByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const it of overdueOpen) m[it.date] = (m[it.date] || 0) + 1
    return m
  }, [overdueOpen])

  const todayItems = byDay[todayKey] || []
  const todayLeft = todayItems.filter(it => !isDone(it) && !isCancelled(it)).length
  const monthDone = items.filter(isDone).length

  // Оптимистичные мутации: галочка и перенос меняют кэш СРАЗУ, сервер
  // догоняет. Раньше интерфейс ждал сохранение и полную перезагрузку двух
  // списков — с задержкой до Railway это выглядело как «ничего не нажалось».
  const KEY_MONTH = ['my-work', from, to] as const
  const KEY_OVER = ['my-work-overdue', overdueFrom, todayKey] as const
  const snapshot = async () => {
    await qc.cancelQueries({ queryKey: ['my-work'] })
    await qc.cancelQueries({ queryKey: ['my-work-overdue'] })
    return { month: qc.getQueryData<any>(KEY_MONTH), over: qc.getQueryData<any>(KEY_OVER) }
  }
  const patchItem = (id: string, fn: (it: Item) => Item) => {
    const patch = (old: any) => old ? { ...old, items: (old.items || []).map((it: Item) => it.id === id ? fn(it) : it) } : old
    qc.setQueryData<any>(KEY_MONTH, patch)
    qc.setQueryData<any>(KEY_OVER, patch)
  }
  const rollback = (ctx: any) => {
    if (ctx?.month) qc.setQueryData(KEY_MONTH, ctx.month)
    if (ctx?.over) qc.setQueryData(KEY_OVER, ctx.over)
  }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-work'] })
    qc.invalidateQueries({ queryKey: ['my-work-overdue'] })
  }
  const toggle = useMutation({
    mutationFn: (v: { id: string; done: boolean }) => contentPlanApi.myWorkUpdate(v.id, { done: v.done }),
    onMutate: async (v) => {
      const ctx = await snapshot()
      patchItem(v.id, it => ({ ...it, status: v.done ? 'published' : 'planned' }))
      return ctx
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  })
  const setDefault = useMutation({
    mutationFn: (uid: string | null) => contentPlanApi.setDefaultVideographer(uid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shoot-assignees'] }); refresh() },
  })
  // Передача съёмки: карточка уходит из моего кабинета — убираем её из
  // списков сразу, не дожидаясь ответа.
  const give = useMutation({
    mutationFn: (v: { id: string; userId: string | null }) => contentPlanApi.reassignShoot(v.id, v.userId),
    onMutate: async (v) => {
      const ctx = await snapshot()
      if (v.userId !== user?.id) {
        const drop = (old: any) => old ? { ...old, items: (old.items || []).filter((it: Item) => it.id !== v.id) } : old
        qc.setQueryData<any>(KEY_MONTH, drop)
        qc.setQueryData<any>(KEY_OVER, drop)
      }
      return ctx
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  })
  const move = useMutation({
    mutationFn: (v: { id: string; date: string }) => contentPlanApi.myWorkUpdate(v.id, { date: v.date }),
    onMutate: async (v) => {
      const ctx = await snapshot()
      patchItem(v.id, it => ({ ...it, date: v.date, status: 'planned' }))
      return ctx
    },
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: refresh,
  })

  const days = eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) })
  const pad = (getDay(startOfMonth(cursor)) + 6) % 7
  const goMonth = (n: number) => setCursor(c => addMonths(c, n))
  // Порядок строго детерминирован: время → проект → название → id. Без
  // этого после отметки строки менялись местами — сервер отдавал задачи
  // одной даты в том порядке, в каком они лежат в базе, а он плавает.
  // Окно переноса исполнителя: от сегодня до дня выхода публикации.
  const windowOf = (it: Item) => ({ min: todayKey, max: it.parentDate })
  const selItems = (byDay[selKey] || []).slice().sort((a, b) =>
    (a.time || '99').localeCompare(b.time || '99')
    || a.projectName.localeCompare(b.projectName, 'ru')
    || titleOf(a).localeCompare(titleOf(b), 'ru')
    || a.id.localeCompare(b.id))
  // Панель листает стрелками тот список, из которого её открыли.
  const navList: Item[] = dayOpen ? selItems : overdue
  const openIdx = openId ? navList.findIndex(it => it.id === openId) : -1
  const openItem = openIdx >= 0 ? navList[openIdx] : null

  return (
    <div className="space-y-4">
      {/* Сводка дня */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold">Сегодня</h1>
            <p className="text-[12.5px] text-surface-500 dark:text-surface-400">
              {todayLeft > 0
                ? `Осталось: ${todayLeft} ${plural(todayLeft, 'задача', 'задачи', 'задач')}`
                : todayItems.length > 0 ? 'Всё на сегодня сделано' : 'На сегодня задач нет'}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Tile value={String(overdueOpen.length)}
              label={overdueOpen.length > 0 ? 'просрочено' : 'просрочено · всё в срок'}
              tone={overdueOpen.length > 0 ? 'bad' : 'ok'} />
            <Tile value={String(monthDone)} label={`сдано за ${format(cursor, 'LLLL', { locale: ru })}`} tone={monthDone > 0 ? 'ok' : undefined} />
            <Tile value={String(todayItems.length)} label="задач сегодня" />
          </div>
        </div>
      </div>

      {/* Кто отвечает за съёмки по умолчанию. Видит только тот, кто ими
          распоряжается; смена сразу переносит будущие незакрытые съёмки. */}
      {canManage && candidates.length > 0 && (
        <div className="card flex flex-wrap items-center gap-2.5 py-2.5">
          <span className="text-[12.5px] text-surface-500 dark:text-surface-400">Съёмки по умолчанию на</span>
          <select
            value={defaultVideographerId ?? ''}
            onChange={e => setDefault.mutate(e.target.value || null)}
            disabled={setDefault.isPending}
            className="input py-1 px-2 text-[13px] font-semibold min-h-0 w-auto"
          >
            <option value="">— не выбран —</option>
            {candidates.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <span className="text-[11.5px] text-surface-400 dark:text-surface-500">
            {setDefault.isPending ? 'сохраняем…'
              : setDefault.data?.moved
                ? `перенесено съёмок: ${setDefault.data.moved}`
                : 'новые съёмки закрепляются за ним; он передаёт, если не успевает'}
          </span>
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
            const list = byDay[key] || []
            const late = overdueByDay[key] || 0
            const t = isToday(d)
            // Отменённые в точках не показываем — это не работа на день.
            const dots = list.filter(it => !isCancelled(it))
            const MAX_DOTS = 8
            return (
              <button
                key={key}
                onClick={() => { setSel(d); setDayOpen(true) }}
                className={clsx(
                  'min-h-[58px] rounded-xl border p-1.5 flex flex-col text-left transition bg-surface-50 dark:bg-surface-800/40',
                  // Сегодня — рамка с ореолом; выбранный день не подсвечиваем: его
                  // показывает открытое окно.
                  t ? 'border-primary-500 ring-[3px] ring-primary-500/20'
                    : late > 0 ? 'border-red-300 dark:border-red-800/70'
                    : 'border-surface-100 dark:border-surface-700/60 hover:border-surface-300 dark:hover:border-surface-600',
                )}
              >
                <span className={clsx('text-[11px] font-bold text-right leading-none', t ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400 dark:text-surface-500')}>{format(d, 'd')}</span>
                {/* Точки-прогресс: одна на задачу. Зелёная — сделана, цвет роли —
                    в работе, красный контур — просрочена. Больше восьми — «+N». */}
                {dots.length > 0 && (
                  <span className="mt-auto flex flex-wrap items-center gap-[3px]">
                    {dots.slice(0, MAX_DOTS).map(it => {
                      const done = isDone(it)
                      const lateOne = !done && it.date < todayKey
                      return (
                        <i key={it.id} className={clsx('w-[7px] h-[7px] rounded-[2px] shrink-0', done && 'bg-emerald-500', lateOne && 'border-[1.5px] border-red-500')}
                          style={!done && !lateOne ? { background: `rgb(${meta(it).rgb})` } : undefined} />
                      )
                    })}
                    {dots.length > MAX_DOTS && <span className="text-[9px] font-bold leading-none text-surface-400">+{dots.length - MAX_DOTS}</span>}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Окно дня — снизу на телефоне, по центру на компьютере; как у СММ. */}
      {dayOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeDay} />
          <div role="dialog" aria-label="Задачи дня"
            className="relative w-full sm:max-w-2xl max-h-[88vh] sm:max-h-[85vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] sm:rounded-2xl sm:border border-surface-200 dark:border-surface-700 shadow-2xl">
            <div className="sm:hidden pt-2 pb-1"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
            <div className="flex items-baseline gap-2.5 px-4 sm:px-5 pt-3 sm:pt-4 pb-3">
              <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 first-letter:uppercase">
                {isToday(sel) ? 'Сегодня' : format(sel, 'd MMMM, EEEE', { locale: ru })}
              </h2>
              <span className="text-xs text-surface-400 dark:text-surface-500">
                {selItems.filter(isDone).length}/{selItems.length} {plural(selItems.length, 'задача', 'задачи', 'задач')}
              </span>
              <button onClick={closeDay} title="Закрыть"
                className="ml-auto w-8 h-8 shrink-0 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 flex items-center justify-center self-center"><X size={15} /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 sm:px-5 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
              <div className="text-[11px] font-bold uppercase tracking-wide text-surface-400 dark:text-surface-500 mb-2">Задачи</div>
              {selItems.length === 0 ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-6">На этот день задач нет</p>
              ) : (
                <div className="space-y-2">
                  {selItems.map(it => (
                    <TaskRow key={it.id} e={toEvent(it)} canCancel={false} moveWindow={windowOf(it)}
                      showAssignee={canManage && it.stage === 'shoot'} assigneeName={it.assigneeName}
                      onToggle={() => toggle.mutate({ id: it.id, done: !isDone(it) })}
                      onInfo={() => setOpenId(it.id)}
                      onMove={d => move.mutate({ id: it.id, date: dk(d) })} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Просрочки нет — тревожный блок не показываем вовсе (решение владельца,
          вариант «тихо и чисто»): одна спокойная строка под календарём. */}
      {overdueOpen.length === 0 && (
        <p className="text-[12.5px] text-center text-surface-500 dark:text-surface-400 -mt-1">
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">✓ Просрочки нет</span>
          {closedToday > 0 && <> · сегодня закрыто {closedToday}</>}
        </p>
      )}

      {/* Просроченное */}
      {overdueOpen.length > 0 && (
        <div className="card border-red-200/70 dark:border-red-900/40">
          <h2 className="text-sm font-bold mb-1 flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle size={15} /> Просрочено · {overdueOpen.length}
          </h2>
          <div className="space-y-2">
            {overdue.map(it => (
              <TaskRow key={it.id} e={toEvent(it)} canCancel={false} moveWindow={windowOf(it)}
                showAssignee={canManage && it.stage === 'shoot'} assigneeName={it.assigneeName}
                late={isDone(it) ? undefined : Math.max(1, differenceInCalendarDays(new Date(todayKey + 'T00:00:00'), new Date(it.date + 'T00:00:00')))}
                onToggle={() => {
                  const done = !isDone(it)
                  if (done) setKeep(prev => new Set(prev).add(it.id))
                  toggle.mutate({ id: it.id, done })
                }}
                onInfo={() => setOpenId(it.id)}
                onMove={d => move.mutate({ id: it.id, date: dk(d) })} />
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-surface-400 text-center pb-2">
        {isVideo
          ? 'Показаны задачи, назначенные лично вам — съёмку можно передать напарнику в карточке задачи'
          : 'Показаны задачи, назначенные лично вам'}
      </p>

      {/* Панель задачи — та же, что у СММ-специалиста. Отменять задачу
          исполнитель не может (canCancel=false), переносить свою — может. */}
      {openItem && (
        <TaskPanel
          e={toEvent(openItem)}
          pos={openIdx + 1}
          total={navList.length}
          onPrev={() => { if (openIdx > 0) setOpenId(navList[openIdx - 1].id) }}
          onNext={() => { if (openIdx < navList.length - 1) setOpenId(navList[openIdx + 1].id) }}
          onClose={() => setOpenId(null)}
          onToggle={() => toggle.mutate({ id: openItem.id, done: !isDone(openItem) })}
          onMove={d => move.mutate({ id: openItem.id, date: dk(d) })}
          onCancel={() => {}}
          canCancel={false}
          showFile={false}
          moveWindow={{ min: todayKey, max: openItem.parentDate }}
          assign={canGiveItem(openItem) ? {
            name: openItem.assigneeName,
            candidates,
            onPick: uid => { setOpenId(null); give.mutate({ id: openItem.id, userId: uid }) },
          } : undefined}
        />
      )}
    </div>
  )
}

function Tile({ value, label, tone }: { value: string; label: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-xl bg-surface-50 dark:bg-surface-800/40 border border-surface-100 dark:border-surface-700/60 px-3 py-2 min-w-[92px]">
      <b className={clsx('block text-[17px] font-bold tabular-nums leading-none',
        tone === 'bad' ? 'text-red-500 dark:text-red-400' : tone === 'ok' ? 'text-emerald-500 dark:text-emerald-400' : '')}>{value}</b>
      <span className="block text-[10px] text-surface-500 dark:text-surface-400 mt-1">{label}</span>
    </div>
  )
}
