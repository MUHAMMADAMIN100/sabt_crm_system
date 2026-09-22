import { Entity, PrimaryColumn, Column } from 'typeorm';

/** Личный график сотрудника: во сколько начинается его смена.
 *
 *  Без него опоздание считалось от общих 09:30, и монтажёр, выходящий после
 *  обеда, был «опоздавшим» каждый день. Строки может не быть — тогда
 *  действует общий график компании. */
@Entity('work_schedules')
export class WorkSchedule {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

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

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
