// «Сегодня» — панель менеджера по продажам (Продажи, этап 2, 15.11.2026;
// макет «Роль менеджера продаж», SALES_SPEC §7).
//
// Главное на экране — что сделать сейчас: одна лента «Просрочено / Сегодня /
// Завтра» из дел по лидам (/sales/agenda), оплат своих клиентов и своих
// задач. Раньше менеджер собирал это сам из «Базы клиентов», календаря и
// «Панели», и встречи без итога терялись. Справа — план продаж, KPI с
// правилами счёта и оплаты клиентов; месяц оплат (прежняя «Панель») — под
// кнопкой «Календарь оплат», целиком, со своими задачами в днях.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarDays, Check, ChevronDown, Phone, PhoneCall, Plus, RotateCcw, UserPlus, X } from 'lucide-react'
import { addDays, differenceInCalendarDays, endOfMonth, format, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { projectsApi, smmPaymentsApi, type SalesCalPay } from '@/services/api.service'
import { salesApi } from '@/services/sales.api'
import { invalidateSales, salesKeys } from '@/lib/salesQueries'
import { AGENDA_KIND_LABEL, STATE_TONE } from '@/lib/salesStages'
import { useUrlFlag } from '@/lib/urlState'
import type { AgendaItem } from '@/types/sales'
import { Modal } from '@/components/ui'
import LeadDrawer from '@/components/sales/LeadDrawer'
import CallSheet from '@/components/sales/CallSheet'
import MeetingResultSheet from '@/components/sales/MeetingResultSheet'
import LeadCreateModal from '@/components/sales/LeadCreateModal'
import LeadPickerModal from '@/components/sales/LeadPickerModal'
import StageBadge from '@/components/sales/StageBadge'
import SalesPlanCard from '@/pages/profile/SalesPlanCard'
import { useOwnTasks, OwnDayTasks, OwnPopover, type OwnTask, type OwnTasksApi } from './OwnTasks'
import SalesKpi from './SalesKpi'
import SalesPayCalendar, { asDate, dk, money, payCalendarKey, payWhat, plural } from './SalesPayCalendar'

// ── Модель строки ленты ────────────────────────────────────────────────

type Group = 'overdue' | 'today' | 'tomorrow'
type Kind = 'meeting' | 'callback' | 'next_step' | 'payment' | 'own'
type Filter = 'all' | 'calls' | 'meetings' | 'payments'

type Row =
  | { kind: 'meeting' | 'callback' | 'next_step'; key: string; group: Group; ts: number; item: AgendaItem }
  | { kind: 'payment'; key: string; group: Group; ts: number; pay: SalesCalPay }
  | { kind: 'own'; key: string; group: Group; ts: number; task: OwnTask }

/** Вид дела: подпись и цвет точки. Встреча — фиолетовая, как в Календаре
 *  и на доске (STATE_TONE.meeting), чтобы один смысл был одного цвета. */
const KIND_META: Record<Kind, { label: string; dot: string }> = {
  meeting:   { label: AGENDA_KIND_LABEL.meeting,   dot: STATE_TONE.meeting.dot },
  callback:  { label: AGENDA_KIND_LABEL.callback,  dot: 'bg-orange-400' },
  next_step: { label: AGENDA_KIND_LABEL.next_step, dot: STATE_TONE.wait.dot },
  payment:   { label: 'Оплата',                    dot: 'bg-emerald-400' },
  own:       { label: 'Своя задача',               dot: 'bg-surface-400' },
}

const GROUP_TITLE: Record<Group, string> = { overdue: 'Просрочено', today: 'Сегодня', tomorrow: 'Завтра' }

const FILTERS: Array<{ value: Filter; label: string; kinds: Kind[] | null }> = [
  { value: 'all',      label: 'Все',     kinds: null },
  { value: 'calls',    label: 'Звонки',  kinds: ['callback'] },
  { value: 'meetings', label: 'Встречи', kinds: ['meeting'] },
  { value: 'payments', label: 'Оплаты',  kinds: ['payment'] },
]

/** Время дела: свой день — 23:59, чтобы дела без часа стояли после дел со временем. */
const dayEndTs = (day: string) => new Date(`${day}T23:59:00`).getTime()

/** Сумма оплат и признак «часть сумм скрыта сервером». */
function paySum(list: SalesCalPay[]): { sum: number; known: boolean } {
  return {
    sum: list.reduce((s, p) => s + (p.amount ?? 0), 0),
    known: list.some(p => p.amount != null),
  }
}

/** Данные для шторки звонка — из строки ленты. */
type CallLead = { id: string; name: string; status: string; contactPhone?: string | null }
const callLeadOf = (it: AgendaItem): CallLead => ({ id: it.leadId, name: it.leadName, status: it.status, contactPhone: it.phone })

export default function SalesManagerDashboard() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const uid = useId()
  const now = new Date()
  const todayKey = dk(now)
  const tomorrowKey = dk(addDays(now, 1))
  const monthFrom = dk(startOfMonth(now))
  const monthTo = dk(endOfMonth(now))

  // ── Данные ──
  const agendaQ = useQuery({
    queryKey: salesKeys.agenda(),
    queryFn: salesApi.agenda,
    staleTime: 30_000,
    refetchInterval: 5 * 60_000, // новые перезвоны и встречи — без перезагрузки
  })
  // Оплаты: текущий месяц (+ завтра, если оно уже в следующем). Ключ совпадает
  // с первым месяцем «Календаря оплат» — один и тот же запрос не идёт дважды.
  const payTo = tomorrowKey > monthTo ? tomorrowKey : monthTo
  const payQ = useQuery({
    queryKey: payCalendarKey(monthFrom, payTo),
    queryFn: () => smmPaymentsApi.calendar(monthFrom, payTo),
    staleTime: 60_000,
  })
  // Свои задачи — один экземпляр на ленту и календарь: отметка в одном месте
  // сразу видна в другом.
  const own = useOwnTasks(todayKey)

  // ── Окна ──
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null)
  const [callLead, setCallLead] = useState<CallLead | null>(null)
  const [meetingLead, setMeetingLead] = useState<{ id: string; name: string; nextContactAt?: string | null } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [pickCall, setPickCall] = useState(false)
  const [remindPay, setRemindPay] = useState<SalesCalPay | null>(null)
  const [ownPop, setOwnPop] = useState<HTMLElement | null>(null)
  const [ownSheet, setOwnSheet] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [showAllAttention, setShowAllAttention] = useState(false)
  // «Календарь оплат» открыт — в адресе: «Назад» из проекта возвращает его открытым.
  const [calOpen, setCalOpen] = useUrlFlag('payCal')
  const calId = `${uid}-paycal`

  const saved = () => invalidateSales(qc)
  const openProject = (p: SalesCalPay) => { if (p.projectId) navigate(`/smm/projects/${p.projectId}`) }
  const openCalendar = () => {
    setCalOpen(true)
    // Блок появится после рендера — прокручиваем к нему на следующем кадре.
    window.setTimeout(() => document.getElementById(calId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const addOwn = (el: HTMLElement) => {
    // Телефон: окошко у кнопки не помещается — шторка снизу.
    if (window.matchMedia('(max-width: 639px)').matches) setOwnSheet(true)
    else setOwnPop(el)
  }

  // ── Лента ──
  const agenda = agendaQ.data
  const pays = payQ.data?.items || []

  const rows = useMemo(() => {
    const list: Row[] = []
    if (agenda) {
      for (const g of ['overdue', 'today', 'tomorrow'] as Group[]) {
        for (const it of agenda[g] || []) {
          if (it.kind !== 'meeting' && it.kind !== 'callback' && it.kind !== 'next_step') continue
          list.push({ kind: it.kind, key: it.id, group: g, ts: it.at ? Date.parse(it.at) : dayEndTs(todayKey), item: it })
        }
      }
    }
    for (const p of pays) {
      const group: Group | null = p.state === 'late' ? 'overdue'
        : p.state === 'today' ? 'today'
        : p.state === 'wait' && p.date === tomorrowKey ? 'tomorrow' : null
      if (group) list.push({ kind: 'payment', key: `pay:${p.key}`, group, ts: dayEndTs(p.date), pay: p })
    }
    // Незакрытая своя задача прошлых дней уже переехала на сегодня (OwnTasks).
    for (const [day, group] of [[todayKey, 'today'], [tomorrowKey, 'tomorrow']] as Array<[string, Group]>) {
      for (const t of own.of(day)) {
        list.push({ kind: 'own', key: `own:${t.id}`, group, ts: t.time ? new Date(`${day}T${t.time}:00`).getTime() : dayEndTs(day), task: t })
      }
    }
    return list.sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key))
  }, [agenda, pays, own.byDay, todayKey, tomorrowKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const isOpenRow = (r: Row) => !(r.kind === 'own' && r.task.done)
  const actionable = rows.filter(r => r.group !== 'tomorrow' && isOpenRow(r))
  const overdueCount = actionable.filter(r => r.group === 'overdue').length
  const countOf = (f: (typeof FILTERS)[number]) => actionable.filter(r => !f.kinds || f.kinds.includes(r.kind)).length
  const activeFilter = FILTERS.find(f => f.value === filter) || FILTERS[0]
  const shown = rows.filter(r => !activeFilter.kinds || activeFilter.kinds.includes(r.kind))
  const loading = agendaQ.isLoading
  const nothingAtAll = !loading && rows.length === 0 && !agendaQ.isError

  // «Требует внимания»: один лид — одна строка, даже если у него и нет шага,
  // и нет касаний.
  const attention = useMemo(() => {
    const byLead = new Map<string, { item: AgendaItem; reasons: string[] }>()
    for (const it of agenda?.attention || []) {
      const cur = byLead.get(it.leadId)
      const reason = AGENDA_KIND_LABEL[it.kind] || ''
      if (cur) { if (!cur.reasons.includes(reason)) cur.reasons.push(reason) }
      else byLead.set(it.leadId, { item: it, reasons: [reason] })
    }
    return [...byLead.values()]
  }, [agenda])
  const attentionShown = showAllAttention ? attention : attention.slice(0, 5)

  // ── Оплаты моих клиентов ──
  const payGroups = useMemo(() => {
    const late = pays.filter(p => p.state === 'late')
    const today = pays.filter(p => p.state === 'today')
    const wait = pays.filter(p => p.state === 'wait' && p.date > todayKey && p.date <= monthTo)
    return { late, today, wait }
  }, [pays, todayKey, monthTo])

  const handlers: RowHandlers = {
    openLead: id => setDrawerLeadId(id),
    call: it => setCallLead(callLeadOf(it)),
    meeting: it => setMeetingLead({ id: it.leadId, name: it.leadName, nextContactAt: it.at }),
    remind: p => setRemindPay(p),
    openProject,
  }

  const summary = actionable.length === 0
    ? 'дел нет'
    : `${actionable.length} ${plural(actionable.length, 'дело', 'дела', 'дел')}${overdueCount ? ` · ${overdueCount} просрочено` : ''}`

  return (
    <div className="space-y-4">
      {/* Шапка: день и сколько дел. Кнопки — на компьютере; на телефоне те же
          действия под «+» нижней панели. */}
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] sm:text-2xl font-extrabold tracking-tight text-surface-900 dark:text-surface-50 leading-tight">Сегодня</h1>
          <p className="mt-0.5 text-[13px] text-surface-500 dark:text-surface-400">
            <span className="first-letter:uppercase inline-block">{format(now, 'EEEE, d MMMM', { locale: ru })}</span>
            {' · '}
            <span className={clsx(overdueCount > 0 && 'font-semibold', overdueCount > 0 ? STATE_TONE.late.text : '')}>{summary}</span>
          </p>
        </div>
        <div className="hidden lg:flex items-center gap-2">
          <button type="button" onClick={() => setPickCall(true)} className="btn-secondary">
            <PhoneCall size={15} /> Записать звонок
          </button>
          <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary">
            <UserPlus size={15} /> Новый лид
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        {/* ── Левая колонка: дела ── */}
        <div className="space-y-4 min-w-0">
          <section className="card" aria-labelledby={`${uid}-todo`}>
            <div className="flex items-center gap-2 mb-3">
              <h2 id={`${uid}-todo`} className="text-[15px] font-bold text-surface-900 dark:text-surface-100">Что сделать</h2>
              <button type="button" onClick={ev => addOwn(ev.currentTarget)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 h-11 sm:h-8 text-[13px] font-semibold text-primary-600 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                <Plus size={15} /> Своя задача
              </button>
            </div>

            {/* Фильтр — не скрывает дела насовсем: число у каждого вида видно сразу. */}
            <div role="group" aria-label="Какие дела показать" className="flex gap-1.5 overflow-x-auto hide-scrollbar -mx-1 px-1 pb-1 mb-2">
              {FILTERS.map(f => {
                const n = countOf(f)
                const on = filter === f.value
                return (
                  <button key={f.value} type="button" aria-pressed={on} onClick={() => setFilter(f.value)}
                    className={clsx('chip', on && 'chip-on')}>
                    {f.label}
                    {n > 0 && <span className={clsx('tabular-nums', on ? 'opacity-80' : 'text-surface-500 dark:text-surface-400')}>{n}</span>}
                  </button>
                )
              })}
            </div>

            {agendaQ.isError && (
              <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-900/10 px-3 py-2.5">
                <AlertTriangle size={16} className="text-red-500 dark:text-red-400 shrink-0" />
                <span className="flex-1 min-w-[180px] text-[13px] text-red-700 dark:text-red-300">Не удалось загрузить дела по лидам.</span>
                <button type="button" onClick={() => agendaQ.refetch()} className="btn-secondary max-sm:min-h-[44px]">
                  <RotateCcw size={14} /> Повторить
                </button>
              </div>
            )}

            {loading ? (
              <ul className="space-y-2" aria-label="Загрузка дел">
                {[0, 1, 2, 3].map(i => (
                  <li key={i} className="flex items-center gap-3 rounded-xl border border-surface-100 dark:border-surface-700/60 px-3 py-3">
                    <span className="skeleton h-4 w-10 shrink-0" />
                    <span className="flex-1 space-y-2">
                      <span className="skeleton block h-3 w-24" />
                      <span className="skeleton block h-4 w-3/5" />
                    </span>
                    <span className="skeleton h-9 w-24 shrink-0 hidden sm:block" />
                  </li>
                ))}
              </ul>
            ) : nothingAtAll ? (
              <div className="flex flex-col items-center text-center py-10 px-4">
                <span className="w-12 h-12 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 flex items-center justify-center mb-3">
                  <Check size={22} strokeWidth={2.5} />
                </span>
                <p className="text-[15px] font-semibold text-surface-900 dark:text-surface-100">На сегодня всё — можно взять новых лидов</p>
                <p className="mt-1 text-[13px] text-surface-500 dark:text-surface-400 max-w-sm">
                  Встреч, перезвонов, шагов и оплат на сегодня и завтра нет.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Link to="/clients" className="btn-secondary max-sm:min-h-[44px]">Открыть клиентов</Link>
                  <button type="button" onClick={() => setCreateOpen(true)} className="btn-primary max-sm:min-h-[44px]">
                    <UserPlus size={15} /> Новый лид
                  </button>
                </div>
              </div>
            ) : shown.length === 0 ? (
              // Лента не загрузилась и показать нечего — хватает плашки ошибки выше.
              agendaQ.isError && rows.length === 0 ? null : (
                <p className="py-8 text-center text-[13px] text-surface-500 dark:text-surface-400">По этому фильтру дел нет.</p>
              )
            ) : (
              <div className="space-y-4">
                {(['overdue', 'today', 'tomorrow'] as Group[]).map(g => {
                  const list = shown.filter(r => r.group === g)
                  if (list.length === 0) return null
                  return (
                    <div key={g}>
                      <h3 className={clsx('mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold',
                        g === 'overdue' ? STATE_TONE.late.text : 'text-surface-600 dark:text-surface-300')}>
                        {g === 'overdue' && <AlertTriangle size={13} />}
                        {GROUP_TITLE[g]} · {list.filter(isOpenRow).length}
                      </h3>
                      <ul className="space-y-2">
                        {list.map(r => <TodoRow key={r.key} row={r} todayKey={todayKey} own={own} h={handlers} />)}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Лиды, которые выпали из работы: без следующего шага или без касаний неделю. */}
          {attention.length > 0 && (
            <section className="card" aria-labelledby={`${uid}-attn`}>
              <div className="flex items-baseline gap-2 mb-1">
                <h2 id={`${uid}-attn`} className="text-[15px] font-bold text-surface-900 dark:text-surface-100">Требует внимания</h2>
                <span className="text-[13px] tabular-nums text-surface-500 dark:text-surface-400">{attention.length}</span>
              </div>
              <p className="text-[12.5px] text-surface-500 dark:text-surface-400 mb-3">
                Лиды без следующего шага или без касаний 7+ дней — назначьте, что дальше.
              </p>
              <ul className="space-y-2">
                {attentionShown.map(({ item: it, reasons }) => (
                  <li key={it.leadId} onClick={() => setDrawerLeadId(it.leadId)}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 rounded-xl border border-surface-100 dark:border-surface-700/60 bg-surface-50 dark:bg-surface-800/50 px-3 py-2.5 cursor-pointer hover:border-surface-300 dark:hover:border-surface-600 transition-colors">
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 min-w-0">
                        <button type="button" onClick={ev => { ev.stopPropagation(); setDrawerLeadId(it.leadId) }}
                          className="min-w-0 truncate text-left text-[14px] font-semibold text-surface-900 dark:text-surface-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                          {it.leadName}
                        </button>
                        <StageBadge status={it.status} className="shrink-0" />
                      </span>
                      <span className="mt-0.5 block text-[12.5px] text-amber-700 dark:text-amber-300">
                        {reasons.join(' · ')}
                        {it.potential ? <span className="text-surface-500 dark:text-surface-400"> · {money(it.potential)} с.</span> : null}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0 max-sm:basis-full max-sm:justify-end" onClick={ev => ev.stopPropagation()}>
                      {it.phone && <CallLink phone={it.phone} name={it.leadName} onCall={() => setCallLead(callLeadOf(it))} />}
                      <button type="button" onClick={ev => { ev.stopPropagation(); setDrawerLeadId(it.leadId) }}
                        className="btn-secondary h-11 sm:h-9 sm:min-h-0">
                        Назначить шаг
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {attention.length > 5 && (
                <button type="button" onClick={() => setShowAllAttention(v => !v)} aria-expanded={showAllAttention}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 h-11 sm:h-8 text-[13px] font-semibold text-primary-600 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30">
                  {showAllAttention ? 'Свернуть' : `Показать все · ${attention.length}`}
                  <ChevronDown size={14} className={clsx('transition-transform', showAllAttention && 'rotate-180')} />
                </button>
              )}
            </section>
          )}
        </div>

        {/* ── Правая колонка: план, KPI, оплаты ── */}
        <aside className="space-y-4 min-w-0" aria-label="План, KPI и оплаты">
          <SalesPlanCard alwaysShow />
          <SalesKpi />
          <PaymentsCard
            loading={payQ.isLoading}
            error={payQ.isError}
            onRetry={() => payQ.refetch()}
            groups={payGroups}
            noClients={payQ.data?.clients === 0}
            calOpen={calOpen}
            onOpenCalendar={openCalendar}
          />
        </aside>
      </div>

      {/* Месяц оплат и своих задач — прежняя «Панель» менеджера. */}
      <div>
        <button type="button" onClick={() => (calOpen ? setCalOpen(false) : openCalendar())} aria-expanded={calOpen} aria-controls={calId}
          className="w-full flex items-center gap-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-4 min-h-[48px] text-left hover:border-surface-300 dark:hover:border-surface-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          <CalendarDays size={17} className="text-surface-500 dark:text-surface-400 shrink-0" />
          <b className="text-[14px] font-semibold text-surface-900 dark:text-surface-100">Календарь оплат</b>
          <span className="hidden sm:inline text-[12.5px] text-surface-500 dark:text-surface-400">месяц: оплаты клиентов и свои задачи по дням</span>
          <ChevronDown size={16} className={clsx('ml-auto text-surface-400 transition-transform', calOpen && 'rotate-180')} />
        </button>
        {calOpen && (
          <div className="mt-3">
            <SalesPayCalendar id={calId} own={own} todayKey={todayKey} />
          </div>
        )}
      </div>

      {/* ── Окна ── */}
      <LeadDrawer leadId={drawerLeadId} onClose={() => setDrawerLeadId(null)} />
      <CallSheet lead={callLead} onClose={() => setCallLead(null)} onSaved={saved} />
      <MeetingResultSheet lead={meetingLead} onClose={() => setMeetingLead(null)} onSaved={saved} />
      <LeadCreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => saved()} />
      <LeadPickerModal open={pickCall} title="Кому вы звонили?" onClose={() => setPickCall(false)}
        onPick={lead => {
          setPickCall(false)
          setCallLead({ id: lead.id, name: lead.name, status: lead.status, contactPhone: lead.contactPhone })
        }} />
      {remindPay && <RemindPaymentModal pay={remindPay} onClose={() => setRemindPay(null)} onOpenProject={openProject} />}
      {ownPop && <OwnPopover anchor={ownPop} dayKey={todayKey} todayKey={todayKey} own={own} onClose={() => setOwnPop(null)} />}
      {ownSheet && <OwnTodaySheet own={own} todayKey={todayKey} onClose={() => setOwnSheet(false)} />}
    </div>
  )
}

// ── Строка дела ────────────────────────────────────────────────────────

type RowHandlers = {
  openLead: (leadId: string) => void
  call: (it: AgendaItem) => void
  meeting: (it: AgendaItem) => void
  remind: (p: SalesCalPay) => void
  openProject: (p: SalesCalPay) => void
}

/** Кнопка звонка: набирает номер (tel:) и сразу открывает шторку «Записать
 *  звонок» — вернулись из разговора, а итог уже можно отметить. */
function CallLink({ phone, name, onCall }: { phone: string; name: string; onCall: () => void }) {
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} onClick={ev => { ev.stopPropagation(); onCall() }}
      aria-label={`Позвонить: ${name}`} title={`Позвонить · ${phone}`}
      className="w-11 h-11 sm:w-9 sm:h-9 shrink-0 rounded-lg border border-surface-200 dark:border-surface-600 bg-white dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:text-primary-600 dark:hover:text-primary-300 hover:border-primary-400 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
      <Phone size={16} />
    </a>
  )
}

const actionBtn = 'h-11 sm:h-9 sm:min-h-0 whitespace-nowrap'

function TodoRow({ row, todayKey, own, h }: { row: Row; todayKey: string; own: OwnTasksApi; h: RowHandlers }) {
  const late = row.group === 'overdue'
  const meta = KIND_META[row.kind]

  // Время: час; у просроченного — ещё и день («вчера», «12 нояб.»).
  let time = '—'
  let sub: string | null = null
  let onRow: (() => void) | undefined
  let title = ''
  let badge: string | null = null
  let note: string | null = null
  let done = false
  let actions: ReactNode = null

  if (row.kind === 'payment') {
    const p = row.pay
    title = p.name
    note = `${p.amount == null ? '—' : `${money(p.amount)} с.`} · ${payWhat(p)}`
    if (late) {
      const days = Math.max(1, differenceInCalendarDays(asDate(todayKey), asDate(p.date)))
      // «12.11» — помещается в колонку времени; «12 нояб.» не помещался.
      time = format(asDate(p.date), 'dd.MM')
      sub = `${days} ${plural(days, 'день', 'дня', 'дней')}`
    }
    onRow = p.projectId ? () => h.openProject(p) : undefined
    actions = p.projectId && (p.state === 'late' || p.state === 'today') ? (
      <button type="button" onClick={ev => { ev.stopPropagation(); h.remind(p) }} className={clsx('btn-primary', actionBtn)}>
        Напомнить
      </button>
    ) : null
  } else if (row.kind === 'own') {
    const t = row.task
    title = t.title
    done = t.done
    time = t.time || '—'
    note = t.from && !t.done ? `перенесено с ${format(asDate(t.from), 'd MMM', { locale: ru })}` : null
    const next = format(addDays(asDate(t.day), 1), 'yyyy-MM-dd')
    actions = (
      <>
        <button type="button" onClick={() => own.toggle(t)} aria-pressed={t.done}
          className={clsx(t.done ? 'btn-ghost' : 'btn-primary', actionBtn)}>
          {t.done ? 'Вернуть' : <><Check size={15} /> Готово</>}
        </button>
        {!t.done && (
          <button type="button" onClick={() => own.move(t, next)} className={clsx('btn-ghost', actionBtn)}
            title={t.day === todayKey ? 'Перенести на завтра' : 'Перенести на день позже'}>
            Перенести
          </button>
        )}
      </>
    )
  } else {
    const it = row.item
    title = it.leadName
    badge = it.status
    note = it.note
    if (it.at) {
      const at = new Date(it.at)
      time = format(at, 'HH:mm')
      if (late) {
        const d = differenceInCalendarDays(asDate(todayKey), at)
        sub = d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : format(at, 'd MMM', { locale: ru })
      }
    }
    onRow = () => h.openLead(it.leadId)
    const primary =
      row.kind === 'callback' ? { label: 'Записать', run: () => h.call(it) }
      : row.kind === 'next_step' ? { label: 'Готово', run: () => h.openLead(it.leadId) }
      // «Состоялась» — только для встречи, время которой уже наступает:
      // итог завтрашней сервер не примет (SALES_SPEC §5).
      : row.group !== 'tomorrow' ? { label: 'Состоялась', run: () => h.meeting(it) }
      : null
    actions = (
      <>
        {it.phone && <CallLink phone={it.phone} name={it.leadName} onCall={() => h.call(it)} />}
        {primary && (
          <button type="button" onClick={ev => { ev.stopPropagation(); primary.run() }} className={clsx('btn-primary', actionBtn)}>
            {primary.label}
          </button>
        )}
        <button type="button" onClick={ev => { ev.stopPropagation(); h.openLead(it.leadId) }} className={clsx('btn-ghost', actionBtn)}>
          Перенести
        </button>
      </>
    )
  }

  return (
    <li onClick={onRow}
      className={clsx('flex flex-wrap sm:flex-nowrap items-start sm:items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 transition-colors',
        onRow && 'cursor-pointer hover:border-surface-300 dark:hover:border-surface-600',
        late ? 'bg-red-50/50 dark:bg-red-900/10 border-red-200/70 dark:border-red-900/40'
          : done ? 'bg-green-50/50 dark:bg-green-900/10 border-green-200/60 dark:border-green-800/40'
          : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700/60')}>
      <span className={clsx('w-12 shrink-0 pt-0.5 sm:pt-0 tabular-nums leading-tight',
        late ? STATE_TONE.late.text : 'text-surface-700 dark:text-surface-200')}>
        <span className="block text-[14px] font-bold">{time}</span>
        {sub && <span className="block text-[11px] font-semibold">{sub}</span>}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-500 dark:text-surface-400">
          <i className={clsx('w-2 h-2 rounded-full shrink-0', meta.dot)} aria-hidden />
          {meta.label}
        </span>
        <span className="mt-0.5 flex items-center gap-2 min-w-0">
          {onRow ? (
            <button type="button" onClick={ev => { ev.stopPropagation(); onRow?.() }}
              className="min-w-0 truncate text-left text-[14px] font-semibold text-surface-900 dark:text-surface-100 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              {title}
            </button>
          ) : (
            <span className={clsx('min-w-0 truncate text-[14px] font-semibold',
              done ? 'line-through text-surface-500 dark:text-surface-400' : 'text-surface-900 dark:text-surface-100')}>{title}</span>
          )}
          {badge && <StageBadge status={badge} className="shrink-0" />}
        </span>
        {note && <span className="mt-0.5 block text-[12.5px] text-surface-600 dark:text-surface-300 line-clamp-2">{note}</span>}
      </span>

      {actions && (
        <span className="flex items-center gap-1.5 shrink-0 max-sm:basis-full max-sm:justify-end" onClick={ev => ev.stopPropagation()}>
          {actions}
        </span>
      )}
    </li>
  )
}

// ── Оплаты моих клиентов ──────────────────────────────────────────────

function PaymentsCard({ loading, error, onRetry, groups, noClients, calOpen, onOpenCalendar }: {
  loading: boolean
  error: boolean
  onRetry: () => void
  groups: { late: SalesCalPay[]; today: SalesCalPay[]; wait: SalesCalPay[] }
  noClients: boolean
  calOpen: boolean
  onOpenCalendar: () => void
}) {
  const uid = useId()
  const line = (label: string, list: SalesCalPay[], tone: keyof typeof STATE_TONE, hint?: string) => {
    const { sum, known } = paySum(list)
    return (
      <li className="flex items-baseline gap-2 py-1.5">
        <i className={clsx('w-2 h-2 rounded-full shrink-0 self-center', STATE_TONE[tone].dot)} aria-hidden />
        <span className="text-[13px] text-surface-700 dark:text-surface-200">
          {label}{hint && <span className="text-surface-500 dark:text-surface-400"> {hint}</span>}
        </span>
        <span className={clsx('ml-auto tabular-nums text-[13px]', list.length && tone === 'late' ? STATE_TONE.late.text : 'text-surface-900 dark:text-surface-100')}>
          <b className="font-semibold">{list.length}</b>
          {list.length > 0 && <span className="text-surface-500 dark:text-surface-400"> · {known ? `${money(sum)} с.` : '—'}</span>}
        </span>
      </li>
    )
  }
  return (
    <section className="card" aria-labelledby={`${uid}-pay`}>
      <h2 id={`${uid}-pay`} className="text-[15px] font-bold text-surface-900 dark:text-surface-100 mb-1.5">Оплаты моих клиентов</h2>
      {loading ? (
        <div className="space-y-2.5 py-1">
          {[0, 1, 2].map(i => <span key={i} className="skeleton block h-4 w-full" />)}
        </div>
      ) : error ? (
        <div className="py-2">
          <p className="text-[13px] text-surface-600 dark:text-surface-300">Нет данных об оплатах</p>
          <button type="button" onClick={onRetry} className="btn-secondary mt-2 max-sm:min-h-[44px]"><RotateCcw size={14} /> Повторить</button>
        </div>
      ) : noClients ? (
        <p className="text-[13px] text-surface-500 dark:text-surface-400 py-1">
          Своих клиентов пока нет — оплаты появятся, когда основатель назначит вас менеджером проекта.
        </p>
      ) : (
        <ul className="divide-y divide-surface-100 dark:divide-surface-700/60">
          {line('Просрочено', groups.late, 'late')}
          {line('Сегодня', groups.today, 'today')}
          {line('Ждём', groups.wait, 'wait', 'до конца месяца')}
        </ul>
      )}
      <button type="button" onClick={onOpenCalendar}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 -mx-2 h-11 sm:h-8 text-[13px] font-semibold text-primary-600 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        <CalendarDays size={15} /> {calOpen ? 'К календарю оплат' : 'Календарь оплат'}
      </button>
      <p className="text-[11.5px] text-surface-500 dark:text-surface-400">Оплату записывает основатель в «Финансах».</p>
    </section>
  )
}

// ── «Напомнить» об оплате ─────────────────────────────────────────────

/** Письмо клиенту с запросом оплаты — то же, что «Запросить оплату» в
 *  проекте; сервер берёт долг из «Финансов» и email из карточки клиента. */
function RemindPaymentModal({ pay, onClose, onOpenProject }: { pay: SalesCalPay; onClose: () => void; onOpenProject: (p: SalesCalPay) => void }) {
  const [message, setMessage] = useState('')
  const send = useMutation({
    mutationFn: () => projectsApi.sendPaymentRequest(pay.projectId as string, message.trim() || undefined),
    onSuccess: (res: any) => {
      toast.success(`Напоминание отправлено${res?.to ? ` на ${res.to}` : ''}`)
      onClose()
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось отправить напоминание'),
  })
  return (
    <Modal open onClose={onClose} title="Напомнить об оплате" closeOnBackdropClick={!message}>
      <div className="space-y-4">
        <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/60 px-3 py-2.5">
          <p className="text-[14px] font-semibold text-surface-900 dark:text-surface-100">{pay.name}</p>
          <p className="text-[12.5px] text-surface-600 dark:text-surface-300 mt-0.5">
            {pay.amount == null ? '' : `${money(pay.amount)} с. · `}{payWhat(pay)} · срок {format(asDate(pay.date), 'd MMMM', { locale: ru })}
          </p>
        </div>
        <p className="text-[13px] text-surface-600 dark:text-surface-300">
          Клиенту уйдёт письмо с суммой к оплате на email из карточки проекта.
        </p>
        <div>
          <label htmlFor="remind-msg" className="label">Ваше сообщение (необязательно)</label>
          <textarea id="remind-msg" value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={2000}
            className="input resize-none" placeholder="Например: напоминаем об оплате за ноябрь" />
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={() => { onClose(); onOpenProject(pay) }} className="btn-ghost max-sm:min-h-[44px]">Открыть проект</button>
          <button type="button" onClick={onClose} className="btn-secondary max-sm:min-h-[44px]">Отмена</button>
          <button type="button" onClick={() => send.mutate()} disabled={send.isPending} className="btn-primary max-sm:min-h-[44px]">
            {send.isPending ? 'Отправляем…' : 'Отправить письмо'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Своя задача на сегодня (телефон) ──────────────────────────────────

/** Шторка снизу со строкой ввода: окошко у кнопки на телефоне не помещается. */
function OwnTodaySheet({ own, todayKey, onClose }: { own: OwnTasksApi; todayKey: string; onClose: () => void }) {
  // Esc закрывает, страница под шторкой не листается. onClose — через ref:
  // родитель передаёт новую функцию на каждый рендер.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') closeRef.current() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Своя задача на сегодня"
        className="relative w-full max-h-[85vh] flex flex-col bg-white dark:bg-surface-900 rounded-t-[22px] shadow-2xl">
        <div className="pt-2 pb-1"><div className="w-10 h-[5px] rounded-full bg-surface-300 dark:bg-surface-600 mx-auto" /></div>
        <div className="flex items-center gap-2 px-4 pt-2 pb-3">
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-100">Своя задача на сегодня</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть"
            className="ml-auto w-11 h-11 rounded-lg bg-surface-100 dark:bg-surface-800 text-surface-500 flex items-center justify-center"><X size={16} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain border-t border-surface-100 dark:border-surface-800 px-4 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
          <OwnDayTasks dayKey={todayKey} todayKey={todayKey} own={own} autoFocus />
        </div>
      </div>
    </div>,
    document.body,
  )
}
