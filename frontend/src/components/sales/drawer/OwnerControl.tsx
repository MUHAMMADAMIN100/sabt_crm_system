import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { employeesApi } from '@/services/api.service'
import { leadsApi } from '@/services/sales.api'
import type { SalesLead } from '@/types/sales'
import { afterLeadChange, useLeadUpdate } from '../salesHooks'
import { DIRECTION_LABEL, SALES_ROLE_BY_DIRECTION, errorText, isTopRole, salesDirectionOf } from '../leadUtils'

type Me = { id: string; role?: string | null; secondaryRole?: string | null } | null

/**
 * «Ведёте вы / ведёт X» + «Передать» / «Взять себе» (15.11.2026).
 * МП передаёт свой лид менеджеру своего направления, руководство — любому
 * менеджеру продаж (как проверяет сервер в PATCH ownerId). Кандидатов
 * берём из «Сотрудников» (/employees доступен всем ролям).
 */
export default function OwnerControl({ lead, me }: { lead: SalesLead; me: Me }) {
  const qc = useQueryClient()
  const top = isTopRole(me)
  const myDir = salesDirectionOf(me)
  const mine = !!me && lead.ownerId === me.id
  const [picking, setPicking] = useState(false)
  const [target, setTarget] = useState('')
  const canTransfer = top || mine
  const canClaim = !lead.ownerId && !!myDir && (!lead.direction || lead.direction === myDir)

  const empQ = useQuery({
    queryKey: ['employees'],
    queryFn: () => employeesApi.list(),
    enabled: picking,
    staleTime: 5 * 60_000,
  })

  const candidates = useMemo(() => {
    const dir = lead.direction ?? myDir
    const list: any[] = Array.isArray(empQ.data) ? empQ.data : []
    return list
      .filter(e => e?.userId && e.user && e.user.isActive !== false && e.status !== 'inactive' && e.userId !== lead.ownerId)
      .map(e => {
        const roles = [e.user.role, e.user.secondaryRole]
        const d = roles.includes('sales_manager_smm') ? 'smm' : roles.includes('sales_manager_dev') ? 'development' : null
        return { id: String(e.userId), name: String(e.fullName || e.user.name || ''), dir: d as 'smm' | 'development' | null, roles }
      })
      .filter(c => c.dir && (top ? true : !!dir && c.roles.includes(SALES_ROLE_BY_DIRECTION[dir])))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [empQ.data, lead.direction, lead.ownerId, myDir, top])

  const update = useLeadUpdate()
  const claim = useMutation({
    mutationFn: () => leadsApi.claim(lead.id),
    onSuccess: saved => { afterLeadChange(qc, saved); toast.success('Лид теперь ваш') },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось взять лид')),
  })

  const transfer = () => {
    const to = candidates.find(c => c.id === target)
    if (!to) return
    update.mutate({ id: lead.id, data: { ownerId: to.id } }, {
      onSuccess: () => { toast.success(`Лид передан: ${to.name}`); setPicking(false); setTarget('') },
    })
  }

  const who = mine ? 'ведёте вы' : lead.owner?.name ? `ведёт ${lead.owner.name}` : 'без ответственного'

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-surface-600 dark:text-surface-300">
        <span>{who}</span>
        {!picking && canTransfer && (
          <button type="button" onClick={() => setPicking(true)}
            className="inline-flex min-h-[36px] items-center rounded-md px-2 text-xs font-medium text-primary-700 hover:bg-surface-100 dark:text-primary-300 dark:hover:bg-surface-700 max-lg:min-h-[44px]">
            {lead.ownerId ? 'Передать' : 'Назначить'}
          </button>
        )}
        {!picking && canClaim && !top && (
          <button type="button" onClick={() => claim.mutate()} disabled={claim.isPending}
            className="btn-secondary min-h-[36px] max-lg:min-h-[44px]">
            {claim.isPending ? 'Берём…' : 'Взять себе'}
          </button>
        )}
      </div>
      {picking && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`owner-${lead.id}`} className="sr-only">Кому передать</label>
          <select id={`owner-${lead.id}`} className="input min-w-0 flex-1" value={target} onChange={e => setTarget(e.target.value)}
            disabled={empQ.isLoading}>
            <option value="">{empQ.isLoading ? 'Загрузка…' : candidates.length ? '— Кому передать —' : 'Нет других менеджеров'}</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>{c.name}{top && c.dir ? ` · ${DIRECTION_LABEL[c.dir]}` : ''}</option>
            ))}
          </select>
          <button type="button" onClick={transfer} disabled={!target || update.isPending} className="btn-primary min-h-[44px]">
            {update.isPending ? 'Передаём…' : 'Передать'}
          </button>
          <button type="button" onClick={() => { setPicking(false); setTarget('') }} className="btn-ghost min-h-[44px]">Отмена</button>
          {empQ.isError && <p className="w-full text-xs text-red-600 dark:text-red-300">Не удалось загрузить список менеджеров</p>}
        </div>
      )}
    </div>
  )
}
