import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Calendar, Plus } from 'lucide-react'
import { devTrackerApi } from '@/services/api.service'
import { Avatar } from '@/components/ui'
import { useAuthStore } from '@/store/auth.store'
import { userCan } from '@/lib/permissions'
import { DEV_STATUS_LABELS, fmtDeadline, isDevTaskOverdue, type DevTask } from '@/pages/dev-board/devBoardTypes'
import { boardUrl, taskUrl } from '../devLinks'

// ── Вкладка «Задачи» проекта разработки ────────────────────────────────
/** Задачи канбан-доски dev-tracker, привязанные к этому проекту.
 *  Переезд `DevProjectTasksTab` из SmmProjectPage (бывший таб «Задачи»
 *  карточки dev-проекта): тот же queryKey, тот же `devTrackerApi.list`,
 *  тот же счётчик done/total. Все ссылки — через `devLinks`.
 *  Плюс: sprint-бейдж и blocked-бейдж `⛔` в строках (поля `sprintId` /
 *  `isBlocked` / `blockedReason` есть в типе DevTask; если бэк их не прислал —
 *  бейджей просто нет, ничего не падает).
 *
 *  Единый источник задач — модуль /dev-board: здесь только срез по проекту,
 *  создание/редактирование живёт на доске.
 *
 *  Подписи статусов — общие DEV_STATUS_LABELS из devBoardTypes (единый
 *  источник); локально только бейдж-классы этой вкладки. */
// Бейдж-классы статусов вкладки (подписи — из DEV_STATUS_LABELS, не дублировать).
const DEV_STATUS_BADGE_CLS: Record<string, string> = {
  backlog:     'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
  todo:        'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  in_progress: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  in_review:   'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  testing:     'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  done:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

/** Длинный id спринта в компактный бейдж (полный id — в title). */
function shortSprint(id: string): string {
  const s = String(id)
  return s.length > 8 ? `${s.slice(0, 6)}…` : s
}

export function DevTasksTab({ projectId }: { projectId: string }) {
  // Создание задач — только dev-tracker.manage: без права ссылки «Задача» /
  // «Создать первую задачу» прячем (доска всё равно блокирует ?create=1
  // тостом — здесь первый рубеж, чтобы developer не упирался в 403).
  const user = useAuthStore(s => s.user)
  const canCreate = userCan(user, 'dev-tracker.manage')
  const { data, isLoading, isError, error, refetch } = useQuery<DevTask[]>({
    queryKey: ['dev-tracker', 'list', 'project', projectId],
    queryFn: () => devTrackerApi.list(projectId),
    // Пустой projectId не должен тянуть ВЕСЬ список: у list() фильтр ставится
    // только при truthy projectId, а вкладка живёт в контексте проекта.
    enabled: !!projectId,
    retry: false,
  })
  const tasks = Array.isArray(data) ? data : []
  const done = tasks.filter(t => t.status === 'done').length
  const isForbidden = (error as { response?: { status?: number } } | null)?.response?.status === 403

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Задачи разработки
        </h2>
        <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
          {done}/{tasks.length} готово
        </span>
        <div className="flex-1" />
        <Link
          to={boardUrl(projectId)}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
        >
          Открыть на доске
        </Link>
        {canCreate && (
        <Link
          to={boardUrl(projectId, true)}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#3f7a58] text-white hover:brightness-110 transition inline-flex items-center gap-1.5"
        >
          <Plus size={15} /> Задача
        </Link>
        )}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
          Загружаю задачи…
        </div>
      ) : isError && tasks.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">
            {isForbidden
              ? 'Нет доступа к задачам доски разработки.'
              : 'Не удалось загрузить задачи доски разработки.'}
          </p>
          {!isForbidden && (
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm font-semibold text-[#3f7a58] hover:underline"
          >
            Повторить
          </button>
          )}
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">
            К этому проекту ещё не привязано ни одной задачи доски разработки.
          </p>
          {canCreate && (
          <Link
            to={boardUrl(projectId, true)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#3f7a58] hover:underline"
          >
            <Plus size={15} /> Создать первую задачу
          </Link>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {tasks.map(t => {
            const badgeCls = DEV_STATUS_BADGE_CLS[t.status] || DEV_STATUS_BADGE_CLS.backlog
            const statusLabel = (DEV_STATUS_LABELS as Record<string, string>)[t.status] || t.status
            const overdue = isDevTaskOverdue(t)
            const blocked = !!t.isBlocked
            const blockedReason = t.blockedReason || null
            const sprintId = t.sprintId || null
            return (
              <Link
                key={t.id}
                to={taskUrl(t.id)}
                className="flex items-center gap-3 py-2.5 px-1 -mx-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 transition"
              >
                <span className={'text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 ' + badgeCls}>
                  {statusLabel}
                </span>
                {blocked && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 max-w-[180px]"
                    title={blockedReason ? `Заблокирована: ${blockedReason}` : 'Заблокирована'}
                  >
                    <span aria-hidden>⛔</span>
                    <span className="truncate">{blockedReason || 'Блокер'}</span>
                  </span>
                )}
                {sprintId && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded shrink-0 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                    title={`Спринт: ${sprintId}`}
                  >
                    <span aria-hidden>🏃</span> {shortSprint(sprintId)}
                  </span>
                )}
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate flex-1">
                  {t.title}
                </span>
                {t.storyPoints ? (
                  <span className="text-[11px] font-bold text-gray-400 shrink-0">{t.storyPoints} SP</span>
                ) : null}
                {t.deadline && (
                  <span
                    className={'inline-flex items-center gap-1 text-[11px] shrink-0 ' + (overdue ? 'text-red-500 font-semibold' : 'text-gray-400')}
                    title={overdue ? 'Дедлайн просрочен' : 'Дедлайн'}
                  >
                    <Calendar size={12} aria-hidden="true" />
                    {/* Общий fmtDeadline (нарезка строки): тот же формат, что на
                        доске, и без off-by-one new Date('YYYY-MM-DD') в UTC−. */}
                    {fmtDeadline(t.deadline)}
                  </span>
                )}
                {t.assignee && (
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Avatar name={t.assignee.name ?? '?'} src={t.assignee.avatarUrl || t.assignee.avatar || undefined} size={20} zoomable={false} />
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[110px] truncate">
                      {t.assignee.name ?? '—'}
                    </span>
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default DevTasksTab
