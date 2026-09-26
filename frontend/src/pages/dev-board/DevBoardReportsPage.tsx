import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FileText, Copy, Download, Printer, Loader2,
  ListTodo, CheckCircle2, Clock, AlarmClock, Ban, FolderOpen, ShieldAlert,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { devTrackerApi, projectsApi } from '@/services/api.service'
import type {
  DevTrackerReport, DevTrackerReportBlocker, DevTrackerReportQuery,
} from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import { PageLoader, StatCard, EmptyState, Select } from '@/components/ui'
import { Markdown } from './markdown'
import { DEV_STATUS_LABELS, selectDevProjects, fmtDeadline } from './devBoardTypes'
import { boardUrl, taskUrl } from '@/pages/dev/devLinks'

/**
 * «Отчёты для руководства» — шаблоны «Неделя / Спринт / Проект» поверх
 * GET /dev-tracker/reports с превью (StatCard'ы, блокеры, команда, markdown)
 * и действиями «Копировать / Скачать .md / Печать».
 *
 * Только manage: гард тот же, что внутри соседних manage-зон доски —
 * userCan(user, 'dev-tracker.manage') (в App.tsx dev-board различается лишь
 * по dev-tracker.view, manage enforcement — внутри страниц).
 * Бэкенд endpoint'а может ещё не быть — generate ловит 404 тостом,
 * страница не падает, пустые данные → EmptyState «Нет данных за период».
 */

type ReportTemplate = 'week' | 'sprint' | 'project'

/** Число от бэка: null/undefined/NaN/Infinity → fallback (иначе JSX покажет NaN). */
const num = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** assignee в контракте — строка или объект: нормализуем к имени. */
function blockerAssigneeName(b: DevTrackerReportBlocker): string | null {
  const a = b.assignee
  if (!a) return null
  if (typeof a === 'string') return a.trim() || null
  return a.name?.trim() || null
}

/** Print-CSS: печатается только превью (#dev-report-preview), шапка страницы,
 *  карточки шаблонов и кнопки действий скрыты. Scoped-стили страницы. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #dev-report-preview, #dev-report-preview * { visibility: visible !important; }
  #dev-report-preview {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    margin: 0 !important;
  }
  #dev-report-preview .card {
    box-shadow: none !important;
    break-inside: avoid;
  }
}
`

export default function DevBoardReportsPage() {
  const user = useAuthStore(s => s.user)
  const canManage = userCan(user, 'dev-tracker.manage')

  const [template, setTemplate] = useState<ReportTemplate>('week')
  const [days, setDays] = useState('7')
  const [weekProjectId, setWeekProjectId] = useState('')
  const [sprintId, setSprintId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [report, setReport] = useState<DevTrackerReport | null>(null)
  const [generated, setGenerated] = useState(false)
  const [loading, setLoading] = useState(false)

  // Спринты — через devTrackerApi.getSprints (тот же источник, что фильтр
  // доски). Бэка может не быть — retry выключен, пусто → плейсхолдер.
  const { data: sprintsData, isLoading: sprintsLoading } = useQuery({
    queryKey: ['dev-tracker', 'sprints'],
    queryFn: () => devTrackerApi.getSprints(),
    retry: false,
    staleTime: 60_000,
  })
  const sprints = useMemo(() => {
    if (Array.isArray(sprintsData)) return sprintsData as { id: string; name: string }[]
    const nested = (sprintsData as { items?: unknown; sprints?: unknown } | null | undefined)?.items
      ?? (sprintsData as { items?: unknown; sprints?: unknown } | null | undefined)?.sprints
    return Array.isArray(nested) ? (nested as { id: string; name: string }[]) : []
  }, [sprintsData])

  // Dev-проекты — как фильтр доски: все проекты, отбор dev-типов по projectType.
  const { data: rawProjects } = useQuery({
    queryKey: ['dev-projects-for-reports'],
    queryFn: () => projectsApi.list({}),
    retry: 1,
    staleTime: 120_000,
  })
  const devProjects = useMemo(
    () => selectDevProjects(Array.isArray(rawProjects) ? (rawProjects as { id: string; name?: string; projectType?: string }[]) : [])
      .map(p => ({ id: String(p.id), name: (p.name ?? '').trim() || 'Без названия' })),
    [rawProjects],
  )

  // ── Нормализованные данные отчёта (контракт сверх — опционально) ──────
  // Числа коалесцим через num(): ?? пропустил бы NaN/Infinity/строки от
  // частичного контракта бэка прямо в StatCard.
  const stats = useMemo(() => {
    const s = report?.stats ?? {}
    return {
      created: num((s as Record<string, unknown>).created),
      done: num((s as Record<string, unknown>).done),
      doneOnTime: num((s as Record<string, unknown>).doneOnTime),
      overdue: num((s as Record<string, unknown>).overdue),
      blocked: num((s as Record<string, unknown>).blocked),
      open: num((s as Record<string, unknown>).open),
    }
  }, [report])
  const slaBreached: number | null =
    typeof report?.stats?.slaBreached === 'number' ? (report?.stats?.slaBreached as number) : null
  const rawBlockers = report?.blockers
  const blockers: DevTrackerReportBlocker[] = Array.isArray(rawBlockers) ? rawBlockers : []
  const rawMembers = report?.members
  const members = Array.isArray(rawMembers) ? rawMembers : []
  const rawVelocity = report?.velocity
  const velocity = Array.isArray(rawVelocity) ? rawVelocity : []
  const markdown = (report?.markdown ?? '').trim()

  const hasNumbers =
    stats.created > 0 || stats.done > 0 || stats.doneOnTime > 0 ||
    stats.overdue > 0 || stats.blocked > 0 || stats.open > 0 ||
    (slaBreached !== null && slaBreached > 0)
  const isEmptyReport =
    !hasNumbers && blockers.length === 0 && members.length === 0 &&
    velocity.length === 0 && !markdown

  // Только manage — тот же ин-component гард, что в DevBoardPage/деталке.
  if (!canManage) return <Navigate to={boardUrl()} replace />

  const handleGenerate = async () => {
    if (template === 'sprint' && !sprintId) { toast.error('Выберите спринт'); return }
    if (template === 'project' && !projectId) { toast.error('Выберите проект'); return }
    const params: DevTrackerReportQuery =
      template === 'week'
        ? { type: 'week', days: Number(days), ...(weekProjectId ? { projectId: weekProjectId } : {}) }
        : template === 'sprint'
          ? { type: 'sprint', sprintId }
          : { type: 'project', projectId }
    setLoading(true)
    // Свой таймаут 30с: глобальный у api — 90с (под AI-запросы), а висеть
    // с крутилкой полторы минуты нельзя — backend в dev-окружении иногда
    // лежит после перезагрузки машины. AbortController гарантирует выход.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    try {
      const data = await devTrackerApi.getReports(params, ctrl.signal)
      setReport(data ?? null)
      setGenerated(true)
    } catch (e: any) {
      // Бэк-агент делает endpoint параллельно: 404/501 — штатно, тост.
      const status = e?.response?.status
      const canceled =
        e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
      if (canceled) {
        toast.error('Сервер не отвечает дольше 30 секунд — проверьте, что бэкенд запущен (порт 3000)')
      } else if (status === 404 || status === 501) {
        toast.error('Отчёты пока недоступны — бэкенд готовит endpoint')
      } else {
        toast.error(e?.response?.data?.message || 'Не удалось сформировать отчёт')
      }
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }

  const copyMarkdown = async () => {
    if (!markdown) { toast.error('В отчёте нет markdown-текста'); return }
    try {
      await navigator.clipboard.writeText(markdown)
      toast.success('Markdown скопирован')
    } catch {
      // Fallback для non-secure context / отказа в доступе к clipboard.
      let ta: HTMLTextAreaElement | null = null
      try {
        ta = document.createElement('textarea')
        ta.value = markdown
        // Не дёргаем скролл страницы при фокусе фолбэк-поля.
        ta.style.position = 'fixed'
        ta.style.top = '0'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        if (!ok) throw new Error('copy failed')
        toast.success('Markdown скопирован')
      } catch {
        toast.error('Не удалось скопировать')
      } finally {
        if (ta && ta.parentNode) ta.parentNode.removeChild(ta)
      }
    }
  }

  const downloadMarkdown = () => {
    if (!markdown) { toast.error('В отчёте нет markdown-текста'); return }
    const name =
      template === 'week' ? `dev-report-week-${days}d.md`
      : template === 'sprint' ? 'dev-report-sprint.md'
      : 'dev-report-project.md'
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Файл сохранён')
  }

  const cardCls = (active: boolean) =>
    clsx(
      'card text-left w-full cursor-pointer transition-colors',
      active
        ? 'ring-2 ring-primary-500'
        : 'hover:border-surface-300 dark:hover:border-surface-600',
    )

  return (
    <div className="min-w-0 space-y-5">
      {/* Шапка */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <div aria-hidden="true" className="w-10 h-10 rounded-lg bg-primary-600 flex items-center justify-center shrink-0">
            <FileText size={20} className="text-white" />
          </div>
          <h1 className="page-title min-w-0 flex-1 break-words">
            Отчёты для руководства
          </h1>
        </div>
      </div>

      {/* Шаблоны: grid collapses на мобиле, селекты full-width.
          Карточка кликабельна мышью; с клавиатуры шаблон выбирается и сменой
          значения селекта (onChange тоже ставит template) — фокус на div
          не обязателен, вложенный select уже в таб-порядке. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div
          onClick={() => setTemplate('week')}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTemplate('week') }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={template === 'week'}
          aria-label="Шаблон: неделя"
          className={cardCls(template === 'week')}>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">
            Неделя
          </h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
            Итоги за период, опционально по проекту.
          </p>
          <div className="space-y-2">
            <Select
              value={days}
              onChange={v => { setDays(v); setTemplate('week') }}
              className="w-full min-h-[40px] sm:min-h-[34px]"
              options={[
                { value: '7', label: '7 дней' },
                { value: '14', label: '14 дней' },
                { value: '30', label: '30 дней' },
              ]}
            />
            <Select
              value={weekProjectId}
              onChange={v => { setWeekProjectId(v); setTemplate('week') }}
              className="w-full min-h-[40px] sm:min-h-[34px]"
              placeholder="Все проекты"
              options={devProjects.map(p => ({ value: p.id, label: p.name }))}
            />
          </div>
        </div>

        <div
          onClick={() => setTemplate('sprint')}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTemplate('sprint') }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={template === 'sprint'}
          aria-label="Шаблон: спринт"
          className={cardCls(template === 'sprint')}>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">
            Спринт
          </h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
            Итоги спринта: scope, velocity, блокеры.
          </p>
          <Select
            value={sprintId}
            onChange={v => { setSprintId(v); setTemplate('sprint') }}
            className="w-full min-h-[40px] sm:min-h-[34px]"
            placeholder={sprintsLoading ? 'Загрузка…' : sprints.length ? 'Выберите спринт' : 'Спринты недоступны'}
            options={sprints.map(s => ({ value: s.id, label: s.name }))}
          />
        </div>

        <div
          onClick={() => setTemplate('project')}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTemplate('project') }
          }}
          role="button"
          tabIndex={0}
          aria-pressed={template === 'project'}
          aria-label="Шаблон: проект"
          className={cardCls(template === 'project')}>
          <h2 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">
            Проект
          </h2>
          <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
            Сводка по dev-проекту: статусы, блокеры, команда.
          </p>
          <Select
            value={projectId}
            onChange={v => { setProjectId(v); setTemplate('project') }}
            className="w-full min-h-[40px] sm:min-h-[34px]"
            placeholder={devProjects.length ? 'Выберите проект' : 'Проекты недоступны'}
            options={devProjects.map(p => ({ value: p.id, label: p.name }))}
          />
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="btn-primary min-h-[40px] sm:min-h-[34px] inline-flex items-center justify-center gap-2 w-full sm:w-auto disabled:opacity-60"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          Сформировать
        </button>
        {loading && (
          <p className="text-xs text-surface-400 dark:text-surface-500 mt-2">
            Запрашиваю данные у сервера… если висит дольше 30 секунд — проверьте бэкенд
          </p>
        )}
      </div>

      {loading && !report ? (
        <PageLoader />
      ) : !generated ? (
        <div className="card">
          <EmptyState
            title="Отчёт не сформирован"
            description="Выберите шаблон выше и нажмите «Сформировать»."
          />
        </div>
      ) : !report || isEmptyReport ? (
        <div className="card">
          <EmptyState
            title="Нет данных за период"
            description="За выбранный период задач не найдено — попробуйте другой период или шаблон."
          />
        </div>
      ) : (
        <>
          {/* Действия с отчётом (в печать не попадают — вне #dev-report-preview) */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyMarkdown}
              className="btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1.5 text-sm"
            >
              <Copy size={15} /> Копировать markdown
            </button>
            <button
              type="button"
              onClick={downloadMarkdown}
              className="btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1.5 text-sm"
            >
              <Download size={15} /> Скачать .md
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-secondary !py-1.5 min-h-[40px] sm:min-h-[34px] inline-flex items-center gap-1.5 text-sm"
            >
              <Printer size={15} /> Печать
            </button>
          </div>

          {/* Превью — единственный печатаемый блок */}
          <div id="dev-report-preview" className="space-y-4 min-w-0 max-w-full">
            <div>
              <h2 className="text-lg font-bold text-surface-900 dark:text-surface-100">
                {report.title || 'Отчёт'}
              </h2>
              {report.period && (
                <p className="text-sm text-surface-500 dark:text-surface-400">{report.period}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard title="Создано" value={stats.created} icon={ListTodo} color="bg-primary-600" />
              <StatCard title="Выполнено" value={stats.done} icon={CheckCircle2} color="bg-green-500" />
              <StatCard title="В срок" value={stats.doneOnTime} icon={Clock} color="bg-emerald-500" />
              <StatCard
                title="Просрочено"
                value={stats.overdue}
                icon={AlarmClock}
                color={stats.overdue > 0 ? 'bg-red-500' : 'bg-surface-400'}
              />
              <StatCard title="Заблокировано" value={stats.blocked} icon={Ban} color="bg-amber-500" />
              <StatCard title="Открыто" value={stats.open} icon={FolderOpen} color="bg-sky-500" />
              {slaBreached !== null && (
                <StatCard
                  title="SLA нарушено"
                  value={slaBreached}
                  icon={ShieldAlert}
                  color={slaBreached > 0 ? 'bg-red-500' : 'bg-surface-400'}
                />
              )}
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
                Блокеры{blockers.length > 0 ? ` (${blockers.length})` : ''}
              </h3>
              {blockers.length === 0 ? (
                <p className="text-sm text-surface-400 dark:text-surface-500 py-2">
                  Блокеров нет — всё движется.
                </p>
              ) : (
                <ul className="divide-y divide-surface-100 dark:divide-surface-700/50">
                  {blockers.map(b => {
                    const assignee = blockerAssigneeName(b)
                    const statusLabel = b.status
                      ? ((DEV_STATUS_LABELS as Record<string, string>)[b.status] ?? b.status)
                      : null
                    return (
                      <li key={b.id}>
                        <Link
                          to={taskUrl(b.id)}
                          className="flex items-center gap-3 min-w-0 py-2.5 group"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-surface-800 dark:text-surface-200 truncate group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                              {b.title || 'Без названия'}
                            </p>
                            {b.reason && (
                              <p className="text-sm text-surface-500 dark:text-surface-400 truncate">
                                {b.reason}
                              </p>
                            )}
                          </div>
                          {assignee && (
                            <span className="shrink-0 hidden sm:inline text-xs text-surface-500 dark:text-surface-400 truncate max-w-[160px]">
                              {assignee}
                            </span>
                          )}
                          {statusLabel && (
                            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 whitespace-nowrap">
                              {statusLabel}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {members.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
                  Команда
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-surface-400 dark:text-surface-500 border-b border-surface-100 dark:border-surface-700">
                        <th className="pb-2 pr-3 font-medium">Сотрудник</th>
                        <th className="pb-2 px-2 font-medium text-center">Всего</th>
                        <th className="pb-2 px-2 font-medium text-center">Сделано</th>
                        <th className="pb-2 px-2 font-medium text-center">В срок</th>
                        <th className="pb-2 px-2 font-medium text-center">Просрочено</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m, i) => (
                        <tr
                          key={m.assigneeId || `${m.name ?? 'member'}-${i}`}
                          className="border-b border-surface-50 dark:border-surface-700/50 last:border-0"
                        >
                          <td className="py-2 pr-3 font-medium text-surface-800 dark:text-surface-200 truncate max-w-[220px]">
                            {String(m.name ?? '').trim() || 'Без имени'}
                          </td>
                          <td className="py-2 px-2 text-center tabular-nums text-surface-700 dark:text-surface-300">
                            {num(m.total)}
                          </td>
                          <td className="py-2 px-2 text-center tabular-nums text-surface-700 dark:text-surface-300">
                            {num(m.done)}
                          </td>
                          <td className="py-2 px-2 text-center tabular-nums text-green-600 dark:text-green-400">
                            {num(m.doneOnTime)}
                          </td>
                          <td className="py-2 px-2 text-center tabular-nums text-surface-700 dark:text-surface-300">
                            {num(m.overdue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Подписи недель velocity — общий fmtDeadline из ./devBoardTypes
                ('YYYY-MM-DD' → 'дд.мм', нарезкой строки, без Date — таймзона
                не сдвигает день). */}
            {velocity.length > 0 && (
              <div className="card">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
                  Velocity
                </h3>
                <div className="flex flex-wrap gap-2">
                  {velocity.map((v, i) => {
                    const label = v.week ? fmtDeadline(v.week) : `#${i + 1}`
                    const parts: string[] = []
                    if (typeof v.points === 'number' && Number.isFinite(v.points)) parts.push(`${v.points} pt`)
                    if (typeof v.count === 'number' && Number.isFinite(v.count)) parts.push(`${v.count} задач`)
                    return (
                      <span
                        key={`${label}-${i}`}
                        className="text-xs px-2.5 py-1 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 tabular-nums"
                      >
                        {label}{parts.length ? `: ${parts.join(' · ')}` : ''}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {markdown && (
              <div className="card min-w-0 max-w-full">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-3">
                  Текст отчёта
                </h3>
                {/* Таблицы/широкий markdown-контент скроллятся внутри превью,
                    страница на 360px не получает горизонтального скролла. */}
                <div className="min-w-0 max-w-full overflow-x-auto">
                  <Markdown
                    text={report.markdown as string}
                    className="space-y-2 text-sm break-words text-surface-700 dark:text-surface-300"
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {/* Print-CSS намеренно последним ребёнком space-y-5: как первый он
          входил в селектор space-y и «толкал» шапку вниз на 20px — заголовок
          «Отчёты» рисовался ниже оси остальных страниц раздела. */}
      <style>{PRINT_CSS}</style>
    </div>
  )
}
