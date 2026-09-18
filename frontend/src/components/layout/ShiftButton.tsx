// Кнопка «Начать работу» / «Завершить смену».
//
// Одна кнопка на два состояния: смена не начата — зелёная «Начать работу»;
// смена идёт — счётчик времени, по нажатию закрывается. Основателю не
// показывается вовсе (он не отмечает смены, он их смотрит).
//
// Используется в двух местах: подвал бокового меню на компьютере и первый
// пункт листа «Ещё» на телефоне — поэтому вид задаётся через variant.
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square } from 'lucide-react'
import clsx from 'clsx'
import { workShiftsApi } from '@/services/api.service'
import { useAuthStore } from '@/store/auth.store'

/** «3 ч 12 мин» из минут. */
function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h <= 0) return `${m} мин`
  return m ? `${h} ч ${m} мин` : `${h} ч`
}

export function useShift() {
  const role = useAuthStore(s => s.user?.role)
  // Основателю смены не нужны: он их не отмечает, а смотрит.
  const enabled = !!role && role !== 'founder'
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['work-shift-my'],
    queryFn: () => workShiftsApi.my(),
    enabled,
    refetchInterval: 60_000,      // счётчик оживает раз в минуту
    staleTime: 30_000,
  })
  const open = data?.open ?? null
  const mut = useMutation({
    mutationFn: () => (open ? workShiftsApi.stop() : workShiftsApi.start()),
    onSuccess: (fresh: any) => qc.setQueryData(['work-shift-my'], fresh),
    onSettled: () => qc.invalidateQueries({ queryKey: ['work-shift-my'] }),
  })

  // Пока смена идёт, счётчик должен расти сам, не дожидаясь запроса.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(t)
  }, [open])

  const liveMinutes = open
    ? Math.max(0, Math.round((Date.now() - new Date(open.startedAt).getTime()) / 60000))
    : 0
  void tick

  return {
    enabled,
    open,
    busy: mut.isPending,
    toggle: () => mut.mutate(),
    label: open ? fmt(liveMinutes) : 'Начать работу',
    startedLabel: open?.startedLabel ?? null,
    todayMinutes: data?.todayMinutes ?? 0,
  }
}

export default function ShiftButton({ variant, collapsed = false }: {
  /** sidebar — подвал меню на компьютере; sheet — лист «Ещё» на телефоне. */
  variant: 'sidebar' | 'sheet'
  collapsed?: boolean
}) {
  const shift = useShift()
  if (!shift.enabled) return null

  const on = !!shift.open
  const Icon = on ? Square : Play

  if (variant === 'sheet') {
    return (
      <button
        onClick={shift.toggle}
        disabled={shift.busy}
        className={clsx('w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-bold transition disabled:opacity-60',
          on ? 'bg-red-500/10 text-red-500 border border-red-500/60' : 'bg-green-500 text-white')}
      >
        <Icon size={16} strokeWidth={2.5} />
        {on ? `Завершить смену · ${shift.label}` : 'Начать работу'}
      </button>
    )
  }

  return (
    <button
      onClick={shift.toggle}
      disabled={shift.busy}
      title={on ? `Смена с ${shift.startedLabel} · нажмите, чтобы завершить` : 'Начать рабочий день'}
      className={clsx(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-60',
        on
          ? 'bg-green-500/12 text-green-400 border border-green-500/40 hover:bg-green-500/20'
          : 'bg-green-500 text-white hover:brightness-110',
        collapsed && 'lg:justify-center lg:px-2 lg:gap-0',
      )}
    >
      {on
        ? <span className="w-2 h-2 rounded-full bg-green-400 shrink-0 shadow-[0_0_0_3px_rgba(74,222,128,.25)]" />
        : <Icon size={15} strokeWidth={2.5} className="shrink-0" />}
      <span className={clsx(
        'truncate transition-all duration-300 overflow-hidden whitespace-nowrap',
        collapsed ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100',
      )}>
        {on ? shift.label : 'Начать работу'}
      </span>
    </button>
  )
}
