import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clientsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import KpiCelebration from '@/components/kpi/KpiCelebration'

/**
 * Глобальный мониторинг KPI менеджера продаж — для мгновенного
 * поздравления в момент закрытия любой метрики, в ЛЮБОЙ странице
 * приложения (компонент смонтирован в Layout).
 *
 * АНТИСПАМ: чистая in-memory transition-detection через useRef.
 * Никакого localStorage — он давал ложные «уже отпразднована» отметки
 * (модал помечался как показанный ещё до того, как юзер успевал увидеть).
 *
 * Логика:
 *   - При ПЕРВОМ приходе KPI запоминаем done-метрики как baseline
 *     и НЕ показываем модал (это «снимок» уже существующего состояния,
 *     не повод праздновать).
 *   - На каждом следующем обновлении: если метрика done сейчас И НЕ
 *     была done на прошлом тике → это РЕАЛЬНЫЙ переход → модал.
 *   - Если done:true → false (откат) → убираем из baseline, чтобы при
 *     повторном закрытии снова отпраздновать.
 *   - Overall=100% — отдельный переход false→true триггерит «золотой»
 *     модал и заменяет первый-же индивидуальный триггер.
 *
 * useRef переживает navigation между страницами (Layout не размонтируется),
 * но обнуляется при F5/login. После F5 первое состояние KPI — baseline,
 * без модала. Это правильно: юзер только что зашёл и сам видит карточки.
 */
export default function KpiCelebrationWatcher() {
  const role = useAuthStore(s => s.user?.role)
  const userId = useAuthStore(s => s.user?.id)
  const userName = useAuthStore(s => s.user?.name) || 'Сотрудник'
  const isSales = role === 'sales_manager_smm' || role === 'sales_manager_dev'

  // Окно — сегодня. Если юзер перешёл через полночь, useEffect ниже
  // увидит новую дату и сбросит baseline (новый день — новые KPI).
  const today = new Date().toISOString().slice(0, 10)

  const { data: kpi } = useQuery({
    queryKey: ['sales-kpi', userId, today, today],
    queryFn: () => clientsApi.kpi({ from: today, to: today }),
    enabled: isSales && !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000, // страховка на случай разрыва WebSocket
  })

  const [celebrationKey, setCelebrationKey] = useState<string | null>(null)

  // Baseline done-метрик с прошлого тика (null = ещё не инициализирован).
  const doneRef = useRef<Set<string> | null>(null)
  // Был ли overall=100% на прошлом тике (для золотого триггера).
  const was100Ref = useRef<boolean>(false)
  // Привязка baseline к дате — при смене дня обнуляем.
  const dateRef = useRef<string>(today)

  // Одноразовая чистка legacy localStorage (старые антиспам-ключи).
  // С новой логикой они не нужны, но висят с прошлых релизов.
  useEffect(() => {
    try {
      const keys = Object.keys(localStorage)
      for (const k of keys) {
        if (k.startsWith('kpiCelebrated:') || k.startsWith('kpiCelebrated_v2:')) {
          localStorage.removeItem(k)
        }
      }
    } catch { /* без storage — пофиг */ }
  }, [])

  // Если userId сменился (другой юзер вошёл в этой же вкладке) или дата
  // перевалила на новый день — обнуляем baseline.
  useEffect(() => {
    doneRef.current = null
    was100Ref.current = false
    dateRef.current = today
  }, [userId, today])

  useEffect(() => {
    if (!isSales || !kpi?.items?.length || !userId) return

    const currentDone = new Set<string>(
      (kpi.items as any[]).filter(it => it.done).map(it => it.key),
    )
    const overall = Number(kpi.overallPercent || 0)
    const now100 = overall >= 100

    // Первый приход KPI — это «снимок», не повод праздновать.
    // Запоминаем baseline и выходим.
    if (doneRef.current === null) {
      doneRef.current = currentDone
      was100Ref.current = now100
      return
    }

    // Сначала проверяем «золотой» переход overall <100% → 100%.
    if (now100 && !was100Ref.current) {
      doneRef.current = currentDone
      was100Ref.current = true
      setCelebrationKey('__all__')
      return
    }

    // Иначе — ищем первую метрику, которая стала done с прошлого тика.
    for (const key of currentDone) {
      if (!doneRef.current.has(key)) {
        setCelebrationKey(key)
        break
      }
    }

    // Обновляем baseline (включая случаи когда что-то перестало быть done).
    doneRef.current = currentDone
    was100Ref.current = now100
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpi, userId, isSales, today])

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
