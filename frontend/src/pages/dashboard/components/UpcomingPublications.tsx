import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { workflowApi } from '@/services/api.service'
import { Clapperboard } from 'lucide-react'

interface UpcomingPublicationRow {
  cardId: string
  itemId?: string
  title: string
  projectId: string
  project: string
  publishDate: string
  stage: string
  ready: boolean
  published: boolean
  assigneeId: string | null
}

// «Сегодня»/«завтра» — по Душанбе, та же бизнес-зона, что и окно выборки на
// бэкенде (workflow.service#upcomingPublications), иначе метки разъехались
// бы с реальными датами на границе суток.
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dushanbe' })
const tomorrowISO = () => {
  const d = new Date(`${todayISO()}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA')
}

function dateLabel(iso: string): string {
  if (iso === todayISO()) return 'Сегодня'
  if (iso === tomorrowISO()) return 'Завтра'
  return new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

// Правило цветов: зелёный — только завершённое (опубликовано), красный — только
// просрочка (здесь её не бывает — окно всегда в будущем/сегодня). Остальное —
// нейтральный янтарь «в работе».
function StageBadge({ row }: { row: UpcomingPublicationRow }) {
  if (row.published) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Опубликовано
      </span>
    )
  }
  if (row.ready) {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
        Готово к публикации
      </span>
    )
  }
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      Ещё в работе
    </span>
  )
}

/**
 * «К публикации — сегодня и завтра» — все видеоролики (рилсы), запланированные
 * к публикации на ближайшие 1–2 дня. Для кабинета публикатора (видит всю
 * доску) и руководства СММ; сервер сам решает зону видимости по роли
 * (см. workflow.service#upcomingPublications).
 */
export default function UpcomingPublications() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ['workflow', 'upcoming-publications'],
    queryFn: () => workflowApi.upcomingPublications(2),
  })

  const list = (rows as UpcomingPublicationRow[]) || []

  return (
    <div className="card animate-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <Clapperboard size={16} className="text-primary-600" />
        <h3 className="font-semibold text-surface-900 dark:text-surface-100 text-sm">
          К публикации — сегодня и завтра
        </h3>
      </div>

      {isLoading ? (
        <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-4">Загрузка…</p>
      ) : list.length === 0 ? (
        <p className="text-xs text-surface-400 dark:text-surface-500 text-center py-4">Ближайших публикаций нет</p>
      ) : (
        <div className="space-y-1.5">
          {list.map(row => (
            <Link
              key={`${row.cardId}-${row.itemId || ''}`}
              to="/workflow-board"
              className="flex items-center gap-2 p-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{row.title}</p>
                <p className="text-[11px] text-primary-600 dark:text-primary-400 truncate">{row.project}</p>
              </div>
              <span className="text-xs text-surface-500 dark:text-surface-400 shrink-0">{dateLabel(row.publishDate)}</span>
              <StageBadge row={row} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
