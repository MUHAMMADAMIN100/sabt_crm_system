import { Entity, PrimaryColumn, Column } from 'typeorm';

/** Настройки смен и авто-штрафа — одна строка на всю компанию. */
@Entity('shift_settings')
export class ShiftSettings {
  @PrimaryColumn({ type: 'boolean', default: true })
  id: boolean;

  /** Штрафовать за опоздание без предупреждения автоматически. */
  @Column({ type: 'boolean', default: false })
  autoFine: boolean;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 100 })
  fineAmount: number;

  /** Допуск после начала смены — общий, если у человека не задан свой. */
  @Column({ type: 'int', default: 30 })
  graceMinutes: number;

  /** Час, когда система подводит итог дня и проводит штрафы. */
  @Column({ type: 'int', default: 21 })
  runHour: number;

  /** За сколько дней просьба «приду позже» должна быть подана. */
  @Column({ type: 'int', default: 1 })
  noticeDaysBefore: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
