import { Entity, PrimaryColumn, Column } from 'typeorm';

/** Настройки финмодуля (key-value). Напр. openingBalances по счетам. */
@Entity('finance_settings')
export class FinanceSetting {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key: string;

  @Column({ type: 'jsonb', nullable: true })
  value: any;
}
