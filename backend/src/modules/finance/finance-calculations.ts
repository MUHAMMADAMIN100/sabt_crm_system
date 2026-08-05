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

type SalaryHistoryRepairEmployee = {
  salary?: number | string | null;
  hireDate?: string | null;
  createdAt?: string | Date | null;
  salaryHistory?: Record<string, number> | null;
  salarySnapshots?: Record<string, { salary?: number | string | null } | null> | null;
};

type SalaryHistoryRepairOptions = {
  asOfYm: string;
  baselineSalary?: number | null;
  confirmedRates?: Record<string, number>;
  explicitRates?: Record<string, number>;
};

const VALID_YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const roundedAmount = (value: unknown) =>
  Math.round((Number.isFinite(Number(value)) ? Number(value) : 0) * 100) / 100;

/** Удаляет только артефакты старой миграции, которая ошибочно считала
 * snapshot.salary установленным окладом. Ставки, явно сохранённые человеком,
 * подтверждённые исходными данными и текущий оклад остаются источником истины. */
export function repairFinanceSalaryHistory(
  employee: SalaryHistoryRepairEmployee,
  options: SalaryHistoryRepairOptions,
): Record<string, number> {
  const explicitRates = Object.fromEntries(Object.entries(options.explicitRates || {})
    .filter(([ym]) => VALID_YM.test(ym))
    .map(([ym, amount]) => [ym, roundedAmount(amount)]));
  const confirmedRates = Object.fromEntries(Object.entries(options.confirmedRates || {})
    .filter(([ym]) => VALID_YM.test(ym))
    .map(([ym, amount]) => [ym, roundedAmount(amount)]));
  const snapshots = employee.salarySnapshots || {};
  const repaired: Record<string, number> = {};

  for (const [ym, rawAmount] of Object.entries(employee.salaryHistory || {})) {
    if (!VALID_YM.test(ym)) continue;
    const amount = roundedAmount(rawAmount);
    const snapshot = snapshots[ym];
    const copiedFromSnapshot = snapshot != null
      && Math.abs(amount - roundedAmount(snapshot.salary)) < FINANCE_AMOUNT_TOLERANCE;
    const explicitlyConfirmed = (explicitRates[ym] != null
      && Math.abs(explicitRates[ym] - amount) < FINANCE_AMOUNT_TOLERANCE)
      || (confirmedRates[ym] != null
        && Math.abs(confirmedRates[ym] - amount) < FINANCE_AMOUNT_TOLERANCE);
    if (!copiedFromSnapshot || explicitlyConfirmed) repaired[ym] = amount;
  }

  const rawBaselineYm = String(employee.hireDate || employee.createdAt || options.asOfYm).slice(0, 7);
  const baselineYm = VALID_YM.test(rawBaselineYm) ? rawBaselineYm : options.asOfYm;
  if (options.baselineSalary != null) {
    repaired[baselineYm] = roundedAmount(options.baselineSalary);
  } else if (!Object.keys(repaired).some(ym => ym <= baselineYm)) {
    repaired[baselineYm] = roundedAmount(employee.salary);
  }

  Object.assign(repaired, confirmedRates, explicitRates);

  const hasFutureRate = Object.keys(repaired).some(ym => ym > options.asOfYm);
  const currentSalary = roundedAmount(employee.salary);
  if (!hasFutureRate
    && Math.abs(salaryForFinanceMonth({ salary: currentSalary, salaryHistory: repaired }, options.asOfYm)
      - currentSalary) >= FINANCE_AMOUNT_TOLERANCE) {
    repaired[options.asOfYm] = currentSalary;
  }

  // После удаления ложной промежуточной точки одинаковые соседние ставки
  // больше не являются изменением и не должны засорять историю.
  const compact: Record<string, number> = {};
  let previous: number | null = null;
  for (const ym of Object.keys(repaired).sort()) {
    const amount = repaired[ym];
    if (previous != null && Math.abs(previous - amount) < FINANCE_AMOUNT_TOLERANCE) continue;
    compact[ym] = amount;
    previous = amount;
  }
  return compact;
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
