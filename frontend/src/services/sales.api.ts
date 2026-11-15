import api from '@/lib/api'
import type {
  Agenda, CallInput, Handoff, HandoffInput, LeadEvent, LeadListPage, LeadListParams,
  MeetingInput, SalesAnalytics, SalesLead, SalesNorms, SalesSettings,
} from '@/types/sales'

/**
 * Продажи, этап 2 (15.11.2026). Договор — docs/SALES_SPEC.md.
 * Старые методы лидов (list/create/update/remove/kpi/stats) — clientsApi в
 * api.service.ts; здесь — новые.
 */

/** Новые маршруты /clients/* (ClientsService). */
export const leadsApi = {
  /** Список с серверной пагинацией. */
  page: (params: LeadListParams) =>
    api.get<LeadListPage>('/clients/list', { params }).then(r => r.data),
  /** Все активные лиды для доски (без лимита 500). */
  board: (params?: { owner?: 'me' | 'all' | string; search?: string }) =>
    api.get<{ items: SalesLead[] }>('/clients/board', { params }).then(r => r.data.items),
  /** Создать; 409 { message:'duplicate', duplicates } — похожий уже есть. force — создать всё равно. */
  create: (data: Partial<SalesLead> & { force?: boolean }) =>
    api.post<SalesLead>('/clients', data).then(r => r.data),
  update: (id: string, data: Partial<SalesLead>) =>
    api.patch<SalesLead>(`/clients/${id}`, data).then(r => r.data),
  /** Взять себе лид без владельца. */
  claim: (id: string) => api.post<SalesLead>(`/clients/${id}/claim`).then(r => r.data),
}

/** Маршруты /sales/* (SalesService). */
export const salesApi = {
  agenda: () => api.get<Agenda>('/sales/agenda').then(r => r.data),
  logCall: (leadId: string, data: CallInput) =>
    api.post<SalesLead>(`/sales/leads/${leadId}/calls`, data).then(r => r.data),
  logEmail: (leadId: string, data: { comment?: string } = {}) =>
    api.post<SalesLead>(`/sales/leads/${leadId}/emails`, data).then(r => r.data),
  meetingResult: (leadId: string, data: MeetingInput) =>
    api.post<SalesLead>(`/sales/leads/${leadId}/meeting`, data).then(r => r.data),
  events: (leadId: string) =>
    api.get<LeadEvent[]>(`/sales/leads/${leadId}/events`).then(r => r.data),
  comment: (leadId: string, text: string) =>
    api.post<LeadEvent>(`/sales/leads/${leadId}/comments`, { text }).then(r => r.data),
  handoff: (leadId: string, data: HandoffInput) =>
    api.post<SalesLead>(`/sales/leads/${leadId}/handoff`, data).then(r => r.data),
  handoffs: (status: 'open' | 'done' = 'open') =>
    api.get<Handoff[]>('/sales/handoffs', { params: { status } }).then(r => r.data),
  linkHandoff: (leadId: string, projectId: string) =>
    api.post(`/sales/handoffs/${leadId}/link`, { projectId }).then(r => r.data),
  analytics: (params: { from: string; to: string; direction?: 'smm' | 'development' }) =>
    api.get<SalesAnalytics>('/sales/analytics', { params }).then(r => r.data),
  settings: () => api.get<SalesSettings>('/sales/settings').then(r => r.data),
  saveSettings: (data: { norms?: Partial<Record<'smm' | 'development', SalesNorms>>; commission?: Record<string, number> }) =>
    api.put<SalesSettings>('/sales/settings', data).then(r => r.data),
}

/** Тело 409-ответа о дублях, если это он. */
export function duplicatesOf(err: any): Array<{ id: string; name: string; status: string; ownerName: string | null }> | null {
  const d = err?.response?.status === 409 ? err?.response?.data : null
  return d && d.message === 'duplicate' && Array.isArray(d.duplicates) ? d.duplicates : null
}
