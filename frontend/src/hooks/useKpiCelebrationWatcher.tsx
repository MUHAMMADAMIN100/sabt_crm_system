import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import KpiCelebration from '@/components/kpi/KpiCelebration'

/**
 * Глобальный мониторинг KPI менеджера продаж — для мгновенного
 * поздравления в момент закрытия любой метрики, в ЛЮБОЙ странице
 * приложения (не только на «Панели»).
 *
 * Подключается в Layout, активен только для ролей sales_manager_*.
 * Использует тот же ключ-схему `kpiCelebrated_v2:` что и SalesDashboard,
 * поэтому двойного триггера не будет: кто первый успел пометить — тот
 * и показал, второй увидит «уже отпразднована».
 *
 * KPI рефетчится по WebSocket leads:changed (см. useSocket), плюс
 * фоновый refetchInterval как страховка на случай разрыва сокета.
 */
export default function KpiCelebrationWatcher() {
  const role = useAuthStore(s => s.user?.role)
  const userId = useAuthStore(s => s.user?.id)
  const userName = useAuthStore(s => s.user?.name) || 'Сотрудник'
  const isSales = role === 'sales_manager_smm' || role === 'sales_manager_dev'

  // Окно — сегодня. Пересчитываем дату на каждом рендере: после
  // полуночи компонент пересчитает period и заберёт KPI за новый день
  // (а старые ключи в localStorage уже относятся к прошлому дню → новый
  // день можно праздновать заново).
  const today = new Date().toISOString().slice(0, 10)

  const { data: kpi } = useQuery({
    queryKey: ['sales-kpi', userId, today, today],
    queryFn: () => clientsApi.kpi({ from: today, to: today }),
    enabled: isSales && !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000, // страховка на случай разрыва WebSocket
  })

  const [celebrationKey, setCelebrationKey] = useState<string | null>(null)

  const KEY_PREFIX = 'kpiCelebrated_v2:'
  const lsKey = (metric: string) => `${KEY_PREFIX}${userId}:${today}_${today}:${metric}`
  const wasCelebrated = (metric: string): boolean => {
    try { return !!localStorage.getItem(lsKey(metric)) } catch { return false }
  }
  const markCelebrated = (metric: string) => {
    try { localStorage.setItem(lsKey(metric), String(Date.now())) } catch {}
  }

  // Авточистка: старые v1-ключи и v2-ключи старше 3 дней.
  useEffect(() => {
    try {
      const threshold = Date.now() - 3 * 86400_000
      const keys = Object.keys(localStorage)
      for (const k of keys) {
        if (k.startsWith('kpiCelebrated:')) { localStorage.removeItem(k); continue }
        if (!k.startsWith(KEY_PREFIX)) continue
        const ts = Number(localStorage.getItem(k))
        if (!Number.isFinite(ts) || ts < threshold) localStorage.removeItem(k)
      }
    } catch { /* без storage — пофиг */ }
  }, [])

  useEffect(() => {
    if (!isSales || !kpi?.items?.length || !userId) return
    const overall = Number(kpi.overallPercent || 0)
    if (overall >= 100 && !wasCelebrated('__all__')) {
      markCelebrated('__all__')
      kpi.items.forEach((it: any) => { if (it.done) markCelebrated(it.key) })
      setCelebrationKey('__all__')
      return
    }
    for (const it of kpi.items) {
      if (!it.done) continue
      if (!wasCelebrated(it.key)) {
        markCelebrated(it.key)
        setCelebrationKey(it.key)
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpi, today, userId, isSales])

  if (!isSales) return null

  return (
    <KpiCelebration
      open={!!celebrationKey}
      name={userName}
      metricKey={celebrationKey}
      onClose={() => setCelebrationKey(null)}
    />
  )
}
