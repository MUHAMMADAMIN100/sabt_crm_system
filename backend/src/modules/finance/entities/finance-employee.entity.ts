import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Сотрудник финансового учёта (для зарплатной ведомости). Собственная
 *  сущность финансов — заводится в «Настройки → Сотрудники». */
@Entity('finance_employees')
export class FinanceEmployee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  role: string | null;

  /** Категория/отдел для группировки зарплатной ведомости (SMM, Продакшн…). */
  @Column({ type: 'varchar', length: 80, nullable: true })
  category: string | null;

  /** Оклад в месяц. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  salary: number;

  /** История оклада по месяцу вступления: { '2026-07': 3000, '2026-08': 4000 }. */
  @Column({ type: 'jsonb', nullable: true })
  salaryHistory: Record<string, number> | null;

  /** LEGACY: старый «общий» аванс. Больше не участвует в расчётах —
   *  авансы теперь помесячные (advances). Колонка оставлена ради данных. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  advance: number;

  /** Авансы по месяцам: { '2026-08': 500 }. Каждый месяц начинается с нуля. */
  @Column({ type: 'jsonb', nullable: true })
  advances: Record<string, number> | null;

  /** Штрафы по месяцам: { '2026-08': 200 }. Вычитаются из «к выплате». */
  @Column({ type: 'jsonb', nullable: true })
  fines: Record<string, number> | null;

  /** Снапшоты выплаченных месяцев: { '2026-07': { salary, bonus, advance,
   *  fine, paid, paidAt } }. Выплаченный месяц ЗАМОРОЖЕН — любые будущие
   *  правки оклада/бонусов/авансов его не меняют (месяцы независимы). */
  @Column({ type: 'jsonb', nullable: true })
  salarySnapshots: Record<string, {
    salary: number; bonus: number; advance: number; fine: number;
    paid: number; paidAt: string;
    /** v2: paid уже включает авансы и остальные операции месяца. */
    paidIncludesAdvance?: boolean;
  }> | null;

  /** Суммы из старой помесячной таблицы без точной даты, счёта и разбивки.
   *  Это отдельные исторические факты, а не ставка и не банковская проводка. */
  @Column({ type: 'jsonb', nullable: true })
  legacyPayrollHistory: Record<string, {
    paid: number;
    source: 'notion';
  }> | null;

  /** Дата приёма на работу (ISO). */
  @Column({ type: 'date', nullable: true })
  hireDate: string | null;

  /** Последний день работы. Нужен, чтобы уволенный сотрудник оставался
   *  в исторических ведомостях, но не попадал в будущие начисления. */
  @Column({ type: 'date', nullable: true })
  terminationDate: string | null;

  /** Завершённые периоды работы при повторном найме. Текущий период остаётся
   * в hireDate/terminationDate, чтобы старые API продолжали работать. */
  @Column({ type: 'jsonb', nullable: true })
  employmentHistory: Array<{ hireDate: string; terminationDate: string }> | null;

  /** Бонусы по месяцам: { '2026-07': 500 }. Задаются вручную в зарплатной
   *  ведомости; входят в «к выплате», выплата создаёт расход как и оклад. */
  @Column({ type: 'jsonb', nullable: true })
  bonuses: Record<string, number> | null;

  /** active — учитывается в фонде ЗП; fired — нет. Legacy 'inactive' трактуем как fired. */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'fired';

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
