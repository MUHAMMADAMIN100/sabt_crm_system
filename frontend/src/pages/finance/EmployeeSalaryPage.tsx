// Отдельная страница сотрудника: полная история ЗП (ставка + выплаты по
// месяцам). Открывается кнопкой «Детальная информация» из ведомости.
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import EmployeeSalaryHistory from './EmployeeSalaryHistory';
import FinIcon from './FinIcon';
import './finance.css';

export default function EmployeeSalaryPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const name = (location.state as any)?.name || 'Сотрудник';

  return (
    <div className="fin-root">
      <button type="button" className="back" onClick={() => navigate(-1)}
        style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}>
        <FinIcon name="chevronLeft" size={15} /> Ведомость
      </button>
      {id && <EmployeeSalaryHistory employeeId={id} name={name} onClose={() => navigate(-1)} />}
    </div>
  );
}
