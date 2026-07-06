// Переключатель месяца «‹ Июль 2026 ›» (+ кнопка «сегодня», если выбран не текущий).
import { monthLabel, shiftYm, currentYm } from './finlib'

export default function MonthNav({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  const isCurrent = ym === currentYm()
  return (
    <div className="month-nav">
      <button type="button" onClick={() => onChange(shiftYm(ym, -1))} title="Предыдущий месяц">‹</button>
      <span className="label">{monthLabel(ym, true)}</span>
      <button type="button" onClick={() => onChange(shiftYm(ym, 1))} title="Следующий месяц">›</button>
      {!isCurrent && (
        <button type="button" onClick={() => onChange(currentYm())} title="Текущий месяц" style={{ fontSize: 12 }}>сегодня</button>
      )}
    </div>
  )
}
