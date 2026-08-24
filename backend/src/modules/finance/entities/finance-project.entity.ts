import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** Направление проекта/клиента для финансов. */
export type FinanceDirection = 'smm' | 'development' | 'design' | 'maintenance';

/** Проект/клиент финансового учёта. Собственная сущность финансов
 *  (не FK на CRM-проекты) — заводится в «Настройки → Проекты/Клиенты». */
@Entity('finance_projects')
export class FinanceProject {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: 'smm' })
  direction: FinanceDirection;

  /** Тариф (месячная сумма контракта) — для колонки «план» в обзоре. */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  tariff: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** Дата заключения контракта (ISO) — исходная, правится только вручную. */
  @Column({ type: 'date', nullable: true })
  contractDate: string | null;

  /** Якорь SMM-цикла: дата последней ПОЛНОЙ оплаты. Катится вперёд при каждой
   *  полной оплате (просрочка сдвигает день следующего платежа) и
   *  пересчитывается из оплат при их отмене. NULL — оплат ещё не было,
   *  якорём служит contractDate. */
  @Column({ type: 'date', nullable: true })
  cycleAnchor: string | null;

  /** Архивный проект — больше не работаем; уходит из активных таблиц. */
  @Column({ type: 'boolean', default: false })
  archived: boolean;

  /** Статус жизненного цикла: lead | active | paused | done | archived.
   *  paused — клиент приостановил работу: проект уходит из планов/прогнозов
   *  и напоминаний, раз в 2 недели приходит ревизия «уточнить у клиента». */
  @Column({ type: 'varchar', length: 16, nullable: true, default: 'active' })
  status: string | null;

  /** Дата постановки на паузу — для «на паузе с …», ревизий раз в 2 недели
   *  и сдвига сроков замороженных платежей при возврате в работу. */
  @Column({ type: 'date', nullable: true })
  pausedAt: string | null;

  /** design: брендбук/логобук — оплата по месяцам (матрица), иначе разовая. */
  @Column({ type: 'boolean', default: false })
  multiMonth: boolean;

  /** SMM/обслуживание: ориентировочный срок сотрудничества в месяцах — на
   *  сколько вперёд планируем доход в календаре. NULL — «бессрочно»
   *  (проецируем на 12 мес. вперёд с автопродлением). */
  @Column({ type: 'int', nullable: true })
  retentionMonths: number | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
