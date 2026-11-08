// Отдельная страница сотрудника: полная история ЗП (ставка + выплаты по
// месяцам). Открывается кнопкой «Детальная информация» из ведомости.
import { useParams, useLocation } from 'react-router-dom';
import { useBackTarget } from '@/lib/navMemory';
import EmployeeSalaryHistory from './EmployeeSalaryHistory';
import FinIcon from './FinIcon';
import './finance.css';

export default function EmployeeSalaryPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const name = (location.state as any)?.name || 'Сотрудник';
  // «‹» — на шаг назад, а по прямой ссылке — в ведомость (08.11.2026).
  const back = useBackTarget('/finance/expense/salary', 'Ведомость');

  return (
    <div className="fin-root">
      <button type="button" className="back" onClick={() => back.go()}
        style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
        <FinIcon name="chevronLeft" size={15} /> {back.label}
      </button>
      {id && <EmployeeSalaryHistory employeeId={id} name={name} onClose={() => back.go()} />}
    </div>
  );
}
