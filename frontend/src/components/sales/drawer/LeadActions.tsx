import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { Calendar, CheckCircle2, Mail, MessageCircle, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import { directApi } from '@/services/direct.api'
import { salesApi } from '@/services/sales.api'
import type { SalesLead } from '@/types/sales'
import { afterLeadChange } from '../salesHooks'
import { endOfToday, errorText, formatAt, instagramHandle } from '../leadUtils'

const ACTION_CLS = 'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-lg border border-surface-200 bg-surface-50 px-1 text-xs font-medium text-surface-800 transition-colors hover:border-surface-400 hover:bg-surface-100 disabled:opacity-50 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-100 dark:hover:bg-surface-700'

/** Встреча назначена на сегодня или раньше и итог не отмечен. */
export function meetingNeedsResult(lead: Pick<SalesLead, 'nextContactAt' | 'meetingResult'>): boolean {
  if (!lead.nextContactAt || lead.meetingResult) return false
  const at = new Date(lead.nextContactAt)
  return !isNaN(at.getTime()) && at.getTime() <= endOfToday().getTime()
}

/**
 * Действия карточки (15.11.2026): Звонок → шторка звонка, Письмо → отметка
 * в истории и KPI, Встреча → назначить/перенести, а если встреча сегодня
 * или прошла без итога — «Итог встречи». «Директ» — только если лид
 * заведён из переписки: чат ищем по Instagram лида и сверяем привязку.
 */
export default function LeadActions({ lead, canAct, onCall, onMeeting, onMeetingResult }: {
  lead: SalesLead
  canAct: boolean
  onCall: () => void
  onMeeting: () => void
  onMeetingResult: () => void
}) {
  const qc = useQueryClient()
  const handle = instagramHandle(lead.contactInstagram)
  // Отдельный ключ, не под ['sales']: иначе поиск чата повторялся бы после
  // каждого действия с любым лидом.
  const chatQ = useQuery({
    queryKey: ['lead-direct-chat', lead.id, handle],
    queryFn: () => directApi.list({ search: handle, lead: 'with', limit: 10 }),
    enabled: !!handle,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const chat = chatQ.data?.items?.find(c => c.lead?.id === lead.id) ?? null

  const email = useMutation({
    mutationFn: () => salesApi.logEmail(lead.id),
    onSuccess: saved => { afterLeadChange(qc, saved); toast.success('Письмо отмечено') },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось отметить письмо')),
  })

  const needsResult = meetingNeedsResult(lead)
  const meetingAt = lead.nextContactAt ? new Date(lead.nextContactAt) : null
  const hasMeeting = !!meetingAt && !isNaN(meetingAt.getTime())

  const items: Array<{ key: string; node: ReactNode }> = []
  if (canAct) {
    items.push({ key: 'call', node: (
      <button type="button" onClick={onCall} className={ACTION_CLS}><Phone size={18} aria-hidden="true" /> Звонок</button>
    ) })
    items.push({ key: 'email', node: (
      <button type="button" onClick={() => email.mutate()} disabled={email.isPending} className={ACTION_CLS}>
        <Mail size={18} aria-hidden="true" /> {email.isPending ? 'Отмечаем…' : 'Письмо'}
      </button>
    ) })
    items.push({ key: 'meeting', node: needsResult ? (
      <button type="button" onClick={onMeetingResult} className={clsx(ACTION_CLS, '!border-violet-400 dark:!border-violet-500/70')}>
        <CheckCircle2 size={18} aria-hidden="true" /> Итог встречи
      </button>
    ) : (
      <button type="button" onClick={onMeeting} className={ACTION_CLS}><Calendar size={18} aria-hidden="true" /> Встреча</button>
    ) })
  }
  if (chat) {
    items.push({ key: 'direct', node: (
      <Link to={`/direct?c=${encodeURIComponent(chat.id)}`} className={ACTION_CLS}>
        <MessageCircle size={18} aria-hidden="true" /> Директ
      </Link>
    ) })
  }

  if (!items.length && !hasMeeting) return null

  return (
    <div className="px-4 pb-4 sm:px-5">
      {items.length > 0 && (
        <div className={clsx('grid gap-2', items.length >= 4 ? 'grid-cols-4' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
          {items.map(i => <div key={i.key} className="contents">{i.node}</div>)}
        </div>
      )}
      {hasMeeting && (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className={clsx('inline-flex items-center gap-1.5',
            needsResult ? 'text-violet-700 dark:text-violet-300' : 'text-surface-700 dark:text-surface-200')}>
            <Calendar size={14} aria-hidden="true" /> Встреча {formatAt(meetingAt!)}
          </span>
          {lead.meetingResult === 'held' && <span className="text-green-700 dark:text-green-300">· состоялась</span>}
          {lead.meetingResult === 'missed' && <span className="text-red-600 dark:text-red-300">· не состоялась</span>}
          {canAct && (
            <button type="button" onClick={onMeeting}
              className="inline-flex min-h-[36px] items-center rounded-md px-2 text-xs font-medium text-primary-700 hover:bg-surface-100 dark:text-primary-300 dark:hover:bg-surface-700 max-lg:min-h-[44px]">
              {lead.meetingResult ? 'Новая встреча' : 'Перенести'}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
