/**
 * Хуки экранов продаж (15.11.2026): правка лида с обновлением всех экранов,
 * последнее значение для анимации закрытия окна, ширина экрана.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { leadsApi } from '@/services/sales.api'
import { invalidateSales, salesKeys } from '@/lib/salesQueries'
import type { SalesLead } from '@/types/sales'
import { errorText } from './leadUtils'

/** После любого действия с лидом: все экраны продаж плюс Календарь (там
 *  встречи и перезвоны) и KPI сотрудника на Панели. */
export function afterLeadChange(qc: QueryClient, lead?: SalesLead | null): void {
  if (lead?.id) qc.setQueryData(salesKeys.lead(lead.id), lead)
  invalidateSales(qc)
  qc.invalidateQueries({ queryKey: ['calendar'] })
  qc.invalidateQueries({ queryKey: ['kpi-user'] })
}

/** PATCH /clients/:id с обновлением кэшей и тостом об ошибке. */
export function useLeadUpdate(successText?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SalesLead> }) => leadsApi.update(id, data),
    onSuccess: lead => {
      afterLeadChange(qc, lead)
      if (successText) toast.success(successText)
    },
    onError: (e: any) => toast.error(errorText(e, 'Не удалось сохранить')),
  })
}

/** Последнее непустое значение: окно закрывается с анимацией, и его
 *  содержимое не должно исчезать раньше самого окна. */
export function useLastValue<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null)
  if (value) ref.current = value
  return value ?? ref.current
}

/** Совпадает ли медиа-запрос — и следит за поворотом/изменением окна. */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [query])
  return matches
}

/** Компьютер — от 993 px (как breakpoint lg в tailwind.config). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 993px)')
}
