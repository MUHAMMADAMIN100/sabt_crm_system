import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** План продаж менеджера на месяц (решение владельца 19.10.2026): сумму
 *  ставит основатель на странице «Сотрудники», сделанное CRM считает сама —
 *  оплаты клиентов менеджера по «Финансам». */
@Entity('sales_plans')
@Index(['userId', 'ym'], { unique: true })
export class SalesPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  /** Месяц плана: YYYY-MM. */
  @Column({ type: 'varchar', length: 7 })
  ym: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'uuid', nullable: true })
  updatedById: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
