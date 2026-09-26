import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ListTodo, Loader2, AlarmClock, Timer, Gauge, RefreshCw, BarChart3, ShieldAlert,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import clsx from 'clsx'
import api from '@/lib/api'
import { devTrackerApi } from '@/services/api.service'
import type { DevTrackerFlowPoint } from '@/services/api.service'
import { PageLoader, Avatar, ProgressBar, EmptyState } from '@/components/ui'
import { fmtDeadline } from './devBoardTypes'

/** Локальная карточка метрики: общий StatCard в узких колонках (6 в ряд)
 *  рвёт подписи («ПРОСРОЧЕН О»), поэтому здесь своя раскладка —
 *  подпись мелко и с нормальным переносом, значение крупно. */
function KpiStat({ title, value, sub, icon: Icon, color }: {
  title: string
  value: ReactNode
  sub?: string
  icon: React.ComponentType<{ size?: number | string; className?: string }>
  color: string
}) {
  return (
    <div className="card !p-3 sm:!p-4 flex items-start gap-2.5 min-w-0">
      <span aria-hidden="true" className={clsx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-white', color)}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wide leading-tight text-surface-500 dark:text-surface-400 break-words">
          {title}
        </span>
        <span className="block text-xl font-bold tabular-nums text-surface-900 dark:text-surface-100 leading-snug">
          {value}
        </span>
        {!!sub && (
          <span className="block text-[11px] leading-tight text-surface-400 dark:text-surface-500 break-words">
            {sub}
          </span>
        )}
      </span>
    </div>
  )
}

// ── Типы ответа GET /dev-tracker/kpi ────────────────────────────────────
// Это контракт API, поэтому типы ответа — локальные (не путать с
// devBoardTypes.ts, где живут UI-константы модуля).
interface DevKpiTeam {
  total: number
  done: number
  inProgress: number
  overdue: number
  doneOnTime: number
  doneLate: number
  /** null — нет завершённых задач с дедлайном, процент считать нельзя. */
  onTimeRate: number | null
  /** null — ещё не было завершённых задач, средний цикл не считается. */
  avgCycleDays: number | null
  /** SLA-нарушения команды. Ключа нет (бэк ещё не отдаёт) — карточку не показываем. */
  slaBreached?: number | null
}

interface DevKpiMember {
  assigneeId: string
  name: string | null
  avatarUrl?: string | null
  total: number
  done: number
  inProgress: number
  overdue: number
  doneOnTime: number
  doneLate: number
  onTimeRate: number | null
}

interface DevKpiResponse {
  team: DevKpiTeam
  members: DevKpiMember[]
  /** Недельная скорость: 6 недель. Опционально — бэк может ещё не отдавать. */
  velocity?: DevKpiVelocityPoint[]
  /** Ежедневная динамика: 30 дней. `open` опционален — если бэк не посчитал,
   *  остаток считаем накопительно из created/done. */
  burndown?: DevKpiBurndownPoint[]
}

interface DevKpiVelocityPoint {
  /** Неделя в формате 'YYYY-MM-DD' (понедельник). */
  week: string
  points: number
  count: number
}

interface DevKpiBurndownPoint {
  /** День в формате 'YYYY-MM-DD'. */
  day: string
  created: number
  done: number
  open?: number | null
}

async function fetchDevKpi(): Promise<DevKpiResponse> {
  const { data } = await api.get<DevKpiResponse>('/dev-tracker/kpi')
  return data
}

/** CFD-поток: GET /dev-tracker/kpi/flow?days=30. Бэка может ещё не быть —
 *  вызываем через devTrackerApi, при 404 отдаём [] (graceful degrade). */
async function fetchDevFlow(): Promise<DevTrackerFlowPoint[]> {
  try {
    const data = await devTrackerApi.getFlow(30)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

// ── Светофорная логика % «в срок» ───────────────────────────────────────
type RateLevel = 'green' | 'yellow' | 'red'

/** null — данных для процента нет (нет завершённых задач с дедлайном). */
function rateLevel(rate: number | null | undefined): RateLevel | null {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return null
  if (rate >= 80) return 'green'
  if (rate >= 60) return 'yellow'
  return 'red'
}

const RATE_TEXT: Record<RateLevel, string> = {
  green: 'text-green-600 dark:text-green-400',
  yellow: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
}

const RATE_BG: Record<RateLevel, string> = {
  green: 'bg-green-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
}

const fmtDays = (d: number | null | undefined) =>
  d === null || d === undefined || !Number.isFinite(d)
    ? '—'
    : `${Number.isInteger(d) ? d : (d as number).toFixed(1)} дн.`

/** Число от бэка: null/undefined/NaN/Infinity → 0 (иначе Recharts/JSX покажет NaN). */
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

/** Подписи осей графиков: общий fmtDeadline ('YYYY-MM-DD' → 'дд.мм',
 *  вручную, без Date — таймзона не сдвинет день) + fallback '—' для
 *  пустых значений (иначе ось с пустыми тиками). */
const fmtShortRu = (iso: string | null | undefined) => (iso ? fmtDeadline(iso) : '—')

/** Кастомный тултип ТОЛЬКО для pie: у Cell-сегментов цвет не прокидывается
 *  в дефолтный тултип (чёрный текст на тёмном). Рисуем сами — светлый текст
 *  + точка цвета сегмента. Остальные графики не трогаем. */
function PieTip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        backgroundColor: '#1e293b',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        color: '#e2e8f0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      {payload.map((p: any, i: number) => (
        <div key={`${p.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              flexShrink: 0,
              background: p?.payload?.color || p?.color || '#94a3b8',
            }}
          />
          <span>{p.name}:&nbsp;<b>{p.value}</b></span>
        </div>
      ))}
    </div>
  )
}

/** Тёмный тултип остальных графиков (bar/velocity/burndown/flow). */
const CHART_TIP = {
  contentStyle: {
    backgroundColor: '#1e293b',
    border: 'none',
    borderRadius: 8,
    fontSize: 12,
    color: '#e2e8f0',
  },
  labelStyle: { color: '#e2e8f0', fontWeight: 600 },
} as const

/**
 * KPI команды разработки — командные метрики, эффективность по сотрудникам
 * и графики «в срок vs поздно» по задачам канбан-доски разработки.
 * Данные: GET /dev-tracker/kpi.
 */
export default function DevBoardKpiPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['dev-tracker', 'kpi'],
    queryFn: fetchDevKpi,
    retry: 1,
  })
  const isForbidden = (error as { response?: { status?: number } } | null)?.response?.status === 403

  const team = data?.team

  // Лучший по % «в срок» сверху; при равном проценте — больше выполненных выше.
  // null/undefined/NaN (нет завершённых задач с дедлайном) — всегда в конец списка.
  const rateOrNeg = (r: number | null | undefined) =>
    r === null || r === undefined || !Number.isFinite(r) ? -1 : (r as number)
  const members = useMemo(
    () =>
      [...(Array.isArray(data?.members) ? data.members : [])].sort(
        (a, b) => rateOrNeg(b.onTimeRate) - rateOrNeg(a.onTimeRate) || num(b.done) - num(a.done),
      ),
    [data],
  )

  const barData = useMemo(
    () =>
      members.map(m => {
        // Имя может прийти не строкой (частичный контракт) — .trim() на числе ронял страницу.
        const safeName = String(m.name ?? 'Удалённый').trim() || 'Удалённый'
        return {
          name: safeName.split(/\s+/)[0] || safeName,
          full: safeName,
          'В срок': num(m.doneOnTime),
          'Поздно': num(m.doneLate),
        }
      }),
    [members],
  )
  /** Все нули (никто ещё не сдавал с дедлайном) — оси без баров выглядят
   *  сломанными, показываем честную плашку вместо пустого графика. */
  const barEmpty = barData.length > 0 && barData.every(d => d['В срок'] === 0 && d['Поздно'] === 0)

  const pieData = useMemo(() => {
    if (!team) return []
    // overdue — пересекается со статусами (просроченная задача уже сидит
    // в inProgress/backlog), поэтому в pie её не вычитаем: pie только по
    // статусам done / inProgress / остальные, а overdue — отдельной плашкой StatCard.
    // Опциональные ключи от бэка могут отсутствовать — коалесцим к 0 через num()
    // (?? пропустил бы NaN → Recharts получил бы NaN).
    // РАСХОЖДЕНИЕ С БЭКОМ: team.inProgress — только статус in_progress
    // (review/testing бэк туда не включает). Поэтому сегмент «В работе»
    // уже́, чем весь WIP, а review/testing падают в «Очередь / ревью / тест».
    // Математику бэка не трогаем — честность только подписями.
    const total = Math.max(0, num(team.total))
    const done = Math.max(0, num(team.done))
    const inProgress = Math.max(0, num(team.inProgress))
    const other = Math.max(0, total - done - inProgress)
    return [
      { name: 'Выполнено', value: done, color: '#22c55e' },
      { name: 'В работе', value: inProgress, color: '#6366f1' },
      { name: 'Очередь / ревью / тест', value: other, color: '#94a3b8' },
    ].filter(s => s.value > 0)
  }, [team])

  // Velocity и burndown опциональны: пока бэк не готов — пустые массивы,
  // страница не падает, вместо графиков — плашки EmptyState.
  // Числа тоже опциональны — через num() к 0, иначе Recharts получит NaN
  // (?? не ловит NaN). Массивы проверяем через Array.isArray — бэк может
  // прислать null/объект вместо [].
  const velocityData = useMemo(
    () => {
      const raw = Array.isArray(data?.velocity) ? data.velocity : []
      // Даты бэка сортируем клиентом (ISO 'YYYY-MM-DD' сортируется строкой):
      // несортированный ответ иначе ломает ось времени burndown/CFD.
      const sorted = [...raw].sort((a, b) => String(a.week ?? '').localeCompare(String(b.week ?? '')))
      return sorted.map(v => ({
        week: fmtShortRu(v.week ?? ''),
        'Стори-поинты': num(v.points),
        'Задачи': num(v.count),
      }))
    },
    [data],
  )
  const velocityEmpty =
    velocityData.length > 0 &&
    velocityData.every(d => (d['Стори-поинты'] as number) === 0 && (d['Задачи'] as number) === 0)

  const burndownData = useMemo(() => {
    const raw = Array.isArray(data?.burndown) ? data.burndown : []
    // Сортируем по дню до накопительного расчёта open: порядок ответа бэка
    // не гарантирован, а prevOpen зависит от последовательности.
    const sorted = [...raw].sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')))
    let prevOpen = 0
    return sorted.map(d => {
      const created = typeof d.created === 'number' && Number.isFinite(d.created) ? d.created : 0
      const doneN = typeof d.done === 'number' && Number.isFinite(d.done) ? d.done : 0
      // open от бэка — остаток открытых на день; если не посчитан —
      // ведём накопительно из created/done (не ниже нуля).
      const open =
        typeof d.open === 'number' && Number.isFinite(d.open)
          ? d.open
          : Math.max(0, prevOpen + created - doneN)
      prevOpen = open
      return { day: fmtShortRu(d.day ?? ''), 'Открыто': open, 'Закрыто': doneN }
    })
  }, [data])
  const burndownEmpty =
    burndownData.length > 0 &&
    burndownData.every(d => (d['Открыто'] as number) === 0 && (d['Закрыто'] as number) === 0)

  // CFD-поток по 6 статусам за 30 дней: GET /dev-tracker/kpi/flow.
  // Бэка может ещё не быть — retry выключен, пусто → EmptyState-плашка.
  // isLoading отдельно: без него первая отрисовка показывала «Данных пока нет»
  // и через секунду подменяла графиком (ложный empty-flicker).
  const { data: flowRaw, isLoading: flowLoading, refetch: refetchFlow } = useQuery({
    queryKey: ['dev-tracker', 'kpi', 'flow'],
    queryFn: fetchDevFlow,
    retry: false,
    staleTime: 60_000,
  })

  const flowData = useMemo(() => {
    const raw = Array.isArray(flowRaw) ? flowRaw : []
    const sorted = [...raw].sort((a, b) => String(a.day ?? '').localeCompare(String(b.day ?? '')))
    return sorted.map(d => ({
      day: fmtShortRu(d.day ?? ''),
      'Бэклог': num(d.backlog),
      'К выполнению': num(d.todo),
      'В работе': num(d.in_progress),
      'На ревью': num(d.in_review),
      'Тестирование': num(d.testing),
      'Готово': num(d.done),
    }))
  }, [flowRaw])
  const flowEmpty =
    flowData.length > 0 &&
    flowData.every(d =>
      (d['Бэклог'] as number) === 0 && (d['К выполнению'] as number) === 0 &&
      (d['В работе'] as number) === 0 && (d['На ревью'] as number) === 0 &&
      (d['Тестирование'] as number) === 0 && (d['Готово'] as number) === 0,
    )

  // SLA-нарушения: ключа нет — карточку не показываем.
  // NaN/Infinity от бэка тоже прячем (JSON их не даёт, но частичный контракт возможен).
  const slaRaw = team?.slaBreached ?? null
  const slaBreached: number | null =
    typeof slaRaw === 'number' && Number.isFinite(slaRaw) ? slaRaw : null
  const showSla = slaBreached !== null

  // ВАЖНО: team здесь ещё может быть undefined (useQuery в полёте) — без
  // optional chaining страница падала с TypeError ещё до рендера, и
  // ChunkErrorBoundary вечно показывал логотип вместо контента.
  const isEmpty = num(team?.total) === 0 && members.length === 0
  const rate: number | null =
    team?.onTimeRate === null || team?.onTimeRate === undefined ||
    !Number.isFinite(team.onTimeRate)
      ? null
      // Клэмп 0–100, как у участников (safeRate): выброс бэка не должен
      // выглядеть как «150%» или отрицательный процент.
      : Math.min(100, Math.max(0, team.onTimeRate))
  const teamRateLevel = rateLevel(rate)
  const teamDoneClosed = num(team?.doneOnTime) + num(team?.doneLate)

  return (
    <div className="min-w-0 space-y-5">
      {/* Шапка */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <div aria-hidden="true" className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
            <BarChart3 size={20} className="text-white" />
          </div>
          <h1 className="page-title min-w-0 flex-1 break-words">
            KPI команды разработки
          </h1>
        </div>
      </div>

      {isLoading ? (
        <PageLoader />
      ) : isError || !team ? (
        <div className="card">
          <EmptyState
            title={isForbidden ? 'Нет доступа' : 'Не удалось загрузить KPI'}
            description={
              isForbidden
                ? 'У вас нет прав для просмотра KPI разработки.'
                : 'Проверьте подключение и попробуйте ещё раз.'
            }
            action={
              !isForbidden ? (
              <button
                type="button"
                onClick={() => { void refetch(); void refetchFlow() }}
                disabled={isFetching}
                className="btn-primary min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-2"
              >
                <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
                Повторить
              </button>
              ) : undefined
            }
          />
        </div>
      ) : isEmpty ? (
        <div className="card">
          <EmptyState
            title="Задач пока нет"
            description="KPI появятся после первых задач."
          />
        </div>
      ) : (
        <>
          {/* Командные метрики */}
          <div className={clsx('grid grid-cols-2 gap-3 sm:gap-4', showSla ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}>
            <KpiStat
              title="Всего задач"
              value={num(team.total)}
              icon={ListTodo}
              color="bg-primary-600"
              sub={`Выполнено: ${num(team.done)}`}
            />
            <KpiStat
              title="В работе"
              value={num(team.inProgress)}
              icon={Loader2}
              color="bg-sky-500"
              sub="только in_progress"
            />
            <KpiStat
              title="Просрочено"
              value={num(team.overdue)}
              icon={AlarmClock}
              color={num(team.overdue) > 0 ? 'bg-red-500' : 'bg-surface-400'}
              sub={num(team.overdue) > 0 ? 'Требуют внимания' : 'Всё под контролем'}
            />
            <KpiStat
              title="В срок"
              value={rate === null ? '—' : `${Math.round(rate)}%`}
              icon={Gauge}
              color={teamRateLevel ? RATE_BG[teamRateLevel] : 'bg-surface-400'}
              sub={rate === null ? 'нет завершённых с дедлайном' : `из ${teamDoneClosed} завершённых`}
            />
            <KpiStat
              title="Средний цикл"
              value={fmtDays(team.avgCycleDays)}
              icon={Timer}
              color="bg-violet-500"
              sub="время выполнения"
            />
            {showSla && (
              <KpiStat
                title="SLA нарушено"
                value={slaBreached ?? 0}
                icon={ShieldAlert}
                color={num(slaBreached) > 0 ? 'bg-red-500' : 'bg-surface-400'}
                sub={num(slaBreached) > 0 ? 'Требуют внимания' : 'SLA в норме'}
              />
            )}
          </div>

          {/* Графики */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card lg:col-span-2">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
                Сдано в срок vs поздно
              </h2>
              {barData.length === 0 || barEmpty ? (
                barData.length === 0 ? (
                  <EmptyState
                    title="Нет данных по сотрудникам"
                    description="График появится после назначения задач."
                  />
                ) : (
                  <EmptyState
                    title="Сдач с дедлайном пока нет"
                    description="График появится после первых завершённых задач с дедлайном."
                  />
                )
              ) : (
                <div className="h-[240px] sm:h-64" role="img" aria-label="График: сдано в срок и поздно по сотрудникам">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStart"
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#64748b', opacity: 0.08 }}
                        labelFormatter={(_label, payload) =>
                          (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? _label
                        }
                        contentStyle={CHART_TIP.contentStyle}
                        labelStyle={CHART_TIP.labelStyle}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="В срок" stackId="done" fill="#22c55e" maxBarSize={56} />
                      <Bar dataKey="Поздно" stackId="done" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
                Распределение статусов
              </h2>
              {pieData.length === 0 ? (
                <EmptyState
                  title="Нет данных"
                  description="Распределение статусов появится после первых задач."
                />
              ) : (
              <div className="h-[280px] sm:h-64" role="img" aria-label="Диаграмма: распределение задач по статусам">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map(s => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              )}
            </div>
          </div>

          {/* Velocity и Burndown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
                Velocity — 6 недель
              </h2>
              {velocityData.length === 0 || velocityEmpty ? (
                <EmptyState
                  title="Данных пока нет"
                  description="Velocity появится после первых недель с оценёнными задачами."
                />
              ) : (
                <div className="h-[240px] sm:h-64" role="img" aria-label="График: velocity (стори-поинты и задачи) за 6 недель">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={velocityData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="week"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: '#64748b', opacity: 0.08 }}
                        contentStyle={CHART_TIP.contentStyle}
                        labelStyle={CHART_TIP.labelStyle}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="Стори-поинты" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Задачи" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
                Burndown — 30 дней
              </h2>
              {burndownData.length === 0 || burndownEmpty ? (
                <EmptyState
                  title="Данных пока нет"
                  description="Burndown появится после первых созданных задач."
                />
              ) : (
                <div className="h-[240px] sm:h-64" role="img" aria-label="График: burndown (открыто и закрыто) за 30 дней">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={burndownData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.15} vertical={false} />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                        minTickGap={24}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ stroke: '#64748b', opacity: 0.3 }}
                        contentStyle={CHART_TIP.contentStyle}
                        labelStyle={CHART_TIP.labelStyle}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area
                        type="monotone"
                        dataKey="Открыто"
                        stroke="#f59e0b"
                        fill="#f59e0b"
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="Закрыто"
                        stroke="#22c55e"
                        fill="#22c55e"
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Cumulative Flow — 30 дней: стек по 6 статусам из /kpi/flow */}
          <div className="card">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
              Cumulative Flow — 30 дней
            </h2>
            {flowLoading ? (
              <p className="text-sm text-surface-400 dark:text-surface-500 text-center py-8">Загрузка потока…</p>
            ) : flowData.length === 0 || flowEmpty ? (
              <EmptyState
                title="Данных пока нет"
                description="CFD появится после первых задач на доске."
              />
            ) : (
              <div className="h-[300px] sm:h-64" role="img" aria-label="График: cumulative flow по статусам за 30 дней">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={flowData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#64748b" opacity={0.15} vertical={false} />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      cursor={{ stroke: '#64748b', opacity: 0.3 }}
                      contentStyle={CHART_TIP.contentStyle}
                      labelStyle={CHART_TIP.labelStyle}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="Бэклог" stackId="flow" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.35} strokeWidth={2} />
                    <Area type="monotone" dataKey="К выполнению" stackId="flow" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.35} strokeWidth={2} />
                    <Area type="monotone" dataKey="В работе" stackId="flow" stroke="#6366f1" fill="#6366f1" fillOpacity={0.35} strokeWidth={2} />
                    <Area type="monotone" dataKey="На ревью" stackId="flow" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.35} strokeWidth={2} />
                    <Area type="monotone" dataKey="Тестирование" stackId="flow" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.35} strokeWidth={2} />
                    <Area type="monotone" dataKey="Готово" stackId="flow" stroke="#22c55e" fill="#22c55e" fillOpacity={0.35} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Эффективность по сотрудникам */}
          <div className="card">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-4">
              Эффективность по сотрудникам
            </h2>
            {members.length === 0 ? (
              <EmptyState
                title="Задач не назначено"
                description="Эффективность появится после назначения исполнителей."
              />
            ) : (
              <>
                {/* Mobile: компактные карточки вместо широкой таблицы */}
                <div className="md:hidden space-y-2">
                  {members.map((m, idx) => {
                    const displayName = String(m.name ?? '').trim() || 'Удалённый сотрудник'
                    const mRate: number | null =
                      m.onTimeRate === null || m.onTimeRate === undefined ||
                      !Number.isFinite(m.onTimeRate)
                        ? null
                        : m.onTimeRate
                    const lvl = rateLevel(mRate)
                    const safeRate = mRate === null ? null : Math.min(100, Math.max(0, mRate))
                    return (
                      <div
                        key={m.assigneeId ?? `${displayName}-${idx}`}
                        className="rounded-lg border border-surface-200 dark:border-surface-700/60 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar name={displayName} src={m.avatarUrl ?? undefined} size={28} zoomable={false} />
                          <span className="flex-1 min-w-0 font-medium text-sm text-surface-800 dark:text-surface-200 truncate">
                            {displayName}
                          </span>
                          {safeRate === null || lvl === null ? (
                            <span className="text-xs text-surface-400 dark:text-surface-500 shrink-0">—</span>
                          ) : (
                            <span className={clsx('text-xs font-semibold tabular-nums shrink-0', RATE_TEXT[lvl])}>
                              {Math.round(safeRate)}%
                            </span>
                          )}
                        </div>
                        {safeRate !== null && <div className="mt-2"><ProgressBar value={safeRate} /></div>}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-surface-500 dark:text-surface-400">
                          <span>Всего <b className="text-surface-800 dark:text-surface-200">{num(m.total)}</b></span>
                          <span>В работе <b className="text-sky-600 dark:text-sky-400">{num(m.inProgress)}</b></span>
                          <span>Сделано <b className="text-surface-800 dark:text-surface-200">{num(m.done)}</b></span>
                          <span className={num(m.overdue) > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                            Просрочено <b>{num(m.overdue)}</b>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]" aria-label="Эффективность по сотрудникам">
                  <thead className="sticky top-0 z-10 bg-surface-50 dark:bg-surface-800">
                    <tr className="text-left text-xs uppercase tracking-wider text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                      <th scope="col" className="sticky left-0 z-10 bg-surface-50 dark:bg-surface-800 pb-2 pr-3 font-medium">Сотрудник</th>
                      <th scope="col" className="pb-2 px-2 font-medium text-center">Всего</th>
                      <th scope="col" className="pb-2 px-2 font-medium text-center">В работе</th>
                      <th scope="col" className="pb-2 px-2 font-medium text-center">Сделано</th>
                      <th scope="col" className="pb-2 px-2 font-medium text-center">В срок</th>
                      <th scope="col" className="pb-2 px-2 font-medium text-center">Поздно</th>
                      <th scope="col" className="pb-2 px-2 font-medium text-center">Просрочено</th>
                      <th scope="col" className="pb-2 pl-2 font-medium w-40">% в срок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m, idx) => {
                      // null/undefined/''/'   '/не-строка → 'Удалённый сотрудник' (иначе пустая ячейка/краш .trim()).
                      const displayName = String(m.name ?? '').trim() || 'Удалённый сотрудник'
                      // undefined от бэка приводим к null: rateLevel(undefined)
                      // раньше давал 'red', а ветка `=== null` не ловила dash → NaN в ProgressBar.
                      const mRate: number | null =
                        m.onTimeRate === null || m.onTimeRate === undefined ||
                        !Number.isFinite(m.onTimeRate)
                          ? null
                          : m.onTimeRate
                      const lvl = rateLevel(mRate)
                      // Клэмп 0–100: ProgressBar не должен получить >100/отрицательное.
                      const safeRate = mRate === null ? null : Math.min(100, Math.max(0, mRate))
                      return (
                        <tr
                          key={m.assigneeId ?? `${displayName}-${idx}`}
                          className="border-b border-surface-50 dark:border-surface-700/50 last:border-0"
                        >
                          <td className="sticky left-0 z-10 bg-surface-50 dark:bg-surface-800 py-2.5 pr-3">
                            <div className="flex items-center gap-2.5 min-w-0 max-w-[180px] sm:max-w-none">
                              <span className="shrink-0">
                                <Avatar
                                  name={displayName}
                                  src={m.avatarUrl ?? undefined}
                                  size={28}
                                  zoomable={false}
                                />
                              </span>
                              <span className="font-medium min-w-0 text-surface-800 dark:text-surface-200 truncate">
                                {displayName}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-center tabular-nums text-surface-700 dark:text-surface-300">
                            {num(m.total)}
                          </td>
                          <td className="py-2.5 px-2 text-center tabular-nums text-sky-600 dark:text-sky-400">
                            {num(m.inProgress)}
                          </td>
                          <td className="py-2.5 px-2 text-center tabular-nums text-surface-700 dark:text-surface-300">
                            {num(m.done)}
                          </td>
                          <td className="py-2.5 px-2 text-center tabular-nums text-green-600 dark:text-green-400">
                            {num(m.doneOnTime)}
                          </td>
                          <td className="py-2.5 px-2 text-center tabular-nums text-red-500 dark:text-red-400">
                            {num(m.doneLate)}
                          </td>
                          <td
                            className={clsx(
                              'py-2.5 px-2 text-center tabular-nums',
                              num(m.overdue) > 0
                                ? 'text-red-600 dark:text-red-400 font-semibold'
                                : 'text-surface-400 dark:text-surface-500',
                            )}
                          >
                            {num(m.overdue)}
                          </td>
                          <td className="py-2.5 pl-2">
                            {safeRate === null || lvl === null ? (
                              <span className="text-xs text-surface-400 dark:text-surface-500">—</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span
                                  className={clsx(
                                    'text-xs font-semibold tabular-nums w-9 shrink-0',
                                    RATE_TEXT[lvl],
                                  )}
                                >
                                  {Math.round(safeRate)}%
                                </span>
                                <div className="flex-1 min-w-[64px]">
                                  <ProgressBar value={safeRate} />
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}


