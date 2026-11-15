import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowRight, Calendar, CheckCircle2, FolderKanban, Flag, Mail, MessageSquare, Pause, Phone, Plus, Send, UserX, Users,
} from 'lucide-react'
import { Skeleton } from '@/components/ui'
import { salesApi } from '@/services/sales.api'
import { salesKeys } from '@/lib/salesQueries'
import { CALL_OUTCOMES, CALL_RESULTS, lostReasonLabel, stageMeta } from '@/lib/salesStages'
import type { LeadEvent, LeadEventKind } from '@/types/sales'
import { afterLeadChange } from '../salesHooks'
import { errorText, formatAt, formatMoney, relTime } from '../leadUtils'
import Section from './Section'

const ICON: Record<LeadEventKind, typeof Plus> = {
  created: Plus,
  stage: ArrowRight,
  owner: Users,
  call: Phone,
  email: Mail,
  meeting_set: Calendar,
  meeting_done: CheckCircle2,
  meeting_missed: UserX,
  next_step: Flag,
  comment: MessageSquare,
  hold: Pause,
  handoff: Send,
  project_linked: FolderKanban,
}

const VIA: Record<string, string> = { direct: 'из Директа', voice: 'голосом', site: 'с сайта', form: '' }
const NEXT_WORD: Record<string, string> = { callback: 'перезвонить', meeting: 'встреча', step: 'шаг' }

function at(iso: unknown): string | null {
  if (typeof iso !== 'string' || !iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : formatAt(d)
}

/** Событие ленты по-русски: заголовок, подробность и ссылка (если есть).
 *  Формат data — backend/src/modules/clients/lead-events.ts. */
function describe(e: LeadEvent): { title: string; detail?: string; link?: { to: string; label: string } } {
  const d: Record<string, any> = e.data || {}
  switch (e.kind) {
    case 'created': {
      const via = VIA[d.via] || ''
      return { title: `Лид создан${via ? ` ${via}` : ''}`, detail: d.source ? `Источник: ${d.source}` : undefined }
    }
    case 'stage':
      if (d.to === 'lost') {
        return { title: `Проиграно: ${lostReasonLabel(d.lostReason)}`, detail: d.comment || undefined }
      }
      return {
        title: d.from ? `Этап: ${stageMeta(d.from).label} → ${stageMeta(d.to).label}` : `Этап: ${stageMeta(d.to).label}`,
        detail: d.comment || undefined,
      }
    case 'owner':
      if (!d.toName) return { title: 'Ответственный снят' }
      return { title: d.fromName ? `Передан: ${d.fromName} → ${d.toName}` : `Ответственный: ${d.toName}` }
    case 'call': {
      const res = CALL_RESULTS.find(r => r.value === d.result)?.label ?? 'звонок'
      const out = CALL_OUTCOMES.find(o => o.value === d.outcome)?.label
      const next = d.next && at(d.next.at)
        ? `Дальше: ${NEXT_WORD[d.next.kind] ?? 'шаг'} ${at(d.next.at)}${d.next.text ? ` — ${d.next.text}` : ''}`
        : null
      return { title: `Звонок: ${res.toLowerCase()}${out ? `, ${out.toLowerCase()}` : ''}`, detail: [d.comment, next].filter(Boolean).join('\n') || undefined }
    }
    case 'email':
      return { title: 'Письмо отправлено', detail: d.comment || undefined }
    case 'meeting_set':
      return { title: at(d.at) ? `Встреча назначена: ${at(d.at)}` : 'Встреча отменена' }
    case 'meeting_done':
      return { title: 'Встреча состоялась', detail: d.comment || undefined }
    case 'meeting_missed':
      return { title: 'Встреча не состоялась', detail: d.comment || undefined }
    case 'next_step':
      if (!d.text && !d.at) return { title: 'Следующий шаг убран' }
      return { title: `Следующий шаг: ${d.text || 'без описания'}`, detail: at(d.at) ? `Срок: ${at(d.at)}` : 'Без срока' }
    case 'comment':
      return { title: 'Комментарий', detail: d.text || undefined }
    case 'hold':
      return { title: d.onHold ? 'Поставлен на паузу' : 'Снят с паузы' }
    case 'handoff': {
      const parts = [d.product, d.amount ? formatMoney(d.amount) : null].filter(Boolean).join(' · ')
      const pay = typeof d.firstPaymentAt === 'string' ? `Первая оплата: ${at(`${d.firstPaymentAt}T12:00:00`) ?? d.firstPaymentAt}` : null
      return { title: `Передан в работу${parts ? `: ${parts}` : ''}`, detail: [pay, d.note].filter(Boolean).join('\n') || undefined }
    }
    case 'project_linked':
      return {
        title: 'Создан проект',
        link: d.projectId ? { to: `/projects/${d.projectId}`, label: d.projectName || 'Открыть проект' } : undefined,
      }
    default:
      return { title: 'Событие' }
  }
}

/**
 * «История» лида (15.11.2026): лента событий новые сверху
 * (GET /sales/leads/:id/events) и комментарий. Каждое действие — звонок,
 * письмо, этап, передача — видно с автором и временем.
 */
export default function LeadHistory({ leadId }: { leadId: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [all, setAll] = useState(false)
  const q = useQuery({ queryKey: salesKeys.events(leadId), queryFn: () => salesApi.events(leadId) })

  const add = useMutation({
    mutationFn: () => salesApi.comment(leadId, text.trim().slice(0, 2000)),
    onSuccess: ev => {
      qc.setQueryData<LeadEvent[]>(salesKeys.events(leadId), old => [ev, ...(old || [])])
      setText('')
      afterLeadChange(qc)
    },
    onError: (e: any) => toast.error(errorText(e, 'Комментарий не добавлен')),
  })

  const events = q.data || []
  const shown = all ? events : events.slice(0, 20)

  return (
    <Section title="История">
      <form onSubmit={e => { e.preventDefault(); if (text.trim()) add.mutate() }} className="mb-4 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`comment-${leadId}`} className="sr-only">Комментарий</label>
          <textarea id={`comment-${leadId}`} rows={1} maxLength={2000} className="input min-h-[44px] resize-y" value={text}
            onChange={e => setText(e.target.value)} placeholder="Комментарий для истории" />
        </div>
        <button type="submit" disabled={!text.trim() || add.isPending} className="btn-secondary min-h-[44px] shrink-0">
          {add.isPending ? 'Отправка…' : 'Добавить'}
        </button>
      </form>

      {q.isPending ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : q.isError ? (
        <div className="text-sm text-surface-600 dark:text-surface-300">
          Не удалось загрузить историю.{' '}
          <button type="button" onClick={() => q.refetch()} className="font-medium text-primary-700 underline dark:text-primary-300">Повторить</button>
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-surface-500 dark:text-surface-400">Событий пока нет</p>
      ) : (
        <>
          <ol className="space-y-3">
            {shown.map(e => {
              const Icon = ICON[e.kind] ?? MessageSquare
              const info = describe(e)
              const t = relTime(e.createdAt)
              return (
                <li key={e.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-100 text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-900 dark:text-surface-50">{info.title}</p>
                    {info.detail && <p className="mt-0.5 whitespace-pre-line break-words text-sm text-surface-700 dark:text-surface-200">{info.detail}</p>}
                    {info.link && (
                      <Link to={info.link.to} className="mt-0.5 inline-flex min-h-[32px] items-center text-sm font-medium text-primary-700 hover:underline dark:text-primary-300">
                        {info.link.label}
                      </Link>
                    )}
                    <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-400">
                      {e.user?.name || 'Система'}
                      {t && <> · <time dateTime={e.createdAt} title={t.title}>{t.text}</time></>}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
          {!all && events.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="btn-ghost mt-3 min-h-[44px] w-full">
              Показать ещё {events.length - shown.length}
            </button>
          )}
        </>
      )}
    </Section>
  )
}
