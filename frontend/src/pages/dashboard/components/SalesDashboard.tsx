import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi, projectsApi, clientsApi } from '@/services/api.service'
import { DatePicker, DateRangePicker } from '@/components/ui/DatePicker'
import { useAuthStore } from '@/store/auth.store'
import { StatusBadge, ProgressBar, CollapsibleSection } from '@/components/ui'
import { Calendar, CheckCircle2, Mail, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import KpiDetailsModal from '@/components/kpi/KpiDetailsModal'
import KpiCelebration from '@/components/kpi/KpiCelebration'

const TYPE_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'overdue', label: '🔴 Просрочено' },
  { value: 'upcoming', label: '🟠 Скоро' },
  { value: 'outstanding', label: '⏳ К оплате' },
  { value: 'paid', label: '✅ Оплачено' },
]

const PROJECT_STATUS_OPTIONS = [
  { value: 'planning',    label: 'Планируется' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'completed',   label: 'Завершён' },
  { value: 'on_hold',     label: 'На паузе' },
  { value: 'archived',    label: 'Архив' },
]

const fmt = (n: number) => n.toLocaleString('ru-RU')

/** Универсальная ячейка инлайн-редактирования: text / date / select.
 *  Клик → поле ввода; Enter / blur — сохранение; Esc — отмена.
 *  Контейнер фиксированной ширины, чтобы таблица не «прыгала». */
function InlineEditCell({
  value, onSave, mode, options, width = 'w-32', formatter,
}: {
  value: string | null | undefined
  onSave: (v: string) => void
  mode: 'text' | 'date' | 'select'
  options?: { value: string; label: string }[]
  width?: string
  formatter?: (v: string | null | undefined) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const start = () => { setDraft(value ?? ''); setEditing(true) }
  const commit = () => {
    setEditing(false)
    if ((draft || '') !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    if (mode === 'select') {
      return (
        <select
          autoFocus
          value={draft}
          onChange={e => { setDraft(e.target.value); onSave(e.target.value); setEditing(false) }}
          onBlur={() => setEditing(false)}
          onKeyDown={e => { if (e.key === 'Escape') setEditing(false) }}
          className={clsx('px-1.5 py-0.5 text-sm rounded border border-primary-400 bg-white dark:bg-surface-800', width)}
        >
          {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    }
    // Дата — наш красивый DatePicker. После выбора сразу коммитим.
    if (mode === 'date') {
      return (
        <div className={clsx('inline-block', width)}>
          <DatePicker
            value={draft}
            onChange={(v) => { setDraft(v); onSave(v); setEditing(false) }}
          />
        </div>
      )
    }
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') setEditing(false)
        }}
        className={clsx('px-1.5 py-0.5 text-sm rounded border border-primary-400 bg-white dark:bg-surface-800', width)}
      />
    )
  }

  const displayText = formatter ? formatter(value) : (value || '—')
  return (
    <button
      type="button"
      onClick={start}
      title="Нажмите, чтобы изменить"
      className={clsx('group/cell inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors text-left', width)}
    >
      <Pencil size={10} className="text-surface-400 group-hover/cell:text-primary-600 dark:group-hover/cell:text-primary-400 shrink-0" />
      <span className="truncate underline decoration-dotted decoration-surface-300 dark:decoration-surface-600 underline-offset-2 group-hover/cell:text-primary-600 dark:group-hover/cell:text-primary-400">
        {displayText}
      </span>
    </button>
  )
}

/** Ячейка бюджета с инлайн-редактированием: клик → поле ввода,
 *  сохранение по Enter или потере фокуса, отмена по Esc.
 *  Контейнер фиксированной ширины — таблица не «прыгает» при входе
 *  в режим редактирования. */
function BudgetCell({ value, onSave }: { value: number; onSave: (b: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const start = () => { setDraft(String(value ?? 0)); setEditing(true) }
  const commit = () => {
    setEditing(false)
    const n = Number(draft)
    if (!isNaN(n) && n >= 0 && n !== Number(value ?? 0)) onSave(n)
  }

  return (
    <span className="inline-block w-28 align-middle">
      {editing ? (
        <input
          type="number"
          min={0}
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') setEditing(false)
          }}
          className="w-full px-1.5 py-0.5 text-right text-sm rounded border border-primary-400 bg-white dark:bg-surface-800 tabular-nums"
        />
      ) : (
        <button
          type="button"
          onClick={start}
          title="Нажмите, чтобы изменить бюджет"
          className="group/budget w-full inline-flex items-center justify-end gap-1 px-1.5 py-0.5 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors"
        >
          <Pencil size={11} className="text-surface-400 group-hover/budget:text-primary-600 dark:group-hover/budget:text-primary-400 shrink-0" />
          <span className="tabular-nums underline decoration-dotted decoration-surface-300 dark:decoration-surface-600 underline-offset-2 group-hover/budget:text-primary-600 dark:group-hover/budget:text-primary-400">
            {fmt(value || 0)}
          </span>
        </button>
      )}
    </span>
  )
}

export default function SalesDashboard() {
  const [filter, setFilter] = useState('')
  const role = useAuthStore(s => s.user?.role)
  const userId = useAuthStore(s => s.user?.id)
  // Wave 16: модалка с подробностями для кликнутой метрики KPI.
  const [openedKpiItem, setOpenedKpiItem] = useState<{ key: string; label: string } | null>(null)
  // Сегмент МП: СММ → SMM-проекты, разработка → «Web сайт».
  const segmentType =
    role === 'sales_manager_dev' ? 'Web сайт'
    : role === 'sales_manager_smm' ? 'SMM'
    : null

  const qc = useQueryClient()
  // Кэш per-user (чтобы данные другого пользователя не подтекали при
  // переключении сессий) + всегда фетчим при монтировании, чтобы первый
  // рендер сразу с актуальными проектами.
  const { data } = useQuery({
    queryKey: ['sales-stats', userId],
    queryFn: analyticsApi.sales,
    enabled: !!userId,
    refetchOnMount: 'always',
    staleTime: 30_000,
  })

  // KPI плана МП — окно по умолчанию «сегодня», можно выбрать диапазон.
  const todayIso = new Date().toISOString().slice(0, 10)
  const [kpiFrom, setKpiFrom] = useState(todayIso)
  const [kpiTo, setKpiTo] = useState(todayIso)
  const { data: kpi } = useQuery({
    queryKey: ['sales-kpi', userId, kpiFrom, kpiTo],
    queryFn: () => clientsApi.kpi({ from: kpiFrom, to: kpiTo }),
    enabled: !!userId,
    refetchOnMount: 'always',
    staleTime: 30_000,
  })

  // ─── Поздравления при закрытии метрик KPI ───────────────────────────
  // Когда метрика впервые за день/период достигает цели — показываем
  // большой анимированный модал с похвалой. Антиспам: храним показанные
  // ключи в useRef Set с подмесом периода, чтобы при refetch'е / WebSocket
  // обновлении один и тот же триггер не вызывал модал заново.
  const userName = useAuthStore(s => s.user?.name) || 'Сотрудник'
  const [celebrationKey, setCelebrationKey] = useState<string | null>(null)
  const celebratedRef = useRef<Set<string>>(new Set())
  // Сбрасываем «уже показанные» когда меняется окно периода или юзер.
  useEffect(() => {
    celebratedRef.current = new Set()
  }, [userId, kpiFrom, kpiTo])

  useEffect(() => {
    if (!kpi?.items?.length) return
    const periodTag = `${kpiFrom}_${kpiTo}`
    // Сначала проверяем оверолл — если ровно сейчас 100% И ранее ещё не
    // праздновали — это «золотой» триггер, имеет приоритет над отдельными.
    const overall = Number(kpi.overallPercent || 0)
    if (overall >= 100) {
      const k = `${periodTag}:__all__`
      if (!celebratedRef.current.has(k)) {
        celebratedRef.current.add(k)
        // Помечаем и каждую отдельную как «уже» — чтобы не сыпались 5 модалов подряд.
        kpi.items.forEach((it: any) => {
          if (it.done) celebratedRef.current.add(`${periodTag}:${it.key}`)
        })
        setCelebrationKey('__all__')
        return
      }
    }
    // Иначе — ищем первую done-метрику, по которой ещё не праздновали.
    for (const it of kpi.items) {
      if (!it.done) continue
      const k = `${periodTag}:${it.key}`
      if (!celebratedRef.current.has(k)) {
        celebratedRef.current.add(k)
        setCelebrationKey(it.key)
        break
      }
    }
  }, [kpi, kpiFrom, kpiTo])

  // МП по продажам (СММ И разработка) могут править все колонки таблицы:
  // name / paidAmount / endDate / status. Так оба направления одинаково
  // владеют операционкой по своим проектам.
  const isSmmSales = role === 'sales_manager_smm' || role === 'sales_manager_dev'

  // Универсальная мутация: апдейт любого поля проекта из инлайн-ячейки.
  // После сохранения инвалидирует панель, список проектов, аналитику и карточку.
  const updateProjectMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) =>
      projectsApi.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['sales-stats', userId] })
      const prev = qc.getQueryData(['sales-stats', userId])
      qc.setQueryData(['sales-stats', userId], (old: any) => {
        if (!old?.projects) return old
        return {
          ...old,
          projects: old.projects.map((p: any) => {
            if (p.id !== id) return p
            const next: any = { ...p, ...patch }
            // Пересчитываем остаток, если изменился бюджет или оплата.
            if ('budget' in patch || 'paidAmount' in patch) {
              const budget = Number(next.budget || 0)
              const paid = Number(next.paidAmount || 0)
              next.remaining = Math.max(0, budget - paid)
              next.paidPct = budget > 0 ? Math.round((paid / budget) * 100) : 0
            }
            return next
          }),
        }
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      qc.setQueryData(['sales-stats', userId], ctx?.prev)
      toast.error('Не удалось сохранить')
    },
    onSuccess: () => {
      toast.success('Изменения сохранены')
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sales-stats', userId] }),
  })

  const patch = (id: string, p: Record<string, any>) => updateProjectMut.mutate({ id, patch: p })

  // Считаем список проектов на каждом рендере — useMemo здесь оборачивал
  // в стейл-ссылку и из-за этого первый рендер показывал «5 из 5» с пустой
  // таблицей до клика по фильтру. Стоимость пересчёта мизерная.
  const allSegmentProjects = ((data?.projects || []) as any[])
    .filter(p => !segmentType || p.projectType === segmentType)
  const projects = (() => {
    if (filter === 'overdue')     return allSegmentProjects.filter(p => p.isOverdue)
    if (filter === 'upcoming')    return allSegmentProjects.filter(p => p.isUpcoming)
    if (filter === 'outstanding') return allSegmentProjects.filter(p => p.remaining > 0)
    if (filter === 'paid')        return allSegmentProjects.filter(p => p.budget > 0 && p.remaining === 0)
    return allSegmentProjects
  })()
  const totalCount = allSegmentProjects.length

  return (
    <div className="space-y-6">
      {/* KPI блок — план/факт за месяц, считается автоматически из CRM.
          Рендерим всегда (даже до получения данных), чтобы блок не пропадал,
          если /clients/kpi временно недоступен. Тогда показываем 0/цель. */}
      <CollapsibleSection
        id="sales-kpi"
        title={
          <div className="flex items-center justify-between w-full gap-3 flex-wrap">
            <h3 className="section-title">
              KPI менеджера {kpiFrom === kpiTo
                ? (kpiFrom === todayIso ? '— сегодня' : `— ${kpiFrom}`)
                : `— ${kpiFrom} … ${kpiTo}`}
            </h3>
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <div className="w-[260px]">
                <DateRangePicker
                  from={kpiFrom}
                  to={kpiTo}
                  onChange={(f, t) => { setKpiFrom(f || todayIso); setKpiTo(t || todayIso) }}
                  placeholder="Выберите период"
                />
              </div>
              <span className={clsx(
                'text-xs font-semibold tabular-nums shrink-0',
                (kpi?.overallPercent ?? 0) >= 100 ? 'text-emerald-600' :
                (kpi?.overallPercent ?? 0) >= 70  ? 'text-amber-600'   : 'text-red-600',
              )}>
                {kpi ? `${kpi.overallPercent}% от плана` : 'загрузка…'}
              </span>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(kpi?.items ?? [
            { key: 'new_companies',   label: 'Новые компании в базе', target: 30, value: 0, percent: 0, done: false },
            { key: 'cold_calls',      label: 'Холодные звонки',       target: 10, value: 0, percent: 0, done: false },
            { key: 'personal_emails', label: 'Персональные письма',   target: 10, value: 0, percent: 0, done: false },
            { key: 'meetings',        label: 'Встречи / созвоны',     target: 2,  value: 0, percent: 0, done: false },
          ]).map((it: any) => (
            <button
              key={it.key}
              type="button"
              onClick={() => setOpenedKpiItem({ key: it.key, label: it.label })}
              disabled={!kpi}
              title="Кликни чтобы посмотреть подробности"
              className={clsx(
                'text-left rounded-xl border p-3 space-y-1.5 transition-all',
                kpi && 'hover:shadow-md hover:-translate-y-0.5 hover:border-primary-300 dark:hover:border-primary-700 cursor-pointer',
                !kpi && 'opacity-60 cursor-not-allowed',
                it.done
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40'
                  : 'bg-surface-50 dark:bg-surface-800/50 border-surface-100 dark:border-surface-700',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-surface-600 dark:text-surface-300">{it.label}</span>
                <span className="text-[10px] text-surface-400">цель {it.target}</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className={clsx(
                  'text-xl font-bold tabular-nums',
                  it.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-surface-800 dark:text-surface-100',
                )}>
                  {it.value}
                </span>
                <span className="text-xs text-surface-400">/ {it.target}</span>
                {it.done && <span className="ml-auto text-[10px] font-semibold text-emerald-600">✓</span>}
              </div>
              <ProgressBar value={it.percent} />
            </button>
          ))}
        </div>
      </CollapsibleSection>

      {/* Модалка с подробностями метрики */}
      {openedKpiItem && userId && (
        <KpiDetailsModal
          open
          onClose={() => setOpenedKpiItem(null)}
          userId={userId}
          metric={openedKpiItem.key}
          metricLabel={openedKpiItem.label}
          from={kpiFrom}
          to={kpiTo}
        />
      )}

      {/* Поздравительный модал при закрытии KPI-метрики */}
      <KpiCelebration
        open={!!celebrationKey}
        name={userName}
        metricKey={celebrationKey}
        onClose={() => setCelebrationKey(null)}
      />

      {/* Projects table */}
      <CollapsibleSection
        id="sales-projects"
        title={
          <div className="flex items-center justify-between w-full">
            <h3 className="section-title">Все проекты</h3>
            <span className="text-xs text-surface-400">{projects.length} из {totalCount}</span>
          </div>
        }
      >
      <div className="space-y-4">

        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                filter === f.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-100 dark:bg-surface-700 text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600',
              )}
            >{f.label}</button>
          ))}
        </div>

        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                <th className="pb-2 font-medium">Проект</th>
                <th className="pb-2 font-medium">Тип</th>
                <th className="pb-2 font-medium text-right">Бюджет</th>
                <th className="pb-2 font-medium text-right">Оплачено</th>
                <th className="pb-2 font-medium text-right">Остаток</th>
                <th className="pb-2 font-medium">След. оплата</th>
                <th className="pb-2 font-medium">Дедлайн</th>
                <th className="pb-2 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50 dark:divide-surface-800">
              {projects.map((p: any) => (
                <tr key={p.id} className="hover:bg-surface-50 dark:hover:bg-surface-700/30 transition-colors">
                  <td className="py-2 pr-3">
                    {isSmmSales ? (
                      <InlineEditCell
                        mode="text"
                        value={p.name}
                        onSave={(v) => patch(p.id, { name: v })}
                        width="w-44"
                      />
                    ) : (
                      <Link to={`/projects/${p.id}`} className="font-medium text-surface-900 dark:text-surface-100 hover:text-primary-600 dark:hover:text-primary-400">
                        {p.name}
                      </Link>
                    )}
                    {p.clientInfo?.email && (
                      <p className="text-[10px] text-surface-400 flex items-center gap-1 mt-0.5">
                        <Mail size={10} /> {p.clientInfo.email}
                      </p>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {p.projectType && (
                      <span className="text-[10px] bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 px-1.5 py-0.5 rounded-full whitespace-nowrap">{p.projectType}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium text-surface-800 dark:text-surface-200 tabular-nums whitespace-nowrap">
                    <BudgetCell
                      value={Number(p.budget || 0)}
                      onSave={(budget) => patch(p.id, { budget })}
                    />
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                    {isSmmSales ? (
                      <BudgetCell
                        value={Number(p.paidAmount || 0)}
                        onSave={(paidAmount) => patch(p.id, { paidAmount })}
                      />
                    ) : (
                      fmt(p.paidAmount)
                    )}
                  </td>
                  <td className={clsx(
                    'py-2 pr-3 text-right font-bold tabular-nums whitespace-nowrap',
                    p.remaining === 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : p.isOverdue
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-amber-600 dark:text-amber-400',
                  )}>
                    {fmt(p.remaining)}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <InlineEditCell
                      mode="date"
                      value={p.nextPaymentDate ? String(p.nextPaymentDate).slice(0, 10) : ''}
                      onSave={(v) => patch(p.id, { nextPaymentDate: v || null })}
                      formatter={(v) => {
                        if (!v) return '—'
                        const d = new Date(v)
                        const today = new Date(); today.setHours(0, 0, 0, 0)
                        const diff = Math.floor((d.getTime() - today.getTime()) / 86_400_000)
                        const prefix = diff < 0 ? '🔴 ' : diff <= 3 ? '🟠 ' : ''
                        return `${prefix}${format(d, 'dd.MM.yy')}`
                      }}
                      width="w-28"
                    />
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {isSmmSales ? (
                      <InlineEditCell
                        mode="date"
                        value={p.endDate ? String(p.endDate).slice(0, 10) : ''}
                        onSave={(v) => patch(p.id, { endDate: v || null })}
                        formatter={(v) => v ? format(new Date(v), 'dd.MM.yy') : '—'}
                        width="w-28"
                      />
                    ) : p.endDate ? (
                      <span className={clsx(
                        'text-xs',
                        p.isOverdue ? 'text-red-500 font-semibold' : p.isUpcoming ? 'text-amber-600 dark:text-amber-400' : 'text-surface-500 dark:text-surface-400',
                      )}>
                        {p.isOverdue && '🔴 '}{p.isUpcoming && '🟠 '}
                        {format(new Date(p.endDate), 'dd.MM.yy')}
                      </span>
                    ) : (
                      <span className="text-xs text-surface-400">—</span>
                    )}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    {isSmmSales ? (
                      <InlineEditCell
                        mode="select"
                        value={p.status}
                        options={PROJECT_STATUS_OPTIONS}
                        onSave={(v) => patch(p.id, { status: v })}
                        formatter={(v) => PROJECT_STATUS_OPTIONS.find(o => o.value === v)?.label || v}
                        width="w-32"
                      />
                    ) : p.budget > 0 && p.remaining === 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={12} /> Оплачено
                      </span>
                    ) : (
                      <StatusBadge status={p.status} />
                    )}
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-sm text-surface-400">
                    Нет проектов по фильтру
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Per-project progress bars */}
        <div className="space-y-2 pt-3 border-t border-surface-100 dark:border-surface-700">
          <p className="text-xs font-medium text-surface-500 dark:text-surface-400">Прогресс оплаты:</p>
          {projects.slice(0, 8).map((p: any) => (
            <div key={p.id} className="flex items-center gap-3 text-xs">
              <Link to={`/projects/${p.id}`} className="w-40 truncate font-medium text-surface-700 dark:text-surface-300 hover:text-primary-600">
                {p.name}
              </Link>
              <div className="flex-1 min-w-0">
                <ProgressBar value={p.paidPct} />
              </div>
              <span className="w-10 text-right text-surface-500 tabular-nums">{p.paidPct}%</span>
              <Link to={`/projects/${p.id}`} className="p-1 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded">
                <Calendar size={14} />
              </Link>
            </div>
          ))}
        </div>
      </div>
      </CollapsibleSection>
    </div>
  )
}
