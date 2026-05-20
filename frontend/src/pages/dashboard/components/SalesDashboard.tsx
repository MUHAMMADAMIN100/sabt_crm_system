import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { analyticsApi, projectsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { PageLoader, StatusBadge, ProgressBar, CollapsibleSection } from '@/components/ui'
import { Calendar, CheckCircle2, Mail, Pencil } from 'lucide-react'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import clsx from 'clsx'

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
    return (
      <input
        autoFocus
        type={mode === 'date' ? 'date' : 'text'}
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
  // Сегмент МП: СММ → SMM-проекты, разработка → «Web сайт».
  const segmentType =
    role === 'sales_manager_dev' ? 'Web сайт'
    : role === 'sales_manager_smm' ? 'SMM'
    : null

  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['sales-stats'],
    queryFn: analyticsApi.sales,
  })

  // Только МП по СММ может править все колонки таблицы (name/endDate/status).
  // У остальных (МП по разработке) — только бюджет.
  const isSmmSales = role === 'sales_manager_smm'

  // Универсальная мутация: апдейт любого поля проекта из инлайн-ячейки.
  // После сохранения инвалидирует панель, список проектов, аналитику и карточку.
  const updateProjectMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, any> }) =>
      projectsApi.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['sales-stats'] })
      const prev = qc.getQueryData(['sales-stats'])
      qc.setQueryData(['sales-stats'], (old: any) => {
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
      qc.setQueryData(['sales-stats'], ctx?.prev)
      toast.error('Не удалось сохранить')
    },
    onSuccess: () => {
      toast.success('Изменения сохранены')
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] })
      qc.invalidateQueries({ queryKey: ['project'] })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sales-stats'] }),
  })

  const patch = (id: string, p: Record<string, any>) => updateProjectMut.mutate({ id, patch: p })

  const projects = useMemo(() => {
    let list = (data?.projects || []) as any[]
    // Каждый МП видит только проекты своего направления.
    if (segmentType) list = list.filter(p => p.projectType === segmentType)
    if (filter === 'overdue') return list.filter(p => p.isOverdue)
    if (filter === 'upcoming') return list.filter(p => p.isUpcoming)
    if (filter === 'outstanding') return list.filter(p => p.remaining > 0)
    if (filter === 'paid') return list.filter(p => p.budget > 0 && p.remaining === 0)
    return list
  }, [data, filter, segmentType])

  if (isLoading) return <PageLoader />

  const totalCount = segmentType
    ? ((data?.projects || []) as any[]).filter(p => p.projectType === segmentType).length
    : (data?.projectCount || 0)

  return (
    <div className="space-y-6">
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
                  <td colSpan={7} className="text-center py-8 text-sm text-surface-400">
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
