import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** График смены, действующий С ДАТЫ.
 *
 *  Строк у человека много — по одной на каждое изменение. За любой день
 *  берётся та, у которой "validFrom" ближайшая снизу. Без этого правка
 *  графика переписывала бы прошлое: поставив монтажёру смену с 14:00, мы
 *  задним числом убирали бы все его августовские опоздания.
 *
 *  "userId" = NULL — общий график компании: по нему живёт тот, кому личный
 *  не задавали. "followsCompany" — пометка «с этой даты снова как у всех»
 *  (удалять строку нельзя, это опять переписало бы прошлое). */
@Entity('work_schedules')
@Index(['userId', 'validFrom'])
export class WorkSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** NULL — общий график компании. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /** С какого дня действует эта строка, 'YYYY-MM-DD'. */
  @Column({ type: 'date', default: () => `DATE '2000-01-01'` })
  validFrom: string;

  @Column({ type: 'varchar', length: 5, default: '09:00' })
  startTime: string;

  @Column({ type: 'varchar', length: 5, default: '18:00' })
  endTime: string;

  @Column({ type: 'int', default: 480 })
  normMinutes: number;

  /** Сколько минут после начала смены опозданием ещё не считается. */
  @Column({ type: 'int', default: 30 })
  graceMinutes: number;

  /** Рабочие дни недели: 1 — понедельник … 7 — воскресенье. */
  @Column({ type: 'varchar', length: 20, default: '1,2,3,4,5,6' })
  workdays: string;

  /** Нет фиксированного начала (выездные съёмки) — опоздания не считаем. */
  @Column({ type: 'boolean', default: false })
  floating: boolean;

  /** С этой даты человек снова живёт по общему графику компании. */
  @Column({ type: 'boolean', default: false })
  followsCompany: boolean;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
