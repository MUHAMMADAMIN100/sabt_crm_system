// Переключатель месяца «‹ Июль 2026 ›» (+ кнопка «сегодня», если выбран не текущий).
// С 08.11.2026: пока финансы догружаются, рядом «Обновляется…» (страницы держат
// цифры прошлого месяца бледными, а не пустые заготовки); при наведении на
// стрелку соседний месяц начинает грузиться заранее (prefetch).
import { useIsFetching } from '@tanstack/react-query'
import { monthLabel, shiftYm, currentYm } from './finlib'

export default function MonthNav({ ym, onChange, prefetch }: {
  ym: string
  onChange: (ym: string) => void
  /** Подгрузить данные месяца заранее — вызывается при наведении на стрелку. */
  prefetch?: (ym: string) => void
}) {
  const isCurrent = ym === currentYm()
  const fetching = useIsFetching({ queryKey: ['finance'] }) > 0
  const warm = (delta: number) => () => { if (prefetch) prefetch(shiftYm(ym, delta)) }
  return (
    <div className="month-nav" role="group" aria-label="Выбор месяца">
      <button type="button" onClick={() => onChange(shiftYm(ym, -1))} onPointerEnter={warm(-1)} onFocus={warm(-1)}
        aria-label="Предыдущий месяц" title="Предыдущий месяц">‹</button>
      <span className="label" aria-live="polite">{monthLabel(ym, true)}</span>
      <button type="button" onClick={() => onChange(shiftYm(ym, 1))} onPointerEnter={warm(1)} onFocus={warm(1)}
        aria-label="Следующий месяц" title="Следующий месяц">›</button>
      {!isCurrent && (
        <button type="button" onClick={() => onChange(currentYm())}
          aria-label="Перейти к текущему месяцу" title="Текущий месяц" style={{ fontSize: 12 }}>сегодня</button>
      )}
      {fetching && <span className="month-nav-updating" role="status">Обновляется…</span>}
    </div>
  )
}
