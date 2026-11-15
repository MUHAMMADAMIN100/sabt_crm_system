/**
 * Продажи, этап 2 (15.11.2026) — типы фронтенда. Договор API:
 * docs/SALES_SPEC.md. Этапы, цвета и подписи — lib/salesStages.ts.
 */

/** Этапы единой воронки + устаревшие значения из старых данных. */
export type LeadStatus =
  | 'new' | 'waiting' | 'meeting' | 'proposal' | 'contract' | 'won' | 'lost'
  | 'negotiating' | 'on_hold' | 'unknown'

export type LeadDirection = 'smm' | 'development'
export type LeadInterest = 'cold' | 'warm' | 'hot'
export type LostReason = 'price' | 'competitor' | 'not_lpr' | 'no_response' | 'not_needed' | 'other'

export interface SalesLead {
  id: string
  name: string
  sphere?: string | null
  problem?: string | null
  address?: string | null
  contactPerson?: string | null
  contactInfo?: string | null
  contactPhone?: string | null
  contactInstagram?: string | null
  contactEmail?: string | null
  status: LeadStatus
  nextStep?: string | null
  nextStepAt?: string | null
  leadSource?: string | null
  dealPotential?: number | string | null
  probability?: number | null
  expectedCloseAt?: string | null
  interest?: LeadInterest | null
  direction?: LeadDirection | null
  onHold?: boolean
  lastContactAt?: string | null
  lastActivityAt?: string | null
  /** Встреча. */
  nextContactAt?: string | null
  meetingResult?: 'held' | 'missed' | null
  repeatCallAt?: string | null
  channel?: string | null
  callType?: 'cold' | 'neutral' | 'hot' | 'repeat' | null
  emailStatus?: 'sent' | 'answered' | 'no_reply' | 'rejected' | null
  lostReason?: LostReason | null
  rejectionReason?: string | null
  callRequested?: boolean
  callRequestedAt?: string | null
  callRequestedByName?: string | null
  ownerId?: string | null
  owner?: { id: string; name: string } | null
  handoffAt?: string | null
  handoffById?: string | null
  handoffData?: HandoffInput | null
  projectId?: string | null
  createdAt: string
  updatedAt: string
}

export interface LeadListParams {
  search?: string
  /** Через запятую. */
  status?: string
  interest?: LeadInterest
  sphere?: string
  source?: string
  owner?: 'me' | 'all' | string
  due?: 'overdue' | 'today' | 'none'
  hold?: '1' | '0'
  page?: number
  pageSize?: number
  sort?: 'next' | 'updated' | 'created' | 'potential'
}

export interface LeadListPage {
  items: SalesLead[]
  total: number
  page: number
  pageSize: number
}

export interface LeadDuplicate { id: string; name: string; status: LeadStatus; ownerName: string | null }

/** Ответ 409 при создании лида-дубля. */
export interface LeadDuplicateError { message: 'duplicate'; duplicates: LeadDuplicate[] }

export type AgendaKind = 'meeting' | 'callback' | 'next_step' | 'no_step' | 'stale'

export interface AgendaItem {
  id: string
  kind: AgendaKind
  /** ISO; null у no_step / stale. */
  at: string | null
  leadId: string
  leadName: string
  status: LeadStatus
  onHold: boolean
  note: string | null
  phone: string | null
  potential: number | null
}

export interface Agenda {
  overdue: AgendaItem[]
  today: AgendaItem[]
  tomorrow: AgendaItem[]
  attention: AgendaItem[]
}

export type CallResult = 'reached' | 'no_answer' | 'busy'
export type CallOutcome = 'interested' | 'wants_kp' | 'thinking' | 'later' | 'refused'

export interface NextAction {
  kind: 'callback' | 'meeting' | 'step'
  /** ISO. */
  at: string
  text?: string
}

export interface CallInput {
  result: CallResult
  outcome?: CallOutcome
  comment?: string
  next?: NextAction
}

export interface MeetingInput {
  held: boolean
  comment?: string
  next?: NextAction
}

export type LeadEventKind =
  | 'created' | 'stage' | 'owner' | 'call' | 'email' | 'meeting_set' | 'meeting_done'
  | 'meeting_missed' | 'next_step' | 'comment' | 'hold' | 'handoff' | 'project_linked'

export interface LeadEvent {
  id: string
  kind: LeadEventKind
  data: Record<string, any> | null
  createdAt: string
  user: { id: string; name: string } | null
}

export interface HandoffInput {
  direction: LeadDirection
  /** Тариф SMM или тип проекта разработки. */
  product: string
  amount: number
  /** YYYY-MM-DD. */
  firstPaymentAt: string
  note?: string
  sendBrief?: boolean
}

export interface Handoff extends HandoffInput {
  leadId: string
  leadName: string
  handoffAt: string
  manager: { id: string; name: string } | null
  projectId: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactInstagram: string | null
}

export interface SalesNorms {
  funnel_progress: number
  new_companies: number
  cold_calls: number
  personal_emails: number
  meetings: number
}

export interface SalesSettings {
  norms: { smm: SalesNorms; development: SalesNorms }
  /** userId → процент от полученных оплат. */
  commission: Record<string, number>
  managers: Array<{ id: string; name: string; role: string }>
}

export interface SalesAnalytics {
  period: { from: string; to: string }
  totals: {
    leads: number
    won: number
    conversion: number
    cycleDaysMedian: number | null
    received: number | null
    plan: number | null
    expected: number | null
  }
  funnel: Array<{ status: LeadStatus; count: number; conversionFromPrev: number | null }>
  bySource: Array<{ source: string; leads: number; won: number; conversion: number }>
  byManager: Array<{
    userId: string; name: string; role: string
    leads: number; meetingsHeld: number; won: number
    received: number | null; plan: number | null; kpiPercent: number | null
  }>
  lostReasons: Array<{ reason: LostReason; count: number }>
}

export interface LeadStats {
  byStatus: Record<string, number>
  byInterest: Record<string, number>
  total: number
  totalPotential: number
  forecast?: number
  [k: string]: any
}
