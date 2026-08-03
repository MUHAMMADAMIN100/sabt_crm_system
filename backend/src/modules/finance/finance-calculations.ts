import { FinanceTransaction, FinanceTxStatus } from './finance-transaction.entity';

/** Денежные значения хранятся с двумя знаками; полкопейки — безопасный
 * допуск при сравнении уже округлённых сумм. */
export const FINANCE_AMOUNT_TOLERANCE = 0.005;

/** Зарплатный период для даты выплаты: до и включая 10-е число закрывается
 * предыдущий месяц, с 11-го начинается начисление текущего месяца. */
export function salaryPeriodForDate(iso: string): string {
  const [year, month, day] = (iso || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return (iso || '').slice(0, 7);
  if (day <= 10) {
    const previous = new Date(year, month - 2, 1);
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Фактической проводкой считается completed. NULL оставлен как completed
 * только для совместимости со старыми строками до появления default-статуса. */
export function isPostedFinanceTransaction(
  tx: Pick<FinanceTransaction, 'status'>,
): boolean {
  return tx.status == null || tx.status === FinanceTxStatus.COMPLETED;
}

/** Текущий остаток не должен учитывать будущие проводки. Сравнение корректно
 * для обязательного DATE-поля в ISO-формате YYYY-MM-DD. */
export function isPostedFinanceTransactionAsOf(
  tx: Pick<FinanceTransaction, 'status' | 'date'>,
  asOf: string,
): boolean {
  return isPostedFinanceTransaction(tx) && tx.date <= asOf;
}

/** Проект участвует в денежных планах только пока реально приносит доход.
 * Единый предикат нужен расчётам, деталям и напоминаниям: иначе завершённый
 * проект исчезает из итога, но продолжает создавать планы и уведомления. */
export function isEarningFinanceProject(
  project: { archived?: boolean; status?: string | null },
): boolean {
  return !project.archived
    && !['lead', 'paused', 'done', 'archived'].includes(project.status || 'active');
}

/** Неоплаченная часть обязательства с единым денежным допуском. */
export function remainingFinanceAmount(total: number, paid: number): number {
  const remaining = Math.max(0, Number(total) - Number(paid));
  if (remaining <= FINANCE_AMOUNT_TOLERANCE) return 0;
  return Math.round(remaining * 100) / 100;
}

/** Оклад, действующий в выбранном месяце. Берём последнюю ставку, дата
 * которой не позже месяца; legacy salary остаётся fallback. */
export function salaryForFinanceMonth(
  employee: {
    salary?: number | string | null;
    salaryHistory?: Record<string, number> | null;
  },
  ym: string,
): number {
  const history = employee.salaryHistory || {};
  const effective = Object.keys(history).filter(month => month <= ym).sort().pop();
  const amount = effective ? Number(history[effective]) : Number(employee.salary);
  return Math.round((Number.isFinite(amount) ? amount : 0) * 100) / 100;
}

/** Состав зарплатной ведомости на конкретный месяц. Для legacy-сотрудника
 * без даты увольнения закрытый снимок остаётся единственным надёжным фактом
 * его присутствия в старой ведомости. */
export function workedInFinanceMonth(
  employee: {
    hireDate?: string | null;
    terminationDate?: string | null;
    employmentHistory?: Array<{ hireDate?: string | null; terminationDate?: string | null }> | null;
    status?: string | null;
    salarySnapshots?: Record<string, unknown> | null;
  },
  ym: string,
): boolean {
  const workedInPeriod = (hireDate?: string | null, terminationDate?: string | null) => {
    const hireYm = (hireDate || '').slice(0, 7);
    const terminationYm = (terminationDate || '').slice(0, 7);
    return (!hireYm || hireYm <= ym) && (!terminationYm || ym <= terminationYm);
  };
  if ((employee.employmentHistory || []).some(period =>
    workedInPeriod(period.hireDate, period.terminationDate))) return true;
  // Закрытый снимок — неизменяемый факт присутствия в старой ведомости.
  // Проверяем его до текущей даты приёма: после повторного найма hireDate
  // относится уже к новому периоду и не должна скрывать legacy-снимок.
  if (employee.salarySnapshots?.[ym]) return true;
  const hireYm = (employee.hireDate || '').slice(0, 7);
  const terminationYm = (employee.terminationDate || '').slice(0, 7);
  if (hireYm && hireYm > ym) return false;
  if (terminationYm) return ym <= terminationYm;
  if (employee.status === 'active' || !employee.status) return true;
  return false;
}
