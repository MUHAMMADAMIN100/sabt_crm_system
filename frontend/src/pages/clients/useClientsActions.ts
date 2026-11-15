import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { clientsApi } from '@/services/api.service'
import { leadsApi } from '@/services/sales.api'
import { invalidateSales } from '@/lib/salesQueries'
import { stageMeta } from '@/lib/salesStages'
import type { LeadStatus, SalesLead } from '@/types/sales'
import { afterLeadChange } from '@/components/sales/salesHooks'
import { errorText } from '@/components/sales/leadUtils'

/**
 * Действия страницы «Клиенты» (15.11.2026): смена этапа с доски (сразу
 * двигаем карточку, откат при ошибке), пауза, удаление и отметки «Позвонить»
 * от руководителя. После каждого — обновление всех экранов продаж.
 */
export function useClientsActions() {
  const qc = useQueryClient()

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) => leadsApi.update(id, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['leads', 'board'] })
      const snaps = qc.getQueriesData<SalesLead[]>({ queryKey: ['leads', 'board'] })
      qc.setQueriesData<SalesLead[]>({ queryKey: ['leads', 'board'] }, old =>
        Array.isArray(old) ? old.map(l => (l.id === id ? { ...l, status } : l)) : old)
      return { snaps }
    },
    onError: (e: any, _v, ctx) => {
      for (const [key, data] of ctx?.snaps ?? []) qc.setQueryData(key, data)
      toast.error(errorText(e, 'Не удалось сменить этап'))
    },
    onSuccess: lead => toast.success(`«${lead.name}» — ${stageMeta(lead.status).label}`),
    onSettled: lead => afterLeadChange(qc, lead ?? null),
  })

  const hold = useMutation({
    mutationFn: ({ id, onHold }: { id: string; onHold: boolean }) => leadsApi.update(id, { onHold }),
    onSuccess: lead => { afterLeadChange(qc, lead); toast.success(lead.onHold ? 'Лид на паузе' : 'Пауза снята') },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось сохранить')),
  })

  const remove = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => { afterLeadChange(qc); toast.success('Лид удалён') },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось удалить')),
  })

  // «Позвонить» (основатель): отметка назначает звонок менеджеру-владельцу
  // сразу и уходит в Telegram; снять может руководитель или владелец.
  const callRequest = useMutation({
    mutationFn: ({ ids, flag }: { ids: string[]; flag: boolean }) => clientsApi.callRequest(ids, flag),
    onMutate: async ({ ids, flag }) => {
      const set = new Set(ids)
      const patch = (l: any) => (set.has(l?.id) ? { ...l, callRequested: flag } : l)
      qc.setQueriesData({ queryKey: ['leads'] }, (old: any) =>
        Array.isArray(old) ? old.map(patch) : Array.isArray(old?.items) ? { ...old, items: old.items.map(patch) } : old)
    },
    onError: () => { invalidateSales(qc); toast.error('Не удалось обновить отметку') },
    onSuccess: (server: any, { flag }) => {
      invalidateSales(qc)
      if (!flag) { toast.success('Отметка снята'); return }
      const d = server?.byDirection || {}
      const parts: string[] = []
      if (d.smm) parts.push(`SMM: ${d.smm}`)
      if (d.development) parts.push(`Разработка: ${d.development}`)
      if (d.none) parts.push(`без направления: ${d.none}`)
      toast.success(`Назначено звонков: ${Number(server?.updated) || 0}${parts.length ? ` (${parts.join(', ')})` : ''}`)
    },
  })

  return { move, hold, remove, callRequest }
}
