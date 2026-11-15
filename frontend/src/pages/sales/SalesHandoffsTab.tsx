// «Продажи → Заявки» (15.11.2026): сделки, которые менеджеры передали в
// работу (GET /sales/handoffs). «Ждут проекта» — проекта ещё нет: создать
// его по заявке (окно создания проекта SMM / разработки с подставленными
// данными и leadId) или связать с уже существующим. «С проектом» — ссылка
// на проект. Видят руководство и руководители направлений (сервер отдаёт
// директору только его направление).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ExternalLink, FileText, Instagram, Link as LinkIcon, Phone, Plus, User } from 'lucide-react'
import { salesApi } from '@/services/sales.api'
import { salesKeys } from '@/lib/salesQueries'
import { canCreateHandoffProject, canLinkHandoff, userCan } from '@/lib/permissions'
import { useUrlState } from '@/lib/urlState'
import { useAuthStore } from '@/store/auth.store'
import { EmptyState, SkeletonCard } from '@/components/ui'
import type { Handoff } from '@/types/sales'
import SmmProjectCreateModal from '@/pages/smm/SmmProjectCreateModal'
import DevProjectCreateModal from '@/pages/dev/components/DevProjectCreateModal'
import LinkProjectModal from './LinkProjectModal'
import { DIRECTION_LABEL, dayLabel, handedOverAgo, handoffAmount, handoffProjectUrl, instagramHandle, telHref } from './salesFormat'
import { ErrorCard, Segmented } from './salesUi'

type HandoffStatus = 'open' | 'done'
const STATUSES: readonly HandoffStatus[] = ['open', 'done']
const STATUS_OPTIONS: Array<{ value: HandoffStatus; label: string }> = [
  { value: 'open', label: 'Ждут проекта' },
  { value: 'done', label: 'С проектом' },
]

export default function SalesHandoffsTab() {
  const user = useAuthStore(s => s.user)
  const [status, setStatus] = useUrlState<HandoffStatus>('status', 'open', STATUSES)
  const [creating, setCreating] = useState<Handoff | null>(null)
  const [linking, setLinking] = useState<Handoff | null>(null)

  const q = useQuery({
    queryKey: salesKeys.handoffs(status),
    queryFn: () => salesApi.handoffs(status),
    staleTime: 30_000,
  })

  const mayCreate = (h: Handoff) => canCreateHandoffProject(user?.role, user?.secondaryRole, h.direction) && userCan(user, 'projects.create')
  const mayLink = canLinkHandoff(user?.role, user?.secondaryRole)
  // Новые сверху.
  const list = [...(q.data ?? [])].sort((a, b) => (b.handoffAt || '').localeCompare(a.handoffAt || ''))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Заявки" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        {q.data && q.data.length > 0 && (
          <span className="text-[13px] text-surface-500 dark:text-surface-400 tabular-nums">Всего: {q.data.length}</span>
        )}
      </div>

      {q.isPending ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3" role="status" aria-label="Загрузка заявок">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : q.isError ? (
        <ErrorCard text="Не удалось загрузить заявки от продаж." onRetry={() => q.refetch()} />
      ) : !list.length ? (
        <div className="card">
          {status === 'open'
            ? <EmptyState title="Новых заявок нет" description="Когда менеджер передаст сделку в работу, она появится здесь." />
            : <EmptyState title="Пока нет заявок с проектом" description="Здесь будут заявки, по которым уже создан или привязан проект." />}
        </div>
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {list.map(h => (
            <li key={h.leadId} className="min-w-0">
              <HandoffCard handoff={h}
                onCreate={mayCreate(h) ? () => setCreating(h) : undefined}
                onLink={mayLink ? () => setLinking(h) : undefined} />
            </li>
          ))}
        </ul>
      )}

      {creating && (creating.direction === 'smm'
        ? <SmmProjectCreateModal handoff={creating} onClose={() => setCreating(null)} />
        : <DevProjectCreateModal handoff={creating} onClose={() => setCreating(null)} />)}
      {linking && <LinkProjectModal handoff={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}

function HandoffCard({ handoff: h, onCreate, onLink }: {
  handoff: Handoff
  onCreate?: () => void
  onLink?: () => void
}) {
  const ig = instagramHandle(h.contactInstagram)
  const projectUrl = handoffProjectUrl(h)
  const facts: Array<[string, string]> = [
    ['Продукт', h.product || '—'],
    ['Сумма', handoffAmount(h.amount, h.direction)],
    ['Первая оплата', dayLabel(h.firstPaymentAt)],
  ]

  return (
    <article className="card h-full flex flex-col gap-3" aria-label={`Заявка: ${h.leadName}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-surface-900 dark:text-surface-100 break-words">{h.leadName}</h3>
          <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
            {h.manager?.name ? `${h.manager.name} · ` : ''}{h.handoffAt ? handedOverAgo(h.handoffAt) : 'передано'}
          </p>
        </div>
        <span className={clsx('badge shrink-0',
          h.direction === 'smm'
            ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
            : 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300')}>
          {DIRECTION_LABEL[h.direction] ?? h.direction}
        </span>
      </header>

      <dl className="grid grid-cols-1 xs:grid-cols-3 gap-2 text-[13px]">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-lg bg-surface-100 dark:bg-surface-900/60 px-2.5 py-2">
            <dt className="text-[11.5px] text-surface-500 dark:text-surface-400">{k}</dt>
            <dd className="font-semibold text-surface-900 dark:text-surface-100 tabular-nums break-words">{v}</dd>
          </div>
        ))}
      </dl>

      {(h.contactPerson || h.contactPhone || ig) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]" aria-label="Контакты клиента">
          {h.contactPerson && (
            <li className="inline-flex items-center gap-1.5 text-surface-700 dark:text-surface-200">
              <User size={14} className="text-surface-400" aria-hidden="true" /> {h.contactPerson}
            </li>
          )}
          {h.contactPhone && (
            <li>
              <a href={telHref(h.contactPhone)} className="inline-flex items-center gap-1.5 min-h-[32px] text-surface-800 dark:text-surface-100 underline-offset-2 hover:underline tabular-nums">
                <Phone size={14} className="text-surface-400" aria-hidden="true" /> {h.contactPhone}
              </a>
            </li>
          )}
          {ig && (
            <li>
              <a href={ig.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-h-[32px] text-surface-800 dark:text-surface-100 underline-offset-2 hover:underline">
                <Instagram size={14} className="text-surface-400" aria-hidden="true" /> {ig.handle}
              </a>
            </li>
          )}
        </ul>
      )}

      {h.sendBrief && (
        <p className="inline-flex items-center gap-1.5 self-start rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-1 text-[12px] font-medium">
          <FileText size={13} aria-hidden="true" /> Отправить клиенту бриф
        </p>
      )}

      {h.note?.trim() && (
        <p className="text-[13px] leading-relaxed text-surface-700 dark:text-surface-300 whitespace-pre-line break-words border-l-2 border-surface-200 dark:border-surface-600 pl-2.5">
          {h.note.trim()}
        </p>
      )}

      <div className="mt-auto pt-1 flex flex-col xs:flex-row flex-wrap gap-2">
        {projectUrl ? (
          <Link to={projectUrl} className="btn-secondary min-h-[44px] lg:min-h-[36px]">
            <ExternalLink size={15} aria-hidden="true" /> Открыть проект
          </Link>
        ) : (
          <>
            {onCreate && (
              <button type="button" onClick={onCreate} className="btn-primary min-h-[44px] lg:min-h-[36px]">
                <Plus size={15} aria-hidden="true" /> Создать проект
              </button>
            )}
            {onLink && (
              <button type="button" onClick={onLink} className="btn-secondary min-h-[44px] lg:min-h-[36px]">
                <LinkIcon size={15} aria-hidden="true" /> Связать с существующим
              </button>
            )}
            {!onCreate && !onLink && (
              <p className="text-xs text-surface-500 dark:text-surface-400">Проект по этой заявке создаёт руководитель направления.</p>
            )}
          </>
        )}
      </div>
    </article>
  )
}
