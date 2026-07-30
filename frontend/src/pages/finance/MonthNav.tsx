// Переключатель месяца «‹ Июль 2026 ›» (+ кнопка «сегодня», если выбран не текущий).
import { monthLabel, shiftYm, currentYm } from './finlib'

export default function MonthNav({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  const isCurrent = ym === currentYm()
  return (
    <div className="month-nav" role="group" aria-label="Выбор месяца">
      <button type="button" onClick={() => onChange(shiftYm(ym, -1))}
        aria-label="Предыдущий месяц" title="Предыдущий месяц">‹</button>
      <span className="label" aria-live="polite">{monthLabel(ym, true)}</span>
      <button type="button" onClick={() => onChange(shiftYm(ym, 1))}
        aria-label="Следующий месяц" title="Следующий месяц">›</button>
      {!isCurrent && (
        <button type="button" onClick={() => onChange(currentYm())}
          aria-label="Перейти к текущему месяцу" title="Текущий месяц" style={{ fontSize: 12 }}>сегодня</button>
      )}
    </div>
  )
}
