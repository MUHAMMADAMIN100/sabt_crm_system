// Переключатель месяца — решает проблему «всё считается по текущему месяцу».
import { monthLabel, shiftYm, currentYm } from '../lib/format';

export default function MonthNav({ ym, onChange }: { ym: string; onChange: (ym: string) => void }) {
  const isCurrent = ym === currentYm();
  return (
    <div className="month-nav">
      <button onClick={() => onChange(shiftYm(ym, -1))} title="Предыдущий месяц">‹</button>
      <span className="label">{monthLabel(ym, true)}</span>
      <button onClick={() => onChange(shiftYm(ym, 1))} title="Следующий месяц">›</button>
      {!isCurrent && (
        <button onClick={() => onChange(currentYm())} title="Текущий месяц" style={{ fontSize: 12 }}>сегодня</button>
      )}
    </div>
  );
}
