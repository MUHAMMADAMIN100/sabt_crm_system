import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { Pencil, PhoneCall, X } from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { clientsApi } from '@/services/api.service'
import { salesKeys } from '@/lib/salesQueries'
import { normalizeStatus, stageMeta } from '@/lib/salesStages'
import { useAuthStore } from '@/store/auth.store'
import type { LeadStatus, SalesLead } from '@/types/sales'
import DrawerShell from './drawer/DrawerShell'
import OwnerControl from './drawer/OwnerControl'
import LeadStageBlock from './drawer/LeadStageBlock'
import LeadActions from './drawer/LeadActions'
import LeadNextStep from './drawer/LeadNextStep'
import LeadDeal from './drawer/LeadDeal'
import LeadContacts from './drawer/LeadContacts'
import LeadHistory from './drawer/LeadHistory'
import StageBadge from './StageBadge'
import CallSheet from './CallSheet'
import MeetingResultSheet from './MeetingResultSheet'
import MeetingScheduleModal from './MeetingScheduleModal'
import LostReasonModal from './LostReasonModal'
import HandoffModal from './HandoffModal'
import { ClientForm } from './ClientForm'
import { useLeadUpdate } from './salesHooks'
import { canWorkLead, formatMoney } from './leadUtils'

/**
 * Карточка лида (15.11.2026, макет «Карточка лида»): правая панель на
 * компьютере, шторка снизу на телефоне. Всё, что менеджер делает с лидом
 * каждый день, — здесь: этап, звонок/письмо/встреча, следующий шаг, сделка,
 * контакты и история. Редкие поля — в полной форме «Все поля».
 *
 * leadId = null — карточка закрыта. Пока грузится, показываем лид из кэша
 * доски/списка (если есть) — карточка открывается мгновенно.
 */
export default function LeadDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const titleId = useId()
  return (
    <DrawerShell open={!!leadId} onClose={onClose} labelledBy={titleId}>
      {leadId && <DrawerBody key={leadId} leadId={leadId} titleId={titleId} onClose={onClose} />}
    </DrawerShell>
  )
}

/** Лид из уже загруженной доски / списка — для мгновенного показа. */
function findCachedLead(qc: QueryClient, id: string): SalesLead | undefined {
  for (const [, data] of qc.getQueriesData<any>({ queryKey: ['leads'] })) {
    const arr: any[] | null = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null
    const hit = arr?.find(l => l?.id === id)
    if (hit) return hit as SalesLead
  }
  return undefined
}

type Sheet = 'call' | 'meeting' | 'meeting-result' | 'lost' | 'handoff' | 'form' | null

function DrawerBody({ leadId, titleId, onClose }: { leadId: string; titleId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const me = useAuthStore(s => s.user)
  const [sheet, setSheet] = useState<Sheet>(null)
  const q = useQuery({
    queryKey: salesKeys.lead(leadId),
    queryFn: () => clientsApi.get(leadId) as Promise<SalesLead>,
    placeholderData: () => findCachedLead(qc, leadId),
  })
  const update = useLeadUpdate()
  const lead = q.data
  const closeSheet = () => setSheet(null)

  const closeBtn = (
    <button type="button" onClick={onClose} aria-label="Закрыть карточку" title="Закрыть"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">
      <X size={18} aria-hidden="true" />
    </button>
  )

  if (!lead) {
    if (q.isError) {
      const status = (q.error as any)?.response?.status
      const gone = status === 404 || status === 403
      return (
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-3 px-4 pt-3 sm:px-5">
            <h2 id={titleId} className="pt-2 text-base font-semibold">Карточка лида</h2>
            {closeBtn}
          </div>
          <div className="px-4 py-10 text-center sm:px-5">
            <p className="text-sm text-surface-700 dark:text-surface-200">
              {gone ? 'Лид не найден или удалён' : 'Не удалось загрузить лид'}
            </p>
            {!gone && <button type="button" onClick={() => q.refetch()} className="btn-secondary mt-4 min-h-[44px]">Повторить</button>}
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-col" aria-busy="true">
        <div className="flex items-start justify-between gap-3 px-4 pt-3 sm:px-5">
          <div className="flex-1 space-y-2 pt-2">
            <h2 id={titleId} className="sr-only">Загрузка карточки лида</h2>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          {closeBtn}
        </div>
        <div className="space-y-4 px-4 py-5 sm:px-5" aria-hidden="true">
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-14" />)}</div>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }

  const canAct = canWorkLead(me, lead)
  const meta = [lead.sphere, lead.leadSource].filter(Boolean).join(' · ')
  const handoffAt = lead.handoffAt ? new Date(lead.handoffAt) : null

  const setStage = (s: LeadStatus) => update.mutate(
    { id: lead.id, data: { status: s } },
    { onSuccess: () => toast.success(`Этап: ${stageMeta(s).label}`) },
  )
  const toggleHold = () => update.mutate(
    { id: lead.id, data: { onHold: !lead.onHold } },
    { onSuccess: saved => toast.success(saved.onHold ? 'Лид на паузе' : 'Пауза снята') },
  )

  // «Все поля»: «Выиграно» из формы ведём через «Передать в работу» —
  // команда должна получить данные о продаже, а не просто смену этапа.
  const submitForm = async (data: Partial<SalesLead>) => {
    const wantsWon = data.status === 'won' && normalizeStatus(lead.status) !== 'won' && !lead.handoffAt
    const payload = { ...data }
    if (wantsWon) delete payload.status
    await update.mutateAsync({ id: lead.id, data: payload })
    toast.success('Сохранено')
    setSheet(wantsWon ? 'handoff' : null)
  }

  return (
    <>
      <header className="flex shrink-0 items-start gap-2 px-4 pb-3 pt-3 sm:px-5">
        <div className="min-w-0 flex-1 pt-1">
          <h2 id={titleId} className="break-words text-lg font-semibold leading-snug text-surface-900 dark:text-surface-50">{lead.name}</h2>
          {meta && <p className="mt-0.5 text-sm text-surface-500 dark:text-surface-400">{meta}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StageBadge status={lead.status} />
            {lead.onHold && (
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">На паузе</span>
            )}
            {lead.callRequested && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-800/50 dark:text-amber-200"
                title={lead.callRequestedByName ? `Отметил: ${lead.callRequestedByName}` : undefined}>
                <PhoneCall size={11} aria-hidden="true" /> Позвонить
              </span>
            )}
          </div>
          <OwnerControl lead={lead} me={me} />
        </div>
        {canAct && (
          <button type="button" onClick={() => setSheet('form')} aria-label="Все поля лида" title="Все поля"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700">
            <Pencil size={17} aria-hidden="true" />
          </button>
        )}
        {closeBtn}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        {handoffAt && !isNaN(handoffAt.getTime()) && (
          <div className="mx-4 mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-sm text-green-900 dark:border-green-800/60 dark:bg-green-900/25 dark:text-green-200 sm:mx-5">
            <p className="font-semibold">Передано в работу {format(handoffAt, 'd MMMM yyyy', { locale: ru })}</p>
            {lead.handoffData && (
              <p className="mt-0.5 text-[13px] opacity-90">
                {[lead.handoffData.product, lead.handoffData.amount ? formatMoney(lead.handoffData.amount) : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {lead.projectId ? (
              <Link to={`/projects/${lead.projectId}`} className="mt-1 inline-flex min-h-[36px] items-center font-medium underline underline-offset-2 hover:no-underline">
                Открыть проект
              </Link>
            ) : (
              <p className="mt-1 text-[13px]">Проект создаётся</p>
            )}
          </div>
        )}

        <LeadStageBlock
          lead={lead}
          canAct={canAct}
          pending={update.isPending}
          onStage={setStage}
          onWon={() => setSheet('handoff')}
          onLost={() => setSheet('lost')}
          onToggleHold={toggleHold}
        />
        <LeadActions
          lead={lead}
          canAct={canAct}
          onCall={() => setSheet('call')}
          onMeeting={() => setSheet('meeting')}
          onMeetingResult={() => setSheet('meeting-result')}
        />
        <LeadNextStep lead={lead} canAct={canAct} />
        <LeadDeal lead={lead} canAct={canAct} />
        <LeadContacts lead={lead} canAct={canAct} />
        <LeadHistory leadId={lead.id} />
        {canAct && (
          <div className="border-t border-surface-200 px-4 py-4 dark:border-surface-700 sm:px-5">
            <button type="button" onClick={() => setSheet('form')}
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline dark:text-primary-300">
              <Pencil size={14} aria-hidden="true" /> Все поля
            </button>
          </div>
        )}
      </div>

      <CallSheet lead={sheet === 'call' ? lead : null} onClose={closeSheet} />
      <MeetingResultSheet lead={sheet === 'meeting-result' ? lead : null} onClose={closeSheet} />
      <MeetingScheduleModal lead={sheet === 'meeting' ? lead : null} onClose={closeSheet} />
      <LostReasonModal lead={sheet === 'lost' ? lead : null} onClose={closeSheet} />
      <HandoffModal lead={sheet === 'handoff' ? lead : null} onClose={closeSheet} />
      {sheet === 'form' && (
        <ClientForm initial={lead} onClose={closeSheet} onSubmit={submitForm} loading={update.isPending} />
      )}
    </>
  )
}
