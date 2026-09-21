// Кнопка рабочей смены: «Начать работу» → счётчик → «Завершить».
//
// Пока смена идёт, нажатие открывает КАРТОЧКУ смены (ShiftCard): там норма
// дня, отрезки, перерыв с причиной и правка времени. Раньше главная кнопка
// молча ставила паузу, и на компьютере об этом нельзя было догадаться —
// подпись «Пауза» жила только во всплывающей подсказке.
//
// Быстрые действия остаются одним нажатием: «Начать» из простоя,
// «Продолжить» с перерыва и квадрат «Завершить» рядом.
//
// Основателю не показывается вовсе: он смены не отмечает, а смотрит.
// Используется в подвале меню на компьютере и первой строкой в листе «Ещё».
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Coffee } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { workShiftsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'
import ShiftCard from './ShiftCard'

/** «3 ч 12 мин» из минут. */
function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m} мин`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

type Action = 'start' | 'pause' | 'stop'

function useShift() {
  const role = useAuthStore(s => s.user?.role)
  const enabled = !!role && role !== 'founder'
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['work-shift-my'],
    queryFn: () => workShiftsApi.my(),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const mut = useMutation({
    mutationFn: (a: Action) =>
      a === 'start' ? workShiftsApi.start() : a === 'pause' ? workShiftsApi.pause() : workShiftsApi.stop(),
    onSuccess: (fresh: any) => qc.setQueryData(['work-shift-my'], fresh),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не получилось — попробуйте ещё раз'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['work-shift-my'] }),
  })

  const state: 'idle' | 'working' | 'paused' = data?.state ?? 'idle'
  const open = data?.open ?? null

  // Пока смена идёт, счётчик растёт сам, не дожидаясь следующего запроса.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (state !== 'working') return
    const t = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [state])

  // За сегодня: закрытые отрезки (с сервера) плюс текущий, который считаем
  // сами — иначе счётчик стоял бы до следующего запроса. Именно closedMinutes,
  // а не todayMinutes: в последнем идущий отрезок уже учтён, и вышло бы вдвое.

  return {
    enabled,
    state,
    busy: mut.isPending,
    run: (a: Action) => mut.mutate(a),
    today: fmt(
      state === 'working' && open
        ? (data?.closedMinutes ?? 0) + Math.max(0, Math.round((Date.now() - new Date(open.startedAt).getTime()) / 60000))
        : data?.todayMinutes ?? 0,
    ),
    pausedSince: data?.pausedSince ?? null,
    startedLabel: open?.startedLabel ?? null,
  }
}

export default function ShiftButton({ variant, collapsed = false }: {
  /** sidebar — подвал меню на компьютере; sheet — лист «Ещё» на телефоне. */
  variant: 'sidebar' | 'sheet'
  collapsed?: boolean
}) {
  const s = useShift()
  const [cardOpen, setCardOpen] = useState(false)
  if (!s.enabled) return null

  const working = s.state === 'working'
  const paused = s.state === 'paused'
  const MainIcon = working ? Coffee : Play
  const mainLabel = working ? `${s.today} · перерыв` : paused ? `Продолжить · ${s.today}` : 'Начать работу'
  // Идёт смена — открываем карточку (перерыв там, с причиной). Простой и
  // перерыв — действие сразу, без лишнего экрана.
  const onMain = () => (working ? setCardOpen(true) : s.run('start'))
  const title = working ? `Смена с ${s.startedLabel} — открыть карточку` : paused ? `На перерыве с ${s.pausedSince}` : 'Начать рабочий день'
  const card = cardOpen ? <ShiftCard onClose={() => setCardOpen(false)} /> : null

  if (variant === 'sheet') {
    return (
      <div className="flex items-center gap-2">
        {card}
        <button
          onClick={onMain}
          disabled={s.busy}
          className={clsx('flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-bold transition disabled:opacity-60',
            working ? 'bg-amber-500/12 text-amber-500 border border-amber-500/60' : 'bg-green-500 text-white')}
        >
          <MainIcon size={16} strokeWidth={2.5} />{mainLabel}
        </button>
        {(working || paused) && (
          <button
            onClick={() => s.run('stop')}
            disabled={s.busy}
            title="Завершить смену"
            className="w-[52px] h-[50px] shrink-0 rounded-xl border border-red-500/60 text-red-500 bg-red-500/10 flex items-center justify-center disabled:opacity-60"
          >
            <Square size={16} strokeWidth={2.5} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={clsx('flex items-center gap-1.5', collapsed && 'lg:flex-col lg:gap-1')}>
      {card}
      <button
        onClick={onMain}
        disabled={s.busy}
        title={title}
        className={clsx(
          'flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-60',
          working ? 'bg-green-500/12 text-green-400 border border-green-500/40 hover:bg-green-500/20'
            : paused ? 'bg-amber-500/12 text-amber-400 border border-amber-500/40 hover:bg-amber-500/20'
            : 'bg-green-500 text-white hover:brightness-110',
          collapsed && 'lg:justify-center lg:px-2 lg:gap-0',
        )}
      >
        {working
          ? <span className="w-2 h-2 rounded-full bg-green-400 shrink-0 shadow-[0_0_0_3px_rgba(74,222,128,.25)]" />
          : <MainIcon size={15} strokeWidth={2.5} className="shrink-0" />}
        <span className={clsx(
          'truncate transition-all duration-300 overflow-hidden whitespace-nowrap',
          collapsed ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100',
        )}>
          {working ? `${s.today} · перерыв` : paused ? 'Продолжить' : 'Начать работу'}
        </span>
      </button>
      {(working || paused) && (
        <button
          onClick={() => s.run('stop')}
          disabled={s.busy}
          title="Завершить смену"
          className="w-8 h-8 shrink-0 rounded-lg border border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20 flex items-center justify-center transition disabled:opacity-60"
        >
          <Square size={13} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
