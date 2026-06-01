import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/ui'
import { kpiApi } from '@/services/api.service'
import { ChevronRight, ExternalLink, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import clsx from 'clsx'

interface DetailRecord {
  id: string
  title: string
  subtitle?: string | null
  date?: string | null
  link?: string | null
  meta?: Record<string, any>
}

interface Props {
  open: boolean
  onClose: () => void
  userId: string
  metric: string
  metricLabel: string
  from?: string
  to?: string
}

function formatDate(s?: string | null): string {
  if (!s) return ''
  try {
    return format(new Date(s), 'd MMMM yyyy, HH:mm', { locale: ru })
  } catch {
    return s
  }
}

/**
 * Модалка с подробным списком записей для одной KPI-метрики.
 * Открывается при клике на карточку метрики. Каждая запись —
 * кликабельная (link на профильную страницу клиента / задачи / проекта).
 */
export default function KpiDetailsModal({
  open, onClose, userId, metric, metricLabel, from, to,
}: Props) {
  const { data: records, isLoading } = useQuery<DetailRecord[]>({
    queryKey: ['kpi-details', userId, metric, from, to],
    queryFn: () => kpiApi.details(userId, metric, { from, to }),
    enabled: open && !!userId && !!metric,
    staleTime: 30_000,
  })

  return (
    <Modal open={open} onClose={onClose} title={metricLabel} size="lg">
      <div className="space-y-2">
        {isLoading && (
          <p className="text-xs text-surface-400 py-8 text-center animate-pulse">
            Загрузка…
          </p>
        )}
        {!isLoading && (!records || records.length === 0) && (
          <p className="text-sm text-surface-400 py-8 text-center">
            Записей за период нет
          </p>
        )}
        {!isLoading && records && records.length > 0 && (
          <>
            <div className="text-xs text-surface-500 dark:text-surface-400 mb-2">
              Всего записей: <b className="text-surface-700 dark:text-surface-200 tabular-nums">{records.length}</b>
            </div>
            <ul className="divide-y divide-surface-100 dark:divide-surface-700">
              {records.map((r) => {
                const inner = (
                  <div className={clsx(
                    'flex items-start gap-3 py-2.5 px-1',
                    r.link && 'hover:bg-surface-50 dark:hover:bg-surface-700/50 transition-colors rounded-md',
                  )}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-surface-900 dark:text-surface-100 truncate">
                        {r.title}
                      </p>
                      {r.subtitle && (
                        <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5 truncate">
                          {r.subtitle}
                        </p>
                      )}
                      {r.date && (
                        <p className="text-[11px] text-surface-400 dark:text-surface-500 mt-0.5 inline-flex items-center gap-1">
                          <Calendar size={10} /> {formatDate(r.date)}
                        </p>
                      )}
                    </div>
                    {r.link && (
                      <span className="text-surface-400 shrink-0 mt-1">
                        {r.link.startsWith('http') ? <ExternalLink size={14} /> : <ChevronRight size={14} />}
                      </span>
                    )}
                  </div>
                )
                return (
                  <li key={r.id}>
                    {r.link ? (
                      <Link to={r.link} onClick={onClose} className="block px-1">
                        {inner}
                      </Link>
                    ) : (
                      <div className="px-1">{inner}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
