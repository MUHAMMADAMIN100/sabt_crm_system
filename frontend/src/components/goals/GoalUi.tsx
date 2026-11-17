// «Компас компании» (16.11.2026, docs/GOALS_SPEC.md §9): общие мелочи
// экранов компаса и отдела — статус-чип, полоса с чертой темпа, статусы
// последних недель и «факт из цели». Цвета и подписи — lib/goals.
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { GoalStatus, KeyResultView } from '@/types/goals'
import { STATUS_META, barWidth, dayMonthLabel, formatTarget, formatValue } from '@/lib/goals'
import { compassApi, compassKeys } from '@/services/goals.api'

/** Статус результата/цели/отдела: «в графике», «риск», «отстаём»… */
export function StatusChip({ status }: { status: GoalStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.none
  return (
    <span className={clsx(
      'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold leading-4 whitespace-nowrap',
      m.bg, m.text,
    )}>
      {m.label}
    </span>
  )
}

/** Полоса прогресса с чертой «где должны быть сегодня» (темп). Для экранного
 *  диктора — картинка с подписью: «выполнено 47 %, по плану сегодня 51 %». */
export function ProgressBar({ progress, pace, status, label }: {
  progress: number | null
  pace?: number | null
  status: GoalStatus
  label?: string
}) {
  const m = STATUS_META[status] ?? STATUS_META.none
  const width = barWidth(progress)
  const tick = pace == null || !Number.isFinite(Number(pace)) ? null : Math.max(0, Math.min(100, Number(pace)))
  const done = progress == null || !Number.isFinite(Number(progress))
    ? 'нет данных'
    : `выполнено ${Math.round(Number(progress))} %`
  const aria = [label ?? done, tick != null ? `по плану сегодня ${Math.round(tick)} %` : null]
    .filter(Boolean).join(', ')
  return (
    <div role="img" aria-label={aria} className="relative h-2 w-full rounded-full bg-surface-200 dark:bg-surface-700">
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500 ease-out', m.bar)}
        style={{ width: `${width}%` }}
      />
      {tick != null && (
        <span
          aria-hidden="true"
          className="absolute -top-[3px] h-3.5 w-0.5 rounded-[1px] bg-surface-900 dark:bg-surface-50"
          style={{ left: `calc(${tick}% - 1px)` }}
        />
      )}
    </div>
  )
}

/** Отметки последних недель — цветные квадратики (серый — не отмечено). */
export function CheckinHistory({ history }: { history: KeyResultView['history'] }) {
  if (!history || history.length === 0) return null
  const text = history
    .map(h => `неделя с ${dayMonthLabel(h.weekStart)} — ${h.status ? STATUS_META[h.status].label : 'не отмечено'}`)
    .join('; ')
  return (
    <div role="img" aria-label={`Статус по неделям: ${text}`} className="inline-flex items-center gap-1">
      {history.map(h => (
        <span
          key={h.weekStart}
          title={`С ${dayMonthLabel(h.weekStart)}: ${h.status ? STATUS_META[h.status].label : 'не отмечено'}`}
          className={clsx(
            'h-3 w-3 rounded-[3px]',
            h.status ? STATUS_META[h.status].bar : 'bg-surface-300 dark:bg-surface-600',
          )}
        />
      ))}
    </div>
  )
}

/** «141 000 с.» + «из 300 000 с.»; нет цифры — «нет данных». */
export function KrValue({ kr }: { kr: KeyResultView }) {
  const target = formatTarget(kr.target, kr.unit, kr.kind)
  if (kr.value == null) {
    return (
      <span className="tabular-nums text-surface-500 dark:text-surface-400">
        нет данных · цель {target}
      </span>
    )
  }
  return (
    <span className="tabular-nums">
      <b className="font-semibold text-surface-900 dark:text-surface-50">{formatValue(kr.value, kr.unit)}</b>
      <span className="text-surface-500 dark:text-surface-400"> из {target}</span>
    </span>
  )
}

/** Значение, которое держится, пока окно закрывается: родитель обнуляет
 *  «что редактируем» сразу, а окно ещё 250 мс уезжает — без этого в нём
 *  мелькнула бы пустая форма. */
export function useWhileOpen<T>(open: boolean, value: T): T {
  const ref = useRef(value)
  if (open) ref.current = value
  return ref.current
}

/** Люди для выбора ответственного и «Разложить по менеджерам»
 *  (GET /compass/people — только тем, кто видит детали). */
export function useCompassPeople(enabled = true) {
  return useQuery({
    queryKey: [...compassKeys.all, 'people'],
    queryFn: () => compassApi.people(),
    staleTime: 5 * 60_000,
    enabled,
  })
}
